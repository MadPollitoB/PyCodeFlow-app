/* ════════════════════════════════════════════════════════════════════════════
   theme-toggle.js — EXPERIMENTEEL, hoort bij theme-warm.css. Zet/haalt het
   <html data-theme="..."> attribuut op basis van het schuifknopje, en onthoudt
   de keuze (enkel lokaal, per browser — geen server/database bij betrokken).

   Bewust los van app.js: als het warme thema wordt afgekeurd, verwijder dit
   bestand samen met theme-warm.css en de toggle-knop in de HTML — er hoeft
   nergens anders iets aangepast te worden.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var OPSLAG_SLEUTEL = 'pycodeflow_experimenteel_thema';

  function huidigThema() {
    // Sprint 59.7: de warme stijl is nu de STANDAARD (voorheen classic) — het
    // schuifknopje is dus omgedraaid naar een opt-OUT ("Te verfrissend? → oude look"),
    // niet langer een opt-in. Wie nog nooit koos, krijgt de nieuwe stijl te zien.
    try { return localStorage.getItem(OPSLAG_SLEUTEL) || 'warm'; }
    catch (e) { return 'warm'; }
  }

  function zetThema(thema) {
    document.documentElement.setAttribute('data-theme', thema);
    try { localStorage.setItem(OPSLAG_SLEUTEL, thema); } catch (e) { /* stil */ }
  }

  // Meteen bij laden toepassen (vóór de toggle-knop zelf bestaat), zodat de
  // gekozen stijl niet even in de oude kleuren opflitst.
  zetThema(huidigThema());

  document.addEventListener('DOMContentLoaded', function () {
    var knop = document.getElementById('theme-toggle-switch');
    if (!knop) return;
    knop.checked = huidigThema() === 'warm';
    knop.addEventListener('change', function () {
      zetThema(knop.checked ? 'warm' : 'classic');
    });
  });
})();
