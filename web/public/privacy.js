// ── Sprint 51g: privacyverklaring als POPUP (geen aparte pagina) ─────────────
// Eén bron voor de modal én de "Privacy"-link in de footer. Werkt standalone (eigen
// inline styling), dus ook op pagina's die app.js niet laden. De link wordt in de
// bestaande footer gehangen; verschijnt die pas later (app.js bouwt ze asynchroon op),
// dan vangt een MutationObserver dat op.
(function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // De inhoud van de privacyverklaring. Bewust beknopt en in duidelijke taal.
  var SECTIES = [
    ['Wie verwerkt je gegevens?',
     'PyCodeFlow is een leerplatform voor programmeeronderwijs. De <strong>school</strong> waar je ' +
     'les volgt of geeft is de verwerkingsverantwoordelijke; PyCodeFlow verwerkt de gegevens in ' +
     'opdracht van de school (als verwerker).'],
    ['Welke gegevens?',
     'Voor leerlingen: je naam, je klas en schooljaar, en het werk dat je maakt (ingediende code, ' +
     'antwoorden, scores en feedback). Voor leerkrachten: je inlognaam, weergavenaam en de school(en) ' +
     'waaraan je gekoppeld bent. We vragen bewust <strong>zo weinig mogelijk</strong> gegevens.'],
    ['Waarvoor?',
     'Uitsluitend om het platform te laten werken: inloggen, lessen en toetsen/taken maken en ' +
     'verbeteren, en je resultaten tonen. Je gegevens worden <strong>niet verkocht</strong> en niet ' +
     'voor advertenties of profilering gebruikt.'],
    ['Cookies',
     'We gebruiken enkel <strong>strikt noodzakelijke sessiecookies</strong> om je ingelogd te houden ' +
     '(bv. <code>teacher_sid</code>, <code>student_sid</code>). Er zijn <strong>geen</strong> tracking-, ' +
     'analytics- of advertentiecookies. Daarom is er geen cookie-toestemming nodig.'],
    ['Hoe lang bewaard?',
     'Zolang dat nodig is voor de school (bv. voor de duur van het schooljaar of de wettelijke ' +
     'bewaartermijn van resultaten). De school bepaalt de bewaartermijn; nadien worden gegevens ' +
     'verwijderd of geanonimiseerd.'],
    ['Je rechten',
     'Je hebt recht op inzage, verbetering en verwijdering van je gegevens. Ben je een leerling ' +
     '(of ouder van een minderjarige leerling)? Richt je vraag aan de school; die geeft ze door aan ' +
     'PyCodeFlow. Leerkrachten kunnen terecht bij de beheerder van hun school.'],
    ['Beveiliging',
     'Wachtwoorden worden versleuteld bewaard, verbindingen verlopen over HTTPS en de toegang tot ' +
     'gegevens is afgeschermd per school en per rol.'],
  ];

  window.showPrivacy = function () {
    if (document.getElementById('privacy-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'privacy-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);display:flex;' +
      'align-items:center;justify-content:center;z-index:99999;padding:20px;';
    var body = SECTIES.map(function (s) {
      return '<h3 style="margin:16px 0 4px;font-size:1rem;color:#1e293b;">' + esc(s[0]) + '</h3>' +
             '<p style="margin:0;font-size:0.9rem;line-height:1.5;color:#334155;">' + s[1] + '</p>';
    }).join('');
    ov.innerHTML =
      '<div style="background:#fff;max-width:640px;width:100%;max-height:85vh;border-radius:16px;' +
        'box-shadow:0 20px 50px rgba(0,0,0,0.3);display:flex;flex-direction:column;overflow:hidden;">' +
        '<div style="padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;">' +
          '<strong style="font-size:1.15rem;color:#0f172a;">🔒 Privacyverklaring</strong>' +
          '<button id="privacy-close-x" aria-label="Sluiten" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#64748b;line-height:1;">×</button>' +
        '</div>' +
        '<div style="padding:6px 22px 18px;overflow-y:auto;">' + body +
          '<p style="margin:18px 0 0;font-size:0.78rem;color:#94a3b8;">' +
          'Deze samenvatting is informatief. Voor de volledige afspraken en de verwerkersovereenkomst ' +
          'kan je terecht bij je school.</p>' +
        '</div>' +
        '<div style="padding:14px 22px;border-top:1px solid #e2e8f0;text-align:right;">' +
          '<button id="privacy-close" style="background:#4f46e5;color:#fff;border:none;padding:9px 18px;' +
            'border-radius:9px;font-weight:700;cursor:pointer;font-size:0.9rem;">Sluiten</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    var sluit = function () { ov.remove(); };
    ov.addEventListener('click', function (e) { if (e.target === ov) sluit(); });
    document.getElementById('privacy-close').addEventListener('click', sluit);
    document.getElementById('privacy-close-x').addEventListener('click', sluit);
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { sluit(); document.removeEventListener('keydown', esc); }
    });
  };

  // De "Privacy"-link in een footer hangen (één keer).
  function voegLinkToe(footer) {
    if (!footer || footer.querySelector('.privacy-link')) return;
    var sep = document.createElement('span');
    sep.className = 'privacy-link';
    sep.innerHTML = ' · <a href="#" onclick="showPrivacy();return false;" ' +
      'style="color:inherit;text-decoration:underline;cursor:pointer;">Privacy</a>';
    footer.appendChild(sep);
  }

  function verwerkBestaande() {
    var f = document.querySelector('.footer-note') || document.querySelector('footer');
    if (f) { voegLinkToe(f); return true; }
    return false;
  }

  function init() {
    if (verwerkBestaande()) return;
    // Footer bestaat nog niet (app.js bouwt ze asynchroon). Kijk of ze later verschijnt.
    var obs = new MutationObserver(function () {
      if (verwerkBestaande()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    // Vangnet: stop met observeren na 8s en maak desnoods een eigen minimale footer.
    setTimeout(function () {
      obs.disconnect();
      if (!document.querySelector('.footer-note') && !document.querySelector('footer')) {
        var f = document.createElement('div');
        f.className = 'footer-note';
        f.style.cssText = 'text-align:center;color:#94a3b8;font-size:0.8rem;padding:18px 0;';
        document.body.appendChild(f);
        voegLinkToe(f);
      }
    }, 8000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
