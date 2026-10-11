'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const srv = rd('server.js');
const app = rd('public/app.js');

test('server: reeks sturen, aanduiden, wissen en leerling bladert', () => {
  for (const ev of ['teacher_send_assignments', 'teacher_set_assignment', 'teacher_clear_assignments', 'student_select_assignment'])
    assert.match(srv, new RegExp(`socket\\.on\\("${ev}"`));
  assert.match(srv, /function wisselWerkblad/);
  assert.match(srv, /function synchroniseerWerkbladen/);
});

test('server: wissen verwijdert werkbladen van de leerlingen en schuift indexen op', () => {
  const m = srv.match(/socket\.on\("teacher_clear_assignments"[\s\S]*?\n  \}\);/)[0];
  assert.match(m, /st\.werkbladen = \{\}/);
  assert.match(m, /nieuwe\[ki - 1\] = v/);
  assert.match(m, /session\.opdrachten\.splice\(index, 1\)/);
});

test('server: terug naar klasmodus synchroniseert op de aangeduide oefening', () => {
  assert.match(srv, /synchroniseerWerkbladen\(session\);\s*socket\.to\(session\.code\)\.emit\("force_workspace", \{ workspace: "shared"/);
});

test('persistentie bewaart werkbladen en reeks', () => {
  const db = rd('db/database.js');
  assert.match(db, /werkbladen: s\.werkbladen/);
  assert.match(db, /_opdrachten/);
});

test('client: leerkracht-knop en leerling-navigatie', () => {
  assert.match(rd('public/teacher-app.html'), /teacher-announcement-series-btn/);
  assert.match(app, /student_select_assignment/);
  assert.match(app, /teacher_send_assignments/);
  assert.match(app, /teacher_clear_assignments/);
  assert.match(app, /Opdracht \$\{idx \+ 1\} van \$\{items\.length\}/);
});
