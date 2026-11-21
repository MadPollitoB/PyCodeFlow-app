// v151 — PyBlitz: live quiz in een klassessie (logica, spelmotor, regels, bronchecks)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../lib/pyblitz');
const { maakSpel } = require('../lib/pyblitz-spel');
const r = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const vraag = (o = {}) => ({ type: 'mc', text: 'Q', options: ['a', 'b', 'c', 'd'], correct: 1, seconds: 20, ...o });

test('151 vraag: tekst, code, foutmelding of afbeelding volstaat; opties en juist antwoord verplicht', () => {
  assert.ok(P.normaliseerVraag(vraag()).ok);
  assert.ok(P.normaliseerVraag(vraag({ text: '', code: 'print(1)' })).ok);
  assert.ok(P.normaliseerVraag(vraag({ text: '', error: 'NameError' })).ok);
  assert.ok(P.normaliseerVraag(vraag({ text: '', imageId: 'abcdef12-3456' })).ok);
  assert.equal(P.normaliseerVraag(vraag({ text: '' })).ok, false, 'lege vraag');
  assert.equal(P.normaliseerVraag(vraag({ correct: 7 })).ok, false);
  assert.equal(P.normaliseerVraag(vraag({ options: ['a'] })).ok, false);
  assert.equal(P.normaliseerVraag(vraag({ seconds: 9999 })).vraag.seconds, 120);
  assert.equal(P.normaliseerVraag(vraag({ seconds: 1 })).vraag.seconds, 5);
  assert.deepEqual(P.normaliseerVraag({ type: 'tf', text: 'x', correct: 1 }).vraag.options.map(o => o.text), ['Juist', 'Onjuist']);
});

test('151 punten: snel is meer, dubbel/geen, reeksbonus beperkt', () => {
  const snel = P.berekenPunten({ juist: true, verstrekenMs: 0, limietMs: 20000 }).totaal;
  const traag = P.berekenPunten({ juist: true, verstrekenMs: 20000, limietMs: 20000 }).totaal;
  assert.equal(snel, 1000); assert.equal(traag, 500);
  assert.equal(P.berekenPunten({ juist: false, verstrekenMs: 0, limietMs: 20000 }).totaal, 0);
  assert.equal(P.berekenPunten({ juist: true, verstrekenMs: 0, limietMs: 20000, punten: 'dubbel' }).totaal, 2000);
  assert.equal(P.berekenPunten({ juist: true, verstrekenMs: 0, limietMs: 20000, punten: 'geen' }).totaal, 0);
  assert.equal(P.berekenPunten({ juist: true, verstrekenMs: 0, limietMs: 20000, reeks: 99 }).totaal, 1200);
});

test('151 gastnamen: schoon, geen scheldwoorden, nummer achter een bezette naam', () => {
  assert.equal(P.normaliseerGastNaam('x').ok, false);
  assert.equal(P.normaliseerGastNaam('Hitler').ok, false);
  assert.equal(P.normaliseerGastNaam('<b>Noor</b>').naam, 'bNoor/b');
  assert.equal(P.normaliseerGastNaam('  Noor   Jansen ').naam, 'Noor Jansen');
  assert.equal(P.uniekeNaam('Noor', new Set()), 'Noor');
  assert.equal(P.uniekeNaam('Noor', new Set(['noor'])), 'Noor 2');
  assert.equal(P.uniekeNaam('Noor', new Set(['noor', 'noor 2'])), 'Noor 3');
  assert.equal(P.naamSleutel('  ÉMMA '), 'emma');
});

test('151 import: JSON (letter, nummer, tekst) en Excelrijen met Waar/Onwaar', () => {
  const j = P.importeerJson(JSON.stringify([{ text: 'a', options: ['x', 'y'], correct: 'B' }, { text: 'b', options: ['x', 'y', 'z'], correct: 3 }, { text: 'c', options: ['x', 'y'], correct: 'x' }, { text: 'd', type: 'tf', correct: false }]));
  assert.deepEqual(j.vragen.map(v => v.correct), [1, 2, 0, 1]); assert.equal(j.vragen[3].type, 'tf');
  assert.equal(P.importeerJson('geen json').ok, false);
  const x = P.importeerRijen([['Vraag', 'Code', 'A', 'B', 'C', 'D', 'Juist', 'Tijd', 'Punten'], ['q', 'print(1)', 'Waar', 'Onwaar', '', '', 'A', 12, 'dubbel'], ['r', '', '1', '2', '3', '', '2', '', '']]);
  assert.equal(x.vragen.length, 2); assert.equal(x.vragen[0].type, 'tf'); assert.equal(x.vragen[0].points, 'dubbel'); assert.equal(x.vragen[1].correct, 1);
  assert.equal(P.importeerRijen([['Foo'], ['x']]).ok, false);
  const exp = P.exporteerJson({ name: 'n', questions: P.normaliseerVragen([vraag()]).vragen });
  assert.equal(P.importeerJson(JSON.stringify(exp)).vragen[0].correct, 1, 'export → import rondrit');
});

function spel(extra = {}) {
  let t = 1000; const timers = [];
  const klok = { now: () => t, tik: (ms) => { t += ms; for (const x of [...timers]) if (x.at <= t && !x.weg) { x.weg = true; x.fn(); } } };
  const set = { id: 's', name: 'S', questions: P.normaliseerVragen([vraag({ seconds: 10 }), vraag({ seconds: 10, points: 'dubbel' })]).vragen };
  const g = maakSpel({ id: 'g', pin: '12345', set, now: klok.now,
    setTimer: (fn, ms) => { const x = { fn, at: t + ms }; timers.push(x); return x; }, clearTimer: (x) => { if (x) x.weg = true; }, ...extra });
  return { g, klok };
}

test('151 spel: juiste antwoord pas na de vraag; één antwoord; te laat telt niet', () => {
  const { g, klok } = spel();
  g.voegSpelerToe({ id: 'a', naam: 'A' }); g.voegSpelerToe({ id: 'b', naam: 'B' });
  assert.ok(g.begin().ok);
  assert.equal(g.toestand('a').juist, undefined); assert.equal(g.toestand(null).juist, undefined);
  assert.ok(g.antwoord('a', 1).ok); assert.equal(g.antwoord('a', 0).ok, false);
  klok.tik(11000);   // timer loopt af (b antwoordde niet)
  assert.equal(g.fase(), 'reveal');
  const st = g.toestand('b'); assert.equal(st.juist, 1); assert.equal(st.jij.resultaat.answered, false);
  assert.equal(g.antwoord('b', 1).ok, false, 'te laat');
  assert.ok(g.toestand('a').jij.resultaat.correct);
});

test('151 spel: iedereen klaar sluit de vraag; eindresultaat; sluiten', () => {
  let einde = null;
  const { g } = spel({ onEinde: (res) => { einde = res; } });
  g.voegSpelerToe({ id: 'a', naam: 'A' }); g.voegSpelerToe({ id: 'b', naam: 'B', gast: true });
  g.begin(); g.antwoord('a', 1); g.antwoord('b', 0);
  assert.equal(g.fase(), 'reveal');
  assert.ok(g.volgende().ok); g.antwoord('a', 1); g.antwoord('b', 1);
  assert.equal(g.toestand(null).laatste, true);
  g.volgende(); assert.equal(g.fase(), 'final');
  assert.equal(einde.spelers.length, 2); assert.equal(einde.spelers[0].naam, 'A');
  assert.equal(g.toestand('b').jij.beantwoord, 2);
  g.stop(); assert.equal(g.fase(), 'closed');
});

test('151 spel: pauze bevriest de tijd; niet starten zonder deelnemers', () => {
  const { g, klok } = spel();
  assert.equal(g.begin().ok, false);
  g.voegSpelerToe({ id: 'a', naam: 'A' }); g.begin();
  klok.tik(4000); g.pauzeer(); klok.tik(60000); assert.equal(g.fase(), 'question');
  g.hervat(); klok.tik(5000); assert.equal(g.fase(), 'question'); klok.tik(2000); assert.equal(g.fase(), 'reveal');
});

test('151 server: enkel klasmodus, token voor gasten, naamregels, sluiten sluit alles', () => {
  const s = r('lib/pyblitz-routes.js');
  assert.match(s, /session\.mode !== 'class' \|\| \(session\.classWorkspaceMode \|\| 'shared'\) !== 'shared'/);
  assert.match(s, /crypto\.randomBytes\(24\)/);
  assert.match(s, /klas\.has\(P\.naamSleutel\(n\.naam\)\)/);
  assert.match(s, /P\.uniekeNaam\(n\.naam, bezet\)/);
  assert.match(s, /io\.to\('pb:' \+ id\)\.emit\('pyblitz_closed'/);
  assert.match(s, /herkenAfbeelding\(buf\)/);
  const srv = r('server.js');
  assert.match(srv, /pyblitzRoutes\.attach\(socket\)/);
  assert.match(srv, /app\.get\('\/pyblitz\.html', requireTeacherAuth/);
  assert.match(srv, /app\.get\('\/play'/);
  assert.match(r('db/database.js'), /_pyblitz: session\.pyblitz/);
});

test('151 front-end: knop, menu, scripts, geen innerHTML met spelersdata', () => {
  assert.match(r('public/teacher-app.html'), /id="pyblitz-btn"/);
  assert.match(r('public/teacher-app.html'), /pyblitz-overlay\.js/);
  assert.match(r('public/student-app.html'), /pyblitz-overlay\.js/);
  assert.match(r('public/quiz-bank.html'), /href="\/pyblitz\.html"/);
  const ui = r('public/pyblitz-ui.js');
  assert.equal((ui.match(/\.innerHTML\s*=/g) || []).length, 1, 'enkel de QR-SVG');
  assert.doesNotMatch(r('public/pyblitz-bibliotheek.js') + r('public/play.js') + r('public/pyblitz-overlay.js'), /innerHTML/);
  assert.match(r('public/app.js'), /window\.__pcfSocket = socket/);
});

test('151 antwoordopties mogen uit meerdere regels of code bestaan; rondrit import/export', () => {
  const r = P.importeerJson(JSON.stringify({ name: 't', questions: [{ text: 'Welke?', options: ['print(1)', { text: 'for i in range(3):\n    print(i)' }, { text: 'x = 1', code: true }, 'd'], correct: 'B' }] }));
  assert.ok(r.ok);
  const o = r.vragen[0].options;
  assert.equal(o[1].text, 'for i in range(3):\n    print(i)'); assert.equal(o[1].code, true, 'meerdere regels = code');
  assert.equal(o[2].code, true); assert.equal(o[0].code, undefined);
  assert.equal(r.vragen[0].correct, 1);
  const terug = P.importeerJson(JSON.stringify(P.exporteerJson({ name: 't', questions: r.vragen })));
  assert.deepEqual(terug.vragen[0].options, o);
  const x = P.importeerRijen([['Vraag', 'A', 'B', 'Juist'], ['q', 'a\nb', 'c', 'A']]);
  assert.equal(x.vragen[0].options[0].code, true);
  const lang = P.normaliseerVraag({ text: 'q', options: ['1\n2\n3\n4\n5\n6\n7\n8', 'b'], correct: 0 });
  assert.equal(lang.vraag.options[0].text.split('\n').length, 6, 'max 6 regels');
});
