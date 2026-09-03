/* ════════════════════════════════════════════════════════════════════════════
   footer-note.js — de STANDAARD footer ("© 2026 PyCodeFlow — ontwikkeld door
   B. Claes • vX.X.X.X"), voor pagina's die app.js niet laden (de lichte
   login-schermen). Exact dezelfde opbouw als injectFooter() in app.js — dus
   overal identiek, of een pagina nu app.js laadt of niet.

   Bugfix: op student-start.html stond eerder een LEGE <div class="footer-note">
   vooraf in de HTML, "om privacy.js iets te laten invullen" — maar app.js'
   eigen injectFooter() slaat het aanmaken van de footer juist over zodra er al
   een .footer-note bestaat (bedoeld om dubbele footers te vermijden, sprint
   63). Het gevolg: die vooraf-lege div bleef leeg op de ©-tekst na, en kreeg
   enkel nog de "· Privacy"-link van privacy.js — vandaar de onvolledige
   footer. Nooit een lege .footer-note vooraf aanmaken: laat óf app.js (als
   die geladen is), óf dit bestand (als dat niet zo is) 'm vullen.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  async function injectFooter() {
    if (document.querySelector('.footer-note') || document.querySelector('footer')) return;

    var versionText = '';
    try {
      var res = await fetch('/api/version');
      var data = await res.json();
      if (data && data.version) versionText = ' • v' + data.version;
    } catch (e) { /* geen versie beschikbaar, footer verschijnt gewoon zonder */ }

    var footer = document.createElement('div');
    footer.className = 'footer-note';
    footer.innerHTML = '© 2026 PyCodeFlow — ontwikkeld door B. Claes' + versionText;
    document.body.appendChild(footer);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectFooter);
  else injectFooter();
})();
