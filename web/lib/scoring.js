// ═══════════════════════════════════════════════════════════════════════════════
// PyCodeFlow — Automatische scoring (pure, testbaar)
// Sprint 34a: geëxtraheerd uit server.js quiz_submit handler.
// Bevat de puntenberekening voor single/meerkeuze vragen.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

// Bereken de automatische score voor één antwoord.
// Retourneert { autoScore, autoScored }.
//   - autoScored=false voor open/code vragen (handmatig verbeteren)
//   - single: volle punten bij exact het juiste antwoord, anders 0
//   - multiple: pro-rata; 0 zodra één fout antwoord geselecteerd is
//
// question = { question_type, choices_json, points }
// selectedChoices = array van gekozen choice-id's
function computeAutoScore(question, selectedChoices) {
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

  if (type === 'single') {
    result.autoScore = (selected.length === 1 && correctIds.includes(selected[0]))
      ? points : 0;
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

module.exports = { computeAutoScore };
