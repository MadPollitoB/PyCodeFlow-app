'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const T = require('../lib/training');
const TOP = ['herhaling', 'print-input'];

test('108 formulier-vraag: geldige meerkeuze, code en foutmeldingen', () => {
  const mk = T.valideerVraag({ topic: 'herhaling', level: 3, type: 'single', text: 'Wat doet range(3)?', choices: ['0 1 2', '1 2 3'], correct: [0] }, TOP);
  assert.deepStrictEqual(mk.fouten, []);
  assert.ok(T.valideerVraag({ topic: 'herhaling', level: 3, type: 'single', text: 'x', choices: ['a', 'b'], correct: [0, 1] }, TOP).fouten.length, 'single met 2 juiste');
  assert.ok(T.valideerVraag({ topic: 'herhaling', level: 3, type: 'multiple', text: 'x', choices: ['a', 'b', 'c'], correct: [0] }, TOP).fouten.length, 'multiple met 1 juiste');
  assert.ok(T.valideerVraag({ topic: 'onbekend', level: 3, type: 'single', text: 'x', choices: ['a', 'b'], correct: [0] }, TOP).fouten.length);
  const code = T.valideerVraag({ topic: 'print-input', level: 2, type: 'code', text: 'x', tests: [{ input: ['Ada'], output: 'Hallo, Ada!' }], keywords: ['input()'], chapter: 'h2' }, TOP);
  assert.deepStrictEqual(code.fouten, []); assert.deepStrictEqual(code.vraag.tests[0].input, ['Ada']);
  assert.ok(T.valideerVraag({ topic: 'print-input', level: 2, type: 'code', text: 'x', tests: [] }, TOP).fouten.length, 'code zonder tests');
});

test('108 hash verandert als onderwerp, niveau of tekst verandert (bewerken kan dus botsen)', () => {
  const a = { topic: 'herhaling', level: 2, type: 'single', text: 'abc' };
  assert.notStrictEqual(T.vraagHash(a), T.vraagHash({ ...a, level: 3 }));
  assert.strictEqual(T.vraagHash(a), T.vraagHash({ ...a, text: 'abc  ' }));
});

test('108 routes voor vragenbeheer en de nieuwe leerlingroutes bestaan en zijn beveiligd', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'training-routes.js'), 'utf8');
  for (const r of [
    "app.post('/api/teacher/training/questions', requireTeacherAuth, requireCsrf",
    "app.put('/api/teacher/training/questions/:id', requireTeacherAuth, requireCsrf",
    "app.post('/api/teacher/training/questions/verify', requireTeacherAuth, requireCsrf",
    "app.delete('/api/teacher/training/questions/:id', requireTeacherAuth, requireCsrf",
    "app.get('/api/teacher/training/questions/:id', requireTeacherAuth",
  ]) assert.ok(src.includes(r), 'ontbreekt of niet beveiligd: ' + r);
  assert.ok(/G\.isHerhaalMoment\(state\.nr\)/.test(src), 'herhaalvragen in de selectie');
  assert.ok(/isHerh \? \{ niveau: van/.test(src), 'herhaalvragen sturen het niveau niet bij');
});
