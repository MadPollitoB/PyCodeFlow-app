// Live-test v121 (heropen-flow) tegen een echte PostgreSQL: DATABASE_URL=... node tests/live/heropenen-live.js
process.chdir(require('path').join(__dirname, '..', '..'));
const db = require('../../db/database.js');
const assert = require('assert');
(async () => {
  await db.init();
  const C = 'T' + Date.now().toString(36).toUpperCase().slice(-6);
  const q = (t, p) => db.query(t, p);
  const ins = (sid, name, qid, code, score) => q(`INSERT INTO quiz_answers (id, session_code, student_id, student_name, question_id, personal_order, code, run_count, saved_at, submitted_at, score, selected_choices, submitted_by) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,0,$5,0,1,1,$6,'[]','student')`, [C, sid, name, qid, code, score]);
  await q(`INSERT INTO sessions (code, id, name, created_at) VALUES ($1,$1,'t',1)`, [C]);
  for (const [i, qq] of [C+'q1',C+'q2'].entries()) await q(`INSERT INTO quiz_question_snapshots (id, session_code, order_index, text_snapshot) VALUES ($1,$2,$3,'x')`, [qq, C, i]);
  for (const [sid, n] of [['s1','Een'],['s2','Twee'],['s4','Vier'],['s5','Vijf']]) { await ins(sid, n, C+'q1', 'print(1)', 5); await ins(sid, n, C+'q2', 'print(2)', 3); }
  const sc = async sid => (await q(`SELECT question_id, score, code, submitted_at FROM quiz_answers WHERE session_code=$1 AND student_id=$2 ORDER BY question_id`, [C, sid])).rows;
  const until = Date.now() + 3600e3;
  for (const [sid, n] of [['s1','Een'],['s2','Twee'],['s4','Vier'],['s5','Vijf']]) { await db.setIndividualAccess(C, sid, n, until); await db.reopenAssignmentForStudent(C, sid, n); }
  // heropenen wist niets
  let r = await sc('s1'); assert.equal(r[0].score, 5); assert.equal(r[0].submitted_at, null);
  // 2 en 4 wijzigen
  await q(`UPDATE quiz_answers SET code='print(99)' WHERE session_code=$1 AND student_id IN ('s2','s4') AND question_id=$2`, [C, C+'q1']);
  const open = await db.getOpenHeropeningen(C);
  assert.equal(open.length, 4); assert.equal(open.find(x => x.id==='s2').gewijzigd, true); assert.equal(open.find(x => x.id==='s1').gewijzigd, false);
  // terugdraaien 1: herstel
  assert.ok(await db.herstelHeropenSnapshot(C, 's1', 'Een')); await db.verwijderIndividueleToegang(C, 's1', 'Een');
  r = await sc('s1'); assert.equal(r[0].score, 5); assert.ok(r[0].submitted_at);
  // 2 aanvaard: submit -> score q1 weg, q2 blijft
  await db.submitQuizAnswers(C, 's2', true, 'teacher', 'Twee');
  r = await sc('s2'); assert.equal(r[0].score, null); assert.equal(r[1].score, 3);
  assert.ok((await db.getHeropenSnapshot(C, 's2', 'Twee')).changed);
  // 4 niet aanvaard: herstel
  await db.herstelHeropenSnapshot(C, 's4', 'Vier'); r = await sc('s4'); assert.equal(r[0].code, 'print(1)'); assert.equal(r[0].score, 5);
  // 5 blijft open en onaangeroerd
  r = await sc('s5'); assert.equal(r[0].submitted_at, null); assert.equal(r[0].score, 5);
  // 5 dient automatisch in zonder wijziging: score blijft, snapshot weg
  await db.submitQuizAnswers(C, 's5', true, 'deadline', 'Vijf');
  r = await sc('s5'); assert.equal(r[0].score, 5); assert.equal(await db.getHeropenSnapshot(C, 's5', 'Vijf'), null);
  // opruimen: s2 gewijzigd en nog niet nagekeken -> blijft; na nakijken -> weg
  await db.ruimSnapshotsOp(); assert.ok(await db.getHeropenSnapshot(C, 's2', 'Twee'));
  await q(`UPDATE quiz_answers SET score=4 WHERE session_code=$1 AND student_id='s2' AND score IS NULL`, [C]);
  await db.ruimSnapshotsOp(); assert.equal(await db.getHeropenSnapshot(C, 's2', 'Twee'), null);
  await q(`DELETE FROM sessions WHERE code=$1`, [C]);
  console.log('LIVE OK');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
