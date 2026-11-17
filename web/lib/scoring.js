// ═══════════════════════════════════════════════════════════════════════════════
// PyCodeFlow — Automatische scoring (pure, testbaar)
// Sprint 34a: geëxtraheerd uit server.js quiz_submit handler.
// Bevat de puntenberekening voor single/meerkeuze vragen.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

// v133: gewichten van de nieuwe meerkeuze-regel "gedeeld juist".
const GEWICHT_GEMIST = 1.5;  // een gemist juist antwoord telt 1,5 eenheid
const GEWICHT_FOUT   = 3;    // een fout aangeduid antwoord telt 3 eenheden
const MC_MODI = ['gedeeld', 'klassiek'];

// Rond af op het dichtstbijzijnde halve punt (0,25 → 0,5; 0,75 → 1).
function rondOpHalvePunten(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.floor(x * 2 + 0.5 + 1e-9) / 2;
}

// Meerkeuze-regel "gedeeld juist" (v133). n = aantal juiste opties.
//   score = punten × max(0, 1 − (1,5 × gemist + 3 × fout) / n), afgerond op een half punt.
//   Alle opties aanduiden (terwijl er foute opties bestaan) geeft altijd 0.
function berekenMeerkeuzeGedeeld(choices, selected, points) {
  const correctIds = choices.filter(ch => ch && ch.correct).map(ch => ch.id);
  const n = correctIds.length;
  if (n === 0) return { score: 0, juist: 0, gemist: 0, fout: 0, totaalJuist: 0 };
  const uniek = Array.from(new Set(selected));
  const juist = uniek.filter(id => correctIds.includes(id)).length;
  const fout = uniek.length - juist;
  const gemist = n - juist;
  const alleOptiesAangeduid = choices.length > n && choices.every(ch => uniek.includes(ch.id));
  let score = 0;
  if (!alleOptiesAangeduid) {
    score = rondOpHalvePunten(points * Math.max(0, 1 - (GEWICHT_GEMIST * gemist + GEWICHT_FOUT * fout) / n));
  }
  return { score, juist, gemist, fout, totaalJuist: n };
}

// Bereken de automatische score voor één antwoord.
// Retourneert { autoScore, autoScored }.
//   - autoScored=false voor open/code vragen (handmatig verbeteren)
//   - single: volle punten bij exact het juiste antwoord, anders 0
//   - multiple, modus 'gedeeld' (v133, standaard voor nieuwe toetsen/taken): zie berekenMeerkeuzeGedeeld
//   - multiple, modus 'klassiek' (bestaande toetsen): pro-rata; 0 zodra één fout antwoord geselecteerd is
//
// question = { question_type, choices_json, points }
// selectedChoices = array van gekozen choice-id's
// opties.modus = 'gedeeld' | 'klassiek' (standaard 'klassiek' = ongewijzigd gedrag)
function computeAutoScore(question, selectedChoices, opties) {
  const result = { autoScore: null, autoScored: false };
  if (!question) return result;
  const type = question.question_type;
  if (type !== 'single' && type !== 'multiple') return result;

  let choices;
  try {
    choices = JSON.parse(question.choices_json || '[]');
  } catch {
    return result; // ongeldige choices → handmatig verbeteren
  }
  if (!Array.isArray(choices)) return result;

  const selected = Array.isArray(selectedChoices) ? selectedChoices : [];
  const correctIds = choices.filter(ch => ch && ch.correct).map(ch => ch.id);
  const points = Number(question.points) || 0;
  const modus = opties && opties.modus === 'gedeeld' ? 'gedeeld' : 'klassiek';

  if (type === 'single') {
    result.autoScore = (selected.length === 1 && correctIds.includes(selected[0]))
      ? points : 0;
  } else if (modus === 'gedeeld') {
    result.autoScore = berekenMeerkeuzeGedeeld(choices, selected, points).score;
  } else {
    const correctSelected = selected.filter(id => correctIds.includes(id)).length;
    const wrongSelected   = selected.filter(id => !correctIds.includes(id)).length;
    if (wrongSelected > 0) {
      result.autoScore = 0;
    } else if (correctIds.length === 0) {
      result.autoScore = 0;
    } else {
      result.autoScore = Math.round((correctSelected / correctIds.length) * points);
    }
  }
  result.autoScored = true;
  return result;
}

module.exports = { computeAutoScore, berekenMeerkeuzeGedeeld, rondOpHalvePunten, MC_MODI, GEWICHT_GEMIST, GEWICHT_FOUT };
