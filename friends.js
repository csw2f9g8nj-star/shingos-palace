const friendsTranslations = {
  en: {
    tagline: "Boutique home boarding",
    backHome: "Back to Shingo's Palace",
    eyebrow: "Dog Match Program",
    heroTitle: "Friends of Shingo's Palace",
    heroIntro:
      "Behavioral profiles for regular guests, built from Carla's real observations, play style, energy, and trusted friendships.",
    heroNote: "Matching is based on relationships and supervised behavior, never breed stereotypes.",
    profilesKicker: "Regular guest profiles",
    profilesTitle: "Every friendship starts with observation.",
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
    personality: "Personality",
    playStyle: "Play style",
    favoriteActivities: "Favorite activities",
    bestFriends: "Favorite friends",
    compatibility: "Compatibility recommendations",
    observations: "Carla's observations",
    overlap: "Overlap",
    whyMatch: "Why they may enjoy each other",
    noPlayDates: "No compatible overlapping stays are currently listed.",
  },
  es: {
    tagline: "Hospedaje boutique en casa",
    backHome: "Volver a Shingo's Palace",
    eyebrow: "Dog Match Program",
    heroTitle: "Friends of Shingo's Palace",
    heroIntro:
      "Perfiles de comportamiento para huéspedes frecuentes, creados desde observaciones reales de Carla, estilo de juego, energía y amistades de confianza.",
    heroNote: "El matching se basa en relaciones y conducta supervisada, nunca en estereotipos de raza.",
    profilesKicker: "Perfiles de huéspedes frecuentes",
    profilesTitle: "Cada amistad empieza con observación.",
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
    personality: "Personalidad",
    playStyle: "Estilo de juego",
    favoriteActivities: "Actividades favoritas",
    bestFriends: "Amigos favoritos",
    compatibility: "Recomendaciones de compatibilidad",
    observations: "Observaciones de Carla",
    overlap: "Coincidencia",
    whyMatch: "Por qué podrían disfrutar juntos",
    noPlayDates: "No hay estadías compatibles superpuestas cargadas por ahora.",
  },
};

const profilesById = new Map(window.dogMatchData.profiles.map((profile) => [profile.id, profile]));
const langButtons = document.querySelectorAll(".lang-button");
const currentDate = new Date("2026-06-17T00:00:00");
let currentLang = localStorage.getItem("shingos-language") || "en";

function ft(key) {
  return friendsTranslations[currentLang][key] || "";
}

function localize(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value[currentLang] || value.en || "";
  return value || "";
}

function formatDateRange(start, end) {
  const options = { month: "short", day: "numeric" };
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  return `${startDate.toLocaleDateString(currentLang === "es" ? "es-US" : "en-US", options)} - ${endDate.toLocaleDateString(
    currentLang === "es" ? "es-US" : "en-US",
    options,
  )}`;
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

function energyDots(level) {
  return Array.from({ length: 5 }, (_, index) => `<span class="${index < level ? "filled" : ""}"></span>`).join("");
}

function renderProfiles() {
  const profileGrid = document.querySelector("#dogProfiles");
  profileGrid.innerHTML = window.dogMatchData.profiles
    .map((profile) => {
      const activities = localize(profile.favoriteActivities)
        .map((activity) => `<li>${activity}</li>`)
        .join("");
      return `
        <article class="dog-profile-card">
          <div class="dog-photo">
            <img src="${profile.photos[0]}" alt="${profile.name} at Shingo's Palace" loading="lazy" />
          </div>
          <div class="dog-profile-content">
            <div class="dog-card-head">
              <div>
                <p class="section-kicker">${profile.size}</p>
                <h3>${profile.name}</h3>
              </div>
              <div class="energy-meter" aria-label="${ft("energy")} ${profile.energyLevel} of 5">${energyDots(profile.energyLevel)}</div>
            </div>
            <dl class="dog-facts">
              <div><dt>${ft("breed")}</dt><dd>${profile.breed}</dd></div>
              <div><dt>${ft("age")}</dt><dd>${profile.age}</dd></div>
              <div><dt>${ft("energy")}</dt><dd>${profile.energyLevel}/5</dd></div>
            </dl>
            <p><strong>${ft("personality")}:</strong> ${localize(profile.personality)}</p>
            <p><strong>${ft("playStyle")}:</strong> ${localize(profile.playStyle)}</p>
            <div>
              <strong>${ft("favoriteActivities")}:</strong>
              <ul class="activity-list">${activities}</ul>
            </div>
            <p><strong>${ft("bestFriends")}:</strong> ${profile.bestFriends.join(", ")}</p>
            <p><strong>${ft("compatibility")}:</strong> ${localize(profile.compatibilityNotes)}</p>
            <p class="carla-note">${localize(profile.carlaObservations)}</p>
          </div>
        </article>
      `;
    })
    .join("");
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
                <img src="${firstDog.photos[0]}" alt="${firstDog.name}" loading="lazy" />
                <img src="${secondDog.photos[0]}" alt="${secondDog.name}" loading="lazy" />
              </div>
              <p class="section-kicker">${ft("overlap")} · ${sharedOverlap(stay, candidate)}</p>
              <h3>${firstDog.name} + ${secondDog.name}</h3>
              <p><strong>${ft("whyMatch")}:</strong> ${localize(firstDog.compatibilityNotes)}</p>
              <span>${stay.stayType} / ${candidate.stayType}</span>
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

  renderProfiles();
  renderPlayDates();
}

window.setFriendsLanguage = (lang) => {
  currentLang = lang;
  localStorage.setItem("shingos-language", currentLang);
  applyLanguage();
};

langButtons.forEach((button) => {
  button.addEventListener("click", () => window.setFriendsLanguage(button.dataset.lang));
});

applyLanguage();
