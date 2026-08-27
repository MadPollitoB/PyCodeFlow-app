// ═══════════════════════════════════════════════════════════════════════════════
// PyCodeFlow — Nakijk-resultaat opbouwen (sprint 37a, composite-onderdelen sprint 51-fix)
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

// Sprint 51-fix: één onderdeel van een samengestelde vraag omzetten naar de veilige,
// leerling-gerichte vorm — zelfde logica als een gewone vraag, maar dan per onderdeel.
function bouwOnderdeel(deel, partAnswers, partScores, partComments, opties) {
  const type = deel.type || 'open';
  const isKeuze = KEUZE_TYPES.has(type);
  const antwoord = partAnswers?.[deel.id];
  const score = partScores?.[deel.id];
  const heeftScore = score !== undefined && score !== null;

  const resultaat = {
    id: String(deel.id || ''),
    type,
    label: type === 'code' ? '' : String(deel.label || ''),
    punten: Number(deel.points) || 0,
    score: heeftScore ? Number(score) : null,
    beoordeeld: heeftScore,
  };

  if (isKeuze) {
    const gekozenIds = new Set((Array.isArray(antwoord) ? antwoord : []).map(String));
    resultaat.opties = sanitizeChoices(deel.choices, opties).map(o => ({
      ...o, gekozen: gekozenIds.has(o.id),
    }));
    resultaat.ingevuld = gekozenIds.size > 0;
  } else {
    resultaat.eigenAntwoord = typeof antwoord === 'string' ? antwoord : '';
    resultaat.ingevuld = Boolean(resultaat.eigenAntwoord.trim());
  }
  if (opties.onthulJuisteAntwoorden) {
    const model = String(deel.modelAnswer || '');
    if (model.trim()) resultaat.modelAnswer = model;
    // Sprint 51-fix: per-onderdeel commentaar (nieuwe part_comments-kolom) — kan een hint
    // naar het antwoord bevatten, dus zelfde regel als bij de hoofdvraag: enkel meesturen
    // bij onthulling (nakijk-modus).
    const partComment = String(partComments?.[deel.id] || '');
    if (partComment.trim()) resultaat.commentaar = partComment;
  }
  return resultaat;
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
    const isComposite = type === 'composite';

    const alleChoices = parseJson(r.choices_json, []);
    const gekozen = parseJson(r.selected_choices, []);
    const gekozenIds = new Set((Array.isArray(gekozen) ? gekozen : []).map(String));

    // Sprint 51-fix: een samengestelde vraag is "ingevuld" als minstens 1 onderdeel
    // ingevuld is — bepaald hieronder ná het opbouwen van de onderdelen zelf.
    let ingevuld;
    if (!isComposite) {
      ingevuld = isKeuze ? gekozenIds.size > 0 : Boolean(String(r.code || '').trim());
    }

    const vraag = {
      nummer: i + 1,
      vraagId: String(r.question_id),
      tekst: String(r.text_snapshot || ''),
      onderwerp: String(r.subject || ''),
      punten,
      type,
      score: heeftScore ? Number(r.score) : null,
      beoordeeld: heeftScore,
    };

    if (isComposite) {
      // Sprint 51-fix: composite-vragen werden hiervoor NERGENS volledig getoond aan de
      // leerling — enkel het (max 1) code-onderdeel kwam toevallig mee via r.code. Nu elk
      // onderdeel (open/code/single/multiple) correct, met per-onderdeel score.
      const delen = parseJson(r.answer_parts, []);
      const partAnswers = parseJson(r.part_answers, {});
      const partScores = parseJson(r.part_scores, {});
      const partComments = parseJson(r.part_comments, {});
      vraag.onderdelen = (Array.isArray(delen) ? delen : []).map(
        d => bouwOnderdeel(d, partAnswers, partScores, partComments, opties));
      ingevuld = vraag.onderdelen.some(o => o.ingevuld);
    } else if (isKeuze) {
      vraag.opties = sanitizeChoices(alleChoices, opties).map(o => ({
        ...o,
        gekozen: gekozenIds.has(o.id),
      }));
    } else {
      vraag.eigenCode = String(r.code || '');
    }
    vraag.ingevuld = ingevuld;
    if (ingevuld) beantwoord++;

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
