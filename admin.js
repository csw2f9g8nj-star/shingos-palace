let supabaseClient;
let adminSession;
let adminDogs = [];

const adminLogin = document.querySelector("#adminLogin");
const adminDashboard = document.querySelector("#adminDashboard");
const adminLoginForm = document.querySelector("#adminLoginForm");
const adminLoginStatus = document.querySelector("#adminLoginStatus");
const adminStatus = document.querySelector("#adminStatus");
const adminDogsEl = document.querySelector("#adminDogs");
const adminTemplate = document.querySelector("#adminDogTemplate");
const adminSearch = document.querySelector("#adminSearch");
const adminRefresh = document.querySelector("#adminRefresh");
const adminSignOut = document.querySelector("#adminSignOut");

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
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function showDashboard(show) {
  adminLogin.hidden = show;
  adminDashboard.hidden = !show;
}

function formatOwner(owner) {
  if (!owner) return "Owner not linked yet";
  const name = [owner.first_name, owner.last_name].filter(Boolean).join(" ");
  return `${name || "Owner"} · ${owner.email || "No email"} · ${owner.phone || "No phone"}`;
}

function renderSection(title, lines) {
  const cleanLines = lines.filter(Boolean);
  if (!cleanLines.length) return `<h3>${title}</h3><p>No records yet.</p>`;
  return `<h3>${title}</h3><ul>${cleanLines.map((line) => `<li>${line}</li>`).join("")}</ul>`;
}

function recordList(records) {
  if (!records?.length) return ["No vaccination records uploaded yet."];
  return records.map((record) => {
    const date = record.upload_date ? new Date(record.upload_date).toLocaleDateString() : "No date";
    const expires = record.expiration_date ? ` · Expires ${record.expiration_date}` : "";
    const label = record.original_filename || `Record v${record.version || 1}`;
    const link = record.signed_url
      ? `<a class="admin-record-link" href="${record.signed_url}" target="_blank" rel="noopener">Preview / Download</a>`
      : "Signed URL unavailable";
    return `<strong>${label}</strong><br>${record.document_status || "submitted"} · Uploaded ${date}${expires}<br>${link}`;
  });
}

function noteList(notes) {
  if (!notes?.length) return ["No private notes yet."];
  return notes
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((note) => {
      const date = new Date(note.created_at).toLocaleString();
      return `<strong>${note.category || "Note"}</strong> · ${date}<br>${note.note_text}`;
    });
}

function compatibilityList(dog) {
  const items = [...(dog.compatibility_as_first || []), ...(dog.compatibility_as_second || [])];
  if (!items.length) return ["No compatibility notes yet."];
  return items.map((item) => `<strong>${item.status}</strong><br>${item.notes || "No extra notes."}`);
}

function populateDogOptions(select, currentDogId) {
  select.innerHTML = adminDogs
    .filter((dog) => dog.id !== currentDogId)
    .map((dog) => `<option value="${dog.id}">${dog.name || "Unnamed dog"}</option>`)
    .join("");
}

function renderDogs() {
  const query = (adminSearch?.value || "").toLowerCase().trim();
  const filtered = adminDogs.filter((dog) => {
    const haystack = [dog.name, dog.breed, dog.owner?.first_name, dog.owner?.last_name, dog.owner?.email]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return !query || haystack.includes(query);
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
    node.querySelector(".admin-dog-avatar").textContent = (dog.name || "?").slice(0, 1).toUpperCase();
    node.querySelector("h2").textContent = dog.name || "Unnamed dog";
    node.querySelector(".admin-owner").textContent = formatOwner(dog.owner);
    node.querySelector(".admin-contact").innerHTML = renderSection("Owner", [
      dog.owner?.emergency_contact ? `Emergency contact: ${dog.owner.emergency_contact}` : "",
    ]);
    node.querySelector(".admin-vet").innerHTML = renderSection("Veterinarian", [
      dog.veterinary_clinic ? `Clinic: ${dog.veterinary_clinic}` : "",
      dog.veterinarian_name ? `Vet: ${dog.veterinarian_name}` : "",
      dog.clinic_phone ? `Phone: ${dog.clinic_phone}` : "",
      dog.clinic_address ? `Address: ${dog.clinic_address}` : "",
    ]);
    node.querySelector(".admin-bookings").innerHTML = renderSection(
      "Reservation history",
      (dog.bookings || []).map(
        (booking) =>
          `${booking.service} · ${booking.dropoff_date || "No date"} → ${booking.pickup_date || "No date"} · ${booking.status}`,
      ),
    );
    node.querySelector(".admin-records").innerHTML = renderSection("Vaccination records", recordList(dog.vaccination_records));
    node.querySelector(".admin-compatibility").innerHTML = renderSection("Compatibility warnings", compatibilityList(dog));
    node.querySelector(".admin-notes").innerHTML = renderSection("Private notes", noteList(dog.dog_notes));

    const noteForm = node.querySelector(".admin-note-form");
    const relatedNoteDogSelect = noteForm.querySelector("select[name='relatedDogId']");
    relatedNoteDogSelect.innerHTML = `<option value="">None</option>${adminDogs
      .filter((item) => item.id !== dog.id)
      .map((item) => `<option value="${item.id}">${item.name || "Unnamed dog"}</option>`)
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

    adminDogsEl.appendChild(node);
  });
}

async function loadDogs() {
  setStatus(adminStatus, "Loading private records...");
  const payload = await apiFetch("/api/admin/dogs");
  adminDogs = payload.dogs || [];
  renderDogs();
  setStatus(adminStatus, "");
}

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
  showDashboard(false);
});

adminRefresh?.addEventListener("click", () => loadDogs().catch((error) => setStatus(adminStatus, error.message)));
adminSearch?.addEventListener("input", renderDogs);

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
