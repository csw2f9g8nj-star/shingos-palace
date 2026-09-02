const { buildBalanceReminderEmail, getBalanceDueDate, sendResendEmail } = require("../lib/api-utils/booking-emails");
const { amountToCents } = require("../lib/api-utils/payments");
const { getAdminClient, handleApiError, publicApiError, sendJson } = require("../lib/api-utils/supabase");

function getOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${host}`;
}

function dateInNewYork(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function tomorrowInNewYork() {
  return dateInNewYork(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

function assertCronAccess(req) {
  const cronSecret = process.env.CRON_SECRET || "";
  if (!cronSecret) {
    throw publicApiError("Payment reminders need CRON_SECRET configured in Vercel.", 500, "missing_cron_secret");
  }

  const authToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const headerToken = req.headers["x-cron-secret"] || "";
  if (authToken !== cronSecret && headerToken !== cronSecret) {
    throw publicApiError("Unauthorized reminder request.", 401, "unauthorized_cron");
  }
}

async function claimReminderSend(supabase, bookingId) {
  const timestamp = new Date().toISOString();
  const { data, error } = await supabase
    .from("bookings")
    .update({ balance_reminder_sent_at: timestamp })
    .eq("id", bookingId)
    .is("balance_reminder_sent_at", null)
    .select("id,balance_reminder_sent_at")
    .maybeSingle();

  if (error) {
    throw Object.assign(publicApiError("Could not reserve this reminder send.", 500, "reminder_claim_failed"), {
      supabaseCode: error.code,
      supabaseMessage: error.message,
      details: error.details,
      hint: error.hint,
    });
  }

  return data ? timestamp : "";
}

async function releaseReminderClaim(supabase, bookingId, timestamp) {
  if (!timestamp) return;
  await supabase.from("bookings").update({ balance_reminder_sent_at: null }).eq("id", bookingId).eq("balance_reminder_sent_at", timestamp);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    assertCronAccess(req);
    const supabase = getAdminClient();
    const targetDate = tomorrowInNewYork();

    const { data: bookings, error } = await supabase
      .from("bookings")
      .select(
        `
        id,
        service,
        status,
        dropoff_date,
        pickup_date,
        estimated_total,
        deposit_due_today,
        deposit_paid_amount,
        remaining_balance,
        booking_pet_summary,
        balance_payment_status,
        balance_reminder_sent_at,
        payment_status,
        owner:owners(first_name,last_name,email),
        dog:dogs(name),
        booking_pets(
          pet_type,
          dog:dogs(name)
        )
      `,
      )
      .eq("dropoff_date", targetDate)
      .is("balance_reminder_sent_at", null)
      .neq("balance_payment_status", "paid");

    if (error) {
      throw publicApiError("Could not load bookings for payment reminders.", 500, "reminder_booking_lookup_failed");
    }

    const origin = getOrigin(req);
    const dueBookings = (bookings || []).filter((booking) => {
      const hasDeposit = booking.payment_status === "deposit_paid" || booking.deposit_paid_amount;
      const hasBalance = amountToCents(booking.remaining_balance) > 0;
      const isCancelled = ["cancelled", "canceled"].includes(String(booking.status || "").toLowerCase());
      return hasDeposit && hasBalance && booking.owner?.email && !isCancelled && getBalanceDueDate(booking) === targetDate;
    });

    const sent = [];
    for (const booking of dueBookings) {
      const claimTimestamp = await claimReminderSend(supabase, booking.id);
      if (!claimTimestamp) continue;

      try {
        const email = buildBalanceReminderEmail({ booking, origin });
        await sendResendEmail({
          to: booking.owner.email,
          subject: email.subject,
          html: email.html,
          text: email.text,
        });
        sent.push(booking.id);
      } catch (error) {
        await releaseReminderClaim(supabase, booking.id, claimTimestamp);
        throw error;
      }
    }

    sendJson(res, 200, {
      ok: true,
      targetDate,
      checked: bookings?.length || 0,
      sent: sent.length,
      bookingIds: sent,
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
