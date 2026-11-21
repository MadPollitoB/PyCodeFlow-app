'use strict';
// v145: live mini-kaartjes + schermafbeeldingen in het live-overzicht (teacher-grid).
// Zuivere functies (testbaar): interval normaliseren, beeld valideren, kaartdata opbouwen.

const STANDAARD_SEC = 30;
const MIN_SEC = 5;
const MAX_SEC = 300;
const MAX_BEELD_TEKENS = 150000;   // data-URL van een JPEG van ~320 px breed is meestal 10–30 kB

// undefined/ongeldig → 30; 0 (of negatief) → 0 = uit; 1–4 → 5; boven 300 → 300.
function normaliseerInterval(v) {
  if (v === undefined || v === null || v === '') return STANDAARD_SEC;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return STANDAARD_SEC;
  if (n <= 0) return 0;
  return Math.max(MIN_SEC, Math.min(MAX_SEC, n));
}

function isGeldigBeeld(img) {
  return typeof img === 'string' && img.length <= MAX_BEELD_TEKENS && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(img);
}

// Het begin van het antwoord op de huidige vraag (voor het kaartje).
function antwoordSnippet(antwoord, max = 90) {
  if (!antwoord) return '';
  let t = '';
  if (typeof antwoord.code === 'string' && antwoord.code.trim()) t = antwoord.code;
  else if (antwoord.partAnswers && typeof antwoord.partAnswers === 'object') {
    t = Object.values(antwoord.partAnswers).filter(v => typeof v === 'string' && v.trim()).join(' ⏐ ');
  }
  if (!t && Array.isArray(antwoord.selectedChoices) && antwoord.selectedChoices.length) t = `${antwoord.selectedChoices.length} keuze(s) gemaakt`;
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// Eén kaartje per (niet-verwijderde) leerling van een toets/taak.
function bouwLiveKaarten(students, now, opties = {}) {
  const lijst = [];
  for (const s of students || []) {
    if (!s || s.removed) continue;
    const ingediend = Boolean(s.quizSubmitted);
    if (ingediend && s._beeld) s._beeld = null;   // beeld wissen zodra de leerling indient
    const huidig = Number.isFinite(s.quizCurrentQuestion) ? s.quizCurrentQuestion : null;
    const totaal = s._quizTotaal || opties.totaal || 0;
    lijst.push({
      id: s.id,
      name: s.name,
      className: s.className || '',
      online: Boolean(s.socketId),
      submitted: ingediend,
      started: Boolean(s.quizStartedAt),
      vraag: huidig == null ? null : huidig + 1,
      totaal,
      beantwoord: s.quizAnswers ? Object.keys(s.quizAnswers).length : 0,
      snippet: ingediend ? '' : (s._antwoordSnippet || ''),
      laatsteActiviteit: s._laatsteActiviteitAt || null,
      weg: Boolean(s.klasbordWeg),
      resterendSec: !ingediend && s._quizEndAt ? Math.max(0, Math.round((s._quizEndAt - now) / 1000)) : null,
      indienOp: !ingediend && s._indienOp ? s._indienOp : null,   // v146: toets zonder teller, enkel een deadline
      tabwissels: s.tabSwitchCount || 0,
      beeldOp: s._beeld ? s._beeld.at : null,
    });
  }
  return lijst.sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

module.exports = { STANDAARD_SEC, MIN_SEC, MAX_SEC, MAX_BEELD_TEKENS, normaliseerInterval, isGeldigBeeld, antwoordSnippet, bouwLiveKaarten };
