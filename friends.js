const friendsTranslations = {
  en: {
    tagline: "Boutique home boarding",
    backHome: "Back to Shingo's Palace",
    eyebrow: "Dog Match Program",
    heroTitle: "The Shingo's Palace Club",
    heroIntro: "Meet the dogs who made Shingo's Palace their second home.",
    heroNote:
      "Some visit every week. Others join us whenever their families travel. Over time, many have built real friendships and become part of our pack. Welcome to the Shingo's Palace Club.",
    profilesKicker: "Club profiles",
    profilesTitle: "A closer look at the dogs Carla knows by heart.",
    clubCtaKicker: "Become part of the Club",
    clubCtaTitle: "Could your dog be our next Club Member?",
    clubCtaText:
      "Many of our guests become regular visitors, build lasting friendships, and become part of the Shingo's Palace family. Every friendship starts with a first visit.",
    clubCtaButton: "Request a Stay",
    playDatesKicker: "Upcoming Play Dates",
    playDatesTitle: "Overlapping stays with friendly potential",
    futureKicker: "Future-ready",
    futureTitle: "Built for favorite-friend notifications",
    futureBody:
      "This page already separates dog profiles, compatibility notes, stay dates, and future notification triggers so we can later alert families when a favorite playmate is scheduled.",
    breed: "Breed",
    age: "Age",
    size: "Size",
    energy: "Energy",
    swimming: "Swimming",
    fetch: "Fetch",
    personality: "Personality",
    playStyle: "Play style",
    favoriteActivities: "Favorite activities",
    hangsOutWith: "Usually hangs out with",
    bestFriends: "Favorite friends",
    compatibility: "Compatibility recommendations",
    observations: "Carla's Note",
    moreDetails: "More details",
    funFacts: "Fun facts",
    memberBadge: "Shingo's Palace Club Member",
    viewProfile: "View profile",
    overlap: "Overlap",
    whyMatch: "Why they may enjoy each other",
    noPlayDates: "No compatible overlapping stays are currently listed.",
    noProfiles: "No dogs match these filters yet.",
    closeProfile: "Close profile",
    filters: {
      small: "Small",
      medium: "Medium",
      large: "Large",
      "high-energy": "High Energy",
      calm: "Calm",
      "loves-swimming": "Loves Swimming",
      "loves-fetch": "Loves Fetch",
    },
    sizeValues: {
      "Extra Small": "Extra Small",
      Small: "Small",
      Medium: "Medium",
      Large: "Large",
      "Small to medium": "Small to medium",
    },
  },
  es: {
    tagline: "Hospedaje boutique en casa",
    backHome: "Volver a Shingo's Palace",
    eyebrow: "Dog Match Program",
    heroTitle: "The Shingo's Palace Club",
    heroIntro: "Conoce a los perros que hicieron de Shingo's Palace su segundo hogar.",
    heroNote:
      "Algunos vienen todas las semanas. Otros nos visitan cuando sus familias viajan. Con el tiempo, muchos crearon amistades reales y se volvieron parte de nuestra manada. Bienvenidos a The Shingo's Palace Club.",
    profilesKicker: "Perfiles del club",
    profilesTitle: "Una mirada cercana a los perros que Carla conoce de corazón.",
    clubCtaKicker: "Sumarse al Club",
    clubCtaTitle: "¿Podría tu perro ser nuestro próximo Club Member?",
    clubCtaText:
      "Muchos de nuestros huéspedes se convierten en visitantes regulares, crean amistades duraderas y pasan a formar parte de la familia de Shingo's Palace. Toda amistad empieza con una primera visita.",
    clubCtaButton: "Solicitar una estadía",
    playDatesKicker: "Próximos días de juego",
    playDatesTitle: "Estadías superpuestas con potencial de amistad",
    futureKicker: "Preparado para crecer",
    futureTitle: "Listo para notificaciones de amigos favoritos",
    futureBody:
      "Esta página ya separa perfiles, notas de compatibilidad, fechas de estadía y futuros disparadores de notificación para que luego podamos avisar a las familias cuando un compañero favorito tenga visita programada.",
    breed: "Raza",
    age: "Edad",
    size: "Tamaño",
    energy: "Energía",
    swimming: "Natación",
    fetch: "Pelota",
    personality: "Personalidad",
    playStyle: "Estilo de juego",
    favoriteActivities: "Actividades favoritas",
    hangsOutWith: "Suele estar con",
    bestFriends: "Amigos favoritos",
    compatibility: "Recomendaciones de compatibilidad",
    observations: "Nota de Carla",
    moreDetails: "Más detalles",
    funFacts: "Datos especiales",
    memberBadge: "Miembro de Shingo's Palace Club",
    viewProfile: "Ver perfil",
    overlap: "Coincidencia",
    whyMatch: "Por qué podrían disfrutar juntos",
    noPlayDates: "No hay estadías compatibles superpuestas cargadas por ahora.",
    noProfiles: "Todavía no hay perros con estos filtros.",
    closeProfile: "Cerrar perfil",
    filters: {
      small: "Pequeño",
      medium: "Mediano",
      large: "Grande",
      "high-energy": "Mucha energía",
      calm: "Tranquilo",
      "loves-swimming": "Ama nadar",
      "loves-fetch": "Ama la pelota",
    },
    sizeValues: {
      "Extra Small": "Extra pequeño",
      Small: "Pequeño",
      Medium: "Mediano",
      Large: "Grande",
      "Small to medium": "Pequeño a mediano",
    },
  },
};

const filterOptions = ["small", "medium", "large", "high-energy", "calm", "loves-swimming", "loves-fetch"];
const profilesById = new Map(window.dogMatchData.profiles.map((profile) => [profile.id, profile]));
const profilesByName = new Map(window.dogMatchData.profiles.map((profile) => [profile.name.toLowerCase(), profile]));
const langButtons = document.querySelectorAll(".lang-button");
const profileModal = document.querySelector("#profileModal");
const profileModalContent = document.querySelector("#profileModalContent");
const currentDate = new Date();
let currentLang = localStorage.getItem("shingos-language") || "en";
let activeFilters = new Set();

function ft(key) {
  return friendsTranslations[currentLang][key] || "";
}

function localize(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value[currentLang] || value.en || "";
  return value || "";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function translatedSize(size) {
  return friendsTranslations[currentLang].sizeValues[size] || size;
}

function formatDateRange(start, end) {
  const options = { month: "short", day: "numeric" };
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const locale = currentLang === "es" ? "es-US" : "en-US";
  return `${startDate.toLocaleDateString(locale, options)} - ${endDate.toLocaleDateString(locale, options)}`;
}

function overlaps(first, second) {
  const firstStart = new Date(`${first.startDate}T00:00:00`);
  const firstEnd = new Date(`${first.endDate}T23:59:59`);
  const secondStart = new Date(`${second.startDate}T00:00:00`);
  const secondEnd = new Date(`${second.endDate}T23:59:59`);
  return firstStart <= secondEnd && secondStart <= firstEnd && firstEnd >= currentDate && secondEnd >= currentDate;
}

function sharedOverlap(first, second) {
  const start = first.startDate > second.startDate ? first.startDate : second.startDate;
  const end = first.endDate < second.endDate ? first.endDate : second.endDate;
  return formatDateRange(start, end);
}

function isRecommended(firstDog, secondDog) {
  return firstDog.recommendedWith.includes(secondDog.id) || secondDog.recommendedWith.includes(firstDog.id);
}

function ratingStars(level, label) {
  const safeLevel = Math.max(0, Math.min(5, Number(level) || 0));
  return `
    <div class="club-rating" aria-label="${label}: ${safeLevel} of 5">
      ${Array.from({ length: 5 }, (_, index) => `<span class="${index < safeLevel ? "filled" : ""}">★</span>`).join("")}
    </div>
  `;
}

function iconSvg(name) {
  const icons = {
    breed:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.7 10.8c1.3 0 2.3-1.4 2.3-3.1S8 4.6 6.7 4.6 4.4 6 4.4 7.7s1 3.1 2.3 3.1Z"/><path d="M17.3 10.8c1.3 0 2.3-1.4 2.3-3.1s-1-3.1-2.3-3.1S15 6 15 7.7s1 3.1 2.3 3.1Z"/><path d="M9.8 9.2c1.2 0 2.1-1.4 2.1-3s-.9-3-2.1-3-2.1 1.4-2.1 3 .9 3 2.1 3Z"/><path d="M14.2 9.2c1.2 0 2.1-1.4 2.1-3s-.9-3-2.1-3-2.1 1.4-2.1 3 .9 3 2.1 3Z"/><path d="M12 11.2c-3 0-5.5 2.2-5.5 4.9 0 1.8 1.1 3 2.7 3 .9 0 1.7-.4 2.8-.4s1.9.4 2.8.4c1.6 0 2.7-1.2 2.7-3 0-2.7-2.5-4.9-5.5-4.9Z"/></svg>',
    age:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v6l4 2"/><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/></svg>',
    size:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V5h14"/><path d="M5 5l14 14"/><path d="M14 19h5v-5"/></svg>',
    energy:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 5 14h6l-1 8 9-13h-6l1-7Z"/></svg>',
    swimming:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s5 5.3 5 10a5 5 0 0 1-10 0c0-4.7 5-10 5-10Z"/><path d="M4 19c2 1.4 4 1.4 6 0s4-1.4 6 0 4 1.4 6 0"/></svg>',
    fetch:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/><path d="M5.6 5.6 18.4 18.4"/><path d="M18.4 5.6 5.6 18.4"/></svg>',
    friends:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M16 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M2.8 20c.7-3.4 2.8-5.2 5.2-5.2s4.5 1.8 5.2 5.2"/><path d="M12.7 18.2c.8-2.2 2.5-3.4 4.4-3.4 2.1 0 3.7 1.5 4.2 4.2"/></svg>',
    note:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5z"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/></svg>',
    fact:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.4 5 5.6.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.6-.8L12 3Z"/></svg>',
  };
  return icons[name] || "";
}

function iconWrap(name) {
  return `<span class="club-icon">${iconSvg(name)}</span>`;
}

function ratingRow(icon, label, level) {
  return `
    <div>
      <span class="rating-label">${iconWrap(icon)}<span>${label}</span></span>
      ${ratingStars(level, label)}
    </div>
  `;
}

function factItem(icon, label, value) {
  return `
    <div class="club-fact-item">
      ${iconWrap(icon)}
      <span><small>${label}</small><strong>${escapeHtml(value)}</strong></span>
    </div>
  `;
}

function listItems(items) {
  return localize(items)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function chipForName(name) {
  const profile = profilesByName.get(String(name).toLowerCase());
  const escapedName = escapeHtml(name);
  if (!profile) return `<span class="dog-chip">${escapedName}</span>`;
  return `<button class="dog-chip clickable" type="button" data-profile-chip="${profile.id}">${escapedName}</button>`;
}

function dogChips(names = []) {
  return `<div class="dog-chip-row">${names.map(chipForName).join("")}</div>`;
}

function memberBadge() {
  return `<span class="club-member-badge"><span aria-hidden="true">◆</span>${ft("memberBadge")}</span>`;
}

function attachProfileInteractions(container) {
  container.querySelectorAll("[data-profile-chip]").forEach((chip) => {
    chip.addEventListener("click", (event) => {
      event.stopPropagation();
      openProfile(chip.dataset.profileChip);
    });
  });
}

function renderFilters() {
  const filters = document.querySelector("#clubFilters");
  filters.innerHTML = filterOptions
    .map(
      (filter) => `
        <button class="club-filter ${activeFilters.has(filter) ? "active" : ""}" type="button" data-filter="${filter}">
          ${friendsTranslations[currentLang].filters[filter]}
        </button>
      `,
    )
    .join("");

  filters.querySelectorAll(".club-filter").forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.filter;
      if (activeFilters.has(filter)) activeFilters.delete(filter);
      else activeFilters.add(filter);
      renderFilters();
      renderProfiles();
    });
  });
}

function profileMatchesFilters(profile) {
  if (!activeFilters.size) return true;
  const profileFilters = new Set(profile.filters || []);
  return [...activeFilters].some((filter) => profileFilters.has(filter));
}

function profileImage(profile, index = 0) {
  return profile.photos[index] || profile.photos[0] || "assets/shingo-original.jpg";
}

function renderProfiles() {
  const profileGrid = document.querySelector("#dogProfiles");
  const profiles = window.dogMatchData.profiles.filter(profileMatchesFilters);

  profileGrid.innerHTML = profiles.length
    ? profiles
        .map(
          (profile) => `
            <article class="dog-profile-card club-card" data-profile-id="${profile.id}" tabindex="0" role="button" aria-label="${ft(
              "viewProfile",
            )}: ${escapeHtml(profile.name)}">
              <div class="dog-photo">
                <img src="${profileImage(profile)}" alt="${escapeHtml(profile.name)} at Shingo's Palace" loading="lazy" />
                ${memberBadge()}
              </div>
              <div class="dog-profile-content">
                <div class="dog-card-head">
                  <div>
                    <p class="section-kicker">${translatedSize(profile.size)}</p>
                    <h3>${escapeHtml(profile.name)}</h3>
                  </div>
                </div>
                <div class="club-info-grid">
                  ${factItem("breed", ft("breed"), profile.breed)}
                  ${factItem("age", ft("age"), profile.age)}
                  ${factItem("size", ft("size"), translatedSize(profile.size))}
                </div>
                <div class="club-ratings">
                  ${ratingRow("energy", ft("energy"), profile.energyLevel)}
                  ${ratingRow("swimming", ft("swimming"), profile.swimmingLevel)}
                  ${ratingRow("fetch", ft("fetch"), profile.fetchLevel)}
                </div>
                <div class="club-chip-block">
                  <strong>${iconWrap("friends")}${ft("hangsOutWith")}</strong>
                  ${dogChips(profile.usuallyHangsOutWith || profile.bestFriends)}
                </div>
                <p class="carla-note">${localize(profile.carlaObservations)}</p>
                <span class="profile-link">${ft("viewProfile")}</span>
              </div>
            </article>
          `,
        )
        .join("")
    : `<p class="empty-state light">${ft("noProfiles")}</p>`;

  profileGrid.querySelectorAll(".dog-profile-card").forEach((card) => {
    card.addEventListener("click", () => openProfile(card.dataset.profileId));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openProfile(card.dataset.profileId);
      }
    });
  });
  attachProfileInteractions(profileGrid);
}

function renderProfileModal(profile) {
  const activities = listItems(profile.favoriteActivities);
  const funFacts = listItems(profile.funFacts || { en: [], es: [] });
  const photos = profile.photos
    .map((photo, index) => `<img src="${photo}" alt="${escapeHtml(profile.name)} photo ${index + 1}" loading="lazy" />`)
    .join("");

  profileModalContent.innerHTML = `
    <div class="profile-modal-gallery">${photos}</div>
    <div class="profile-modal-copy">
      ${memberBadge()}
      <p class="section-kicker">${translatedSize(profile.size)}</p>
      <h2 id="profileModalTitle">${escapeHtml(profile.name)}</h2>
      <div class="club-info-grid">
        ${factItem("breed", ft("breed"), profile.breed)}
        ${factItem("age", ft("age"), profile.age)}
        ${factItem("size", ft("size"), translatedSize(profile.size))}
      </div>
      <div class="club-ratings modal-ratings">
        ${ratingRow("energy", ft("energy"), profile.energyLevel)}
        ${ratingRow("swimming", ft("swimming"), profile.swimmingLevel)}
        ${ratingRow("fetch", ft("fetch"), profile.fetchLevel)}
      </div>
      <p><strong>${ft("personality")}:</strong> ${localize(profile.personality)}</p>
      <p><strong>${ft("playStyle")}:</strong> ${localize(profile.playStyle)}</p>
      <div class="modal-list-block">
        <strong>${iconWrap("fetch")}${ft("favoriteActivities")}</strong>
        <ul class="activity-list">${activities}</ul>
      </div>
      <div class="modal-list-block">
        <strong>${iconWrap("fact")}${ft("funFacts")}</strong>
        <ul class="activity-list">${funFacts}</ul>
      </div>
      <div class="club-chip-block">
        <strong>${iconWrap("friends")}${ft("bestFriends")}</strong>
        ${dogChips(profile.bestFriends)}
      </div>
      <div class="club-chip-block">
        <strong>${iconWrap("friends")}${ft("hangsOutWith")}</strong>
        ${dogChips(profile.usuallyHangsOutWith || profile.bestFriends)}
      </div>
      <p><strong>${ft("compatibility")}:</strong> ${localize(profile.compatibilityNotes)}</p>
      <p><strong>${ft("moreDetails")}:</strong> ${localize(profile.profileDetails)}</p>
      <p class="carla-note">${localize(profile.carlaObservations)}</p>
    </div>
  `;
  attachProfileInteractions(profileModalContent);
}

function openProfile(profileId) {
  const profile = profilesById.get(profileId);
  if (!profile) return;
  renderProfileModal(profile);
  profileModal.classList.add("active");
  profileModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  history.replaceState(null, "", `#profile-${profile.id}`);
}

function closeProfile() {
  profileModal.classList.remove("active");
  profileModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  if (window.location.hash.startsWith("#profile-")) history.replaceState(null, "", window.location.pathname);
}

function renderPlayDates() {
  const playDateGrid = document.querySelector("#playDates");
  const stays = window.dogMatchData.upcomingStays;
  const matches = [];

  stays.forEach((stay, index) => {
    stays.slice(index + 1).forEach((candidate) => {
      const firstDog = profilesById.get(stay.dogId);
      const secondDog = profilesById.get(candidate.dogId);
      if (!firstDog || !secondDog || !overlaps(stay, candidate) || !isRecommended(firstDog, secondDog)) return;

      matches.push({ stay, candidate, firstDog, secondDog });
    });
  });

  playDateGrid.innerHTML = matches.length
    ? matches
        .map(
          ({ stay, candidate, firstDog, secondDog }) => `
            <article class="play-date-card">
              <div class="play-date-dogs">
                <img src="${profileImage(firstDog)}" alt="${escapeHtml(firstDog.name)}" loading="lazy" />
                <img src="${profileImage(secondDog)}" alt="${escapeHtml(secondDog.name)}" loading="lazy" />
              </div>
              <p class="section-kicker">${ft("overlap")} · ${sharedOverlap(stay, candidate)}</p>
              <h3>${escapeHtml(firstDog.name)} + ${escapeHtml(secondDog.name)}</h3>
              <p><strong>${ft("whyMatch")}:</strong> ${localize(firstDog.compatibilityNotes)}</p>
              <span>${escapeHtml(stay.stayType)} / ${escapeHtml(candidate.stayType)}</span>
            </article>
          `,
        )
        .join("")
    : `<p class="empty-state">${ft("noPlayDates")}</p>`;
}

function applyLanguage() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n;
    if (friendsTranslations[currentLang][key]) node.textContent = friendsTranslations[currentLang][key];
  });

  langButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.lang === currentLang);
  });

  renderFilters();
  renderProfiles();
  renderPlayDates();

  const hashProfile = window.location.hash.replace("#profile-", "");
  if (hashProfile && profilesById.has(hashProfile)) renderProfileModal(profilesById.get(hashProfile));
}

window.setFriendsLanguage = (lang) => {
  currentLang = lang;
  localStorage.setItem("shingos-language", currentLang);
  applyLanguage();
};

langButtons.forEach((button) => {
  button.addEventListener("click", () => window.setFriendsLanguage(button.dataset.lang));
});

document.querySelector(".profile-modal-close").addEventListener("click", closeProfile);
document.querySelector(".profile-modal-backdrop").addEventListener("click", closeProfile);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && profileModal.classList.contains("active")) closeProfile();
});

applyLanguage();

const initialProfile = window.location.hash.replace("#profile-", "");
if (initialProfile && profilesById.has(initialProfile)) openProfile(initialProfile);
