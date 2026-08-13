const { amountToCents, getStripeClient } = require("./_utils/payments");
const { getAdminClient, handleApiError, publicApiError, sendJson } = require("./_utils/supabase");

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
    const { bookingId } = req.body || {};
    if (!bookingId) {
      throw publicApiError("Missing booking ID.", 400, "missing_booking_id");
    }

    const supabase = getAdminClient();
    const { data: booking, error } = await supabase
      .from("bookings")
      .select(
        `
        id,
        service,
        dropoff_date,
        pickup_date,
        estimated_total,
        deposit_due_today,
        remaining_balance,
        owner:owners(first_name,last_name,email),
        dog:dogs(name)
      `,
      )
      .eq("id", bookingId)
      .single();

    if (error || !booking) {
      throw publicApiError("We could not find this booking request.", 404, "booking_not_found");
    }

    const depositCents = amountToCents(booking.deposit_due_today);
    if (!depositCents) {
      throw publicApiError("This booking does not have a valid deposit amount.", 400, "invalid_deposit");
    }

    const stripe = getStripeClient();
    const origin = getOrigin(req);
    const customerEmail = booking.owner?.email || undefined;
    const dogName = booking.dog?.name || "Guest dog";
    const serviceLabel = booking.service ? booking.service.charAt(0).toUpperCase() + booking.service.slice(1) : "Booking";

    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      mode: "payment",
      customer_email: customerEmail,
      return_url: `${origin}/index.html?stripe_session_id={CHECKOUT_SESSION_ID}`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: depositCents,
            product_data: {
              name: `Shingo's Palace ${serviceLabel} Deposit`,
              description: `${dogName} · ${booking.dropoff_date || ""} to ${booking.pickup_date || ""}`,
            },
          },
        },
      ],
      metadata: {
        booking_id: booking.id,
        dog_name: dogName,
        estimated_total: booking.estimated_total || "",
        deposit_due_today: booking.deposit_due_today || "",
        remaining_balance: booking.remaining_balance || "",
      },
    });

    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        stripe_checkout_session_id: session.id,
        payment_status: "pending",
        status: "deposit_pending",
      })
      .eq("id", booking.id);

    if (updateError) {
      throw publicApiError(
        "We created the Stripe payment, but could not link it to the booking. Please check the bookings payment columns.",
        500,
        "payment_link_failed",
      );
    }

    sendJson(res, 200, {
      ok: true,
      sessionId: session.id,
      clientSecret: session.client_secret,
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
