(() => {
  "use strict";

  const noticeKey = "shingos-privacy-notice-v1";
  const languageKey = "shingos-language";
  let previousFocus = null;

  const copy = {
    en: {
      noticeTitle: "Your privacy at Shingo's Palace",
      noticeText:
        "We use necessary technologies to keep accounts secure, process reservations and payments, prevent fraud, and remember your language and session. We do not use advertising or analytics trackers.",
      privacyPolicy: "Privacy Policy",
      cookiePolicy: "Cookie Policy",
      cookieSettings: "Cookie Settings",
      acknowledge: "Got it",
      settingsTitle: "Privacy technologies",
      settingsIntro:
        "Shingo's Palace currently uses only technologies needed to provide the website and services you request. There are no advertising or analytics categories to accept or reject.",
      necessaryTitle: "Necessary technologies",
      necessaryStatus: "Always active",
      necessaryText:
        "These technologies support secure sign-in, reservations, fraud prevention, payment processing, and essential preferences.",
      storageHeading: "What is used",
      siteStorage: "Shingo's Palace browser storage",
      siteStorageText: "Remembers your selected language and whether you acknowledged this notice.",
      supabaseStorage: "Supabase authentication storage",
      supabaseStorageText: "Keeps you signed in securely and supports My Account and Admin sessions.",
      stripeStorage: "Stripe payment technologies",
      stripeStorageText: "Supports secure checkout, payment eligibility, and fraud prevention when you choose to pay.",
      close: "Close",
      footerPrivacy: "Privacy Policy",
      footerCookies: "Cookie Policy",
      footerTerms: "Terms of Service",
      footerBooking: "Booking Policies",
    },
    es: {
      noticeTitle: "Tu privacidad en Shingo's Palace",
      noticeText:
        "Usamos tecnologías necesarias para proteger las cuentas, procesar reservas y pagos, prevenir fraude y recordar tu idioma y sesión. No usamos rastreadores de publicidad ni analítica.",
      privacyPolicy: "Política de Privacidad",
      cookiePolicy: "Política de Cookies",
      cookieSettings: "Configuración de Cookies",
      acknowledge: "Entendido",
      settingsTitle: "Tecnologías de privacidad",
      settingsIntro:
        "Shingo's Palace actualmente usa solo tecnologías necesarias para brindar el sitio y los servicios que solicitás. No hay categorías de publicidad o analítica para aceptar o rechazar.",
      necessaryTitle: "Tecnologías necesarias",
      necessaryStatus: "Siempre activas",
      necessaryText:
        "Estas tecnologías permiten el inicio de sesión seguro, las reservas, la prevención de fraude, los pagos y las preferencias esenciales.",
      storageHeading: "Qué se utiliza",
      siteStorage: "Almacenamiento del navegador de Shingo's Palace",
      siteStorageText: "Recuerda el idioma elegido y si confirmaste haber visto este aviso.",
      supabaseStorage: "Almacenamiento de autenticación de Supabase",
      supabaseStorageText: "Mantiene la sesión segura y permite usar Mi Cuenta y las sesiones de Admin.",
      stripeStorage: "Tecnologías de pago de Stripe",
      stripeStorageText: "Permite checkout seguro, elegibilidad de métodos de pago y prevención de fraude cuando elegís pagar.",
      close: "Cerrar",
      footerPrivacy: "Política de Privacidad",
      footerCookies: "Política de Cookies",
      footerTerms: "Términos del Servicio",
      footerBooking: "Políticas de Reserva",
    },
  };

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (_error) {
      // The notice can still be dismissed for the current page when storage is unavailable.
    }
  }

  function getLanguage() {
    const stored = readStorage(languageKey);
    if (stored === "es" || stored === "en") return stored;
    return document.documentElement.lang === "es" ? "es" : "en";
  }

  function translatePrivacyUi() {
    const language = getLanguage();
    document.documentElement.lang = language;
    document.querySelectorAll("[data-privacy-copy]").forEach((node) => {
      const value = copy[language][node.dataset.privacyCopy];
      if (value) node.textContent = value;
    });

    const closeButton = document.querySelector(".privacy-settings-close");
    if (closeButton) closeButton.setAttribute("aria-label", copy[language].close);

    document.querySelectorAll("[data-legal-lang]").forEach((section) => {
      section.hidden = section.dataset.legalLang !== language;
    });
    document.querySelectorAll("[data-legal-language]").forEach((button) => {
      const active = button.dataset.legalLanguage === language;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function closeSettings() {
    const dialog = document.getElementById("privacySettingsDialog");
    if (dialog?.open) {
      dialog.close();
      return;
    }
    restorePreviousFocus();
  }

  function restorePreviousFocus() {
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
    previousFocus = null;
  }

  function openSettings() {
    const dialog = document.getElementById("privacySettingsDialog");
    if (!dialog) return;
    previousFocus = document.activeElement;
    translatePrivacyUi();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector(".privacy-settings-close")?.focus();
  }

  function buildPrivacyUi() {
    if (!document.getElementById("privacyNotice")) {
      const notice = document.createElement("aside");
      notice.id = "privacyNotice";
      notice.className = "privacy-notice";
      notice.setAttribute("aria-labelledby", "privacyNoticeTitle");
      notice.hidden = true;
      notice.innerHTML = `
        <div class="privacy-notice-copy">
          <strong id="privacyNoticeTitle" data-privacy-copy="noticeTitle"></strong>
          <p data-privacy-copy="noticeText"></p>
          <div class="privacy-notice-links">
            <a href="privacy-policy.html" data-privacy-copy="privacyPolicy"></a>
            <a href="cookie-policy.html" data-privacy-copy="cookiePolicy"></a>
            <button class="privacy-inline-button cookie-settings-trigger" type="button" data-privacy-copy="cookieSettings"></button>
          </div>
        </div>
        <button class="privacy-acknowledge" type="button" data-privacy-copy="acknowledge"></button>
      `;
      document.body.appendChild(notice);

      notice.querySelector(".privacy-acknowledge")?.addEventListener("click", () => {
        writeStorage(noticeKey, "acknowledged");
        notice.hidden = true;
      });
    }

    if (!document.getElementById("privacySettingsDialog")) {
      const dialog = document.createElement("dialog");
      dialog.id = "privacySettingsDialog";
      dialog.className = "privacy-settings-dialog";
      dialog.setAttribute("aria-labelledby", "privacySettingsTitle");
      dialog.innerHTML = `
        <div class="privacy-settings-card">
          <button class="privacy-settings-close" type="button" aria-label="Close">×</button>
          <p class="section-kicker" data-privacy-copy="cookieSettings"></p>
          <h2 id="privacySettingsTitle" data-privacy-copy="settingsTitle"></h2>
          <p class="privacy-settings-intro" data-privacy-copy="settingsIntro"></p>
          <section class="privacy-category" aria-labelledby="necessaryCategoryTitle">
            <div>
              <h3 id="necessaryCategoryTitle" data-privacy-copy="necessaryTitle"></h3>
              <span data-privacy-copy="necessaryStatus"></span>
            </div>
            <p data-privacy-copy="necessaryText"></p>
          </section>
          <h3 class="privacy-storage-heading" data-privacy-copy="storageHeading"></h3>
          <div class="privacy-storage-list">
            <article><strong data-privacy-copy="siteStorage"></strong><p data-privacy-copy="siteStorageText"></p></article>
            <article><strong data-privacy-copy="supabaseStorage"></strong><p data-privacy-copy="supabaseStorageText"></p></article>
            <article><strong data-privacy-copy="stripeStorage"></strong><p data-privacy-copy="stripeStorageText"></p></article>
          </div>
          <div class="privacy-settings-links">
            <a href="privacy-policy.html" data-privacy-copy="privacyPolicy"></a>
            <a href="cookie-policy.html" data-privacy-copy="cookiePolicy"></a>
          </div>
          <button class="privacy-settings-done" type="button" data-privacy-copy="close"></button>
        </div>
      `;
      document.body.appendChild(dialog);
      dialog.querySelector(".privacy-settings-close")?.addEventListener("click", closeSettings);
      dialog.querySelector(".privacy-settings-done")?.addEventListener("click", closeSettings);
      dialog.addEventListener("close", restorePreviousFocus);
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeSettings();
      });
    }

    document.querySelectorAll(".cookie-settings-trigger").forEach((button) => {
      if (button.dataset.privacyBound === "true") return;
      button.dataset.privacyBound = "true";
      button.addEventListener("click", openSettings);
    });

    document.querySelectorAll("[data-legal-language]").forEach((button) => {
      button.addEventListener("click", () => {
        const language = button.dataset.legalLanguage;
        writeStorage(languageKey, language);
        document.documentElement.lang = language;
        translatePrivacyUi();
      });
    });

    translatePrivacyUi();
    if (!readStorage(noticeKey)) document.getElementById("privacyNotice").hidden = false;
  }

  window.openPrivacySettings = openSettings;
  window.addEventListener("shingos:languagechange", translatePrivacyUi);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildPrivacyUi, { once: true });
  } else {
    buildPrivacyUi();
  }
})();
