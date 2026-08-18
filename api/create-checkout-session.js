const { amountToCents, getStripeClient } = require("../lib/api-utils/payments");
const { getAdminClient, handleApiError, publicApiError, sendJson } = require("../lib/api-utils/supabase");

function getOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${host}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const { bookingId, paymentType = "deposit" } = req.body || {};
    if (!bookingId) {
      throw publicApiError("Missing booking ID.", 400, "missing_booking_id");
    }

    const supabase = getAdminClient();
    const isBalancePayment = paymentType === "balance";
    const bookingSelect = isBalancePayment
      ? `
        id,
        service,
        dropoff_date,
        pickup_date,
        estimated_total,
        deposit_due_today,
        remaining_balance,
        pet_type,
        booking_pet_summary,
        balance_payment_status,
        owner:owners(first_name,last_name,email),
        dog:dogs(name),
        booking_pets(
          pet_type,
          dog:dogs(name)
        )
      `
      : `
        id,
        service,
        dropoff_date,
        pickup_date,
        estimated_total,
        deposit_due_today,
        remaining_balance,
        pet_type,
        booking_pet_summary,
        owner:owners(first_name,last_name,email),
        dog:dogs(name),
        booking_pets(
          pet_type,
          dog:dogs(name)
        )
      `;

    const { data: booking, error } = await supabase.from("bookings").select(bookingSelect).eq("id", bookingId).single();

    if (error || !booking) {
      throw publicApiError("We could not find this booking request.", 404, "booking_not_found");
    }

    if (isBalancePayment && booking.balance_payment_status === "paid") {
      throw publicApiError("The remaining balance for this booking has already been paid.", 409, "balance_already_paid");
    }

    const amountCents = isBalancePayment ? amountToCents(booking.remaining_balance) : amountToCents(booking.deposit_due_today);
    if (!amountCents) {
      throw publicApiError(
        isBalancePayment
          ? "This booking does not have a valid remaining balance."
          : "This booking does not have a valid deposit amount.",
        400,
        isBalancePayment ? "invalid_remaining_balance" : "invalid_deposit",
      );
    }

    const stripe = getStripeClient();
    const origin = getOrigin(req);
    const customerEmail = booking.owner?.email || undefined;
    const petNames = (booking.booking_pets || []).map((item) => item.dog?.name).filter(Boolean);
    const petName = booking.booking_pet_summary || petNames.join(", ") || booking.dog?.name || "Guest pet";
    const serviceLabel = booking.service ? booking.service.charAt(0).toUpperCase() + booking.service.slice(1) : "Booking";
    const paymentLabel = isBalancePayment ? "Remaining Balance" : "Deposit";

    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: customerEmail,
      return_url: `${origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: `Shingo's Palace ${serviceLabel} ${paymentLabel}`,
              description: `${petName} · ${booking.dropoff_date || ""} to ${booking.pickup_date || ""}`,
            },
          },
        },
      ],
      metadata: {
        booking_id: booking.id,
        payment_type: isBalancePayment ? "balance" : "deposit",
        pet_name: petName,
        dog_name: petName,
        pet_type: booking.pet_type || "dog",
        estimated_total: booking.estimated_total || "",
        deposit_due_today: booking.deposit_due_today || "",
        remaining_balance: booking.remaining_balance || "",
      },
    });

    const updatePayload = isBalancePayment
      ? {
          stripe_balance_checkout_session_id: session.id,
          balance_payment_status: "pending",
        }
      : {
          stripe_checkout_session_id: session.id,
          payment_status: "pending",
          status: "deposit_pending",
        };

    const { error: updateError } = await supabase.from("bookings").update(updatePayload).eq("id", booking.id);

    if (updateError) {
      throw publicApiError(
        isBalancePayment
          ? "We created the balance payment, but could not link it to the booking. Please run the remaining balance payment migration in Supabase."
          : "We created the Stripe payment, but could not link it to the booking. Please check the bookings payment columns.",
        500,
        isBalancePayment ? "balance_payment_link_failed" : "payment_link_failed",
      );
    }

    sendJson(res, 200, {
      ok: true,
      sessionId: session.id,
      clientSecret: session.client_secret,
      paymentType: isBalancePayment ? "balance" : "deposit",
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
