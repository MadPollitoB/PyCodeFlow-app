'use strict';
// v115: kwaliteitscontrole van één trainingsvraag. Geeft een lijst { ernst: 'fout'|'tip', code, tekst }.
// 'fout' = de vraag kan niet goed nagekeken worden of is onjuist opgebouwd; 'tip' = kan beter.
const H = require('./training-hulp');

function controleerVraag(q) {
  const p = [];
  const fout = (code, tekst) => p.push({ ernst: 'fout', code, tekst });
  const tip = (code, tekst) => p.push({ ernst: 'tip', code, tekst });
  const tekst = String(q.text || '');
  const keuzes = Array.isArray(q.choices) ? q.choices : [];
  const juist = Array.isArray(q.correct) ? q.correct : [];
  const tests = Array.isArray(q.tests) ? q.tests : [];

  if (tekst.trim().length < 15) fout('tekst_kort', 'De vraagtekst is erg kort.');
  if (!String(q.explanation || '').trim()) tip('geen_uitleg', 'Er is geen uitleg na het antwoord.');

  if (q.type === 'single' || q.type === 'multiple') {
    if (keuzes.length < 2) fout('te_weinig_keuzes', 'Minder dan 2 antwoordkeuzes.');
    if (juist.some(i => !Number.isInteger(i) || i < 0 || i >= keuzes.length)) fout('juist_buiten_bereik', 'Een juist antwoord verwijst naar een keuze die niet bestaat.');
    if (q.type === 'single' && juist.length !== 1) fout('single_juist', 'Bij één juist antwoord moet precies 1 keuze juist zijn (nu ' + juist.length + ').');
    if (q.type === 'multiple' && juist.length < 1) fout('multi_juist', 'Geen enkel juist antwoord aangeduid.');
    if (q.type === 'multiple' && keuzes.length && juist.length === keuzes.length) tip('alles_juist', 'Alle keuzes zijn juist: dan valt er niets te kiezen.');
    const norm = keuzes.map(k => String(k).trim().toLowerCase());
    if (new Set(norm).size !== norm.length) fout('dubbele_keuze', 'Twee keuzes zijn identiek.');
    if (norm.some(k => !k)) fout('lege_keuze', 'Een keuze is leeg.');
  }

  if (q.type === 'code') {
    if (!tests.length) fout('geen_tests', 'Geen testgevallen: de code kan niet nagekeken worden.');
    // Een lege verwachte uitvoer kan kloppen (bv. een lus die nul keer draait); enkel als ALLE tests leeg zijn is er iets mis.
    if (tests.length && tests.every(t => !String((t && t.output) || '').trim())) fout('lege_verwachte_uitvoer', 'Geen enkel testgeval heeft een verwachte uitvoer.');
    const aantallen = tests.map(t => (Array.isArray(t && t.input) ? t.input.length : 0));
    if (new Set(aantallen).size > 1) tip('wisselend_aantal_invoer', 'De testgevallen hebben een verschillend aantal invoerregels.');
    if (tests.length === 1) tip('een_test', 'Slechts één testgeval: een leerling kan de uitvoer hardcoderen. Voeg een tweede testgeval met andere invoer toe.');
    if (tests.length > 1 && new Set(tests.map(t => JSON.stringify((t && t.input) || []))).size === 1 && aantallen[0] > 0) tip('zelfde_invoer', 'Alle testgevallen gebruiken dezelfde invoer.');
    if (!/uitvoer|bijvoorbeeld|bv\.|voorbeeld|bij\s+\S+\s+is|krijg|toont|afdrukt|uitgeprint|geprint/i.test(tekst)) tip('geen_voorbeeld', 'De opdracht noemt geen verwachte uitvoer of voorbeeld.');
    const checks = q.checks || [];
    checks.forEach((c, i) => {
      if (!c || !c.label) fout('check_zonder_label', `Check ${i + 1} heeft geen zichttekst.`);
      if ((c.kind === 'bevat' || c.kind === 'niet_bevat')) { try { new RegExp(c.pattern); } catch (e) { fout('check_regex', `Check ${i + 1}: ongeldig patroon.`); } }
      if (c.kind === 'test' && !(tests[c.index])) fout('check_test_index', `Check ${i + 1} verwijst naar testgeval ${Number(c.index) + 1}, dat niet bestaat.`);
      if (c.kind === 'aantal_input' && tests[0] && Array.isArray(tests[0].input) && c.n !== tests[0].input.length) fout('check_aantal_input', `Check ${i + 1} verwacht ${c.n} invoer(en), maar testgeval 1 heeft er ${tests[0].input.length}.`);
    });
  }

  const soort = H.hulpSoort(q.level, H.STANDAARD_HULP);
  if (soort === 'checklist' && !(q.keywords || []).length) tip('geen_kernwoorden', 'Geen kernwoorden (worden op niveau 1-3 getoond).');
  if (soort === 'hints' && !(q.hints || []).filter(Boolean).length) tip('geen_hints', 'Geen hints (worden op niveau 4-5 getoond).');
  return p;
}

// Uitleg per stap van de nakijk-keten, in woorden (voor de leerkracht).
function nakijkStappen(q, hcfg) {
  const cfg = hcfg || H.STANDAARD_HULP;
  const soort = H.hulpSoort(q.level, cfg);
  const s = [];
  if (q.type === 'code') {
    s.push('De leerling schrijft code' + (q.starter ? ' (startcode staat klaar)' : '') + ' en kan die uitvoeren met Run. Wat binnen input("...") staat telt nooit mee voor de uitvoer.');
    if (soort === 'checklist') s.push(`Op niveau ${q.level} is er een checklist: "Check mijn code" draait enkel de nodige testgevallen en vinkt elke check af. ${cfg.gratisChecks} check(s) zijn gratis, elke extra kost ${cfg.strafPct}% van de score.`);
    else if (soort === 'hints') s.push(`Op niveau ${q.level} zijn er hints in plaats van een checklist: ${cfg.gratisHints} hint(s) gratis, elke extra kost ${cfg.strafPct}% van de score.`);
    else s.push(`Op niveau ${q.level} krijgt de leerling geen hulp (geen checklist, geen hints).`);
    s.push('Bij indienen wordt elk testgeval uitgevoerd met de ingegeven invoer. De uitvoer wordt vergeleken met de verwachte uitvoer: lege regels en spaties aan het einde van een regel tellen niet mee, hoofdletters wel.');
    s.push('Score = aantal geslaagde testgevallen ÷ totaal aantal. Daarna wordt eventuele hulpstraf afgetrokken. Een score van 1 (100%) telt als juist.');
  } else if (q.type === 'single') {
    s.push('De leerling kiest één antwoord. Het is juist als dat de ene aangeduide juiste keuze is (score 1), anders 0.');
  } else {
    s.push('De leerling vinkt de juiste antwoorden aan. Score = (goed aangevinkt − fout aangevinkt) ÷ aantal juiste, minstens 0. Alles aanvinken loont dus niet. Enkel een score van 1 telt als juist.');
  }
  s.push('Het niveau van de leerling stijgt of daalt volgens de recente resultaten in de training (niet bij de vraag van de dag of Extra oefenen).');
  s.push('Een fout beantwoorde vraag komt later terug als herhaalvraag (spaced repetition); de uitleg wordt getoond na het antwoord.');
  return s;
}

module.exports = { controleerVraag, nakijkStappen };
