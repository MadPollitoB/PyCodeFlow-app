// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 33 — Unit tests: CSV-export logica + tag-filtering (Prioriteit 8)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// ── 33a: CSV scores-matrix (repliceert de server-logica) ──────────────────────
function buildCsv(rows) {
  const questions = [];
  const seenQ = new Set();
  for (const r of rows) {
    if (!seenQ.has(r.question_id)) {
      seenQ.add(r.question_id);
      questions.push({ id: r.question_id, order: r.order_index, points: r.points,
        label: `V${r.order_index + 1}` });
    }
  }
  questions.sort((a, b) => a.order - b.order);
  const students = new Map();
  for (const r of rows) {
    if (!students.has(r.student_id)) {
      students.set(r.student_id, { name: r.student_name, klas: r.student_class, scores: {} });
    }
    students.get(r.student_id).scores[r.question_id] = r.score;
  }
  const esc = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const maxTotal = questions.reduce((sum, q) => sum + (q.points || 0), 0);
  const header = ['Naam', 'Klas', ...questions.map(q => `${q.label} (${q.points}pt)`),
    `Totaal (/${maxTotal})`];
  const lines = [header.map(esc).join(';')];
  const sorted = [...students.values()].sort((a, b) =>
    (a.klas || '').localeCompare(b.klas || '') || (a.name || '').localeCompare(b.name || ''));
  for (const s of sorted) {
    let total = 0;
    const cells = questions.map(q => {
      const sc = s.scores[q.id];
      if (sc !== null && sc !== undefined) total += sc;
      return sc === null || sc === undefined ? '' : sc;
    });
    lines.push([esc(s.name), esc(s.klas), ...cells, total].join(';'));
  }
  return lines;
}

const sampleRows = [
  { question_id:'q1', order_index:0, points:4, student_id:'s1', student_name:'Jan', student_class:'3A', score:3 },
  { question_id:'q2', order_index:1, points:6, student_id:'s1', student_name:'Jan', student_class:'3A', score:5 },
  { question_id:'q1', order_index:0, points:4, student_id:'s2', student_name:'An', student_class:'3A', score:4 },
  { question_id:'q2', order_index:1, points:6, student_id:'s2', student_name:'An', student_class:'3A', score:null },
];

test('CSV: header bevat vragen + totaal met maxpunten', () => {
  const lines = buildCsv(sampleRows);
  assert.strictEqual(lines[0], 'Naam;Klas;V1 (4pt);V2 (6pt);Totaal (/10)');
});

test('CSV: score-totaal per leerling klopt', () => {
  const lines = buildCsv(sampleRows);
  // Gesorteerd op klas dan naam → An (4 + leeg = 4) vóór Jan (3+5=8)
  assert.strictEqual(lines[1], 'An;3A;4;;4');
  assert.strictEqual(lines[2], 'Jan;3A;3;5;8');
});

test('CSV: niet-beoordeelde vraag → lege cel, telt niet mee', () => {
  const lines = buildCsv(sampleRows);
  assert.match(lines[1], /;;/); // An heeft een lege cel voor V2
});

test('CSV: puntkomma/quote in naam wordt ge-escaped', () => {
  const rows = [{ question_id:'q1', order_index:0, points:4,
    student_id:'s1', student_name:'De Vries; Jan', student_class:'3A', score:2 }];
  const lines = buildCsv(rows);
  assert.match(lines[1], /"De Vries; Jan"/);
});

test('CSV: lege resultaten → enkel header', () => {
  const lines = buildCsv([]);
  assert.strictEqual(lines.length, 1);
});

// ── 33d: tag-filtering (client-side deelstring-match) ─────────────────────────
function filterByTag(questions, tagFilter) {
  const t = (tagFilter || '').trim().toLowerCase();
  if (!t) return questions;
  return questions.filter(q => (q.tags || '').toLowerCase().includes(t));
}

const sampleQuestions = [
  { id:'1', text:'a', tags:'hoofdstuk3, herhaling' },
  { id:'2', text:'b', tags:'examen' },
  { id:'3', text:'c', tags:'' },
  { id:'4', text:'d', tags:'Hoofdstuk3' },
];

test('tag-filter: lege filter → alle vragen', () => {
  assert.strictEqual(filterByTag(sampleQuestions, '').length, 4);
});

test('tag-filter: deelstring, hoofdletterongevoelig', () => {
  const r = filterByTag(sampleQuestions, 'hoofdstuk3');
  assert.strictEqual(r.length, 2); // '1' en '4'
});

test('tag-filter: exacte tag', () => {
  const r = filterByTag(sampleQuestions, 'examen');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].id, '2');
});

test('tag-filter: geen match → leeg', () => {
  assert.strictEqual(filterByTag(sampleQuestions, 'onbestaand').length, 0);
});

test('tag-filter: vraag zonder tags telt niet mee bij filter', () => {
  const r = filterByTag(sampleQuestions, 'h');
  assert.strictEqual(r.every(q => q.tags), true);
});

// ── Sprint 37b: modelcode overleeft toets-duplicatie ──────────────────────────
// Repliceert de questions.map(...) uit de duplicate-route in server.js.
function duplicateMap(snapshotRows) {
  return snapshotRows.map((q, i) => ({
    bankId: q.bank_question_id, orderIndex: i,
    text: q.text_snapshot, subject: q.subject, points: q.points,
    questionType: q.question_type || 'code',
    choicesJson: q.choices_json || '[]',
    modelAnswer: q.model_answer || '',
  }));
}

test('duplicatie: modelcode wordt meegekopieerd', () => {
  const rows = [{ bank_question_id: 'b1', text_snapshot: 'V', subject: 'X', points: 4,
    question_type: 'code', choices_json: '[]', model_answer: 'print("modeloplossing")' }];
  const out = duplicateMap(rows);
  assert.strictEqual(out[0].modelAnswer, 'print("modeloplossing")');
});

test('duplicatie: vraagtype + keuzes blijven behouden (33e + 37b samen)', () => {
  const rows = [{ bank_question_id: 'b1', text_snapshot: 'Kies', subject: '', points: 6,
    question_type: 'single', choices_json: '[{"id":"a","text":"A","correct":true}]',
    model_answer: '' }];
  const out = duplicateMap(rows);
  assert.strictEqual(out[0].questionType, 'single');
  assert.match(out[0].choicesJson, /"correct":true/);
  assert.strictEqual(out[0].modelAnswer, '');
});

test('duplicatie: ontbrekend modelantwoord → lege string, geen undefined', () => {
  const rows = [{ bank_question_id: 'b1', text_snapshot: 'V', subject: '', points: 4,
    question_type: 'code', choices_json: '[]' }];
  const out = duplicateMap(rows);
  assert.strictEqual(out[0].modelAnswer, '');
});

// ── Sprint 38: vraag dupliceren in het vragenoverzicht ────────────────────────
// Repliceert de kernlogica van duplicateQuizQuestion (nieuwe optie-id's + velden).
function duplicateBankQuestion(q) {
  let choicesJson = q.choices_json || '[]';
  if (q.question_type === 'multiple' || q.question_type === 'single') {
    const opts = JSON.parse(choicesJson);
    if (Array.isArray(opts)) {
      choicesJson = JSON.stringify(opts.map(o => ({
        id: 'nieuw-' + Math.random().toString(36).slice(2),
        text: String(o?.text ?? ''),
        correct: o?.correct === true,
      })));
    }
  }
  return {
    text: `${q.text} (kopie)`,
    subject: q.subject || '',
    difficulty: q.difficulty || 'gemiddeld',
    maxPoints: q.max_points || 4,
    questionType: q.question_type || 'code',
    choicesJson,
    tags: q.tags || '',
    modelAnswer: q.model_answer || '',
  };
}

test('vraag dupliceren: tekst krijgt "(kopie)"-suffix', () => {
  const out = duplicateBankQuestion({ text: 'Wat is 2+2?', question_type: 'code' });
  assert.strictEqual(out.text, 'Wat is 2+2? (kopie)');
});

test('vraag dupliceren: alle velden meegekopieerd (incl. tags + modelcode)', () => {
  const out = duplicateBankQuestion({
    text: 'V', subject: 'Wiskunde', difficulty: 'moeilijk', max_points: 8,
    question_type: 'code', choices_json: '[]', tags: 'examen,herhaling',
    model_answer: 'print(4)',
  });
  assert.strictEqual(out.subject, 'Wiskunde');
  assert.strictEqual(out.difficulty, 'moeilijk');
  assert.strictEqual(out.maxPoints, 8);
  assert.strictEqual(out.tags, 'examen,herhaling');
  assert.strictEqual(out.modelAnswer, 'print(4)');
});

test('vraag dupliceren: meerkeuze-opties krijgen NIEUWE id\'s', () => {
  const origineel = JSON.stringify([
    { id: 'oud-a', text: 'A', correct: false },
    { id: 'oud-b', text: 'B', correct: true },
  ]);
  const out = duplicateBankQuestion({ text: 'Kies', question_type: 'single', choices_json: origineel });
  const nieuweOpts = JSON.parse(out.choicesJson);
  // Tekst en correct behouden, maar id's mogen NIET gelijk zijn aan het origineel.
  assert.strictEqual(nieuweOpts[0].text, 'A');
  assert.strictEqual(nieuweOpts[1].correct, true);
  assert.notStrictEqual(nieuweOpts[0].id, 'oud-a');
  assert.notStrictEqual(nieuweOpts[1].id, 'oud-b');
});

test('vraag dupliceren: code-vraag houdt lege choices', () => {
  const out = duplicateBankQuestion({ text: 'V', question_type: 'code', choices_json: '[]' });
  assert.strictEqual(out.choicesJson, '[]');
});
