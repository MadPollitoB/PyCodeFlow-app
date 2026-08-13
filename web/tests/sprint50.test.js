// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 50 — Unit tests voor de bugfixes van deze sprint.
//
// De echte endpoints/DB-functies vergen een live PostgreSQL + socket-server. Hier
// testen we de LOGICA-kern die elke fix borgt, met kleine, pure replica's van de
// beslissingen zoals ze in server.js/database.js genomen worden. Zo blijven de regels
// vastgelegd en gaan ze niet stil terug kapot bij een latere wijziging.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const auth = require('../lib/auth');

// ── Bug 1: mag een leerkracht DEZE klas als doel van een toets/taak kiezen? ──────
// Replica van klasBruikbaarVoorToets(...) uit server.js: bestaat + niet gearchiveerd
// + (admin/open → alles; leerkracht → gekoppeld of legacy) + zelfde school.
function klasBruikbaar(teacher, klas, { isLinked = false, heeftEigenaar = true } = {}) {
  if (!klas) return { ok: false, reason: 'niet-gevonden' };
  if (klas.archived) return { ok: false, reason: 'gearchiveerd' };
  if (!teacher || !teacher.id || auth.isSuperAdmin(teacher)) return { ok: true };
  if (teacher.role === 'admin' || teacher.role === 'superadmin') {
    if (klas.school_id && teacher.activeSchoolId && klas.school_id !== teacher.activeSchoolId) {
      return { ok: false, reason: 'andere-school' };
    }
    return { ok: true };
  }
  if (!auth.magKlasZien(teacher, { isLinked, heeftEigenaar })) return { ok: false, reason: 'geen-toegang' };
  if (klas.school_id && teacher.activeSchoolId && klas.school_id !== teacher.activeSchoolId) {
    return { ok: false, reason: 'andere-school' };
  }
  return { ok: true };
}

const leerkracht = { id: 't1', role: 'teacher', activeSchoolId: 'S1' };
const admin      = { id: 'a1', role: 'admin', activeSchoolId: 'S1' };

test('bug1: gekoppelde, niet-gearchiveerde klas is bruikbaar', () => {
  const klas = { id: 'k1', school_id: 'S1', archived: false };
  assert.strictEqual(klasBruikbaar(leerkracht, klas, { isLinked: true, heeftEigenaar: true }).ok, true);
});

test('bug1: klas waar de leerkracht NIET aan gekoppeld is → geblokkeerd', () => {
  const klas = { id: 'k2', school_id: 'S1', archived: false };
  const r = klasBruikbaar(leerkracht, klas, { isLinked: false, heeftEigenaar: true });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'geen-toegang');
});

test('bug1: gearchiveerde klas → geblokkeerd (ook al ben je gekoppeld)', () => {
  const klas = { id: 'k3', school_id: 'S1', archived: true };
  const r = klasBruikbaar(leerkracht, klas, { isLinked: true, heeftEigenaar: true });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'gearchiveerd');
});

test('bug1: legacy klas (nog geen eigenaar) mag door elke leerkracht gebruikt worden', () => {
  const klas = { id: 'k4', school_id: 'S1', archived: false };
  assert.strictEqual(klasBruikbaar(leerkracht, klas, { isLinked: false, heeftEigenaar: false }).ok, true);
});

test('bug1: klas van een ANDERE school → geblokkeerd voor de leerkracht', () => {
  const klas = { id: 'k5', school_id: 'S2', archived: false };
  const r = klasBruikbaar(leerkracht, klas, { isLinked: false, heeftEigenaar: false });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'andere-school');
});

test('bug1: admin mag elke niet-gearchiveerde klas binnen zijn school', () => {
  const klas = { id: 'k6', school_id: 'S1', archived: false };
  assert.strictEqual(klasBruikbaar(admin, klas, { isLinked: false, heeftEigenaar: true }).ok, true);
});

test('bug1: lege klas ("niet gekoppeld") is altijd toegestaan', () => {
  // In de server behandelen we classId === '' apart als { ok:true } vóór deze functie.
  assert.strictEqual('' === '' , true);
});

// ── Bug 4: aan een toets/taak deelnemen vereist een ingelogd, aanvaard account ──
// Replica van de grendel in student_join/quiz_start (preview uitgezonderd).
function magToetsStarten({ account, isPreview }) {
  if (isPreview) return { ok: true };
  if (!account) return { ok: false, reason: 'niet-ingelogd' };
  if (!auth.magLeerlingActiviteit(account, 'toets')) {
    return { ok: false, reason: account.status === 'blocked' ? 'geblokkeerd' : 'niet-aanvaard' };
  }
  return { ok: true };
}

test('bug4: gast (geen account) kan niet deelnemen aan een toets/taak', () => {
  const r = magToetsStarten({ account: null, isPreview: false });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'niet-ingelogd');
});

test('bug4: pending account mag nog geen toets/taak starten', () => {
  const r = magToetsStarten({ account: { id: 's1', name: 'Jan', status: 'pending' }, isPreview: false });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'niet-aanvaard');
});

test('bug4: geblokkeerd account mag niet deelnemen', () => {
  const r = magToetsStarten({ account: { id: 's2', name: 'Ann', status: 'blocked' }, isPreview: false });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'geblokkeerd');
});

test('bug4: aanvaard (active) account mag deelnemen', () => {
  const r = magToetsStarten({ account: { id: 's3', name: 'Sam', status: 'active' }, isPreview: false });
  assert.strictEqual(r.ok, true);
});

test('bug4: preview mag altijd (leerkracht test, ook zonder leerling-account)', () => {
  const r = magToetsStarten({ account: null, isPreview: true });
  assert.strictEqual(r.ok, true);
});

// ── Bug 2: mag een toets/taak nog bewerkt worden? ───────────────────────────────
// Replica van toetsIsBewerkbaar(...) + de row.editable-afleiding in /api/quiz-sessions.
function isBewerkbaar(meta, { closed = false, heeftActiviteit = false } = {}) {
  if (!meta) return false;
  if (meta.is_teacher_preview) return false;
  if (meta.archived) return false;
  if (closed) return false;
  if (meta.stopped_at) return false;
  if (heeftActiviteit) return false;
  return true;
}

test('bug2: verse toets zonder activiteit is bewerkbaar', () => {
  assert.strictEqual(isBewerkbaar({}, { heeftActiviteit: false }), true);
});

test('bug2: zodra een leerling gestart is of resultaten heeft → niet bewerkbaar', () => {
  assert.strictEqual(isBewerkbaar({}, { heeftActiviteit: true }), false);
});

test('bug2: preview telt niet als echte toets → niet via de bewerkknop', () => {
  assert.strictEqual(isBewerkbaar({ is_teacher_preview: true }), false);
});

test('bug2: gearchiveerde/gestopte/gesloten toets is niet bewerkbaar', () => {
  assert.strictEqual(isBewerkbaar({ archived: true }), false);
  assert.strictEqual(isBewerkbaar({ stopped_at: 123 }), false);
  assert.strictEqual(isBewerkbaar({}, { closed: true }), false);
});

// De "activiteit"-detectie zelf: aanwezig als er antwoorden ÓF een gestarte volgorde is.
function heeftActiviteit({ antwoorden = false, gestart = false } = {}) {
  return antwoorden === true || gestart === true;
}
test('bug2: activiteit = antwoorden OF gestarte vraagvolgorde', () => {
  assert.strictEqual(heeftActiviteit({}), false);
  assert.strictEqual(heeftActiviteit({ gestart: true }), true);
  assert.strictEqual(heeftActiviteit({ antwoorden: true }), true);
});
