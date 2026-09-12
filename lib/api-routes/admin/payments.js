const { buildBalancePaidEmail, buildDepositConfirmationEmail, sendResendEmail } = require("../../api-utils/booking-emails");
const { amountToCents, centsToCurrency } = require("../../api-utils/payments");
const { parseMultipartForm } = require("../../api-utils/forms");
const {
  getAdminClient,
  handleApiError,
  normalizeField,
  publicApiError,
  requireAdminUser,
  sendJson,
} = require("../../api-utils/supabase");

const PAYMENT_SELECT = `
  id,
  owner_id,
  dog_id,
  service,
  pet_type,
  booking_pet_summary,
  dropoff_date,
  pickup_date,
  estimated_total,
  deposit_due_today,
  remaining_balance,
  status,
  payment_status,
  deposit_payment_method,
  deposit_paid_amount,
  deposit_paid_at,
  balance_payment_status,
  balance_payment_method,
  balance_paid_amount,
  balance_paid_at,
  zelle_deposit_confirmed_at,
  zelle_deposit_reference,
  zelle_deposit_note,
  zelle_balance_confirmed_at,
  zelle_balance_reference,
  zelle_balance_note,
  created_at,
  owner:owners(first_name,last_name,email,phone),
  dog:dogs(id,name,pet_type),
  booking_pets(dog_id,pet_type,dog:dogs(id,name,pet_type))
`;

function originFromRequest(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${host}`;
}

async function sendManualPaymentEmail(booking, paymentType, amountPaid, req) {
  if (!booking.owner?.email) return;
  const builder = paymentType === "balance" ? buildBalancePaidEmail : buildDepositConfirmationEmail;
  const email = builder({ booking, amountPaid, origin: originFromRequest(req) });
  try {
    await sendResendEmail({ to: booking.owner.email, subject: email.subject, html: email.html, text: email.text });
  } catch (error) {
    console.error("Manual Zelle confirmation email failed after payment was saved.", {
      bookingId: booking.id,
      paymentType,
      error: error?.message || error,
    });
  }
}

module.exports = async function handler(req, res) {
  try {
    const supabase = getAdminClient();
    const admin = await requireAdminUser(req, supabase);

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("bookings")
        .select(PAYMENT_SELECT)
        .or("deposit_payment_method.eq.zelle,balance_payment_method.eq.zelle")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      sendJson(res, 200, { ok: true, payments: data || [] });
      return;
    }

    if (req.method !== "PATCH") {
      sendJson(res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    const { fields } = await parseMultipartForm(req);
    const bookingId = normalizeField(fields.bookingId);
    const paymentType = normalizeField(fields.paymentType) === "balance" ? "balance" : "deposit";
    const reference = normalizeField(fields.reference);
    const note = normalizeField(fields.note);
    if (!bookingId) throw publicApiError("Booking ID is required.", 400, "missing_booking_id");

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(PAYMENT_SELECT)
      .eq("id", bookingId)
      .single();
    if (bookingError || !booking) throw publicApiError("Booking not found.", 404, "booking_not_found");

    const expected = paymentType === "balance" ? booking.remaining_balance : booking.deposit_due_today;
    const expectedCents = amountToCents(expected);
    const submittedCents = amountToCents(normalizeField(fields.amount));
    if (!expectedCents || submittedCents !== expectedCents) {
      throw publicApiError(`The confirmed amount must exactly match ${expected}.`, 400, "zelle_amount_mismatch");
    }
    if (paymentType === "balance" && booking.balance_payment_status === "paid") {
      throw publicApiError("This remaining balance is already paid.", 409, "balance_already_paid");
    }
    if (paymentType === "deposit" && ["deposit_paid", "paid_in_full"].includes(booking.payment_status)) {
      throw publicApiError("This deposit is already paid.", 409, "deposit_already_paid");
    }

    const now = new Date().toISOString();
    const amountPaid = centsToCurrency(submittedCents);
    const updatePayload = paymentType === "balance"
      ? {
          balance_payment_method: "zelle",
          balance_payment_status: "paid",
          balance_paid_amount: amountPaid,
          balance_paid_at: now,
          zelle_balance_confirmed_at: now,
          zelle_balance_reference: reference || null,
          zelle_balance_note: note || null,
          remaining_balance: "$0",
          payment_status: "paid_in_full",
          status: "paid_in_full",
        }
      : {
          deposit_payment_method: "zelle",
          payment_status: "deposit_paid",
          deposit_paid_amount: amountPaid,
          deposit_paid_at: now,
          zelle_deposit_confirmed_at: now,
          zelle_deposit_reference: reference || null,
          zelle_deposit_note: note || null,
          status: "deposit_paid",
        };

    const { data: updated, error: updateError } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", booking.id)
      .select(PAYMENT_SELECT)
      .single();
    if (updateError) throw updateError;

    await sendManualPaymentEmail(updated, paymentType, amountPaid, req);
    sendJson(res, 200, {
      ok: true,
      booking: updated,
      paymentType,
      amountPaid,
      confirmedBy: admin.email,
    });
  } catch (error) {
    handleApiError(res, error);
  }
};

module.exports.config = { api: { bodyParser: false } };
