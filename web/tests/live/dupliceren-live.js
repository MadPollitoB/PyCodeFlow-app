// Live-test v131: dupliceren kopieert alle instellingen + groepen.
// Vereist een draaiende server met POC_BASIC_AUTH_ENABLED=false:
//   DATABASE_URL=... BASE=http://localhost:3001 node tests/live/dupliceren-live.js
process.chdir(require('path').join(__dirname, '..', '..'));
const db = require('../../db/database.js');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:3001';
(async () => {
  await db.init();
  const C = 'D' + Date.now().toString(36).toUpperCase().slice(-6);
  await db.query(`INSERT INTO sessions (code, id, name, created_at, mode) VALUES ($1,$1,'orig',1,'quiz')`, [C]);
  await db.createQuizSession({
    sessionCode: C, type: 'toets', randomize: true, noTimer: false, timerSeconds: 1800,
    accessFrom: 1760000000000, accessUntil: 1760003600000, autoSubmitLate: false, noBack: true,
    tabSwitchEnabled: true, tabSwitchThreshold: 3, tabSwitchGraceSeconds: 9, cursusLinks: JSON.stringify([{ id: 'c1', title: 'Cursus', url: 'https://voorbeeld.test/cursus', questionIds: [] }]),
    selfEvalEnabled: true, klasbordEnabled: false, fullscreenRequired: false, copyPasteBlocked: false,
    minRunsPerQ: 1, hideQuestionOnScreen: true, isTeacherPreview: false, schoolYear: '2026-2027', targetClass: '',
    questions: [0, 0, 1, 1, 2].map((g, i) => ({ orderIndex: i, text: 'vraag ' + i, subject: 's', points: i + 1, questionType: 'open', randomGroup: g })),
  });
  const orig = await db.getQuizMeta(C);
  const res = await fetch(`${BASE}/api/quiz/${C}/duplicate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin: BASE }, body: JSON.stringify({ name: 'kopie-test' }),
  });
  const d = await res.json();
  assert.ok(d.ok, JSON.stringify(d));
  const kopie = await db.getQuizMeta(d.code);
  const velden = ['randomize', 'timer_seconds', 'no_timer', 'min_runs_per_q', 'hide_question_on_screen', 'school_year', 'target_class', 'access_from', 'access_until',
    'auto_submit_late', 'no_back', 'tab_switch_enabled', 'tab_switch_threshold', 'tab_switch_grace_seconds', 'cursus_links', 'self_eval_enabled', 'klasbord_enabled',
    'fullscreen_required', 'copy_paste_blocked', 'type', 'individual_timer'];
  for (const v of velden) assert.deepStrictEqual(String(kopie[v]), String(orig[v]), 'veld ' + v + ': ' + kopie[v] + ' ≠ ' + orig[v]);
  assert.strictEqual(kopie.results_released, false); assert.strictEqual(kopie.review_mode, false);
  const qs = await db.getQuizQuestions(d.code);
  assert.deepStrictEqual(qs.map(q => q.random_group), [0, 0, 1, 1, 2]);
  await db.query(`DELETE FROM sessions WHERE code = ANY($1)`, [[C, d.code]]);
  console.log('DUPLICEREN LIVE OK', velden.length + ' velden + groepen gelijk');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
