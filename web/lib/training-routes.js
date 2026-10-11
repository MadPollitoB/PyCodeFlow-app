'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 97 — Trainingscenter: routes (leerling + leerkracht) en code-nakijken.
// De beslissingen zelf staan in lib/training.js (pure logica, getest).
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const T = require('./training');
const H = require('./training-hulp');
const G = require('./training-groei');
const D = require('./training-dagvraag');
const K = require('./training-kwaliteit');

const ONDERWERPEN = [
  { id: 'stroomdiagrammen', name: 'Stroomdiagrammen', sort: 1 },
  { id: 'print-input',      name: 'print() en input()', sort: 2 },
  { id: 'variabelen',       name: 'Variabelen', sort: 3 },
  { id: 'datatypes',        name: 'Datatypes', sort: 4 },
  { id: 'expressies',       name: 'Wiskundige expressies', sort: 5 },
  { id: 'beslissingen',     name: 'Beslissingen', sort: 6 },
  { id: 'herhaling',        name: 'Herhaling', sort: 7 },
  { id: 'foutmeldingen',    name: 'Foutmeldingen', sort: 8 },
  { id: 'debuggen',         name: 'Debuggen', sort: 9 },
];

const CODE_MAX_TEKENS = 8000;
const RUN_MIN_INTERVAL_MS = 2000;
const TEST_TIMEOUT_MS = 8000;

function registerTrainingRoutes(app, deps) {
  const { dbModule, requireStudentAuth, requireTeacherAuth, requireCsrf, isSuperAdmin, magKlasZien, log,
          runnerStart, runnerEvents, runnerInput, runnerCancel } = deps;
  // v115: onderwerpen komen uit de database (toevoegen, hernoemen, uitschakelen, verwijderen).
  // topicIds = alle niet-verwijderde onderwerpen (ook uitgeschakelde: daar kan je nog vragen aan werken);
  // actieveIds = enkel wat leerlingen mogen kiezen.
  const topicIds = ONDERWERPEN.map(t => t.id);
  const actieveIds = ONDERWERPEN.map(t => t.id);
  const topicNamen = new Map(ONDERWERPEN.map(t => [t.id, t.name]));
  const topicNaam = id => topicNamen.get(id) || id;
  async function herlaadTopics() {
    const rijen = await dbModule.listAllTrainingTopics();
    topicIds.splice(0, topicIds.length, ...rijen.map(t => t.id));
    actieveIds.splice(0, actieveIds.length, ...rijen.filter(t => t.active).map(t => t.id));
    topicNamen.clear(); rijen.forEach(t => topicNamen.set(t.id, t.name));
    return rijen;
  }
  const bezigeRuns = new Set();          // eenvoudige slot per training tegen dubbel indienen
  const laatsteRun = new Map();          // studentId → tijdstip laatste "uitvoeren"

  // v107: hulpregels per klas (leerkracht); een leerling krijgt de ruimste regeling van zijn klassen.
  async function hulpCfgVoorLeerling(studentId) {
    try {
      const klasIds = await dbModule.getActiveClassIdsOfStudent(studentId);
      const rijen = klasIds.length ? await dbModule.getTrainingClassSettings(klasIds) : [];
      return H.effectieveHulpCfg(rijen.map(r => r.settings));
    } catch (e) { return { ...H.STANDAARD_HULP }; }
  }

  async function dagCfgVoorLeerling(studentId) {
    try {
      const klasIds = await dbModule.getActiveClassIdsOfStudent(studentId);
      const rijen = klasIds.length ? await dbModule.getTrainingClassSettings(klasIds) : [];
      return D.effectieveDagvraagCfg(rijen.map(r => r.settings && r.settings.dagvraag));
    } catch (e) { return { ...D.DAG_STANDAARD }; }
  }

  async function instellingen() {
    let raw = null;
    try { raw = await dbModule.getTrainingConfig(); } catch (e) { /* standaard */ }
    return T.normaliseerInstellingen(raw || {}).instellingen;
  }

  // ── Code uitvoeren met vooraf bepaalde invoer (voor nakijken én "uitvoeren") ──
  // De runner sluit een geslaagde run af met "===== Compiler klaar met runnen =====": die regel
  // hoort niet bij de uitvoer van het programma en wordt dus weggehaald.
  const RUNNER_AFSLUITING = /\n*===== Compiler klaar met runnen =====\n?/g;
  async function runMetInvoer(code, invoer, timeoutMs) {
    const r = await runMetInvoerRuw(code, invoer, timeoutMs);
    return { ...r, output: String(r.output || '').replace(RUNNER_AFSLUITING, '\n') };
  }
  // v110: de vraagtekst binnen input("...") hoort niet bij de uitvoer die we nakijken (leerlingen horen
  // juist een duidelijke vraag in input() te zetten). Alleen bij het nakijken wordt de prompt weggelaten.
  const PROMPT_WEG = 'import builtins as _pcf_b; _pcf_i = _pcf_b.input; _pcf_b.input = lambda *_a, **_k: _pcf_i()\n';
  const zonderPrompt = code => /^\s*from\s+__future__\s+import/m.test(code) ? code : PROMPT_WEG + code;
  async function runMetInvoerRuw(code, invoer, timeoutMs) {
    if (!code || !String(code).trim()) return { output: '', reden: 'geen_code' };
    let runId;
    try { runId = (await runnerStart(zonderPrompt(String(code)))).runId; }
    catch (e) { return { output: '', reden: 'kon_niet_starten' }; }
    const rij = (invoer || []).slice();
    const begin = Date.now();
    let output = ''; let laatsteSeq = 0; let aantalInvoer = 0;
    try {
      for (;;) {
        if (Date.now() - begin > timeoutMs) { await runnerCancel(runId).catch(() => {}); return { output, reden: 'timeout', aantalInvoer }; }
        const data = await runnerEvents(runId, laatsteSeq);
        for (const ev of (data.events || [])) {
          laatsteSeq = ev.seq;
          if (ev.type === 'stdout' || ev.type === 'stderr') output += ev.data;
          else if (ev.type === 'input_request') {
            aantalInvoer++;
            if (!rij.length) { await runnerCancel(runId).catch(() => {}); return { output, reden: 'vraagt_input', aantalInvoer }; }
            await runnerInput(runId, rij.shift());
          } else if (ev.type === 'run_error') {
            let d = {}; try { d = typeof ev.data === 'string' ? JSON.parse(ev.data || '{}') : (ev.data || {}); } catch { /* negeren */ }
            output += `\n[fout: ${d.message || 'onbekende fout'}]`;
          } else if (ev.type === 'end') return { output, reden: 'klaar', aantalInvoer };
        }
        if (!data.running && !data.queued) return { output, reden: 'klaar', aantalInvoer };
        await new Promise(r => setTimeout(r, 120));
      }
    } catch (e) {
      await runnerCancel(runId).catch(() => {});
      return { output, reden: 'fout', aantalInvoer };
    }
  }

  async function kijkCodeNa(vraag, antwoord) {
    const code = String(antwoord == null ? '' : antwoord).slice(0, CODE_MAX_TEKENS);
    const resultaten = [];
    for (const test of vraag.tests) {          // na elkaar: de runner heeft beperkte capaciteit
      const r = await runMetInvoer(code, test.input, TEST_TIMEOUT_MS);
      const ok = r.reden === 'klaar' && T.uitvoerKomtOvereen(test.output, r.output);
      resultaten.push({ ok, reden: r.reden, invoer: test.input, verwacht: test.output, gekregen: r.output });
    }
    const score = T.scoreCode(resultaten);
    const eersteFout = resultaten.find(r => !r.ok);
    return {
      score,
      details: {
        geslaagd: resultaten.filter(r => r.ok).length,
        totaal: resultaten.length,
        eersteFout: eersteFout ? {
          invoer: eersteFout.invoer, verwacht: T.normaliseerUitvoer(eersteFout.verwacht),
          gekregen: T.normaliseerUitvoer(eersteFout.gekregen).slice(0, 600), reden: eersteFout.reden,
        } : null,
      },
    };
  }

  function kijkKeuzeNa(vraag, antwoord) {
    const score = vraag.type === 'single' ? T.scoreSingle(vraag, antwoord) : T.scoreMultiple(vraag, antwoord);
    return { score, details: { juist: vraag.correct } };
  }

  // ── Volgende vraag kiezen ──────────────────────────────────────────────────
  async function kiesVolgende(studentId, state, cfg) {
    // v108: elke 3e vraag is (indien beschikbaar) een eerder foute vraag die opnieuw aan de beurt is
    if (G.isHerhaalMoment(state.nr)) {
      try {
        const due = (await dbModule.getTrainingDue(studentId, state.topics, Date.now())).filter(d => !state.asked.includes(d.id));
        if (due.length) {
          const q = await dbModule.getTrainingQuestion(due[0].id);
          if (q) { state.herh = state.herh || {}; state.herh[q.id] = true; return q; }
        }
      } catch (e) { log.warn('[training] herhaling: ' + e.message); }
    }
    const kandidaten = await dbModule.getTrainingCandidates(studentId, state.topics);
    const gezien = await dbModule.getTrainingSeen(studentId);
    let over = state.topics.slice();
    while (over.length) {
      const topic = T.kiesOnderwerp(over, state.aantalPerTopic);
      const q = T.kiesVraag({ pool: kandidaten, topic, niveau: state.levels[topic], dezeRun: state.asked, eerderGezien: gezien });
      if (q) return dbModule.getTrainingQuestion(q.id);
      over = over.filter(t => t !== topic);     // dit onderwerp is uitgeput
    }
    return null;
  }

  async function sluitAf(run, state, status, reden) {
    const cfg = await instellingen();
    const antwoorden = await dbModule.getTrainingRunAnswers(run.id);
    const n = antwoorden.length;
    const som = antwoorden.reduce((a, b) => a + b.score, 0);
    const scorePct = n ? Math.round((som / n) * 1000) / 10 : 0;
    const perTopic = state.topics.map(t => {
      const lijst = antwoorden.filter(a => a.topic === t);
      return {
        topic: t, naam: topicNaam(t), niveau: state.levels[t], n: lijst.length,
        scorePct: lijst.length ? Math.round(lijst.reduce((a, b) => a + b.score, 0) / lijst.length * 100) : null,
      };
    });
    let titel = null; let titelNiveau = null;
    const bereikt = Math.max(...state.topics.map(t => T.herschaalNiveau(state.levels[t], state.maxLevel[t])));
    if (status === 'klaar') {
      const t = T.bepaalTitel({ scorePct, bereiktNiveau: bereikt, aantalVragen: n, instellingen: cfg });
      titel = t.titel; titelNiveau = t.niveau;
    }
    await dbModule.finishTrainingRun(run.id, { status, scorePct, finalLevel: bereikt, title: titel, titleLevel: titelNiveau, stopReason: reden });
    // Onthoud het bereikte niveau per onderwerp (ook bij stoppen: wat je aantoonde blijft staan)
    if (n && !state.dagelijks) await dbModule.setStudentTrainingLevels(run.student_id, state.levels);   // Extra oefenen verandert je niveau niet
    return {
      status, scorePct, aantal: n, aantalJuist: antwoorden.filter(a => a.score >= 1).length,
      titel, titelNiveau, bereiktNiveau: bereikt, perTopic,
      nogTeBeoordelen: 0,
    };
  }

  function leerlingVraag(q, state, nr, totaal, hulpCfg) {
    return { ...T.vraagVoorLeerling(q, nr, totaal, state.levels[q.topic], hulpCfg), herhaling: !!(state.herh && state.herh[q.id]) };
  }

  function eigenRun(run, studentId) { return run && run.student_id === studentId; }

  // ═════════════════════════ LEERLING ═════════════════════════════════════════
  app.get('/api/training/overzicht', requireStudentAuth, async (req, res) => {
    try {
      const cfg = await instellingen();
      const rijen = await dbModule.listTrainingTopicsForStudent(req.student.id);
      const laatste = (await dbModule.listTrainingRunsForStudent(req.student.id, 1))[0] || null;
      const actief = await dbModule.getActiveTrainingRun(req.student.id);
      const nu = Date.now();
      const stats = await dbModule.getTrainingTopicStats(req.student.id);
      const due = await dbModule.countTrainingDuePerTopic(req.student.id, nu);
      const streak = G.berekenStreak(await dbModule.getTrainingAnswerTimes(req.student.id, nu - 400 * G.DAG_MS), nu);
      const dagBlok = await dagvraagBlok(req.student.id, nu);
      res.json({
        dagvraag: dagBlok,
        streak: dagBlok.aan ? dagBlok.streak : streak.streak, vandaagGedaan: dagBlok.aan ? dagBlok.status === 'opgelost' : streak.vandaagGedaan,
        teHerhalen: Object.values(due).reduce((a, b) => a + b, 0),
        dagelijks: { aantal: G.DAGELIJKS_AANTAL, onderwerpen: G.kiesDagelijkseOnderwerpen(rijen.map(r => ({ id: r.id, aantal: r.aantal })), stats, due).map(topicNaam) },
        topics: rijen.map(r => {
          const st = stats[r.id] || { n: 0, gem: null }; const d = due[r.id] || 0;
          return { id: r.id, name: r.name, aantal: r.aantal, maxLevel: r.max_level, niveau: r.opgeslagen_niveau || null,
            geoefend: st.n, gemScore: st.gem, teHerhalen: d,
            volgendeStap: G.volgendeStap({ due: d, n: st.n, gem: st.gem, niveau: r.opgeslagen_niveau || null, maxLevel: r.max_level || 10 }) };
        }),
        laatste: laatste ? { ...laatste, topics: laatste.topics.map(topicNaam) } : null,
        actief,
        grenzen: { minVragen: T.MIN_VRAGEN, maxVragen: T.MAX_VRAGEN, minOnderwerpen: T.MIN_ONDERWERPEN, maxOnderwerpen: T.MAX_ONDERWERPEN },
        titels: cfg.titels,
      });
    } catch (e) { log.error('[training] overzicht', e); res.status(500).json({ error: 'Kon het trainingscenter niet laden.' }); }
  });

  // ═════════════════ v109: VRAAG VAN DE DAG ═════════════════
  // Moet vóór de routes met /:id staan (anders is "dagvraag" een training-id).
  const DAG_RE = /^\d{4}-\d{2}-\d{2}$/;
  const laatsteDagAntwoord = new Map();
  const vandaagSleutel = (nu = Date.now()) => G.dagSleutel(nu);

  async function dagvraagBlok(studentId, nu) {
    const cfg = await dagCfgVoorLeerling(studentId);
    if (!cfg.aan) return { aan: false };
    const vandaag = vandaagSleutel(nu);
    const sinds = G.dagSleutel(nu - 14 * G.DAG_MS);
    const [rijen, opgelost] = await Promise.all([dbModule.getDagvraagRijen(studentId, sinds), dbModule.getDagvraagOpgelost(studentId)]);
    const st = D.berekenDagStreak(opgelost, nu, cfg.jokersPerWeek);
    const perDag = {}; rijen.forEach(r => { perDag[r.day] = r; });
    const rij = perDag[vandaag] || null;
    const max = rij ? D.maxPogingen(rij.type, cfg) : 0;
    return {
      aan: true, streak: st.streak, jokersOver: st.jokersOver, jokersPerWeek: cfg.jokersPerWeek, inhaalDagen: cfg.inhaalDagen,
      status: D.dagStatus(rij, vandaag, vandaag, cfg), pogingen: D.actievePogingen(rij), maxPogingen: max,
      onderwerp: rij ? topicNaam(rij.topic) : null, niveau: rij ? rij.level : null,
      week: D.weekStrook(perDag, nu, st.jokersGebruikt, cfg, undefined, 7, (await dbModule.getDagvraagEerste(studentId)) || vandaag),
    };
  }

  const vrijeHulpCfg = async studentId => ({ ...(await hulpCfgVoorLeerling(studentId)), gratisChecks: H.MAX_CHECKS, gratisHints: H.MAX_HINTS, strafPct: 0 });
  const onthulling = q => ({ uitleg: q.explanation || '', juist: q.type === 'code' ? null : q.correct,
    voorbeeld: q.type === 'code' && q.tests && q.tests[0] ? { invoer: q.tests[0].input, uitvoer: q.tests[0].output } : null });

  async function kiesDagvraagVoor(studentId, cfg, dag) {
    const rijen = await dbModule.listTrainingTopicsForStudent(studentId);
    const beschikbaar = rijen.filter(r => r.aantal > 0);
    if (!beschikbaar.length) return null;
    const nu = Date.now();
    const stats = await dbModule.getTrainingTopicStats(studentId);
    const due = await dbModule.countTrainingDuePerTopic(studentId, nu);
    const geoefend = beschikbaar.filter(r => (stats[r.id] || {}).n > 0);
    const topics = geoefend.length
      ? G.kiesDagelijkseOnderwerpen(geoefend.map(r => ({ id: r.id, aantal: r.aantal })), stats, due, 99)
      : beschikbaar.slice(0, 2).map(r => r.id);
    const kandidaten = await dbModule.getTrainingCandidates(studentId, beschikbaar.map(r => r.id));
    const recent = new Set((await dbModule.getDagvraagRecent(studentId, G.dagSleutel(nu - 30 * G.DAG_MS))).map(x => x.question_id));
    const niveauPerTopic = {}; rijen.forEach(r => { niveauPerTopic[r.id] = r.opgeslagen_niveau || 1; });
    const gekozen = D.kiesDagvraag({ kandidaten, topics, niveauPerTopic, gezien: await dbModule.getTrainingSeen(studentId), recent, cfg, zaad: studentId + '|' + dag });
    return gekozen ? dbModule.getTrainingQuestion(gekozen.id) : null;
  }

  // v110: welke dag bedoelt de leerling? Standaard vandaag; een voorbije dag enkel binnen het inhaalvenster.
  async function doelDag(studentId, cfg, bodyDag) {
    const vandaag = vandaagSleutel();
    const dag = bodyDag == null || bodyDag === '' ? vandaag : String(bodyDag);
    if (!DAG_RE.test(dag)) return { fout: [400, 'Ongeldige dag.'] };
    if (dag === vandaag) return { dag, vandaag, inhaal: false };
    if (!D.kanInhalen(dag, vandaag, cfg, await dbModule.getDagvraagEerste(studentId))) return { fout: [403, 'Deze dag kan je niet (meer) inhalen.'] };
    return { dag, vandaag, inhaal: true };
  }
  const dagWoord = (dag, vandaag) => dag === vandaag ? 'vandaag' : 'deze dag';

  async function dagvraagToestand(studentId, rij, q, cfg, vandaag) {
    const status = D.dagStatus(rij, rij.day, vandaag, cfg);
    const max = D.maxPogingen(q.type, cfg); const act = D.actievePogingen(rij);
    const hulpCfg = await vrijeHulpCfg(studentId);
    const uit = { dag: rij.day, inhaal: !!rij.inhaal, status, pogingen: act, maxPogingen: max, resterend: max > 0 ? Math.max(0, max - act) : null,
      vraag: { ...T.vraagVoorLeerling(q, 1, 1, q.level, hulpCfg), herhaling: false, dagvraag: true },
      hulpStand: hulpStandVoorClient({ hulp: rij.hulp }, q) };
    // het eigen laatste antwoord van de leerling terugzetten bij heropenen (nooit het juiste antwoord)
    const poging = await dbModule.getDagvraagPogingen(studentId, rij.day);
    if (poging.length && poging[poging.length - 1].answer != null) uit.laatsteAntwoord = poging[poging.length - 1].answer;
    if (status === 'opgelost' || status === 'ingehaald' || (status === 'mislukt' && rij.day < vandaag && D.magOnthullen(rij, rij.day, vandaag, cfg, null))) uit.onthulling = onthulling(q);
    return uit;
  }

  app.post('/api/training/dagvraag/start', requireStudentAuth, requireCsrf, async (req, res) => {
    try {
      const cfg = await dagCfgVoorLeerling(req.student.id);
      if (!cfg.aan) return res.status(403).json({ error: 'De vraag van de dag staat uit voor jouw klas.' });
      const doel = await doelDag(req.student.id, cfg, req.body && req.body.dag);
      if (doel.fout) return res.status(doel.fout[0]).json({ error: doel.fout[1] });
      const { dag, vandaag, inhaal } = doel;
      let rij = await dbModule.getDagvraag(req.student.id, dag);
      let q = null;
      if (rij) q = await dbModule.getTrainingQuestion(rij.questionId);
      // v111: vraag verwijderd (bv. onderwerp weggehaald): een afgesloten of voorbije dag toont enkel de melding;
      // de nog openstaande vraag van vandaag krijgt een nieuwe vraag zodat de streak niet geblokkeerd raakt.
      if (rij && !q && (rij.solved || dag !== vandaag)) return res.status(410).json({ error: 'Deze vraag bestaat niet meer.' });
      if (!rij || !q) {
        q = await kiesDagvraagVoor(req.student.id, cfg, dag);
        if (!q) return res.status(404).json({ error: 'Er zijn nog geen vragen beschikbaar voor een vraag van de dag.' });
        if (!rij) rij = await dbModule.createDagvraag(req.student.id, dag, q, inhaal);
        else rij = await dbModule.vervangDagvraag(req.student.id, dag, q);
      }
      if (inhaal && !rij.solved && !rij.inhaal) rij = await dbModule.startInhaal(req.student.id, dag);
      res.json(await dagvraagToestand(req.student.id, rij, q, cfg, vandaag));
    } catch (e) { log.error('[training] dagvraag start', e); res.status(500).json({ error: 'Kon de vraag van de dag niet laden.' }); }
  });

  app.post('/api/training/dagvraag/answer', requireStudentAuth, requireCsrf, async (req, res) => {
    const sleutel = req.student.id;
    if (Date.now() - (laatsteDagAntwoord.get(sleutel) || 0) < 1500) return res.status(429).json({ error: 'Even geduld.' });
    laatsteDagAntwoord.set(sleutel, Date.now());
    try {
      const cfg = await dagCfgVoorLeerling(req.student.id);
      if (!cfg.aan) return res.status(403).json({ error: 'De vraag van de dag staat uit voor jouw klas.' });
      const doel = await doelDag(req.student.id, cfg, req.body && req.body.dag);
      if (doel.fout) return res.status(doel.fout[0]).json({ error: doel.fout[1] });
      const { dag, vandaag } = doel;
      const rij = await dbModule.getDagvraag(req.student.id, dag);
      if (!rij || (doel.inhaal && !rij.inhaal)) return res.status(409).json({ error: 'Open eerst de vraag van de dag.' });
      const q = await dbModule.getTrainingQuestion(rij.questionId);
      if (!q) return res.status(410).json({ error: 'Deze vraag bestaat niet meer.' });
      if (Number(req.body && req.body.questionId) !== q.id) return res.status(409).json({ error: 'Dit is niet de vraag van ' + dagWoord(dag, vandaag) + '.' });
      const st0 = D.dagStatus(rij, dag, vandaag, cfg);
      if (st0 === 'opgelost' || st0 === 'ingehaald') return res.status(409).json({ error: 'Je hebt de vraag van ' + dagWoord(dag, vandaag) + ' al opgelost.' });
      if (st0 === 'mislukt') return res.status(409).json({ error: 'Je hebt al je pogingen voor ' + dagWoord(dag, vandaag) + ' gebruikt.' });
      const beoordeling = q.type === 'code' ? await kijkCodeNa(q, req.body.answer) : kijkKeuzeNa(q, req.body.answer);
      const juist = beoordeling.score >= 1;
      const details = q.type === 'code' ? { geslaagd: beoordeling.details.geslaagd, totaal: beoordeling.details.totaal } : {};
      const nieuw = await dbModule.addDagvraagPoging(req.student.id, dag, { correct: juist, answer: req.body.answer, details });
      const status = D.dagStatus(nieuw, dag, vandaag, cfg);
      const act = D.actievePogingen(nieuw);
      const uit = { juist, status, dag, inhaal: !!nieuw.inhaal, pogingen: act, maxPogingen: D.maxPogingen(q.type, cfg) };
      uit.resterend = uit.maxPogingen > 0 ? Math.max(0, uit.maxPogingen - act) : null;
      if (q.type === 'code') {
        uit.details = { geslaagd: details.geslaagd, totaal: details.totaal };
        const f = beoordeling.details.eersteFout;      // enkel wat het programma deed, nooit het verwachte antwoord
        if (!juist && f) uit.details.eersteFout = { invoer: f.invoer, gekregen: f.gekregen };
      }
      if (juist) { uit.onthulling = onthulling(q); uit.streak = (await dagvraagBlok(req.student.id, Date.now())).streak; }
      res.json(uit);
    } catch (e) { log.error('[training] dagvraag antwoord', e); res.status(500).json({ error: 'Kon je antwoord niet nakijken.' }); }
  });

  // hint en check van de vraag van de dag: zelfde regels als in een training, maar zonder scoreaftrek
  async function dagHulpContext(req, res) {
    const cfg = await dagCfgVoorLeerling(req.student.id);
    const doel = cfg.aan ? await doelDag(req.student.id, cfg, req.body && req.body.dag) : { fout: [403, 'De vraag van de dag staat uit.'] };
    if (doel.fout) { res.status(doel.fout[0]).json({ error: doel.fout[1] }); return null; }
    const dag = doel.dag;
    const rij = await dbModule.getDagvraag(req.student.id, dag);
    const q = rij ? await dbModule.getTrainingQuestion(rij.questionId) : null;
    if (rij && !q) { res.status(410).json({ error: 'Deze vraag bestaat niet meer.' }); return null; }
    if (!rij || !q || (doel.inhaal && !rij.inhaal) || Number(req.body && req.body.questionId) !== q.id) { res.status(409).json({ error: 'Dit is niet de vraag van ' + dagWoord(dag, doel.vandaag) + '.' }); return null; }
    const stx = D.dagStatus(rij, dag, doel.vandaag, cfg);
    if (stx === 'opgelost' || stx === 'ingehaald') { res.status(409).json({ error: 'Je hebt deze vraag al opgelost.' }); return null; }
    return { rij, q, dag, hcfg: await vrijeHulpCfg(req.student.id), fake: { hulp: rij.hulp || {} } };
  }
  app.post('/api/training/dagvraag/hint', requireStudentAuth, requireCsrf, async (req, res) => {
    try {
      const c = await dagHulpContext(req, res); if (!c) return;
      const { q, fake, hcfg } = c;
      if (H.hulpSoort(q.level, hcfg) !== 'hints' || !(q.hints || []).length) return res.status(400).json({ error: 'Voor deze vraag zijn er geen hints.' });
      const nr = Number(req.body.nr); const max = Math.min(H.MAX_HINTS, q.hints.length);
      if (!Number.isInteger(nr) || nr < 1 || nr > max) return res.status(400).json({ error: 'Onbekende hint.' });
      const stand = hulpStand(fake, q.id);
      if (nr > (stand.hints || 0) + 1) return res.status(409).json({ error: 'Vraag eerst de vorige hint op.' });
      if (nr > (stand.hints || 0)) { stand.hints = nr; bewaarHulpStand(fake, q.id, stand); await dbModule.saveDagvraagHulp(req.student.id, c.dag, fake.hulp); }
      res.json({ hint: q.hints[nr - 1], nr, max, kostte: false, straf: 0 });
    } catch (e) { log.error('[training] dagvraag hint', e); res.status(500).json({ error: 'Kon de hint niet ophalen.' }); }
  });
  app.post('/api/training/dagvraag/check', requireStudentAuth, requireCsrf, async (req, res) => {
    const nu = Date.now();
    if (nu - (laatsteCheck.get(req.student.id) || 0) < CHECK_MIN_INTERVAL_MS) return res.status(429).json({ error: 'Even wachten voor je opnieuw checkt.' });
    try {
      const c = await dagHulpContext(req, res); if (!c) return;
      const { q, fake, hcfg } = c;
      if (q.type !== 'code' || H.hulpSoort(q.level, hcfg) !== 'checklist') return res.status(400).json({ error: 'Voor deze vraag is er geen checklist.' });
      laatsteCheck.set(req.student.id, nu);
      const code = String((req.body && req.body.code) || '').slice(0, CODE_MAX_TEKENS);
      const checks = H.checksVan(q); const uitv = { aantalInvoer: null, tests: [] };
      if (code.trim()) {
        for (const i of H.nodigeTests(checks)) {
          const test = q.tests[i]; if (!test) continue;
          const r = await runMetInvoer(code, test.input, TEST_TIMEOUT_MS);
          uitv.tests[i] = { ok: r.reden === 'klaar' && T.uitvoerKomtOvereen(test.output, r.output) };
          if (i === 0) uitv.aantalInvoer = r.aantalInvoer;
        }
      }
      const resultaat = H.evalueerChecks(checks, code, uitv);
      const stand = hulpStand(fake, q.id); stand.checks = (stand.checks || 0) + 1; stand.laatste = resultaat;
      bewaarHulpStand(fake, q.id, stand); await dbModule.saveDagvraagHulp(req.student.id, c.dag, fake.hulp);
      res.json({ resultaat, gebruikt: stand.checks, kostte: false, straf: 0 });
    } catch (e) { log.error('[training] dagvraag check', e); res.status(500).json({ error: 'Kon de check niet uitvoeren.' }); }
  });

  // Overzicht van alle dagen (10 per pagina) met samenvatting
  app.get('/api/training/dagvraag/geschiedenis', requireStudentAuth, async (req, res) => {
    try {
      const cfg = await dagCfgVoorLeerling(req.student.id);
      const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
      const vandaag = vandaagSleutel();
      const { totaal, rijen } = await dbModule.listDagvraagDagen(req.student.id, offset, 10);
      const opgelost = await dbModule.getDagvraagOpgelost(req.student.id);
      const alle = await dbModule.listDagvraagDagen(req.student.id, 0, 100000);
      const pogingenOpgelost = alle.rijen.filter(r => r.solved).map(r => r.attempts);
      res.json({
        offset, totaal,
        items: rijen.map(r => ({ dag: r.day, onderwerp: topicNaam(r.topic), niveau: r.level, pogingen: r.attempts, status: D.dagStatus(r, r.day, vandaag, cfg),
          type: r.type, opgelostOm: r.solvedAt, inhaal: !!r.inhaal, verwijderd: r.vraagBestaat === false })),
        samenvatting: { dagenGedaan: totaal, opgelost: opgelost.length,
          ingehaald: alle.rijen.filter(r => r.solved && r.inhaal).length,
          gemPogingen: pogingenOpgelost.length ? Math.round(pogingenOpgelost.reduce((a, b) => a + b, 0) / pogingenOpgelost.length * 10) / 10 : null,
          langsteStreak: D.langsteReeks(opgelost), streak: D.berekenDagStreak(opgelost, Date.now(), cfg.jokersPerWeek).streak },
      });
    } catch (e) { log.error('[training] dagvraag geschiedenis', e); res.status(500).json({ error: 'Kon het overzicht niet laden.' }); }
  });

  // Eén dag bekijken. Het antwoord zie je pas als je de vraag juist had, of als de dag voorbij is.
  app.get('/api/training/dagvraag/dag/:dag', requireStudentAuth, async (req, res) => {
    try {
      const dag = String(req.params.dag);
      if (!DAG_RE.test(dag)) return res.status(400).json({ error: 'Ongeldige dag.' });
      const cfg = await dagCfgVoorLeerling(req.student.id);
      const rij = await dbModule.getDagvraag(req.student.id, dag);
      if (!rij) return res.status(404).json({ error: 'Voor deze dag is er geen vraag.' });
      const q = await dbModule.getTrainingQuestion(rij.questionId);
      const vandaag = vandaagSleutel();
      const status = D.dagStatus(rij, dag, vandaag, cfg);
      if (!q) {   // v111: de vraag is verwijderd; streak en poginggeschiedenis blijven
        const p0 = await dbModule.getDagvraagPogingen(req.student.id, dag);
        return res.json({ dag, status, verwijderd: true, melding: 'Deze vraag bestaat niet meer.', onderwerp: topicNaam(rij.topic), niveau: rij.level,
          pogingen: p0.map(p => ({ nr: p.nr, om: p.at, juist: p.correct, geslaagd: p.details.geslaagd == null ? null : p.details.geslaagd, totaal: p.details.totaal == null ? null : p.details.totaal })) });
      }
      const eerste = await dbModule.getDagvraagEerste(req.student.id);
      const toon = D.magOnthullen(rij, dag, vandaag, cfg, eerste);
      const inhaalbaar = !rij.solved && D.kanInhalen(dag, vandaag, cfg, eerste) && !D.inhaalVergrendeld(rij, cfg);
      const pogingen = await dbModule.getDagvraagPogingen(req.student.id, dag);
      res.json({
        dag, status, inhaalbaar: !!inhaalbaar, inhaal: !!rij.inhaal, onderwerp: topicNaam(q.topic), niveau: q.level, type: q.type, tekst: q.text, code: q.code || '',
        keuzes: q.type === 'code' ? [] : q.choices, starter: q.type === 'code' ? q.starter : '',
        pogingen: pogingen.map(p => ({ nr: p.nr, om: p.at, juist: p.correct, geslaagd: p.details.geslaagd == null ? null : p.details.geslaagd, totaal: p.details.totaal == null ? null : p.details.totaal })),
        laatsteAntwoord: pogingen.length ? pogingen[pogingen.length - 1].answer : null,
        onthulling: toon ? onthulling(q) : null,
      });
    } catch (e) { log.error('[training] dagvraag dag', e); res.status(500).json({ error: 'Kon deze dag niet laden.' }); }
  });

  app.get('/api/training/geschiedenis', requireStudentAuth, async (req, res) => {
    try {
      const lijst = await dbModule.listTrainingRunsForStudent(req.student.id, 20);
      res.json({ runs: lijst.map(r => ({ ...r, topics: r.topics.map(topicNaam) })) });
    } catch (e) { res.status(500).json({ error: 'Kon de geschiedenis niet laden.' }); }
  });

  app.post('/api/training/start', requireStudentAuth, requireCsrf, async (req, res) => {
    try {
      const cfg = await instellingen();
      const rijen = await dbModule.listTrainingTopicsForStudent(req.student.id);
      let keuze;
      const dagelijks = !!(req.body && req.body.dagelijks);
      if (dagelijks) {            // v108: "Dagelijkse 5": zwakste/herhaal-onderwerpen, 5 vragen
        const nu = Date.now();
        const tops = G.kiesDagelijkseOnderwerpen(rijen.map(r => ({ id: r.id, aantal: r.aantal })),
          await dbModule.getTrainingTopicStats(req.student.id), await dbModule.countTrainingDuePerTopic(req.student.id, nu));
        if (!tops.length) return res.status(400).json({ error: 'Er zijn nog geen vragen beschikbaar.' });
        keuze = { ok: true, aantal: G.DAGELIJKS_AANTAL, topics: tops };
      } else {
        keuze = T.valideerTrainingKeuze(req.body || {}, actieveIds);
        if (!keuze.ok) return res.status(400).json({ error: keuze.fout });
      }
      const perId = Object.fromEntries(rijen.map(r => [r.id, r]));
      const leeg = keuze.topics.filter(t => !perId[t] || perId[t].aantal < 1);
      if (leeg.length) return res.status(400).json({ error: `Voor ${leeg.map(topicNaam).join(', ')} zijn nog geen vragen beschikbaar.` });

      // een nog openstaande training wordt afgesloten als "gestopt" (één tegelijk)
      const oud = await dbModule.getActiveTrainingRun(req.student.id);
      if (oud) {
        const oudRun = await dbModule.getTrainingRun(oud);
        if (oudRun) await sluitAf(oudRun, oudRun.state, 'gestopt', 'nieuwe_training_gestart');
      }

      const hulpCfg = await hulpCfgVoorLeerling(req.student.id);
      const state = { topics: keuze.topics, levels: {}, recent: {}, aantalPerTopic: {}, maxLevel: {}, asked: [], nr: 0, huidige: null, hulpCfg, dagelijks };
      for (const t of keuze.topics) {
        const max = perId[t].max_level || 10;
        state.maxLevel[t] = max;
        state.levels[t] = T.startNiveauVoor(perId[t].opgeslagen_niveau, max, cfg);
        state.recent[t] = []; state.aantalPerTopic[t] = 0;
      }
      const eerste = await kiesVolgende(req.student.id, state, cfg);
      if (!eerste) return res.status(400).json({ error: 'Er zijn geen vragen beschikbaar voor deze keuze.' });
      state.huidige = eerste.id;
      const runId = await dbModule.createTrainingRun({
        studentId: req.student.id, studentName: req.student.name, aantal: keuze.aantal,
        topics: keuze.topics, fullscreenVerplicht: req.body.fullscreenVerplicht === true || req.body.fullscreenVerplicht === 'true',
        state,
      });
      res.json({ runId, aantal: keuze.aantal, vraag: leerlingVraag(eerste, state, 1, keuze.aantal, hulpCfg) });
    } catch (e) { log.error('[training] start', e); res.status(500).json({ error: 'Kon de training niet starten.' }); }
  });

  // Herstel na een paginaverversing: huidige vraag of resultaat opnieuw geven.
  app.get('/api/training/:id/state', requireStudentAuth, async (req, res) => {
    try {
      const run = await dbModule.getTrainingRun(Number(req.params.id));
      if (!eigenRun(run, req.student.id)) return res.status(404).json({ error: 'Training niet gevonden.' });
      if (run.status !== 'bezig') {
        const eind = await sluitAfLezen(run);
        return res.json({ status: run.status, resultaat: eind });
      }
      const q = await dbModule.getTrainingQuestion(run.state.huidige);
      res.json({ status: 'bezig', aantal: run.question_count, fullscreenVerplicht: run.fullscreen_verplicht,
        vraag: q ? leerlingVraag(q, run.state, run.state.nr + 1, run.question_count, H.hulpCfgVan(run.state)) : null,
        hulpStand: q ? hulpStandVoorClient(run.state, q) : null });
    } catch (e) { res.status(500).json({ error: 'Kon de training niet laden.' }); }
  });

  async function sluitAfLezen(run) {
    const antwoorden = await dbModule.getTrainingRunAnswers(run.id);
    const state = run.state;
    return {
      status: run.status, scorePct: run.score_pct, aantal: antwoorden.length,
      aantalJuist: antwoorden.filter(a => a.score >= 1).length,
      titel: run.title, titelNiveau: run.title_level, bereiktNiveau: run.final_level,
      perTopic: (state.topics || []).map(t => {
        const l = antwoorden.filter(a => a.topic === t);
        return { topic: t, naam: topicNaam(t), niveau: state.levels[t], n: l.length,
          scorePct: l.length ? Math.round(l.reduce((a, b) => a + b.score, 0) / l.length * 100) : null };
      }),
      nogTeBeoordelen: 0,
    };
  }

  app.post('/api/training/:id/answer', requireStudentAuth, requireCsrf, async (req, res) => {
    const id = Number(req.params.id);
    if (bezigeRuns.has(id)) return res.status(429).json({ error: 'Even geduld, je vorig antwoord wordt nog nagekeken.' });
    bezigeRuns.add(id);
    try {
      const run = await dbModule.getTrainingRun(id);
      if (!eigenRun(run, req.student.id)) return res.status(404).json({ error: 'Training niet gevonden.' });
      if (run.status !== 'bezig') return res.status(409).json({ error: 'Deze training is al afgesloten.' });
      const state = run.state;
      const vraag = await dbModule.getTrainingQuestion(state.huidige);
      if (!vraag || Number(req.body.questionId) !== vraag.id) return res.status(409).json({ error: 'Deze vraag is al beantwoord.' });
      const cfg = await instellingen();

      const beoordeling = vraag.type === 'code'
        ? await kijkCodeNa(vraag, req.body.answer)
        : kijkKeuzeNa(vraag, req.body.answer);
      // v106: extra hulp (2e check op niveau 1-3, 2e hint op niveau 4-5) kost score; de 1e is gratis.
      const gebruik = hulpStand(state, vraag.id);
      const straf = H.hulpStraf(vraag.level, gebruik, H.hulpCfgVan(state));
      const goedAntwoord = beoordeling.score >= 1;                       // juistheid los van de straf
      beoordeling.score = H.scoreNaStraf(beoordeling.score, straf);
      beoordeling.details = { ...beoordeling.details, hulp: { checks: gebruik.checks || 0, hints: gebruik.hints || 0, straf } };

      // niveau bijsturen voor dit onderwerp
      const t = vraag.topic;
      const van = state.levels[t];
      // herhaalvragen en "Extra oefenen" (Dagelijkse 5) sturen het niveau nooit bij; enkel een echte training doet dat
      const isHerh = !!(state.herh && state.herh[vraag.id]) || !!state.dagelijks;
      const nieuw = isHerh ? { niveau: van, recent: state.recent[t] || [] }
        : T.nieuwNiveau({ niveau: van, recent: [...(state.recent[t] || []), beoordeling.score], maxNiveau: state.maxLevel[t], instellingen: cfg });
      try {                                                          // v108: Leitner-herhaling bijwerken
        const bestaand = await dbModule.getTrainingReview(req.student.id, vraag.id);
        const vlg = G.volgendeHerhaling(bestaand, goedAntwoord, Date.now());
        if (vlg) await dbModule.saveTrainingReview(req.student.id, vraag.id, vlg.box, vlg.dueAt);
        else if (bestaand) await dbModule.deleteTrainingReview(req.student.id, vraag.id);
      } catch (e) { log.warn('[training] herhaling bijwerken: ' + e.message); }
      state.levels[t] = nieuw.niveau; state.recent[t] = nieuw.recent;
      state.aantalPerTopic[t] = (state.aantalPerTopic[t] || 0) + 1;
      state.asked.push(vraag.id);
      state.nr += 1;

      await dbModule.addTrainingAnswer({
        runId: id, seq: state.nr, questionId: vraag.id, topic: t, level: vraag.level,
        answer: req.body.answer, score: beoordeling.score, details: beoordeling.details,
      });

      let volgende = null; let resultaat = null;
      if (state.nr < run.question_count) volgende = await kiesVolgende(req.student.id, state, cfg);
      if (volgende) {
        state.huidige = volgende.id;
        await dbModule.saveTrainingRunState(id, state);
      } else {
        // klaar (of de pool is op: dan sluiten we eerder af)
        resultaat = await sluitAf(run, state, 'klaar', state.nr < run.question_count ? 'pool_op' : null);
        await dbModule.saveTrainingRunState(id, state);
      }
      res.json({
        score: beoordeling.score,
        uitslag: goedAntwoord ? 'goed' : (beoordeling.score > 0 ? 'deels' : 'fout'),
        straf,
        uitleg: vraag.explanation || '',
        juist: vraag.type === 'code' ? null : vraag.correct,
        details: beoordeling.details,
        niveauWijziging: nieuw.wijziging ? { topic: topicNaam(t), van, naar: nieuw.niveau } : null,
        volgende: volgende ? leerlingVraag(volgende, state, state.nr + 1, run.question_count, H.hulpCfgVan(state)) : null,
        resultaat,
      });
    } catch (e) { log.error('[training] antwoord', e); res.status(500).json({ error: 'Kon je antwoord niet nakijken.' }); }
    finally { bezigeRuns.delete(id); }
  });

  app.post('/api/training/:id/stop', requireStudentAuth, requireCsrf, async (req, res) => {
    try {
      const run = await dbModule.getTrainingRun(Number(req.params.id));
      if (!eigenRun(run, req.student.id)) return res.status(404).json({ error: 'Training niet gevonden.' });
      if (run.status !== 'bezig') return res.json({ ok: true });
      const reden = String((req.body && req.body.reason) || 'gestopt').slice(0, 40);
      const resultaat = await sluitAf(run, run.state, 'gestopt', reden);
      res.json({ ok: true, resultaat });
    } catch (e) { res.status(500).json({ error: 'Kon de training niet stoppen.' }); }
  });

  // ── v106: hulp per niveau — checks (niveau 1-3) en hints (niveau 4-5) ─────────
  function hulpStand(state, qid) {
    return (state.hulp && state.hulp[qid]) || { checks: 0, hints: 0, laatste: null };
  }
  function bewaarHulpStand(state, qid, stand) {
    state.hulp = state.hulp || {};
    state.hulp[qid] = stand;
  }
  // Wat de leerling na een verversing terug mag zien: gebruikte hints (tekst) + laatste check-resultaat.
  function hulpStandVoorClient(state, q) {
    const st = hulpStand(state, q.id);
    return {
      checks: st.checks || 0, hints: st.hints || 0, laatste: st.laatste || null,
      getoondeHints: (q.hints || []).slice(0, st.hints || 0),
    };
  }
  const laatsteCheck = new Map();        // studentId → tijdstip laatste check (capaciteit van de runner)
  const CHECK_MIN_INTERVAL_MS = 3000;

  async function huidigeVraagVan(run, questionId) {
    const vraag = await dbModule.getTrainingQuestion(run.state.huidige);
    if (!vraag || Number(questionId) !== vraag.id) return null;
    return vraag;
  }

  app.post('/api/training/:id/hint', requireStudentAuth, requireCsrf, async (req, res) => {
    const id = Number(req.params.id);
    if (bezigeRuns.has(id)) return res.status(429).json({ error: 'Even geduld.' });
    bezigeRuns.add(id);
    try {
      const run = await dbModule.getTrainingRun(id);
      if (!eigenRun(run, req.student.id)) return res.status(404).json({ error: 'Training niet gevonden.' });
      if (run.status !== 'bezig') return res.status(409).json({ error: 'Deze training is al afgesloten.' });
      const vraag = await huidigeVraagVan(run, req.body && req.body.questionId);
      if (!vraag) return res.status(409).json({ error: 'Deze vraag is al beantwoord.' });
      const hcfg = H.hulpCfgVan(run.state);
      if (H.hulpSoort(vraag.level, hcfg) !== 'hints' || !(vraag.hints || []).length) return res.status(400).json({ error: 'Voor deze vraag zijn er geen hints.' });
      const nr = Number(req.body && req.body.nr);
      const max = Math.min(H.MAX_HINTS, vraag.hints.length);
      if (!Number.isInteger(nr) || nr < 1 || nr > max) return res.status(400).json({ error: 'Onbekende hint.' });
      const stand = hulpStand(run.state, vraag.id);
      if (nr > (stand.hints || 0) + 1) return res.status(409).json({ error: 'Vraag eerst de vorige hint op.' });
      const nieuweKost = nr > (stand.hints || 0);          // een al getoonde hint opnieuw bekijken is gratis
      if (nieuweKost) { stand.hints = nr; bewaarHulpStand(run.state, vraag.id, stand); await dbModule.saveTrainingRunState(id, run.state); }
      res.json({ hint: vraag.hints[nr - 1], nr, max, kostte: nieuweKost && nr > hcfg.gratisHints, straf: H.hulpStraf(vraag.level, stand, hcfg) });
    } catch (e) { log.error('[training] hint', e); res.status(500).json({ error: 'Kon de hint niet ophalen.' }); }
    finally { bezigeRuns.delete(id); }
  });

  app.post('/api/training/:id/check', requireStudentAuth, requireCsrf, async (req, res) => {
    const id = Number(req.params.id);
    if (bezigeRuns.has(id)) return res.status(429).json({ error: 'Even geduld, je vorige check loopt nog.' });
    const nu = Date.now();
    if (nu - (laatsteCheck.get(req.student.id) || 0) < CHECK_MIN_INTERVAL_MS) return res.status(429).json({ error: 'Even wachten voor je opnieuw checkt.' });
    bezigeRuns.add(id);
    try {
      const run = await dbModule.getTrainingRun(id);
      if (!eigenRun(run, req.student.id)) return res.status(404).json({ error: 'Training niet gevonden.' });
      if (run.status !== 'bezig') return res.status(409).json({ error: 'Deze training is al afgesloten.' });
      const vraag = await huidigeVraagVan(run, req.body && req.body.questionId);
      if (!vraag) return res.status(409).json({ error: 'Deze vraag is al beantwoord.' });
      const hcfg = H.hulpCfgVan(run.state);
      if (vraag.type !== 'code' || H.hulpSoort(vraag.level, hcfg) !== 'checklist') return res.status(400).json({ error: 'Voor deze vraag is er geen checklist.' });
      laatsteCheck.set(req.student.id, nu);
      const code = String((req.body && req.body.code) || '').slice(0, CODE_MAX_TEKENS);
      const checks = H.checksVan(vraag);
      const uitvoeringen = { aantalInvoer: null, tests: [] };
      if (code.trim()) {
        for (const i of H.nodigeTests(checks)) {            // enkel de testgevallen die de checks nodig hebben
          const test = vraag.tests[i]; if (!test) continue;
          const r = await runMetInvoer(code, test.input, TEST_TIMEOUT_MS);
          uitvoeringen.tests[i] = { ok: r.reden === 'klaar' && T.uitvoerKomtOvereen(test.output, r.output) };
          if (i === 0) uitvoeringen.aantalInvoer = r.aantalInvoer;
        }
      }
      const resultaat = H.evalueerChecks(checks, code, uitvoeringen);
      const stand = hulpStand(run.state, vraag.id);
      stand.checks = (stand.checks || 0) + 1;
      stand.laatste = resultaat;
      bewaarHulpStand(run.state, vraag.id, stand);
      await dbModule.saveTrainingRunState(id, run.state);
      res.json({ resultaat, gebruikt: stand.checks, kostte: stand.checks > hcfg.gratisChecks, straf: H.hulpStraf(vraag.level, stand, hcfg) });
    } catch (e) { log.error('[training] check', e); res.status(500).json({ error: 'Kon de check niet uitvoeren.' }); }
    finally { bezigeRuns.delete(id); }
  });

  // ── v106: interactief uitvoeren (zoals in de rest van de app: het programma wacht zelf op input) ──
  const actieveRuns = new Map();        // runnerRunId → { studentId, begin }
  const runVanLeerling = new Map();     // studentId → runnerRunId
  const RUN_MAX_MS = 120000;
  function ruimOp(runId) {
    const r = actieveRuns.get(runId);
    if (r && runVanLeerling.get(r.studentId) === runId) runVanLeerling.delete(r.studentId);
    actieveRuns.delete(runId);
  }
  function eigenRunnerRun(req) {
    const r = actieveRuns.get(String(req.params.rid));
    return r && r.studentId === req.student.id ? r : null;
  }
  app.post('/api/training/run/start', requireStudentAuth, requireCsrf, async (req, res) => {
    try {
      const nu = Date.now();
      if (nu - (laatsteRun.get(req.student.id) || 0) < 1000) return res.status(429).json({ error: 'Even wachten voor je opnieuw uitvoert.' });
      laatsteRun.set(req.student.id, nu);
      const code = String((req.body && req.body.code) || '').slice(0, CODE_MAX_TEKENS);
      if (!code.trim()) return res.status(400).json({ error: 'Schrijf eerst code.' });
      const oud = runVanLeerling.get(req.student.id);
      if (oud) { await runnerCancel(oud).catch(() => {}); ruimOp(oud); }
      const { runId } = await runnerStart(code);
      const sleutel = String(runId);
      actieveRuns.set(sleutel, { studentId: req.student.id, begin: nu });
      runVanLeerling.set(req.student.id, sleutel);
      setTimeout(() => { if (actieveRuns.has(sleutel)) { runnerCancel(sleutel).catch(() => {}); ruimOp(sleutel); } }, RUN_MAX_MS).unref?.();
      res.json({ runId: sleutel });
    } catch (e) { res.status(503).json({ error: 'De uitvoeromgeving is even niet bereikbaar.' }); }
  });
  app.get('/api/training/run/:rid/events', requireStudentAuth, async (req, res) => {
    if (!eigenRunnerRun(req)) return res.status(404).json({ error: 'Uitvoering niet gevonden.' });
    try {
      const data = await runnerEvents(String(req.params.rid), Number(req.query.since) || 0);
      if (!data.running && !data.queued) ruimOp(String(req.params.rid));
      res.json({ events: (data.events || []).map(e => ({ seq: e.seq, type: e.type, data: e.data })), running: !!data.running || !!data.queued });
    } catch (e) { res.status(503).json({ error: 'Kon de uitvoer niet ophalen.' }); }
  });
  app.post('/api/training/run/:rid/input', requireStudentAuth, requireCsrf, async (req, res) => {
    if (!eigenRunnerRun(req)) return res.status(404).json({ error: 'Uitvoering niet gevonden.' });
    try {
      const r = await runnerInput(String(req.params.rid), String((req.body && req.body.value) == null ? '' : req.body.value).slice(0, 500));
      res.json({ ok: !r.rejected });
    } catch (e) { res.status(503).json({ error: 'Kon je invoer niet versturen.' }); }
  });
  app.post('/api/training/run/:rid/cancel', requireStudentAuth, requireCsrf, async (req, res) => {
    if (!eigenRunnerRun(req)) return res.json({ ok: true });
    await runnerCancel(String(req.params.rid)).catch(() => {});
    ruimOp(String(req.params.rid));
    res.json({ ok: true });
  });

  // "Code uitvoeren" tijdens een codevraag: enkel uitvoer tonen, geen nakijken.
  app.post('/api/training/run', requireStudentAuth, requireCsrf, async (req, res) => {
    const nu = Date.now();
    if (nu - (laatsteRun.get(req.student.id) || 0) < RUN_MIN_INTERVAL_MS) {
      return res.status(429).json({ error: 'Even wachten voor je opnieuw uitvoert.' });
    }
    laatsteRun.set(req.student.id, nu);
    const code = String((req.body && req.body.code) || '').slice(0, CODE_MAX_TEKENS);
    const invoer = String((req.body && req.body.invoer) || '').split('\n').slice(0, 20);
    const r = await runMetInvoer(code, invoer, TEST_TIMEOUT_MS);
    const uitleg = { vraagt_input: 'Je programma vraagt meer invoer dan je hebt opgegeven. Vul de invoer aan (één regel per input()).',
      timeout: 'Je programma duurde te lang en werd gestopt.', kon_niet_starten: 'De uitvoeromgeving is even niet bereikbaar.' }[r.reden] || '';
    res.json({ output: String(r.output || '').slice(0, 4000), melding: uitleg });
  });

  // ═════════════════════════ LEERKRACHT ═══════════════════════════════════════
  // Algemene pool + instellingen beheert enkel de platformbeheerder (of de open modus zonder accounts).
  // v117: wie de algemene pool (vragen + onderwerpen) mag bewerken is instelbaar door de platformbeheerder:
  //   'superadmin' (enkel platformbeheerder) · 'beheerder' (ook schoolbeheerders) · 'leerkracht' (alle leerkrachten).
  // Zonder expliciete keuze: 'leerkracht' bij een installatie met één school, anders 'superadmin'.
  let poolRecht = 'superadmin';
  async function laadPoolRecht() {
    try {
      const v = await dbModule.getTrainingSetting('pool_recht');
      if (v === 'superadmin' || v === 'beheerder' || v === 'leerkracht') { poolRecht = v; return; }
      poolRecht = (await dbModule.countActiveSchools()) <= 1 ? 'leerkracht' : 'superadmin';
    } catch (e) { log.warn('[training] pool-recht laden: ' + e.message); }
  }
  const kanSuper = t => !!t && (!t.id || isSuperAdmin(t));
  const kanAlgemeen = t => !!t && (kanSuper(t) || poolRecht === 'leerkracht' || (poolRecht === 'beheerder' && t.role === 'admin'));
  async function magKlas(req, classId) { return magKlasZien(req, classId); }
  const dagenNaarMs = d => { const n = Number(d); return Number.isFinite(n) && n > 0 ? Date.now() - n * 86400000 : 0; };

  app.get('/api/teacher/training/overview', requireTeacherAuth, async (req, res) => {
    try {
      const classId = String(req.query.classId || '');
      if (!classId || !(await magKlas(req, classId))) return res.status(403).json({ error: 'Geen toegang tot deze klas.' });
      const sinds = dagenNaarMs(req.query.dagen);
      const cfg = await instellingen();
      const leerlingenRuw = await dbModule.getTrainingOverviewForClass(classId, sinds);
      const hulpPer = await dbModule.getTrainingHulpForClass(classId, sinds);
      const nuOv = Date.now(); const vandaagOv = G.dagSleutel(nuOv);
      const dagCfg = D.normaliseerDagvraagCfg(((await dbModule.getTrainingClassSettings([classId]))[0] || {}).settings?.dagvraag).cfg;
      const dagRijen = await dbModule.getDagvraagVoorKlas(classId, G.dagSleutel(nuOv - 400 * G.DAG_MS));
      const leerlingen = leerlingenRuw.map(l => {
        const h = hulpPer[l.id] || { antwoorden: 0, checks: 0, hints: 0, metHulp: 0, straf: 0 };
        const mijn = dagRijen.filter(r => r.studentId === l.id);
        const vandaagRij = mijn.find(r => r.day === vandaagOv) || null;
        const dagvraag = !dagCfg.aan ? null : {
          vandaag: vandaagRij ? D.dagStatus(vandaagRij, vandaagOv, vandaagOv, dagCfg) : 'open',
          pogingenVandaag: vandaagRij ? D.actievePogingen(vandaagRij) : 0,
          streak: D.berekenDagStreak(mijn.filter(r => r.solved && !r.inhaal).map(r => r.day), nuOv, dagCfg.jokersPerWeek).streak,
          opgelost: mijn.filter(r => r.solved && !r.inhaal).length,
          ingehaald: mijn.filter(r => r.solved && r.inhaal).length,
        };
        return { ...l, dagvraag, hulp: { checks: h.checks, hints: h.hints, antwoordenMetHulp: h.metHulp, antwoorden: h.antwoorden,
          pctMetHulp: h.antwoorden ? Math.round(h.metHulp / h.antwoorden * 100) : null,
          gemStrafPct: h.antwoorden ? Math.round(h.straf / h.antwoorden * 100) : null } };
      });
      const zwak = await dbModule.getTrainingZwakstePerTopic(classId, sinds);
      const titelNaam = n => (cfg.titels.find(t => t.niveau === n) || {}).titel || null;
      const getraind = leerlingen.filter(l => l.klaar > 0);
      const totaal = leerlingen.reduce((a, l) => a + l.klaar, 0);
      const gemScore = getraind.length ? Math.round(getraind.reduce((a, l) => a + (l.gemScore || 0), 0) / getraind.length) : null;
      const zwakste = zwak.filter(z => z.n >= 5).sort((a, b) => a.gem - b.gem)[0] || null;
      // verdeling: hoeveel leerlingen hebben welke beste titel (om de grenzen te kunnen bijsturen)
      const verdeling = cfg.titels.map(t => ({ niveau: t.niveau, titel: t.titel, aantal: getraind.filter(l => l.besteTitelNiveau === t.niveau).length }));
      res.json({
        leerlingen: leerlingen.map(l => ({ ...l, besteTitel: titelNaam(l.besteTitelNiveau) })),
        samenvatting: { aantalLeerlingen: leerlingen.length, getraind: getraind.length, trainingen: totaal, gemScore,
          zwaksteOnderwerp: zwakste ? { naam: topicNaam(zwakste.topic), gem: zwakste.gem } : null },
        verdeling,
        perOnderwerp: zwak.map(z => ({ ...z, naam: topicNaam(z.topic) })),
      });
    } catch (e) { log.error('[training] overzicht lk', e); res.status(500).json({ error: 'Kon het overzicht niet laden.' }); }
  });

  async function magLeerling(req, studentId) {
    if (!req.teacher || !req.teacher.id) return true;                       // open modus
    for (const klasId of await dbModule.getActiveClassIdsOfStudent(studentId)) {
      if (await magKlasZien(req, klasId)) return true;
    }
    return false;
  }

  app.get('/api/teacher/training/student/:id', requireTeacherAuth, async (req, res) => {
    try {
      if (!(await magLeerling(req, req.params.id))) return res.status(403).json({ error: 'Geen toegang tot deze leerling.' });
      const runs = await dbModule.listTrainingRunsForStudent(req.params.id, 50);
      res.json({ runs: runs.map(r => ({ ...r, topics: r.topics.map(topicNaam) })) });
    } catch (e) { res.status(500).json({ error: 'Kon de trainingen niet laden.' }); }
  });

  app.get('/api/teacher/training/run/:runId', requireTeacherAuth, async (req, res) => {
    try {
      const run = await dbModule.getTrainingRun(Number(req.params.runId));
      if (!run || !(await magLeerling(req, run.student_id))) return res.status(403).json({ error: 'Geen toegang.' });
      const antwoorden = await dbModule.getTrainingRunAnswers(run.id);
      res.json({ antwoorden: antwoorden.map(a => ({ seq: a.seq, topic: topicNaam(a.topic), level: a.level, type: a.type,
        text: a.text.slice(0, 300), score: Math.round(a.score * 100),
        hulp: a.details && a.details.hulp ? { checks: a.details.hulp.checks || 0, hints: a.details.hulp.hints || 0, straf: Math.round((a.details.hulp.straf || 0) * 100) } : null })) });
    } catch (e) { res.status(500).json({ error: 'Kon de antwoorden niet laden.' }); }
  });

  // Pool: aantal vragen per onderwerp en niveau (algemeen + eigen)
  app.get('/api/teacher/training/pool', requireTeacherAuth, async (req, res) => {
    try {
      const rijen = await dbModule.getTrainingPoolCounts(req.teacher.id);
      res.json({ topics: (await herlaadTopics()).map(t => ({ id: t.id, name: t.name, actief: t.active })), counts: rijen, kanAlgemeenBeheren: kanAlgemeen(req.teacher), heeftAccount: !!req.teacher.id });
    } catch (e) { res.status(500).json({ error: 'Kon de pool niet laden.' }); }
  });

  // v111: onderwerp verwijderen (enkel platformbeheerder: het raakt ook eigen vragen van andere leerkrachten)
  app.get('/api/teacher/training/topics/:id/impact', requireTeacherAuth, async (req, res) => {
    try {
      if (!kanAlgemeen(req.teacher)) return res.status(403).json({ error: 'Enkel de platformbeheerder kan onderwerpen verwijderen.' });
      const id = String(req.params.id);
      if (!topicIds.includes(id)) return res.status(404).json({ error: 'Onderwerp niet gevonden.' });
      res.json({ id, naam: topicNaam(id), ...(await dbModule.trainingTopicImpact(id)) });
    } catch (e) { log.error('[training] impact', e); res.status(500).json({ error: 'Kon dit niet bepalen.' }); }
  });
  app.delete('/api/teacher/training/topics/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      if (!kanAlgemeen(req.teacher)) return res.status(403).json({ error: 'Enkel de platformbeheerder kan onderwerpen verwijderen.' });
      const id = String(req.params.id);
      if (!topicIds.includes(id)) return res.status(404).json({ error: 'Onderwerp niet gevonden.' });
      if (String((req.body && req.body.bevestig) || '').trim().toLowerCase() !== topicNaam(id).toLowerCase())
        return res.status(400).json({ error: 'Typ de naam van het onderwerp om te bevestigen.' });
      const impact = await dbModule.verwijderTrainingTopic(id);
      await herlaadTopics();
      log.info(`[training] onderwerp ${id} verwijderd door ${req.teacher.id || 'open modus'}: ${JSON.stringify(impact)}`);
      res.json({ ok: true, impact });
    } catch (e) { log.error('[training] onderwerp verwijderen', e); res.status(500).json({ error: 'Kon het onderwerp niet verwijderen.' }); }
  });

  // ── v115: onderwerpen beheren (toevoegen, hernoemen, volgorde, in-/uitschakelen) ─────────────
  const slug = naam => String(naam || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const alleenBeheerder = (req, res) => {
    if (kanAlgemeen(req.teacher)) return true;
    res.status(403).json({ error: 'Je hebt geen recht om onderwerpen te beheren (instelbaar door de platformbeheerder).' });
    return false;
  };
  app.get('/api/teacher/training/topics', requireTeacherAuth, async (req, res) => {
    try {
      res.json({ topics: (await herlaadTopics()).map(t => ({ id: t.id, name: t.name, sort: t.sort_order, actief: t.active, maxLevel: t.max_level,
        vragenActief: t.vragen_actief, vragenUit: t.vragen_uit })), kanBeheren: kanAlgemeen(req.teacher) });
    } catch (e) { res.status(500).json({ error: 'Kon de onderwerpen niet laden.' }); }
  });
  app.post('/api/teacher/training/topics', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      if (!alleenBeheerder(req, res)) return;
      const naam = String((req.body && req.body.name) || '').trim().slice(0, 60);
      const id = slug(naam);
      if (naam.length < 2 || !id) return res.status(400).json({ error: 'Geef het onderwerp een naam van minstens 2 tekens.' });
      const bestaand = await herlaadTopics();
      if (bestaand.length >= 40) return res.status(400).json({ error: 'Maximaal 40 onderwerpen.' });
      if (bestaand.some(t => t.name.toLowerCase() === naam.toLowerCase())) return res.status(409).json({ error: 'Er bestaat al een onderwerp met deze naam.' });
      const sort = (bestaand.reduce((m, t) => Math.max(m, t.sort_order || 0), 0)) + 1;
      const ok = await dbModule.createTrainingTopic({ id, name: naam, maxLevel: 10, sort });
      if (!ok) return res.status(409).json({ error: 'Er bestaat al een onderwerp met deze naam.' });
      await herlaadTopics();
      log.info(`[training] onderwerp ${id} toegevoegd door ${req.teacher.id || 'open modus'}`);
      res.json({ ok: true, id });
    } catch (e) { log.error('[training] onderwerp toevoegen', e); res.status(500).json({ error: 'Kon het onderwerp niet toevoegen.' }); }
  });
  app.put('/api/teacher/training/topics/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      if (!alleenBeheerder(req, res)) return;
      const id = String(req.params.id);
      if (!topicIds.includes(id)) return res.status(404).json({ error: 'Onderwerp niet gevonden.' });
      const b = req.body || {};
      const naam = b.name == null ? null : String(b.name).trim().slice(0, 60);
      if (naam !== null && naam.length < 2) return res.status(400).json({ error: 'De naam is te kort.' });
      const sort = b.sort == null ? null : Math.max(0, Math.min(999, parseInt(b.sort, 10) || 0));
      const actief = typeof b.actief === 'boolean' ? b.actief : null;
      const ok = await dbModule.updateTrainingTopic(id, { name: naam, sort, active: actief });
      if (!ok) return res.status(404).json({ error: 'Onderwerp niet gevonden.' });
      await herlaadTopics();
      res.json({ ok: true });
    } catch (e) { log.error('[training] onderwerp wijzigen', e); res.status(500).json({ error: 'Kon het onderwerp niet wijzigen.' }); }
  });

  app.get('/api/teacher/training/questions', requireTeacherAuth, async (req, res) => {
    try {
      const status = ['alle', 'uit'].includes(req.query.status) ? req.query.status : 'actief';
      const lijst = await dbModule.listTrainingQuestions({ teacherId: req.teacher.id, status,
        topic: req.query.topic || null, level: req.query.level ? Number(req.query.level) : null, zoek: String(req.query.zoek || '').trim() || null });
      let uit = lijst.map(q => {
        const problemen = K.controleerVraag(q);
        return { id: q.id, topic: q.topic, level: q.level, type: q.type, text: q.text.slice(0, 200), active: q.active,
          algemeen: q.algemeen, eigen: q.eigen, nAntwoorden: q.nAntwoorden,
          pctJuist: q.nAntwoorden ? Math.round(q.nJuist / q.nAntwoorden * 100) : null,
          fouten: problemen.filter(p => p.ernst === 'fout').length, tips: problemen.filter(p => p.ernst === 'tip').length };
      });
      const totaal = uit.length;
      if (req.query.probleem === 'fout') uit = uit.filter(q => q.fouten > 0);
      else if (req.query.probleem === 'alle') uit = uit.filter(q => q.fouten + q.tips > 0);
      const samenvatting = { totaal, metFout: uit.filter(q => q.fouten > 0).length };
      res.json({ questions: uit.slice(0, 200), gevonden: uit.length, samenvatting });
    } catch (e) { log.error('[training] vragen', e); res.status(500).json({ error: 'Kon de vragen niet laden.' }); }
  });

  // v115: uitschakelen (blijft bewaard) en definitief verwijderen zijn aparte acties.
  app.put('/api/teacher/training/questions/:id/active', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      const actief = !!(req.body && req.body.actief);
      const ok = await dbModule.setTrainingQuestionActive(Number(req.params.id), actief, req.teacher.id, kanAlgemeen(req.teacher));
      res.status(ok ? 200 : 403).json(ok ? { ok: true, actief } : { error: 'Je kan enkel je eigen vragen beheren (algemene vragen: platformbeheerder).' });
    } catch (e) { res.status(500).json({ error: 'Kon de vraag niet wijzigen.' }); }
  });
  app.delete('/api/teacher/training/questions/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (req.query.definitief === '1') {
        const ok = await dbModule.deleteTrainingQuestionHard(id, req.teacher.id, kanAlgemeen(req.teacher));
        return res.status(ok ? 200 : 403).json(ok ? { ok: true } : { error: 'Je kan enkel je eigen vragen verwijderen (algemene vragen: platformbeheerder).' });
      }
      const ok = await dbModule.deactivateTrainingQuestion(id, req.teacher.id, kanAlgemeen(req.teacher));
      res.status(ok ? 200 : 403).json(ok ? { ok: true } : { error: 'Je kan enkel je eigen vragen verwijderen.' });
    } catch (e) { res.status(500).json({ error: 'Kon de vraag niet verwijderen.' }); }
  });

  // ── v108: vragen één voor één toevoegen, bewerken en testen (naast de JSON-import) ──────────
  const kanBewerken = (q, teacher) => (q.owner ? q.owner === teacher.id : kanAlgemeen(teacher));
  const naarFormulier = q => ({ id: q.id, topic: q.topic, level: q.level, type: q.type, text: q.text, code: q.code,
    choices: q.choices, correct: q.correct, starter: q.starter, tests: q.tests, explanation: q.explanation,
    chapter: q.chapter, keywords: q.keywords, hints: q.hints, checks: q.checks, algemeen: !q.owner });

  app.get('/api/teacher/training/questions/:id', requireTeacherAuth, async (req, res) => {
    try {
      const q = await dbModule.getTrainingQuestion(Number(req.params.id));
      if (!q) return res.status(404).json({ error: 'Vraag niet gevonden.' });
      if (q.owner && q.owner !== req.teacher.id) return res.status(403).json({ error: 'Dit is een vraag van een andere leerkracht.' });
      res.json({ vraag: naarFormulier(q), kanBewerken: kanBewerken(q, req.teacher) });
    } catch (e) { res.status(500).json({ error: 'Kon de vraag niet laden.' }); }
  });

  // v115: alles over één vraag — hoe ze eruit ziet, hoe ze nagekeken wordt, kwaliteit en gebruik.
  const kijkMagVraag = (q, teacher) => !q.owner || q.owner === teacher.id;
  app.get('/api/teacher/training/questions/:id/detail', requireTeacherAuth, async (req, res) => {
    try {
      const q = await dbModule.getTrainingQuestion(Number(req.params.id));
      if (!q) return res.status(404).json({ error: 'Vraag niet gevonden.' });
      if (!kijkMagVraag(q, req.teacher)) return res.status(403).json({ error: 'Dit is een vraag van een andere leerkracht.' });
      const hcfg = H.STANDAARD_HULP;
      const eigenChecks = !!(q.checks && q.checks.length);
      const checks = q.type === 'code' ? H.checksVan(q).map((c, i) => ({ id: i, label: c.label, kind: c.kind, pattern: c.pattern || null, n: c.n == null ? null : c.n, index: c.index == null ? null : c.index })) : [];
      const st = await dbModule.getTrainingQuestionStats(q.id);
      res.json({
        vraag: { ...naarFormulier(q), active: q.active, onderwerpNaam: topicNaam(q.topic) },
        kanBewerken: kanBewerken(q, req.teacher),
        hulpSoort: H.hulpSoort(q.level, hcfg),
        hulpCfg: { gratisChecks: hcfg.gratisChecks, gratisHints: hcfg.gratisHints, strafPct: hcfg.strafPct },
        hoofdstuk: (() => { const h = H.hoofdstukVoorVraag(q); return h ? { nr: h.nr, titel: h.titel, url: h.url } : null; })(),
        checks, checksBron: q.type === 'code' ? (eigenChecks ? 'eigen' : 'automatisch') : null,
        stappen: K.nakijkStappen(q, hcfg),
        problemen: K.controleerVraag(q),
        statistiek: st,
      });
    } catch (e) { log.error('[training] detail', e); res.status(500).json({ error: 'Kon de vraag niet laden.' }); }
  });

  // "Probeer als leerling": voert het echte nakijken uit (zelfde functies als bij de leerling), zonder iets op te slaan.
  const laatsteProbeer = new Map();
  app.post('/api/teacher/training/questions/:id/probeer', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      const q = await dbModule.getTrainingQuestion(Number(req.params.id));
      if (!q) return res.status(404).json({ error: 'Vraag niet gevonden.' });
      if (!kijkMagVraag(q, req.teacher)) return res.status(403).json({ error: 'Dit is een vraag van een andere leerkracht.' });
      const sleutel = req.teacher.id || 'open';
      if (Date.now() - (laatsteProbeer.get(sleutel) || 0) < 1500) return res.status(429).json({ error: 'Even wachten.' });
      laatsteProbeer.set(sleutel, Date.now());
      const antwoord = req.body && req.body.answer;
      if (q.type !== 'code') {
        const b = kijkKeuzeNa(q, antwoord);
        return res.json({ type: q.type, score: b.score, juist: b.score >= 1, juisteKeuzes: q.correct, uitleg: q.explanation || '' });
      }
      const code = String(antwoord == null ? '' : antwoord).slice(0, CODE_MAX_TEKENS);
      if (!code.trim()) return res.status(400).json({ error: 'Schrijf eerst code.' });
      const tests = []; const uitv = { aantalInvoer: null, tests: [] };
      for (let i = 0; i < q.tests.length; i++) {
        const t = q.tests[i];
        const r = await runMetInvoer(code, t.input, TEST_TIMEOUT_MS);
        const ok = r.reden === 'klaar' && T.uitvoerKomtOvereen(t.output, r.output);
        uitv.tests[i] = { ok }; if (i === 0) uitv.aantalInvoer = r.aantalInvoer;
        tests.push({ invoer: t.input, verwacht: T.normaliseerUitvoer(t.output), gekregen: T.normaliseerUitvoer(r.output).slice(0, 800), reden: r.reden, ok, aantalInvoer: r.aantalInvoer });
      }
      const checks = H.checksVan(q);
      const ev = H.evalueerChecks(checks, code, uitv);
      const score = T.scoreCode(tests);
      res.json({ type: 'code', score, juist: score >= 1, tests,
        checks: ev.map((e, i) => ({ id: i, label: checks[i].label, ok: e.ok, kind: checks[i].kind })), uitleg: q.explanation || '' });
    } catch (e) { log.error('[training] probeer', e); res.status(500).json({ error: 'Kon het nakijken niet uitvoeren.' }); }
  });

  app.post('/api/teacher/training/questions', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      const scope = req.body && req.body.scope === 'general' ? 'general' : 'own';
      if (scope === 'general' && !kanAlgemeen(req.teacher)) return res.status(403).json({ error: 'Je hebt geen recht om vragen aan de algemene pool toe te voegen (instelbaar door de platformbeheerder).' });
      if (scope === 'own' && !req.teacher.id) return res.status(400).json({ error: 'Log in met een eigen account om eigen vragen toe te voegen.' });
      const r = T.valideerVraag(req.body && req.body.vraag, topicIds);
      if (r.fouten.length) return res.status(400).json({ error: r.fouten.join(' '), fouten: r.fouten });
      const uit = await dbModule.createTrainingQuestion(r.vraag, scope === 'general' ? null : req.teacher.id, T.vraagHash);
      if (uit.dubbel) return res.status(409).json({ error: 'Deze vraag bestaat al (zelfde onderwerp, niveau en tekst).' });
      res.json({ ok: true, id: uit.id });
    } catch (e) { log.error('[training] vraag toevoegen', e); res.status(500).json({ error: 'Kon de vraag niet opslaan.' }); }
  });

  // Live analyse van een (nog niet opgeslagen) vraag: welke checklist, welke nakijkstappen, welke problemen.
  app.post('/api/teacher/training/questions/analyse', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      const r = T.valideerVraag(req.body && req.body.vraag, topicIds);
      const q = r.vraag;
      if (!q) return res.status(400).json({ error: r.fouten.join(' '), fouten: r.fouten });
      const hcfg = H.STANDAARD_HULP;
      const eigenChecks = !!(q.checks && q.checks.length);
      const checks = q.type === 'code' ? H.checksVan(q).map((c, i) => ({ id: i, label: c.label, kind: c.kind, pattern: c.pattern || null, n: c.n == null ? null : c.n, index: c.index == null ? null : c.index })) : [];
      res.json({ fouten: r.fouten, hulpSoort: H.hulpSoort(q.level, hcfg), checks, checksBron: q.type === 'code' ? (eigenChecks ? 'eigen' : 'automatisch') : null,
        stappen: K.nakijkStappen(q, hcfg), problemen: K.controleerVraag(q) });
    } catch (e) { log.error('[training] analyse', e); res.status(500).json({ error: 'Kon de vraag niet analyseren.' }); }
  });

  app.put('/api/teacher/training/questions/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      const r = T.valideerVraag(req.body && req.body.vraag, topicIds);
      if (r.fouten.length) return res.status(400).json({ error: r.fouten.join(' '), fouten: r.fouten });
      const uit = await dbModule.updateTrainingQuestion(Number(req.params.id), r.vraag, req.teacher.id, kanAlgemeen(req.teacher), T.vraagHash);
      if (uit.dubbel) return res.status(409).json({ error: 'Er bestaat al een vraag met dezelfde onderwerp, niveau en tekst.' });
      if (!uit.ok) return res.status(403).json({ error: 'Je kan enkel je eigen vragen aanpassen.' });
      res.json({ ok: true });
    } catch (e) { log.error('[training] vraag aanpassen', e); res.status(500).json({ error: 'Kon de vraag niet aanpassen.' }); }
  });

  // Laat de leerkracht zijn oplossing op de testinvoer draaien: toont de echte uitvoer (en of die klopt).
  const laatsteVerify = new Map();
  app.post('/api/teacher/training/questions/verify', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      const sleutel = req.teacher.id || 'open';
      if (Date.now() - (laatsteVerify.get(sleutel) || 0) < 1500) return res.status(429).json({ error: 'Even wachten.' });
      laatsteVerify.set(sleutel, Date.now());
      const code = String((req.body && req.body.code) || '').slice(0, CODE_MAX_TEKENS);
      const tests = (Array.isArray(req.body && req.body.tests) ? req.body.tests : []).slice(0, 10);
      if (!code.trim()) return res.status(400).json({ error: 'Schrijf eerst een oplossing.' });
      if (!tests.length) return res.status(400).json({ error: 'Voeg eerst minstens één testgeval toe.' });
      const uit = [];
      for (const t of tests) {
        const invoer = (Array.isArray(t && t.input) ? t.input : []).map(String).slice(0, 20);
        const r = await runMetInvoer(code, invoer, TEST_TIMEOUT_MS);
        const output = T.normaliseerUitvoer(r.output);
        uit.push({ output, reden: r.reden, ok: r.reden === 'klaar' && T.uitvoerKomtOvereen(String((t && t.output) || ''), r.output), aantalInvoer: r.aantalInvoer });
      }
      res.json({ resultaten: uit });
    } catch (e) { log.error('[training] verify', e); res.status(500).json({ error: 'Kon de oplossing niet uitvoeren.' }); }
  });

  // JSON-import: eerst controleren (check:true), pas daarna opslaan.
  app.post('/api/teacher/training/import', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      const scope = req.body && req.body.scope === 'general' ? 'general' : 'own';
      if (scope === 'general' && !kanAlgemeen(req.teacher)) return res.status(403).json({ error: 'Je hebt geen recht om vragen aan de algemene pool toe te voegen (instelbaar door de platformbeheerder).' });
      if (scope === 'own' && !req.teacher.id) return res.status(400).json({ error: 'Log in met een eigen account om eigen vragen toe te voegen.' });
      const r = T.valideerImport(req.body && req.body.questions, topicIds);
      if (req.body && req.body.check) return res.json({ geldig: r.geldig.length, fouten: r.fouten.slice(0, 30), totaalFouten: r.fouten.length });
      if (r.fouten.length) return res.status(400).json({ error: 'De import bevat fouten. Los ze eerst op.', fouten: r.fouten.slice(0, 30) });
      const uit = await dbModule.insertTrainingQuestions(r.geldig, scope === 'general' ? null : req.teacher.id, T.vraagHash);
      res.json({ ok: true, ...uit });
    } catch (e) { log.error('[training] import', e); res.status(500).json({ error: 'Kon de vragen niet opslaan.' }); }
  });

  // v107: hulpregels per klas
  app.get('/api/teacher/training/class-settings', requireTeacherAuth, async (req, res) => {
    try {
      const classId = String(req.query.classId || '');
      if (!classId || !(await magKlas(req, classId))) return res.status(403).json({ error: 'Geen toegang tot deze klas.' });
      const rij = (await dbModule.getTrainingClassSettings([classId]))[0];
      res.json({ eigen: !!rij, instellingen: H.normaliseerHulpCfg(rij ? rij.settings : {}).cfg, standaard: H.STANDAARD_HULP,
        dagvraag: D.normaliseerDagvraagCfg(rij && rij.settings ? rij.settings.dagvraag : {}).cfg, dagStandaard: D.DAG_STANDAARD });
    } catch (e) { res.status(500).json({ error: 'Kon de klasinstellingen niet laden.' }); }
  });
  app.put('/api/teacher/training/class-settings', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      const classId = String((req.body && req.body.classId) || '');
      if (!classId || !(await magKlas(req, classId))) return res.status(403).json({ error: 'Geen toegang tot deze klas.' });
      const r = H.normaliseerHulpCfg(req.body && req.body.instellingen);
      if (r.fouten.length) return res.status(400).json({ error: r.fouten.join(' ') });
      const bestaand = (await dbModule.getTrainingClassSettings([classId]))[0];
      const d = D.normaliseerDagvraagCfg(req.body && req.body.dagvraag != null ? req.body.dagvraag : (bestaand && bestaand.settings ? bestaand.settings.dagvraag : {}));
      if (d.fouten.length) return res.status(400).json({ error: d.fouten.join(' ') });
      await dbModule.setTrainingClassSettings(classId, { ...r.cfg, dagvraag: d.cfg });
      res.json({ ok: true, eigen: true, instellingen: r.cfg, dagvraag: d.cfg });
    } catch (e) { log.error('[training] klasinstellingen', e); res.status(500).json({ error: 'Kon de klasinstellingen niet opslaan.' }); }
  });
  app.delete('/api/teacher/training/class-settings', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      const classId = String(req.query.classId || '');
      if (!classId || !(await magKlas(req, classId))) return res.status(403).json({ error: 'Geen toegang tot deze klas.' });
      await dbModule.deleteTrainingClassSettings(classId);
      res.json({ ok: true, eigen: false, instellingen: { ...H.STANDAARD_HULP }, dagvraag: { ...D.DAG_STANDAARD } });
    } catch (e) { res.status(500).json({ error: 'Kon de klasinstellingen niet herstellen.' }); }
  });

  app.get('/api/teacher/training/settings', requireTeacherAuth, async (req, res) => {
    res.json({ instellingen: await instellingen(), mayEdit: kanSuper(req.teacher), poolRecht, standaard: T.STANDAARD_INSTELLINGEN });
  });
  app.put('/api/teacher/training/settings', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      if (!kanSuper(req.teacher)) return res.status(403).json({ error: 'Enkel de platformbeheerder kan de instellingen wijzigen.' });
      const r = T.normaliseerInstellingen(req.body || {});
      if (r.fouten.length) return res.status(400).json({ error: r.fouten.join(' ') });
      await dbModule.setTrainingConfig(r.instellingen);
      res.json({ ok: true, instellingen: r.instellingen });
    } catch (e) { res.status(500).json({ error: 'Kon de instellingen niet opslaan.' }); }
  });

  app.put('/api/teacher/training/pool-recht', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      if (!kanSuper(req.teacher)) return res.status(403).json({ error: 'Enkel de platformbeheerder kan dit wijzigen.' });
      const v = req.body && req.body.recht;
      if (!['superadmin', 'beheerder', 'leerkracht'].includes(v)) return res.status(400).json({ error: 'Ongeldige keuze.' });
      await dbModule.setTrainingSetting('pool_recht', v); poolRecht = v;
      res.json({ ok: true, poolRecht });
    } catch (e) { res.status(500).json({ error: 'Kon de keuze niet opslaan.' }); }
  });

  // ── Eerste keer: onderwerpen + startpool zaaien ──────────────────────────────
  async function zaai() {
    await laadPoolRecht();
    await dbModule.seedTrainingTopics(ONDERWERPEN);
    try { await herlaadTopics(); } catch (e) { log.warn('[training] onderwerpen laden: ' + e.message); }
    try {   // v110: oude opdrachttekst "zonder tekst tussen de haakjes" vervangen (nakijken negeert de prompt nu)
      const n = await dbModule.herschrijfTrainingTekst('Gebruik input() zonder tekst tussen de haakjes.', 'Zet in input() gerust een vraag voor de gebruiker; die tekst telt niet mee voor de uitvoer.', T.vraagHash);
      if (n) log.info(`[training] ${n} opdrachtteksten aangepast (input met vraagtekst is toegestaan)`);
    } catch (e) { log.warn('[training] tekstmigratie: ' + e.message); }
    if ((await dbModule.countTrainingQuestions()) > 0) return;
    const bestand = path.join(__dirname, '..', 'db', 'training-seed.json');
    if (!fs.existsSync(bestand)) return;
    const r = T.valideerImport(fs.readFileSync(bestand, 'utf8'), topicIds);
    if (r.fouten.length) log.warn(`[training] seed: ${r.fouten.length} vragen overgeslagen`);
    const uit = await dbModule.insertTrainingQuestions(r.geldig, null, T.vraagHash);
    log.info(`[training] startpool geladen: ${uit.toegevoegd} vragen`);
  }

  return { zaai, ONDERWERPEN };
}

module.exports = { registerTrainingRoutes, ONDERWERPEN };
