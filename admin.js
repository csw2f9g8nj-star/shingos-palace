let supabaseClient;
let adminSession;
let adminDogs = [];
let adminReviews = [];
let adminZellePayments = [];
let adminClubMemberships = [];
let adminClubMatches = [];
let selectedCanonicalOwner = null;
let pendingPetCreation = null;
let pendingZelleConfirmation = null;
let adminPetFilter = "active";
let pendingPetAction = null;
let adminZelleFilter = "pending";
let adminZelleVisibleCount = 20;

const ZELLE_PAGE_SIZE = 20;

const adminLogin = document.querySelector("#adminLogin");
const adminDashboard = document.querySelector("#adminDashboard");
const adminLoginForm = document.querySelector("#adminLoginForm");
const adminLoginStatus = document.querySelector("#adminLoginStatus");
const adminStatus = document.querySelector("#adminStatus");
const adminDogsEl = document.querySelector("#adminDogs");
const adminMeetGreetsEl = document.querySelector("#adminMeetGreets");
const adminReviewsEl = document.querySelector("#adminReviews");
const adminZellePaymentsEl = document.querySelector("#adminZellePayments");
const adminZelleStatus = document.querySelector("#adminZelleStatus");
const adminMainView = document.querySelector("#adminMainView");
const adminZelleView = document.querySelector("#adminZelleView");
const adminViewButtons = [...document.querySelectorAll("[data-admin-view]")];
const adminZelleFilterButtons = [...document.querySelectorAll("[data-zelle-filter]")];
const adminZellePendingSummary = document.querySelector("#adminZellePendingSummary");
const adminZellePendingCount = document.querySelector("#adminZellePendingCount");
const adminOpenZellePayments = document.querySelector("#adminOpenZellePayments");
const adminZelleLoadMore = document.querySelector("#adminZelleLoadMore");
const adminClubMembersEl = document.querySelector("#adminClubMembers");
const adminClubStatus = document.querySelector("#adminClubStatus");
const adminOwnerSearchForm = document.querySelector("#adminOwnerSearchForm");
const adminOwnerSearchStatus = document.querySelector("#adminOwnerSearchStatus");
const adminOwnerResults = document.querySelector("#adminOwnerResults");
const adminOwnerCreateForm = document.querySelector("#adminOwnerCreateForm");
const adminSelectedOwner = document.querySelector("#adminSelectedOwner");
const adminSelectedOwnerName = document.querySelector("#adminSelectedOwnerName");
const adminSelectedOwnerContact = document.querySelector("#adminSelectedOwnerContact");
const adminChangeOwner = document.querySelector("#adminChangeOwner");
const adminOwnerPets = document.querySelector("#adminOwnerPets");
const adminPetCreateForm = document.querySelector("#adminPetCreateForm");
const adminDuplicateWarning = document.querySelector("#adminDuplicateWarning");
const adminTemplate = document.querySelector("#adminDogTemplate");
const adminSearch = document.querySelector("#adminSearch");
const adminRefresh = document.querySelector("#adminRefresh");
const adminSignOut = document.querySelector("#adminSignOut");
const adminZelleConfirmDialog = document.querySelector("#adminZelleConfirmDialog");
const adminZelleConfirmText = document.querySelector("#adminZelleConfirmText");
const adminZelleConfirmCancel = document.querySelector("#adminZelleConfirmCancel");
const adminZelleConfirmSubmit = document.querySelector("#adminZelleConfirmSubmit");
const adminPetFilterButtons = [...document.querySelectorAll("[data-pet-filter]")];
const adminPetActionDialog = document.querySelector("#adminPetActionDialog");
const adminPetActionTitle = document.querySelector("#adminPetActionTitle");
const adminPetActionText = document.querySelector("#adminPetActionText");
const adminPetNameConfirmWrap = document.querySelector("#adminPetNameConfirmWrap");
const adminPetNameConfirm = document.querySelector("#adminPetNameConfirm");
const adminPetActionStatus = document.querySelector("#adminPetActionStatus");
const adminPetActionCancel = document.querySelector("#adminPetActionCancel");
const adminPetArchiveInstead = document.querySelector("#adminPetArchiveInstead");
const adminPetActionSubmit = document.querySelector("#adminPetActionSubmit");

function setStatus(element, message) {
  if (element) element.textContent = message || "";
}

async function loadAdminConfig() {
  const response = await fetch("/api/admin/config");
  const config = await response.json();
  if (!response.ok || !config.ok || !config.supabaseUrl || !config.supabasePublishableKey) {
    throw new Error("Admin configuration is missing. Check Vercel environment variables.");
  }

  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
}

async function apiFetch(path, options = {}) {
  if (!adminSession?.access_token) {
    throw new Error("Please sign in again.");
  }

  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${adminSession.access_token}`,
    },
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || "Request failed.");
    error.code = payload.code || "request_failed";
    error.payload = payload;
    throw error;
  }

  return payload;
}

function showDashboard(show) {
  adminLogin.hidden = show;
  adminDashboard.hidden = !show;
}

function showAdminView(view) {
  const nextView = view === "zelle" ? "zelle" : "dashboard";
  if (adminMainView) adminMainView.hidden = nextView !== "dashboard";
  if (adminZelleView) adminZelleView.hidden = nextView !== "zelle";
  adminViewButtons.forEach((button) => {
    const active = button.dataset.adminView === nextView;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function formatOwner(owner) {
  if (!owner) return "Owner not linked yet";
  const name = [owner.first_name, owner.last_name].filter(Boolean).join(" ");
  return `${name || "Owner"} · ${owner.email || "No email"} · ${owner.phone || "No phone"}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeText(value, fallback = "") {
  return escapeHtml(value || fallback);
}

function renderSection(title, lines) {
  const cleanLines = lines.filter(Boolean);
  if (!cleanLines.length) return `<h3>${escapeHtml(title)}</h3><p>No records yet.</p>`;
  return `<h3>${escapeHtml(title)}</h3><ul>${cleanLines.map((line) => `<li>${line}</li>`).join("")}</ul>`;
}

function recordList(records) {
  if (!records?.length) return ["Vaccination Records: Pending"];
  return records.map((record) => {
    const date = record.upload_date ? new Date(record.upload_date).toLocaleDateString() : "No date";
    const expires = record.expiration_date ? ` · Expires ${record.expiration_date}` : "";
    const label = safeText(record.original_filename, `Record v${record.version || 1}`);
    const link = record.signed_url
      ? `<a class="admin-record-link" href="${escapeHtml(record.signed_url)}" target="_blank" rel="noopener">Preview / Download</a>`
      : "Signed URL unavailable";
    return `<strong>${label}</strong><br>${safeText(record.document_status, "submitted")} · Uploaded ${escapeHtml(date)}${safeText(expires)}<br>${link}`;
  });
}

function dogNameById(dogId) {
  return adminDogs.find((dog) => dog.id === dogId)?.name || "another dog";
}

function activeClubMembership(dogId) {
  return adminClubMemberships.find((membership) => membership.dog_id === dogId && membership.is_active);
}

function activeClubMatches(dogId) {
  return adminClubMatches.filter(
    (match) => match.is_active && (match.dog_one_id === dogId || match.dog_two_id === dogId),
  );
}

function activeClubDogs(excludeDogId = "") {
  return adminDogs.filter(
    (dog) => dog.id !== excludeDogId && !dog.archived_at && dog.pet_type === "dog" && activeClubMembership(dog.id),
  );
}

function openPetActionDialog(dog, action) {
  if (!adminPetActionDialog) return;
  pendingPetAction = { dog, action };
  const actions = {
    archive: {
      title: `Archive ${dog.name}?`,
      text: "The profile and all history will be preserved. It will no longer appear in active lists or new booking selections.",
      label: "Archive Pet",
    },
    restore: {
      title: `Restore ${dog.name}?`,
      text: "The pet will return to active lists. Club membership and previous Club Matches will remain inactive.",
      label: "Restore Pet",
    },
    removeClub: {
      title: `Remove ${dog.name} from the Club?`,
      text: "The pet profile and all history will remain. Active Club Matches will be deactivated and preserved.",
      label: "Remove from Club",
    },
    delete: {
      title: `Permanently delete ${dog.name}?`,
      text: "This action cannot be undone. Deletion will be blocked if this pet has any protected history.",
      label: "Delete Permanently",
    },
  };
  const detail = actions[action];
  adminPetActionTitle.textContent = detail.title;
  adminPetActionText.textContent = detail.text;
  adminPetActionSubmit.textContent = detail.label;
  adminPetActionSubmit.hidden = false;
  adminPetActionSubmit.classList.toggle("admin-danger-button", action === "delete");
  adminPetNameConfirmWrap.hidden = action !== "delete";
  adminPetNameConfirm.value = "";
  adminPetActionSubmit.disabled = action === "delete";
  adminPetArchiveInstead.hidden = true;
  setStatus(adminPetActionStatus, "");
  adminPetActionDialog.showModal();
  if (action === "delete") adminPetNameConfirm.focus();
}

async function runPetAction(actionOverride = "") {
  if (!pendingPetAction) return;
  const { dog } = pendingPetAction;
  const action = actionOverride || pendingPetAction.action;
  const data = new FormData();
  data.set("dogId", dog.id);

  let path = "/api/admin/dogs";
  let method = "PATCH";
  if (action === "removeClub") {
    path = "/api/admin/club";
    method = "POST";
    data.set("action", "membership");
    data.set("isActive", "false");
  } else if (action === "delete") {
    method = "DELETE";
    data.set("confirmationName", adminPetNameConfirm.value);
  } else {
    data.set("action", action);
  }

  adminPetActionSubmit.disabled = true;
  adminPetArchiveInstead.disabled = true;
  setStatus(adminPetActionStatus, "Saving...");
  try {
    await apiFetch(path, { method, body: data });
    adminPetActionDialog.close();
    pendingPetAction = null;
    await loadDogs();
  } catch (error) {
    setStatus(adminPetActionStatus, error.message);
    if (action === "delete" && error.code === "pet_delete_blocked") {
      adminPetNameConfirmWrap.hidden = true;
      adminPetActionSubmit.hidden = true;
      adminPetArchiveInstead.hidden = Boolean(dog.archived_at);
    } else {
      adminPetActionSubmit.disabled = action === "delete" && adminPetNameConfirm.value !== dog.name;
    }
    adminPetArchiveInstead.disabled = false;
  }
}

function relatedClubDogId(match, dogId) {
  return match.dog_one_id === dogId ? match.dog_two_id : match.dog_one_id;
}

function ownerDisplayName(owner) {
  return [owner?.first_name, owner?.last_name].filter(Boolean).join(" ") || "Owner";
}

function focusDogProfile(dogId) {
  if (adminSearch) adminSearch.value = "";
  renderDogs();
  requestAnimationFrame(() => {
    document.querySelector(`[data-dog-id="${CSS.escape(dogId)}"]`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

function renderOwnerSearchResults(owners) {
  if (!adminOwnerResults) return;
  if (!owners.length) {
    adminOwnerResults.innerHTML = "<p>No owner found with that exact email. Create a new owner below.</p>";
    return;
  }

  adminOwnerResults.innerHTML = owners
    .map((owner) => `
      <article class="admin-owner-result-card">
        <div>
          <strong>${safeText(ownerDisplayName(owner))}</strong>
          <span>${safeText(owner.email)}${owner.phone ? ` · ${safeText(owner.phone)}` : ""}</span>
          <small>${owner.pets?.length || 0} ${(owner.pets?.length || 0) === 1 ? "pet" : "pets"}${owner.auth_user_id ? " · Customer account linked" : " · No customer login yet"}</small>
        </div>
        <button class="ghost-button" type="button" data-select-owner="${escapeHtml(owner.id)}">Select Owner</button>
      </article>
    `)
    .join("");
  adminOwnerResults._owners = owners;
}

function renderSelectedOwner() {
  if (!adminSelectedOwner || !selectedCanonicalOwner) return;
  adminSelectedOwner.hidden = false;
  adminSelectedOwnerName.textContent = ownerDisplayName(selectedCanonicalOwner);
  adminSelectedOwnerContact.textContent = [selectedCanonicalOwner.email, selectedCanonicalOwner.phone]
    .filter(Boolean)
    .join(" · ");
  renderSelectedOwnerPets();
}

function renderSelectedOwnerPets() {
  if (!adminOwnerPets || !selectedCanonicalOwner) return;
  const pets = selectedCanonicalOwner.pets || [];

  if (!pets.length) {
    adminOwnerPets.innerHTML = "<p>No pets belong to this owner yet. Create the first canonical pet below.</p>";
    return;
  }

  adminOwnerPets.innerHTML = `
    <h3>Existing Pets</h3>
    <div class="admin-owner-pet-list">
      ${pets.map((pet) => {
        const isDog = pet.pet_type === "dog";
        const isMember = Boolean(activeClubMembership(pet.id));
        return `
          <article class="admin-owner-pet-card">
            <div>
              <strong>${safeText(pet.name, "Unnamed pet")}</strong>
              <span>${safeText(isDog ? "Dog" : "Cat")}${pet.breed ? ` · ${safeText(pet.breed)}` : ""}</span>
            </div>
            <div class="admin-owner-pet-actions">
              <button class="ghost-button" type="button" data-open-canonical-pet="${escapeHtml(pet.id)}">Open Profile</button>
              ${isDog && !isMember ? `<button class="ghost-button" type="button" data-add-canonical-club="${escapeHtml(pet.id)}">Add to Club</button>` : ""}
              ${isDog && isMember ? '<span class="admin-club-badge">Club Member</span>' : ""}
              ${!isDog ? '<span class="admin-pet-type-note">Club is dog-only</span>' : ""}
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

async function refreshSelectedOwner() {
  if (!selectedCanonicalOwner?.email) return;
  const payload = await apiFetch(`/api/admin/club-pets?email=${encodeURIComponent(selectedCanonicalOwner.email)}`);
  const refreshed = (payload.owners || []).find((owner) => owner.id === selectedCanonicalOwner.id);
  if (refreshed) {
    selectedCanonicalOwner = refreshed;
    renderSelectedOwner();
  }
}

async function addCanonicalDogToClub(dogId, button) {
  if (button) button.disabled = true;
  setStatus(adminOwnerSearchStatus, "Adding the selected dog to the Club...");
  const data = new FormData();
  data.set("action", "membership");
  data.set("dogId", dogId);
  data.set("isActive", "true");
  try {
    await apiFetch("/api/admin/club", { method: "POST", body: data });
    await loadDogs();
    await refreshSelectedOwner();
    setStatus(adminOwnerSearchStatus, "Dog added to Shingo's Palace Club.");
  } catch (error) {
    setStatus(adminOwnerSearchStatus, error.message);
    if (button) button.disabled = false;
  }
}

function selectCanonicalOwner(owner) {
  selectedCanonicalOwner = owner;
  pendingPetCreation = null;
  adminDuplicateWarning.hidden = true;
  adminPetCreateForm?.reset();
  adminOwnerCreateForm.hidden = true;
  renderSelectedOwner();
  setStatus(adminOwnerSearchStatus, "");
}

async function submitCanonicalPet(forceCreate = false) {
  if (!selectedCanonicalOwner || !adminPetCreateForm) return;
  const status = adminPetCreateForm.querySelector(".status-line");
  const data = pendingPetCreation ? new FormData() : new FormData(adminPetCreateForm);

  if (pendingPetCreation) {
    Object.entries(pendingPetCreation).forEach(([key, value]) => data.set(key, value));
  }
  data.set("action", "create-pet");
  data.set("ownerId", selectedCanonicalOwner.id);
  data.set("forceCreate", forceCreate ? "true" : "false");
  setStatus(status, forceCreate ? "Creating the new pet after confirmation..." : "Checking this pet...");
  adminDuplicateWarning.hidden = true;

  try {
    const payload = await apiFetch("/api/admin/club-pets", { method: "POST", body: data });
    pendingPetCreation = null;
    adminPetCreateForm.reset();
    await loadDogs();
    await refreshSelectedOwner();
    setStatus(status, `${payload.pet.name} was added as a canonical pet profile.`);
    focusDogProfile(payload.pet.id);
  } catch (error) {
    if (error.code !== "possible_duplicate_pet") {
      setStatus(status, error.message);
      return;
    }

    pendingPetCreation = Object.fromEntries(data.entries());
    const candidates = error.payload?.pets || [];
    adminDuplicateWarning.innerHTML = `
      <strong>Possible duplicate pet</strong>
      <p>A pet with the same owner, name, type, and compatible breed already exists. Choose the existing profile or explicitly create another pet.</p>
      <div class="admin-duplicate-options">
        ${candidates.map((pet) => `<button class="ghost-button" type="button" data-use-existing-pet="${escapeHtml(pet.id)}">Use ${safeText(pet.name)}${pet.breed ? ` · ${safeText(pet.breed)}` : ""}</button>`).join("")}
        <button class="admin-inline-action" type="button" data-create-pet-anyway>Create New Pet Anyway</button>
      </div>
    `;
    adminDuplicateWarning.hidden = false;
    setStatus(status, "No pet was created. Please review the possible match.");
  }
}

function renderClubMembers() {
  if (!adminClubMembersEl) return;
  const members = activeClubDogs();

  if (!members.length) {
    adminClubMembersEl.innerHTML = "<p>No active Club members yet. Open a dog profile below to add the first member.</p>";
    return;
  }

  adminClubMembersEl.innerHTML = members
    .map((dog) => {
      const matchCount = activeClubMatches(dog.id).length;
      const ownerName = [dog.owner?.first_name, dog.owner?.last_name].filter(Boolean).join(" ") || "Owner";
      return `
        <button class="admin-club-member-card" type="button" data-club-focus="${escapeHtml(dog.id)}">
          <span class="admin-club-member-initial">${safeText((dog.name || "?").slice(0, 1).toUpperCase())}</span>
          <span>
            <strong>${safeText(dog.name, "Unnamed dog")}</strong>
            <small>${safeText(ownerName)} · ${matchCount} ${matchCount === 1 ? "match" : "matches"}</small>
          </span>
        </button>
      `;
    })
    .join("");
}

function clubMatchList(dog) {
  const matches = activeClubMatches(dog.id);
  if (!matches.length) return "<p>No active Club Matches yet.</p>";

  return `
    <ul class="admin-club-match-list">
      ${matches.map((match) => {
        const friendId = relatedClubDogId(match, dog.id);
        return `
          <li>
            <span><strong>${safeText(dogNameById(friendId))}</strong>${match.notes ? `<br>${safeText(match.notes)}` : ""}</span>
            <button class="admin-inline-action" type="button" data-deactivate-club-match="${escapeHtml(match.id)}">Deactivate</button>
          </li>
        `;
      }).join("")}
    </ul>
  `;
}

function noteList(notes) {
  if (!notes?.length) return ["No private notes yet."];
  return notes
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((note) => {
      const date = new Date(note.created_at).toLocaleString();
      const relatedDog = note.related_dog_id ? `<br>Related dog: ${safeText(dogNameById(note.related_dog_id))}` : "";
      return `<strong>${safeText(note.category, "Note")}</strong> · ${escapeHtml(date)}<br>${safeText(note.note_text)}${relatedDog}`;
    });
}

function compatibilityList(dog) {
  const items = [...(dog.compatibility_as_first || []), ...(dog.compatibility_as_second || [])];
  if (!items.length) return ["No compatibility notes yet."];
  return items.map((item) => {
    const relatedDogId = item.dog_one_id === dog.id ? item.dog_two_id : item.dog_one_id;
    return `<strong>${safeText(item.status)}</strong> with ${safeText(dogNameById(relatedDogId))}<br>${safeText(item.notes, "No extra notes.")}`;
  });
}

function renderMeetGreets(requests) {
  if (!adminMeetGreetsEl) return;

  if (!requests?.length) {
    adminMeetGreetsEl.innerHTML = "<p>No Meet & Greet requests yet.</p>";
    return;
  }

  adminMeetGreetsEl.innerHTML = requests
    .map((request) => {
      const created = request.created_at ? new Date(request.created_at).toLocaleString() : "No date";
      return `
        <article class="admin-request-card">
          <strong>${safeText(request.owner_name, "Owner")} · ${safeText(request.dog_name, "Dog")}</strong>
          <span>${safeText(request.email, "No email")} · ${safeText(request.phone, "No phone")}</span>
          <span>${safeText(request.preferred_day, "No day")} at ${safeText(request.preferred_time, "No time")}</span>
          <span>Status: ${safeText(request.status, "new_request")}</span>
          ${request.message ? `<p>${safeText(request.message)}</p>` : ""}
          <span>Submitted ${escapeHtml(created)}</span>
        </article>
      `;
    })
    .join("");
}

function starRating(rating) {
  const safeRating = Math.max(1, Math.min(5, Number(rating) || 5));
  return "★".repeat(safeRating) + "☆".repeat(5 - safeRating);
}

function renderAdminReviews(reviews) {
  if (!adminReviewsEl) return;

  if (!reviews?.length) {
    adminReviewsEl.innerHTML = "<p>No reviews yet.</p>";
    return;
  }

  adminReviewsEl.innerHTML = reviews
    .map((review) => {
      const ownerName = [review.owner?.firstName, review.owner?.lastName].filter(Boolean).join(" ") || "Pet parent";
      const petName = review.pet?.name || "Pet";
      const created = review.createdAt ? new Date(review.createdAt).toLocaleString() : "No date";
      const pending = review.status === "pending";
      return `
        <article class="admin-request-card admin-review-card" data-review-id="${escapeHtml(review.id)}">
          <div class="admin-review-topline">
            <strong>${safeText(ownerName)} · ${safeText(petName)}</strong>
            <span class="admin-review-status is-${safeText(review.status)}">${safeText(review.status)}</span>
          </div>
          <span class="admin-review-stars">${starRating(review.rating)}</span>
          <p>${safeText(review.reviewText)}</p>
          <span>${safeText(review.booking?.service, "Reservation")} · ${safeText(review.booking?.dropoffDate, "No date")} → ${safeText(review.booking?.pickupDate, "No date")}</span>
          <span>${safeText(review.owner?.email, "No email")} · Submitted ${escapeHtml(created)}</span>
          <div class="admin-review-actions">
            <button class="ghost-button" type="button" data-review-action="approved" ${pending ? "" : "disabled"}>Approve</button>
            <button class="ghost-button" type="button" data-review-action="rejected" ${pending ? "" : "disabled"}>Reject</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function currencyAmount(value) {
  const amount = Number(String(value || "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount)) return "$0";
  return `$${amount.toFixed(2).replace(/\.00$/, "")}`;
}

function zellePaymentEntries(bookings) {
  return (bookings || []).flatMap((booking) => {
    const entries = [];
    if (booking.deposit_payment_method === "zelle") {
      entries.push({
        booking,
        paymentType: "deposit",
        amount: booking.deposit_due_today,
        pending: !["deposit_paid", "paid_in_full"].includes(booking.payment_status),
        confirmedAt: booking.zelle_deposit_confirmed_at,
        reference: booking.zelle_deposit_reference,
        note: booking.zelle_deposit_note,
        requestedAt: booking.created_at,
      });
    }
    if (booking.balance_payment_method === "zelle") {
      entries.push({
        booking,
        paymentType: "balance",
        amount: booking.balance_payment_status === "paid" ? booking.balance_paid_amount : booking.remaining_balance,
        pending: booking.balance_payment_status !== "paid",
        confirmedAt: booking.zelle_balance_confirmed_at,
        reference: booking.zelle_balance_reference,
        note: booking.zelle_balance_note,
        requestedAt: booking.created_at,
      });
    }
    return entries;
  });
}

function zellePetNames(booking) {
  const names = (booking.booking_pets || []).map((item) => item.dog?.name).filter(Boolean);
  if (!names.length && booking.dog?.name) names.push(booking.dog.name);
  return names.join(", ") || booking.booking_pet_summary || "Pet";
}

function renderAdminZellePayments(bookings) {
  if (!adminZellePaymentsEl) return;
  const entries = zellePaymentEntries(bookings);
  const pendingCount = entries.filter((entry) => entry.pending).length;
  if (adminZellePendingSummary) adminZellePendingSummary.hidden = pendingCount === 0;
  if (adminZellePendingCount) adminZellePendingCount.textContent = `Zelle payments pending: ${pendingCount}`;

  const filteredEntries = entries
    .filter((entry) => {
      if (adminZelleFilter === "pending") return entry.pending;
      if (adminZelleFilter === "confirmed") return !entry.pending;
      return true;
    })
    .sort((a, b) => {
      const aDate = new Date(adminZelleFilter === "confirmed" ? a.confirmedAt : (a.confirmedAt || a.requestedAt || 0)).getTime();
      const bDate = new Date(adminZelleFilter === "confirmed" ? b.confirmedAt : (b.confirmedAt || b.requestedAt || 0)).getTime();
      return bDate - aDate;
    });

  if (!filteredEntries.length) {
    const emptyMessage = adminZelleFilter === "pending"
      ? "No Zelle payments awaiting verification."
      : adminZelleFilter === "confirmed"
        ? "No confirmed Zelle payments yet."
        : "No Zelle payment requests yet.";
    adminZellePaymentsEl.innerHTML = `<p class="admin-zelle-empty">${emptyMessage}</p>`;
    if (adminZelleLoadMore) adminZelleLoadMore.hidden = true;
    return;
  }

  adminZellePaymentsEl.innerHTML = filteredEntries
    .slice(0, adminZelleVisibleCount)
    .map(({ booking, paymentType, amount, pending, confirmedAt, reference, note, requestedAt }) => {
    const ownerName = [booking.owner?.first_name, booking.owner?.last_name].filter(Boolean).join(" ") || "Pet parent";
    const label = paymentType === "balance" ? "Remaining balance" : "Deposit";
    const submitted = requestedAt ? new Date(requestedAt).toLocaleString() : "No date";
    const confirmation = confirmedAt ? new Date(confirmedAt).toLocaleString() : "";
    return `
      <article class="admin-request-card admin-zelle-card ${pending ? "is-pending" : "is-confirmed"}">
        <div class="admin-review-topline">
          <strong>${safeText(ownerName)} · ${safeText(zellePetNames(booking))}</strong>
          <span class="admin-review-status ${pending ? "is-pending" : "is-approved"}">${pending ? "Pending verification" : "Confirmed"}</span>
        </div>
        <span>${safeText(booking.service, "Reservation")} · ${safeText(booking.dropoff_date, "No date")} → ${safeText(booking.pickup_date, "No date")}</span>
        <span>${label}: <strong>${safeText(currencyAmount(amount))}</strong></span>
        <span>${safeText(booking.owner?.email, "No email")} · Requested ${escapeHtml(submitted)}</span>
        ${pending ? `
          <form class="admin-form admin-zelle-confirm-form">
            <input type="hidden" name="bookingId" value="${escapeHtml(booking.id)}" />
            <input type="hidden" name="paymentType" value="${escapeHtml(paymentType)}" />
            <label>
              <span>Exact amount received</span>
              <input name="amount" value="${escapeHtml(currencyAmount(amount))}" readonly />
            </label>
            <label>
              <span>Zelle reference (optional)</span>
              <input name="reference" autocomplete="off" />
            </label>
            <label>
              <span>Internal note (optional)</span>
              <textarea name="note" rows="2"></textarea>
            </label>
            <button class="ghost-button" type="submit">Confirm ${label}</button>
            <p class="status-line" aria-live="polite"></p>
          </form>
        ` : `
          <span>Confirmed ${escapeHtml(confirmation)}</span>
          ${reference ? `<span>Reference: ${safeText(reference)}</span>` : ""}
          ${note ? `<span>Internal note: ${safeText(note)}</span>` : ""}
        `}
      </article>
    `;
  }).join("");

  if (adminZelleLoadMore) {
    adminZelleLoadMore.hidden = filteredEntries.length <= adminZelleVisibleCount;
  }
}

function populateDogOptions(select, currentDogId) {
  select.innerHTML = adminDogs
    .filter((dog) => dog.id !== currentDogId && !dog.archived_at)
    .map((dog) => `<option value="${escapeHtml(dog.id)}">${safeText(dog.name, "Unnamed dog")}</option>`)
    .join("");
}

function renderDogs() {
  const query = (adminSearch?.value || "").toLowerCase().trim();
  const filtered = adminDogs.filter((dog) => {
    const haystack = [dog.name, dog.breed, dog.owner?.first_name, dog.owner?.last_name, dog.owner?.email]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesSearch = !query || haystack.includes(query);
    const matchesArchive = adminPetFilter === "all"
      || (adminPetFilter === "archived" ? Boolean(dog.archived_at) : !dog.archived_at);
    return matchesSearch && matchesArchive;
  });

  adminDogsEl.innerHTML = "";
  if (!filtered.length) {
    adminDogsEl.innerHTML = "<p>No dog profiles found yet.</p>";
    return;
  }

  filtered.forEach((dog) => {
    const node = adminTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.dogId = dog.id;
    node.dataset.ownerId = dog.owner_id;
    const isArchived = Boolean(dog.archived_at);
    node.classList.toggle("is-archived", isArchived);
    node.querySelector(".admin-dog-avatar").textContent = (dog.name || "?").slice(0, 1).toUpperCase();
    node.querySelector("h2").textContent = dog.name || "Unnamed dog";
    node.querySelector(".admin-owner").textContent = formatOwner(dog.owner);
    const isClubMember = Boolean(activeClubMembership(dog.id));
    const clubBadge = node.querySelector(".admin-club-badge");
    clubBadge.hidden = !isClubMember;
    node.querySelector(".admin-archived-badge").hidden = !isArchived;
    node.querySelector(".admin-club-management").hidden = dog.pet_type !== "dog" || isArchived;

    const archiveButton = node.querySelector(".admin-archive-pet");
    const restoreButton = node.querySelector(".admin-restore-pet");
    const deleteButton = node.querySelector(".admin-delete-pet");
    archiveButton.hidden = isArchived;
    restoreButton.hidden = !isArchived;
    archiveButton.addEventListener("click", () => openPetActionDialog(dog, "archive"));
    restoreButton.addEventListener("click", () => openPetActionDialog(dog, "restore"));
    deleteButton.addEventListener("click", () => openPetActionDialog(dog, "delete"));

    const membershipState = node.querySelector(".admin-club-membership-state");
    membershipState.textContent = dog.pet_type !== "dog"
      ? "Club membership is currently available for dogs only."
      : isClubMember
        ? "Active Club member"
        : "Not currently a Club member";

    const membershipForm = node.querySelector(".admin-club-membership-form");
    const membershipButton = membershipForm.querySelector("button");
    membershipButton.textContent = isClubMember ? "Remove from Club" : "Add to Club";
    membershipButton.disabled = dog.pet_type !== "dog" || isArchived;
    membershipForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (isClubMember) {
        openPetActionDialog(dog, "removeClub");
        return;
      }
      membershipButton.disabled = true;
      setStatus(adminStatus, isClubMember ? "Deactivating Club membership..." : "Adding Club member...");
      const data = new FormData();
      data.set("action", "membership");
      data.set("dogId", dog.id);
      data.set("isActive", isClubMember ? "false" : "true");
      try {
        await apiFetch("/api/admin/club", { method: "POST", body: data });
        await loadDogs();
      } catch (error) {
        setStatus(adminStatus, error.message);
        membershipButton.disabled = false;
      }
    });

    node.querySelector(".admin-club-current").innerHTML = `<h3>Current Club Matches</h3>${clubMatchList(dog)}`;
    const clubMatchForm = node.querySelector(".admin-club-match-form");
    const clubFriendSelect = clubMatchForm.querySelector("select[name='dogTwoId']");
    const availableFriends = activeClubDogs(dog.id).filter(
      (friend) => !activeClubMatches(dog.id).some((match) => relatedClubDogId(match, dog.id) === friend.id),
    );
    clubFriendSelect.innerHTML = availableFriends
      .map((friend) => `<option value="${escapeHtml(friend.id)}">${safeText(friend.name, "Unnamed dog")}</option>`)
      .join("");
    clubMatchForm.hidden = !isClubMember || !availableFriends.length;
    clubMatchForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = clubMatchForm.querySelector(".status-line");
      const data = new FormData(clubMatchForm);
      data.set("action", "match");
      data.set("dogOneId", dog.id);
      setStatus(status, "Saving Club Match...");
      try {
        await apiFetch("/api/admin/club", { method: "POST", body: data });
        await loadDogs();
      } catch (error) {
        setStatus(status, error.message);
      }
    });

    node.querySelector(".admin-club-current").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-deactivate-club-match]");
      if (!button) return;
      button.disabled = true;
      setStatus(adminStatus, "Deactivating Club Match...");
      const data = new FormData();
      data.set("action", "match");
      data.set("matchId", button.dataset.deactivateClubMatch);
      try {
        await apiFetch("/api/admin/club", { method: "PATCH", body: data });
        await loadDogs();
      } catch (error) {
        setStatus(adminStatus, error.message);
        button.disabled = false;
      }
    });
    node.querySelector(".admin-contact").innerHTML = renderSection("Owner", [
      dog.owner?.emergency_contact ? `Emergency contact: ${safeText(dog.owner.emergency_contact)}` : "",
    ]);
    node.querySelector(".admin-vet").innerHTML = renderSection("Veterinarian", [
      dog.veterinary_clinic ? `Clinic: ${safeText(dog.veterinary_clinic)}` : "",
      dog.veterinarian_name ? `Vet: ${safeText(dog.veterinarian_name)}` : "",
      dog.clinic_phone ? `Phone: ${safeText(dog.clinic_phone)}` : "",
      dog.clinic_address ? `Address: ${safeText(dog.clinic_address)}` : "",
    ]);
    node.querySelector(".admin-bookings").innerHTML = renderSection(
      "Reservation history",
      (dog.bookings || []).map(
        (booking) =>
          `${safeText(booking.service)} · ${safeText(booking.dropoff_date, "No date")} → ${safeText(booking.pickup_date, "No date")} · ${safeText(booking.status)}`,
      ),
    );
    node.querySelector(".admin-records").innerHTML = renderSection("Vaccination records", recordList(dog.vaccination_records));
    node.querySelector(".admin-compatibility").innerHTML = renderSection("Compatibility warnings", compatibilityList(dog));
    node.querySelector(".admin-notes").innerHTML = renderSection("Private notes", noteList(dog.dog_notes));

    const noteForm = node.querySelector(".admin-note-form");
    const relatedNoteDogSelect = noteForm.querySelector("select[name='relatedDogId']");
    relatedNoteDogSelect.innerHTML = `<option value="">None</option>${adminDogs
      .filter((item) => item.id !== dog.id && !item.archived_at)
      .map((item) => `<option value="${escapeHtml(item.id)}">${safeText(item.name, "Unnamed dog")}</option>`)
      .join("")}`;
    noteForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = noteForm.querySelector(".status-line");
      const data = new FormData(noteForm);
      data.set("dogId", dog.id);
      setStatus(status, "Saving note...");
      try {
        await apiFetch("/api/admin/notes", { method: "POST", body: data });
        setStatus(status, "Note saved.");
        await loadDogs();
      } catch (error) {
        setStatus(status, error.message);
      }
    });

    const compatibilityForm = node.querySelector(".admin-compatibility-form");
    const relatedDogSelect = compatibilityForm.querySelector("select[name='dogTwoId']");
    populateDogOptions(relatedDogSelect, dog.id);
    compatibilityForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = compatibilityForm.querySelector(".status-line");
      const data = new FormData(compatibilityForm);
      data.set("dogOneId", dog.id);
      setStatus(status, "Saving compatibility...");
      try {
        await apiFetch("/api/admin/compatibility", { method: "POST", body: data });
        setStatus(status, "Compatibility saved.");
        await loadDogs();
      } catch (error) {
        setStatus(status, error.message);
      }
    });

    const uploadForm = node.querySelector(".admin-upload-form");
    uploadForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = uploadForm.querySelector(".status-line");
      const data = new FormData(uploadForm);
      data.set("dogId", dog.id);
      data.set("ownerId", dog.owner_id);
      setStatus(status, "Uploading securely...");
      try {
        await apiFetch("/api/admin/vaccination-records", { method: "POST", body: data });
        setStatus(status, "Vaccination records updated.");
        uploadForm.reset();
        await loadDogs();
      } catch (error) {
        setStatus(status, error.message);
      }
    });

    noteForm.hidden = isArchived;
    compatibilityForm.hidden = isArchived;
    uploadForm.hidden = isArchived;

    adminDogsEl.appendChild(node);
  });
}

async function loadDogs() {
  setStatus(adminStatus, "Loading private records...");
  const [dogsPayload, meetGreetsPayload, reviewsPayload] = await Promise.all([
    apiFetch("/api/admin/dogs"),
    apiFetch("/api/admin/meet-greets"),
    apiFetch("/api/reviews?scope=admin"),
  ]);
  adminDogs = dogsPayload.dogs || [];
  adminReviews = reviewsPayload.reviews || [];
  try {
    const clubPayload = await apiFetch("/api/admin/club");
    adminClubMemberships = clubPayload.memberships || [];
    adminClubMatches = clubPayload.matches || [];
    setStatus(adminClubStatus, "");
  } catch (error) {
    adminClubMemberships = [];
    adminClubMatches = [];
    setStatus(adminClubStatus, `Club management is not ready yet: ${error.message}`);
  }
  try {
    const paymentPayload = await apiFetch("/api/admin/payments");
    adminZellePayments = paymentPayload.payments || [];
    renderAdminZellePayments(adminZellePayments);
    setStatus(adminZelleStatus, "");
  } catch (error) {
    adminZellePayments = [];
    renderAdminZellePayments([]);
    setStatus(adminZelleStatus, `Zelle payment management is not ready yet: ${error.message}`);
  }
  renderMeetGreets(meetGreetsPayload.requests || []);
  renderAdminReviews(adminReviews);
  renderClubMembers();
  renderDogs();
  if (selectedCanonicalOwner) renderSelectedOwnerPets();
  setStatus(adminStatus, "");
}

adminClubMembersEl?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-club-focus]");
  if (!button) return;
  if (adminSearch) adminSearch.value = "";
  renderDogs();
  document.querySelector(`[data-dog-id="${CSS.escape(button.dataset.clubFocus)}"]`)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
});

adminOwnerSearchForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(adminOwnerSearchForm);
  const email = String(data.get("email") || "").trim().toLowerCase();
  selectedCanonicalOwner = null;
  adminSelectedOwner.hidden = true;
  adminOwnerCreateForm.hidden = true;
  adminOwnerResults.innerHTML = "";
  setStatus(adminOwnerSearchStatus, "Searching for an exact email match...");

  try {
    const payload = await apiFetch(`/api/admin/club-pets?email=${encodeURIComponent(email)}`);
    const owners = payload.owners || [];
    renderOwnerSearchResults(owners);
    adminOwnerCreateForm.hidden = owners.length > 0;
    if (!owners.length) adminOwnerCreateForm.elements.email.value = email;
    setStatus(
      adminOwnerSearchStatus,
      owners.length
        ? `${owners.length} exact owner ${owners.length === 1 ? "record" : "records"} found. Select the correct one.`
        : "No exact owner match was found.",
    );
  } catch (error) {
    setStatus(adminOwnerSearchStatus, error.message);
  }
});

adminOwnerResults?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-owner]");
  if (!button) return;
  const owner = (adminOwnerResults._owners || []).find((candidate) => candidate.id === button.dataset.selectOwner);
  if (owner) selectCanonicalOwner(owner);
});

adminOwnerCreateForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = adminOwnerCreateForm.querySelector(".status-line");
  const data = new FormData(adminOwnerCreateForm);
  data.set("action", "create-owner");
  setStatus(status, "Checking and creating the owner...");

  try {
    const payload = await apiFetch("/api/admin/club-pets", { method: "POST", body: data });
    adminOwnerResults.innerHTML = "";
    adminOwnerCreateForm.reset();
    selectCanonicalOwner(payload.owner);
    setStatus(adminOwnerSearchStatus, "Owner created and selected.");
  } catch (error) {
    if (error.code === "owner_already_exists") {
      const owners = error.payload?.owners || [];
      renderOwnerSearchResults(owners);
      adminOwnerCreateForm.hidden = true;
      setStatus(adminOwnerSearchStatus, "This email already belongs to an owner. Select the correct existing record.");
      return;
    }
    setStatus(status, error.message);
  }
});

adminChangeOwner?.addEventListener("click", () => {
  selectedCanonicalOwner = null;
  pendingPetCreation = null;
  adminSelectedOwner.hidden = true;
  adminOwnerResults.innerHTML = "";
  adminOwnerCreateForm.hidden = true;
  adminDuplicateWarning.hidden = true;
  adminOwnerSearchForm?.querySelector("input[name='email']")?.focus();
  setStatus(adminOwnerSearchStatus, "Search for another owner by their complete email address.");
});

adminOwnerPets?.addEventListener("click", async (event) => {
  const openButton = event.target.closest("[data-open-canonical-pet]");
  if (openButton) {
    focusDogProfile(openButton.dataset.openCanonicalPet);
    return;
  }

  const clubButton = event.target.closest("[data-add-canonical-club]");
  if (clubButton) await addCanonicalDogToClub(clubButton.dataset.addCanonicalClub, clubButton);
});

adminPetCreateForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  pendingPetCreation = null;
  await submitCanonicalPet(false);
});

adminDuplicateWarning?.addEventListener("click", async (event) => {
  const existingButton = event.target.closest("[data-use-existing-pet]");
  if (existingButton) {
    pendingPetCreation = null;
    adminDuplicateWarning.hidden = true;
    setStatus(adminPetCreateForm.querySelector(".status-line"), "Using the existing canonical pet. No duplicate was created.");
    focusDogProfile(existingButton.dataset.useExistingPet);
    return;
  }

  const createButton = event.target.closest("[data-create-pet-anyway]");
  if (createButton) {
    createButton.disabled = true;
    await submitCanonicalPet(true);
  }
});

adminReviewsEl?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-review-action]");
  if (!button) return;

  const card = button.closest("[data-review-id]");
  const reviewId = card?.dataset.reviewId || "";
  if (!reviewId) return;

  button.disabled = true;
  setStatus(adminStatus, "Updating review...");

  try {
    await apiFetch("/api/reviews", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewId,
        status: button.dataset.reviewAction,
      }),
    });
    await loadDogs();
  } catch (error) {
    setStatus(adminStatus, error.message);
    button.disabled = false;
  }
});

async function confirmZellePayment(form) {
  const status = form.querySelector(".status-line");
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  setStatus(status, "Saving the payment confirmation...");
  try {
    await apiFetch("/api/admin/payments", { method: "PATCH", body: new FormData(form) });
    setStatus(status, "Payment confirmed. The customer record has been updated.");
    await loadDogs();
  } catch (error) {
    setStatus(status, error.message);
    button.disabled = false;
  }
}

adminZellePaymentsEl?.addEventListener("submit", (event) => {
  const form = event.target.closest(".admin-zelle-confirm-form");
  if (!form) return;
  event.preventDefault();
  const amount = form.elements.amount?.value || "$0";
  const numericAmount = Number(String(amount).replace(/[^0-9.]/g, ""));
  const displayAmount = Number.isFinite(numericAmount) ? `$${numericAmount.toFixed(2)}` : amount;
  const confirmationText = `I confirm that I received ${displayAmount} through Zelle.`;

  if (!adminZelleConfirmDialog?.showModal) {
    if (window.confirm(confirmationText)) confirmZellePayment(form);
    return;
  }

  pendingZelleConfirmation = form;
  if (adminZelleConfirmText) adminZelleConfirmText.textContent = confirmationText;
  adminZelleConfirmDialog.showModal();
});

adminViewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    showAdminView(button.dataset.adminView);
    if (button.dataset.adminView === "zelle") {
      adminZelleFilter = "pending";
      adminZelleVisibleCount = ZELLE_PAGE_SIZE;
      adminZelleFilterButtons.forEach((item) => {
        const active = item.dataset.zelleFilter === adminZelleFilter;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      renderAdminZellePayments(adminZellePayments);
    }
  });
});

adminOpenZellePayments?.addEventListener("click", () => {
  adminViewButtons.find((item) => item.dataset.adminView === "zelle")?.click();
});

adminZelleFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    adminZelleFilter = button.dataset.zelleFilter || "pending";
    adminZelleVisibleCount = ZELLE_PAGE_SIZE;
    adminZelleFilterButtons.forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
    });
    renderAdminZellePayments(adminZellePayments);
  });
});

adminZelleLoadMore?.addEventListener("click", () => {
  adminZelleVisibleCount += ZELLE_PAGE_SIZE;
  renderAdminZellePayments(adminZellePayments);
});

adminZelleConfirmCancel?.addEventListener("click", () => {
  pendingZelleConfirmation = null;
  adminZelleConfirmDialog?.close();
});

adminZelleConfirmDialog?.addEventListener("cancel", () => {
  pendingZelleConfirmation = null;
});

adminZelleConfirmSubmit?.addEventListener("click", async () => {
  const form = pendingZelleConfirmation;
  pendingZelleConfirmation = null;
  adminZelleConfirmDialog?.close();
  if (form) await confirmZellePayment(form);
});

adminLoginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(adminLoginStatus, "Signing in...");
  try {
    if (!supabaseClient) await loadAdminConfig();
    const email = document.querySelector("#adminEmail").value;
    const password = document.querySelector("#adminPassword").value;
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    adminSession = data.session;
    showDashboard(true);
    await loadDogs();
    setStatus(adminLoginStatus, "");
  } catch (error) {
    setStatus(adminLoginStatus, error.message);
  }
});

adminSignOut?.addEventListener("click", async () => {
  await supabaseClient?.auth.signOut();
  adminSession = null;
  showAdminView("dashboard");
  showDashboard(false);
});

adminRefresh?.addEventListener("click", () => loadDogs().catch((error) => setStatus(adminStatus, error.message)));
adminSearch?.addEventListener("input", renderDogs);
adminPetFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    adminPetFilter = button.dataset.petFilter || "active";
    adminPetFilterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    renderDogs();
  });
});
adminPetNameConfirm?.addEventListener("input", () => {
  if (!pendingPetAction || pendingPetAction.action !== "delete") return;
  adminPetActionSubmit.disabled = adminPetNameConfirm.value !== pendingPetAction.dog.name;
});
adminPetActionCancel?.addEventListener("click", () => {
  adminPetActionDialog?.close();
  pendingPetAction = null;
});
adminPetActionDialog?.addEventListener("cancel", () => {
  pendingPetAction = null;
});
adminPetActionSubmit?.addEventListener("click", () => runPetAction());
adminPetArchiveInstead?.addEventListener("click", () => runPetAction("archive"));

loadAdminConfig()
  .then(async () => {
    const { data } = await supabaseClient.auth.getSession();
    adminSession = data.session;
    if (adminSession) {
      showDashboard(true);
      await loadDogs();
    }
  })
  .catch((error) => setStatus(adminLoginStatus, error.message));
