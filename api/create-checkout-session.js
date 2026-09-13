const { getBookingPetDisplay, serviceLabel } = require("../lib/api-utils/booking-emails");
const { amountToCents, getStripeClient } = require("../lib/api-utils/payments");
const { getAdminClient, handleApiError, publicApiError, sendJson } = require("../lib/api-utils/supabase");
const { authorizeBookingAction, enforceRateLimit, trustedOrigin } = require("../lib/api-utils/request-security");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  if (!enforceRateLimit(req, res, { key: "checkout-session", limit: 30, windowMs: 15 * 60 * 1000 })) return;

  try {
    const { bookingId, paymentType = "deposit", paymentMethod = "stripe", action = "checkout", actionToken = "" } = req.body || {};
    if (!bookingId) {
      throw publicApiError("Missing booking ID.", 400, "missing_booking_id");
    }

    const supabase = getAdminClient();
    const isBalancePayment = paymentType === "balance";
    const bookingSelect = isBalancePayment
      ? `
        id,
        owner_id,
        updated_at,
        service,
        dropoff_date,
        pickup_date,
        estimated_total,
        deposit_due_today,
        remaining_balance,
        pet_type,
        booking_pet_summary,
        balance_payment_status,
        balance_payment_method,
        stripe_balance_checkout_session_id,
        owner:owners(first_name,last_name,email),
        dog:dogs(name),
        booking_pets(
          pet_type,
          dog:dogs(name)
        )
      `
      : `
        id,
        owner_id,
        updated_at,
        service,
        dropoff_date,
        pickup_date,
        estimated_total,
        deposit_due_today,
        remaining_balance,
        pet_type,
        booking_pet_summary,
        stripe_checkout_session_id,
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

    await authorizeBookingAction({
      req,
      supabase,
      booking,
      scope: isBalancePayment ? "balance" : "deposit",
      token: actionToken,
    });

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

    if (action === "details") {
      const petData = getBookingPetDisplay(booking);
      sendJson(res, 200, {
        ok: true,
        bookingId: booking.id,
        paymentType: isBalancePayment ? "balance" : "deposit",
        amount: isBalancePayment ? booking.remaining_balance : booking.deposit_due_today,
        service: booking.service,
        serviceLabel: serviceLabel(booking.service),
        petName: petData.namesDisplay,
        balancePaymentStatus: booking.balance_payment_status || "",
      });
      return;
    }

    if (paymentMethod === "zelle") {
      if (!isBalancePayment) {
        throw publicApiError("Zelle deposits must be selected in the booking form.", 400, "invalid_zelle_deposit_flow");
      }
      if (!process.env.ZELLE_PAYMENT_RECIPIENT) {
        throw publicApiError("Zelle is not configured right now. Please choose card payment.", 503, "zelle_not_configured");
      }

      const { error: zelleUpdateError } = await supabase
        .from("bookings")
        .update({
          balance_payment_method: "zelle",
          balance_payment_status: "awaiting_zelle_payment",
        })
        .eq("id", booking.id);
      if (zelleUpdateError) {
        throw publicApiError("We could not save the Zelle payment request.", 500, "zelle_balance_update_failed");
      }

      sendJson(res, 200, {
        ok: true,
        manual: true,
        bookingId: booking.id,
        paymentType: "balance",
        paymentMethod: "zelle",
        amount: booking.remaining_balance,
      });
      return;
    }

    if (paymentMethod !== "stripe") {
      throw publicApiError("Please select a valid payment method.", 400, "invalid_payment_method");
    }

    const stripe = getStripeClient();
    const origin = trustedOrigin(req);
    const customerEmail = booking.owner?.email || undefined;
    const petData = getBookingPetDisplay(booking);
    const petName = petData.namesDisplay;
    const serviceName = serviceLabel(booking.service);
    const paymentLabel = isBalancePayment ? "Remaining Balance" : "Deposit";

    const storedCheckoutSessionId = isBalancePayment
      ? booking.stripe_balance_checkout_session_id
      : booking.stripe_checkout_session_id;
    if (storedCheckoutSessionId) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(storedCheckoutSessionId);
        const samePayment = existingSession.metadata?.booking_id === booking.id
          && existingSession.metadata?.payment_type === (isBalancePayment ? "balance" : "deposit")
          && Number(existingSession.amount_total || 0) === amountCents;
        if (samePayment && existingSession.status === "open" && existingSession.client_secret) {
          sendJson(res, 200, {
            ok: true,
            sessionId: existingSession.id,
            clientSecret: existingSession.client_secret,
            paymentType: isBalancePayment ? "balance" : "deposit",
          });
          return;
        }
      } catch (error) {
        // A missing or expired prior session is replaced below with the same authoritative amount.
      }
    }

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
              name: `Shingo's Palace ${serviceName} ${paymentLabel}`,
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
    }, {
      idempotencyKey: ["booking", booking.id, isBalancePayment ? "balance" : "deposit", amountCents, booking.updated_at || "initial"].join(":"),
    });

    const updatePayload = isBalancePayment
      ? {
          stripe_balance_checkout_session_id: session.id,
          balance_payment_method: "stripe",
          balance_payment_status: "pending",
        }
      : {
          stripe_checkout_session_id: session.id,
          deposit_payment_method: "stripe",
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
