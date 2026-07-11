// ═══════════════════════════════════════════════════════════════════════════════
// PyCodeFlow — Nakijk-resultaat opbouwen (sprint 37a)
//
// Zet de ruwe DB-rijen (getMyResult) om naar de payload die de leerling ziet.
//
// 🔒 VEILIGHEID: dit is de plek waar de `correct`-vlag uit de antwoordopties
//    wordt GESTRIPT. In sprint 37a mag een leerling zijn eigen antwoord en score
//    zien, maar nog NIET welke optie juist was. Sprint 37b voegt dat bewust toe
//    via de vlag `onthulJuisteAntwoorden`.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const KEUZE_TYPES = new Set(['multiple', 'single']);

function parseJson(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/**
 * Maakt de antwoordopties veilig voor de leerling.
 * Standaard wordt `correct` verwijderd; enkel bij expliciete onthulling blijft ze staan.
 */
function sanitizeChoices(choices, { onthulJuisteAntwoorden = false } = {}) {
  if (!Array.isArray(choices)) return [];
  return choices.map(ch => {
    const veilig = { id: String(ch?.id ?? ''), text: String(ch?.text ?? '') };
    if (onthulJuisteAntwoorden) veilig.correct = ch?.correct === true;
    return veilig;
  });
}

/**
 * Bouwt het nakijk-resultaat van één leerling.
 * @param {Array} rows rijen uit dbModule.getMyResult()
 * @param {object} opties { onthulJuisteAntwoorden }
 * @returns {{ vragen: Array, totaal: number, maxTotaal: number, beantwoord: number }}
 */
function buildMyResult(rows, opties = {}) {
  const lijst = Array.isArray(rows) ? rows : [];
  let totaal = 0;
  let maxTotaal = 0;
  let beantwoord = 0;

  const vragen = lijst.map((r, i) => {
    const punten = Number(r.points) || 0;
    maxTotaal += punten;

    const heeftScore = r.score !== null && r.score !== undefined;
    if (heeftScore) totaal += Number(r.score) || 0;

    const type = String(r.question_type || 'code');
    const isKeuze = KEUZE_TYPES.has(type);

    const alleChoices = parseJson(r.choices_json, []);
    const gekozen = parseJson(r.selected_choices, []);
    const gekozenIds = new Set((Array.isArray(gekozen) ? gekozen : []).map(String));

    // Heeft de leerling iets ingevuld? (code-antwoord of een keuze gemaakt)
    const ingevuld = isKeuze
      ? gekozenIds.size > 0
      : Boolean(String(r.code || '').trim());
    if (ingevuld) beantwoord++;

    const vraag = {
      nummer: i + 1,
      vraagId: String(r.question_id),
      tekst: String(r.text_snapshot || ''),
      onderwerp: String(r.subject || ''),
      punten,
      type,
      score: heeftScore ? Number(r.score) : null,
      beoordeeld: heeftScore,
      ingevuld,
    };

    if (isKeuze) {
      vraag.opties = sanitizeChoices(alleChoices, opties).map(o => ({
        ...o,
        gekozen: gekozenIds.has(o.id),
      }));
    } else {
      vraag.eigenCode = String(r.code || '');
    }
    // 37b: modelantwoord/modelcode enkel meesturen wanneer de juiste antwoorden
    // onthuld mogen worden (nakijk-modus). Nooit tijdens de toets.
    if (opties.onthulJuisteAntwoorden) {
      const model = String(r.model_answer || '');
      if (model.trim()) vraag.modelAnswer = model;
      // 37c: commentaar per vraag. Kan een hint naar het antwoord bevatten,
      // dus enkel meesturen bij onthulling (nakijk-modus).
      const comment = String(r.teacher_comment || '');
      if (comment.trim()) vraag.commentaar = comment;
    }
    return vraag;
  });

  return { vragen, totaal, maxTotaal, beantwoord,
    algemeenCommentaar: opties.onthulJuisteAntwoorden
      ? String(opties.algemeenCommentaar || '').trim() || null
      : null };
}

module.exports = { buildMyResult, sanitizeChoices };
