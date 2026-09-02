const { publicApiError } = require("./supabase");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function formatLongDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function listWithAmpersand(items) {
  const clean = items.map((item) => String(item || "").trim()).filter(Boolean);
  if (!clean.length) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} & ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} & ${clean[clean.length - 1]}`;
}

function fallbackPetSummary(booking) {
  return booking.booking_pet_summary || booking.dog?.name || "your pet";
}

function getBookingPets(booking) {
  const pets = (booking.booking_pets || [])
    .map((item) => ({
      id: item.dog?.id || item.dog_id || "",
      name: item.dog?.name || "",
      petType: item.pet_type || item.dog?.pet_type || booking.pet_type || "dog",
      vaccinationsUpToDate: item.dog?.vaccinations_up_to_date || "",
      rabiesVaccinationUpToDate: item.dog?.rabies_vaccination_up_to_date || "",
      vaccinationRecordCount: Number(item.dog?.vaccination_record_count || 0),
    }))
    .filter((pet) => pet.id || pet.name);

  if (!pets.length && (booking.dog?.name || booking.dog_id)) {
    pets.push({
      id: booking.dog?.id || booking.dog_id || "",
      name: booking.dog?.name || "",
      petType: booking.pet_type || booking.dog?.pet_type || "dog",
      vaccinationsUpToDate: booking.dog?.vaccinations_up_to_date || "",
      rabiesVaccinationUpToDate: booking.dog?.rabies_vaccination_up_to_date || "",
      vaccinationRecordCount: Number(booking.dog?.vaccination_record_count || 0),
    });
  }

  return pets;
}

function getBookingPetDisplay(booking) {
  const pets = getBookingPets(booking);
  const names = pets.map((pet) => pet.name).filter(Boolean);
  return {
    pets,
    names,
    namesDisplay: listWithAmpersand(names) || fallbackPetSummary(booking),
    summaryDisplay: fallbackPetSummary(booking),
  };
}

function getBalanceDueDate(booking) {
  return booking.dropoff_date || "";
}

function getBalanceDueLabel(booking) {
  const dueDate = getBalanceDueDate(booking);
  if (!dueDate) return "";
  return formatLongDate(dueDate);
}

function petLabel(pets) {
  return pets.length > 1 ? "Pets" : "Pet";
}

function vaccinationMessageForPets(pets) {
  if (!pets.length) {
    return "Please review and complete your vaccination records in My Account before arrival.";
  }

  const reliableStatuses = pets.every((pet) => pet.vaccinationRecordCount > 0);
  if (!reliableStatuses) {
    return "Please review and complete your vaccination records in My Account before arrival.";
  }

  const completeMessages = pets.map((pet) => `${pet.name}: Vaccination records complete ✓`);
  return completeMessages.join("\n");
}

async function sendResendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = process.env.REMINDER_FROM_EMAIL || "Shingo's Palace <info@shingospalace.com>";

  if (!apiKey) {
    throw publicApiError("Resend is not configured in Vercel.", 500, "missing_resend_api_key");
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
    throw Object.assign(publicApiError(payload.message || "Resend could not send this email.", 500, "resend_failed"), {
      resendPayload: payload,
    });
  }

  return payload;
}

function accountUrl(origin, email) {
  const url = new URL("/index.html", origin);
  url.searchParams.set("account", "1");
  if (email) url.searchParams.set("email", email);
  return url.toString();
}

function balanceUrl(origin, bookingId) {
  return `${origin}/balance-payment.html?booking_id=${encodeURIComponent(bookingId)}`;
}

function buildActionButton(url, label, background = "#4c8f85", color = "#ffffff") {
  return `<a href="${url}" style="display:inline-block;background:${background};color:${color};text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700;">${escapeHtml(label)}</a>`;
}

function buildInfoRows(rows) {
  return rows
    .filter((row) => row.value)
    .map(
      (row) =>
        `<p style="margin:0 0 10px;"><strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.value)}</p>`,
    )
    .join("");
}

function buildBaseEmailShell({ title, introHtml, bodyHtml, footerHtml = "" }) {
  return `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#24302f;max-width:640px;margin:0 auto;padding:28px;background:#fffaf4;">
      <div style="background:#ffffff;border:1px solid #eadfce;border-radius:24px;padding:28px;">
        <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#7b8a84;">Shingo's Palace</p>
        <h1 style="font-size:28px;line-height:1.2;margin:0 0 14px;color:#24302f;">${escapeHtml(title)}</h1>
        ${introHtml}
        ${bodyHtml}
        ${footerHtml}
      </div>
    </div>
  `;
}

function buildDepositConfirmationEmail({ booking, amountPaid, origin }) {
  const ownerFirstName = booking.owner?.first_name || "there";
  const petData = getBookingPetDisplay(booking);
  const dueDate = getBalanceDueLabel(booking);
  const remainingBalance = booking.remaining_balance || "$0";
  const hasRemainingBalance = remainingBalance && remainingBalance !== "$0" && remainingBalance !== "0";
  const vaccinationMessage = vaccinationMessageForPets(petData.pets);

  const introHtml = `<p style="margin:0 0 18px;">Thank you, ${escapeHtml(ownerFirstName)}! Your reservation is confirmed. 🐾</p>
    <p style="margin:0 0 22px;">We successfully received your payment of <strong>${escapeHtml(amountPaid)}</strong>.</p>`;

  const detailsHtml = `
    <div style="background:#fcf8f1;border:1px solid #eadfce;border-radius:18px;padding:20px;margin:24px 0;">
      <p style="margin:0 0 14px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#7b8a84;">Reservation Details</p>
      ${buildInfoRows([
        { label: "Service", value: serviceLabel(booking.service) },
        { label: petLabel(petData.pets), value: petData.namesDisplay },
        { label: "Check-in", value: formatLongDate(booking.dropoff_date) },
        { label: "Check-out", value: formatLongDate(booking.pickup_date) },
        { label: "Reservation total", value: booking.estimated_total || "" },
        { label: "Paid", value: amountPaid || "" },
        { label: "Remaining balance", value: remainingBalance },
      ])}
    </div>
  `;

  const dueHtml = hasRemainingBalance
    ? `
      <div style="margin:22px 0;">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#7b8a84;">Remaining Balance Due</p>
        <p style="margin:0 0 16px;font-size:18px;font-weight:700;">${escapeHtml(dueDate)}</p>
        <p style="margin:0 0 18px;">You do not need to pay this today. Your remaining balance of <strong>${escapeHtml(
          remainingBalance,
        )}</strong> is due on <strong>${escapeHtml(dueDate)}</strong>. You may pay it earlier if you prefer.</p>
        <p style="margin:0 0 16px;">${buildActionButton(balanceUrl(origin, booking.id), "Pay Remaining Balance")}</p>
      </div>
    `
    : "";

  const footerHtml = `
    <div style="margin-top:24px;">
      <p style="margin:0 0 14px;">Before your stay:</p>
      <p style="margin:0 0 18px;white-space:pre-line;">${escapeHtml(vaccinationMessage)}</p>
      <p style="margin:0 0 18px;">${buildActionButton(accountUrl(origin, booking.owner?.email), "Go to My Account", "#24302f")}</p>
      <p style="margin:0;">We can’t wait to welcome ${escapeHtml(petData.namesDisplay)} to Shingo’s Palace! 🐾</p>
    </div>
  `;

  const html = buildBaseEmailShell({
    title: "Payment received – Shingo’s Palace reservation confirmed 🐾",
    introHtml,
    bodyHtml: `${detailsHtml}${dueHtml}`,
    footerHtml,
  });

  const text = [
    `Thank you, ${ownerFirstName}! Your reservation is confirmed. 🐾`,
    "",
    `We successfully received your payment of ${amountPaid}.`,
    "",
    "RESERVATION DETAILS",
    `Service: ${serviceLabel(booking.service)}`,
    `${petLabel(petData.pets)}: ${petData.namesDisplay}`,
    `Check-in: ${formatLongDate(booking.dropoff_date)}`,
    `Check-out: ${formatLongDate(booking.pickup_date)}`,
    `Reservation total: ${booking.estimated_total || ""}`,
    `Paid: ${amountPaid}`,
    `Remaining balance: ${remainingBalance}`,
    hasRemainingBalance ? `Remaining balance due: ${dueDate}` : "",
    "",
    "Before your stay:",
    vaccinationMessage,
    "",
    `My Account: ${accountUrl(origin, booking.owner?.email)}`,
    hasRemainingBalance ? `Pay Remaining Balance: ${balanceUrl(origin, booking.id)}` : "",
    "",
    `We can’t wait to welcome ${petData.namesDisplay} to Shingo’s Palace! 🐾`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject: "Payment received – Shingo’s Palace reservation confirmed 🐾",
    html,
    text,
  };
}

function buildBalancePaidEmail({ booking, amountPaid, origin }) {
  const ownerFirstName = booking.owner?.first_name || "there";
  const petData = getBookingPetDisplay(booking);

  const introHtml = `<p style="margin:0 0 18px;">Thank you, ${escapeHtml(ownerFirstName)}. We successfully received your remaining balance payment. 🐾</p>`;

  const bodyHtml = `
    <div style="background:#fcf8f1;border:1px solid #eadfce;border-radius:18px;padding:20px;margin:24px 0;">
      ${buildInfoRows([
        { label: "Service", value: serviceLabel(booking.service) },
        { label: petLabel(petData.pets), value: petData.namesDisplay },
        { label: "Check-in", value: formatLongDate(booking.dropoff_date) },
        { label: "Check-out", value: formatLongDate(booking.pickup_date) },
        { label: "Amount paid", value: amountPaid || "" },
        { label: "Remaining balance", value: "$0" },
        { label: "Status", value: "Fully paid" },
      ])}
    </div>
    <p style="margin:0 0 18px;">${buildActionButton(accountUrl(origin, booking.owner?.email), "Go to My Account", "#24302f")}</p>
  `;

  const html = buildBaseEmailShell({
    title: "Balance paid – Your Shingo’s Palace reservation is fully paid 🐾",
    introHtml,
    bodyHtml,
    footerHtml: `<p style="margin:0;">We can’t wait to welcome ${escapeHtml(petData.namesDisplay)} to Shingo’s Palace! 🐾</p>`,
  });

  const text = [
    `Thank you, ${ownerFirstName}. We successfully received your remaining balance payment.`,
    "",
    `Service: ${serviceLabel(booking.service)}`,
    `${petLabel(petData.pets)}: ${petData.namesDisplay}`,
    `Check-in: ${formatLongDate(booking.dropoff_date)}`,
    `Check-out: ${formatLongDate(booking.pickup_date)}`,
    `Amount paid: ${amountPaid}`,
    "Remaining balance: $0",
    "Status: Fully paid",
    "",
    `My Account: ${accountUrl(origin, booking.owner?.email)}`,
  ].join("\n");

  return {
    subject: "Balance paid – Your Shingo’s Palace reservation is fully paid 🐾",
    html,
    text,
  };
}

function buildBalanceReminderEmail({ booking, origin }) {
  const ownerFirstName = booking.owner?.first_name || "there";
  const petData = getBookingPetDisplay(booking);
  const dueDate = getBalanceDueLabel(booking);
  const reservationDates = booking.pickup_date
    ? `${formatLongDate(booking.dropoff_date)} to ${formatLongDate(booking.pickup_date)}`
    : formatLongDate(booking.dropoff_date);

  const introHtml = `<p style="margin:0 0 18px;">Hi ${escapeHtml(ownerFirstName)},</p>
    <p style="margin:0 0 18px;">Just a friendly reminder that the remaining balance for ${escapeHtml(
      petData.namesDisplay,
    )}’s Shingo’s Palace reservation is due tomorrow.</p>`;

  const bodyHtml = `
    <div style="background:#fcf8f1;border:1px solid #eadfce;border-radius:18px;padding:20px;margin:24px 0;">
      ${buildInfoRows([
        { label: "Service", value: serviceLabel(booking.service) },
        { label: petLabel(petData.pets), value: petData.namesDisplay },
        { label: "Reservation dates", value: reservationDates },
        { label: "Remaining balance", value: booking.remaining_balance || "" },
        { label: "Due", value: dueDate },
      ])}
    </div>
    <p style="margin:0 0 16px;">${buildActionButton(balanceUrl(origin, booking.id), "Pay Remaining Balance")}</p>
    <p style="margin:0 0 16px;">${buildActionButton(accountUrl(origin, booking.owner?.email), "My Account", "#24302f")}</p>
  `;

  const html = buildBaseEmailShell({
    title: "Reminder: Your Shingo’s Palace balance is due tomorrow 🐾",
    introHtml,
    bodyHtml,
  });

  const text = [
    `Hi ${ownerFirstName},`,
    "",
    `Just a friendly reminder that the remaining balance for ${petData.namesDisplay}'s Shingo's Palace reservation is due tomorrow.`,
    "",
    `Service: ${serviceLabel(booking.service)}`,
    `${petLabel(petData.pets)}: ${petData.namesDisplay}`,
    `Reservation dates: ${reservationDates}`,
    `Remaining balance: ${booking.remaining_balance || ""}`,
    `Due: ${dueDate}`,
    "",
    `Pay Remaining Balance: ${balanceUrl(origin, booking.id)}`,
    `My Account: ${accountUrl(origin, booking.owner?.email)}`,
  ].join("\n");

  return {
    subject: "Reminder: Your Shingo’s Palace balance is due tomorrow 🐾",
    html,
    text,
  };
}

module.exports = {
  accountUrl,
  balanceUrl,
  buildBalancePaidEmail,
  buildBalanceReminderEmail,
  buildDepositConfirmationEmail,
  escapeHtml,
  formatLongDate,
  getBalanceDueDate,
  getBalanceDueLabel,
  getBookingPetDisplay,
  petLabel,
  sendResendEmail,
  serviceLabel,
};
