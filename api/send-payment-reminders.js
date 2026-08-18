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

function serviceLabel(service) {
  const labels = {
    boarding: "Boarding",
    daycare: "Daycare",
    walking: "Dog Walking",
    grooming: "Grooming",
  };
  return labels[service] || service || "Reservation";
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmail({ booking, origin }) {
  const ownerName = [booking.owner?.first_name, booking.owner?.last_name].filter(Boolean).join(" ").trim() || "there";
  const petNames = (booking.booking_pets || []).map((item) => item.dog?.name).filter(Boolean);
  const dogName = booking.booking_pet_summary || petNames.join(", ") || booking.dog?.name || "your pet";
  const payUrl = `${origin}/balance-payment.html?booking_id=${encodeURIComponent(booking.id)}`;
  const service = serviceLabel(booking.service);
  const dates = `${booking.dropoff_date || ""} to ${booking.pickup_date || ""}`;
  const total = booking.estimated_total || "-";
  const deposit = booking.deposit_paid_amount || booking.deposit_due_today || "-";
  const remaining = booking.remaining_balance || "-";

  const text = [
    `Hi ${ownerName},`,
    "",
    "Your Shingo's Palace stay is almost here.",
    "",
    `Pet: ${dogName}`,
    `Service: ${service}`,
    `Dates: ${dates}`,
    `Total reservation amount: ${total}`,
    `Deposit already paid: ${deposit}`,
    `Remaining balance: ${remaining}`,
    "",
    `Pay Remaining Balance: ${payUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#24302f;max-width:620px;margin:0 auto;padding:28px;background:#fffaf4;">
      <h1 style="font-size:26px;line-height:1.2;margin:0 0 12px;color:#24302f;">Your Shingo's Palace stay is almost here 🐾</h1>
      <p>Hi ${escapeHtml(ownerName)},</p>
      <p>We're looking forward to welcoming ${escapeHtml(dogName)} soon.</p>
      <div style="background:#ffffff;border:1px solid #eadfce;border-radius:18px;padding:20px;margin:24px 0;">
        <p><strong>Pet:</strong> ${escapeHtml(dogName)}</p>
        <p><strong>Service:</strong> ${escapeHtml(service)}</p>
        <p><strong>Booking dates:</strong> ${escapeHtml(dates)}</p>
        <p><strong>Total reservation amount:</strong> ${escapeHtml(total)}</p>
        <p><strong>Deposit already paid:</strong> ${escapeHtml(deposit)}</p>
        <p><strong>Remaining balance:</strong> ${escapeHtml(remaining)}</p>
      </div>
      <p>
        <a href="${payUrl}" style="display:inline-block;background:#4c8f85;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700;">
          Pay Remaining Balance
        </a>
      </p>
      <p style="font-size:13px;color:#687674;">If you've already arranged to pay at check-in, you can ignore this message.</p>
    </div>
  `;

  return { html, text };
}

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = process.env.REMINDER_FROM_EMAIL || "Shingo's Palace <info@shingospalace.com>";

  if (!apiKey) {
    throw publicApiError("Payment reminders need RESEND_API_KEY configured in Vercel.", 500, "missing_resend_api_key");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw publicApiError(payload.message || "Resend could not send the payment reminder.", 500, "resend_failed");
  }
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
      return hasDeposit && hasBalance && booking.owner?.email;
    });

    const sent = [];
    for (const booking of dueBookings) {
      const email = buildEmail({ booking, origin });
      await sendEmail({
        to: booking.owner.email,
        subject: "Your Shingo's Palace stay is almost here 🐾",
        html: email.html,
        text: email.text,
      });

      const { error: updateError } = await supabase
        .from("bookings")
        .update({ balance_reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id);

      if (updateError) {
        throw publicApiError("The reminder was sent, but could not be marked as sent.", 500, "reminder_mark_failed");
      }

      sent.push(booking.id);
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
