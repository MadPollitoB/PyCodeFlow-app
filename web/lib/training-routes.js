'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 97 — Trainingscenter: routes (leerling + leerkracht) en code-nakijken.
// De beslissingen zelf staan in lib/training.js (pure logica, getest).
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const T = require('./training');

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
  const topicIds = ONDERWERPEN.map(t => t.id);
  const topicNaam = id => (ONDERWERPEN.find(t => t.id === id) || { name: id }).name;
  const bezigeRuns = new Set();          // eenvoudige slot per training tegen dubbel indienen
  const laatsteRun = new Map();          // studentId → tijdstip laatste "uitvoeren"

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
  async function runMetInvoerRuw(code, invoer, timeoutMs) {
    if (!code || !String(code).trim()) return { output: '', reden: 'geen_code' };
    let runId;
    try { runId = (await runnerStart(code)).runId; }
    catch (e) { return { output: '', reden: 'kon_niet_starten' }; }
    const rij = (invoer || []).slice();
    const begin = Date.now();
    let output = ''; let laatsteSeq = 0;
    try {
      for (;;) {
        if (Date.now() - begin > timeoutMs) { await runnerCancel(runId).catch(() => {}); return { output, reden: 'timeout' }; }
        const data = await runnerEvents(runId, laatsteSeq);
        for (const ev of (data.events || [])) {
          laatsteSeq = ev.seq;
          if (ev.type === 'stdout' || ev.type === 'stderr') output += ev.data;
          else if (ev.type === 'input_request') {
            if (!rij.length) { await runnerCancel(runId).catch(() => {}); return { output, reden: 'vraagt_input' }; }
            await runnerInput(runId, rij.shift());
          } else if (ev.type === 'run_error') {
            let d = {}; try { d = typeof ev.data === 'string' ? JSON.parse(ev.data || '{}') : (ev.data || {}); } catch { /* negeren */ }
            output += `\n[fout: ${d.message || 'onbekende fout'}]`;
          } else if (ev.type === 'end') return { output, reden: 'klaar' };
        }
        if (!data.running && !data.queued) return { output, reden: 'klaar' };
        await new Promise(r => setTimeout(r, 120));
      }
    } catch (e) {
      await runnerCancel(runId).catch(() => {});
      return { output, reden: 'fout' };
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
    if (n) await dbModule.setStudentTrainingLevels(run.student_id, state.levels);
    return {
      status, scorePct, aantal: n, aantalJuist: antwoorden.filter(a => a.score >= 1).length,
      titel, titelNiveau, bereiktNiveau: bereikt, perTopic,
      nogTeBeoordelen: 0,
    };
  }

  function eigenRun(run, studentId) { return run && run.student_id === studentId; }

  // ═════════════════════════ LEERLING ═════════════════════════════════════════
  app.get('/api/training/overzicht', requireStudentAuth, async (req, res) => {
    try {
      const cfg = await instellingen();
      const rijen = await dbModule.listTrainingTopicsForStudent(req.student.id);
      const laatste = (await dbModule.listTrainingRunsForStudent(req.student.id, 1))[0] || null;
      const actief = await dbModule.getActiveTrainingRun(req.student.id);
      res.json({
        topics: rijen.map(r => ({ id: r.id, name: r.name, aantal: r.aantal, maxLevel: r.max_level, niveau: r.opgeslagen_niveau || null })),
        laatste: laatste ? { ...laatste, topics: laatste.topics.map(topicNaam) } : null,
        actief,
        grenzen: { minVragen: T.MIN_VRAGEN, maxVragen: T.MAX_VRAGEN, minOnderwerpen: T.MIN_ONDERWERPEN, maxOnderwerpen: T.MAX_ONDERWERPEN },
        titels: cfg.titels,
      });
    } catch (e) { log.error('[training] overzicht', e); res.status(500).json({ error: 'Kon het trainingscenter niet laden.' }); }
  });

  app.get('/api/training/geschiedenis', requireStudentAuth, async (req, res) => {
    try {
      const lijst = await dbModule.listTrainingRunsForStudent(req.student.id, 20);
      res.json({ runs: lijst.map(r => ({ ...r, topics: r.topics.map(topicNaam) })) });
    } catch (e) { res.status(500).json({ error: 'Kon de geschiedenis niet laden.' }); }
  });

  app.post('/api/training/start', requireStudentAuth, requireCsrf, async (req, res) => {
    try {
      const keuze = T.valideerTrainingKeuze(req.body || {}, topicIds);
      if (!keuze.ok) return res.status(400).json({ error: keuze.fout });
      const cfg = await instellingen();
      const rijen = await dbModule.listTrainingTopicsForStudent(req.student.id);
      const perId = Object.fromEntries(rijen.map(r => [r.id, r]));
      const leeg = keuze.topics.filter(t => !perId[t] || perId[t].aantal < 1);
      if (leeg.length) return res.status(400).json({ error: `Voor ${leeg.map(topicNaam).join(', ')} zijn nog geen vragen beschikbaar.` });

      // een nog openstaande training wordt afgesloten als "gestopt" (één tegelijk)
      const oud = await dbModule.getActiveTrainingRun(req.student.id);
      if (oud) {
        const oudRun = await dbModule.getTrainingRun(oud);
        if (oudRun) await sluitAf(oudRun, oudRun.state, 'gestopt', 'nieuwe_training_gestart');
      }

      const state = { topics: keuze.topics, levels: {}, recent: {}, aantalPerTopic: {}, maxLevel: {}, asked: [], nr: 0, huidige: null };
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
      res.json({ runId, aantal: keuze.aantal, vraag: T.vraagVoorLeerling(eerste, 1, keuze.aantal, state.levels[eerste.topic]) });
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
        vraag: q ? T.vraagVoorLeerling(q, run.state.nr + 1, run.question_count, run.state.levels[q.topic]) : null });
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

      // niveau bijsturen voor dit onderwerp
      const t = vraag.topic;
      const van = state.levels[t];
      const nieuw = T.nieuwNiveau({ niveau: van, recent: [...(state.recent[t] || []), beoordeling.score], maxNiveau: state.maxLevel[t], instellingen: cfg });
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
        uitslag: beoordeling.score >= 1 ? 'goed' : (beoordeling.score > 0 ? 'deels' : 'fout'),
        uitleg: vraag.explanation || '',
        juist: vraag.type === 'code' ? null : vraag.correct,
        details: beoordeling.details,
        niveauWijziging: nieuw.wijziging ? { topic: topicNaam(t), van, naar: nieuw.niveau } : null,
        volgende: volgende ? T.vraagVoorLeerling(volgende, state.nr + 1, run.question_count, state.levels[volgende.topic]) : null,
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
  const kanAlgemeen = t => !!t && (!t.id || isSuperAdmin(t));
  async function magKlas(req, classId) { return magKlasZien(req, classId); }
  const dagenNaarMs = d => { const n = Number(d); return Number.isFinite(n) && n > 0 ? Date.now() - n * 86400000 : 0; };

  app.get('/api/teacher/training/overview', requireTeacherAuth, async (req, res) => {
    try {
      const classId = String(req.query.classId || '');
      if (!classId || !(await magKlas(req, classId))) return res.status(403).json({ error: 'Geen toegang tot deze klas.' });
      const sinds = dagenNaarMs(req.query.dagen);
      const cfg = await instellingen();
      const leerlingen = await dbModule.getTrainingOverviewForClass(classId, sinds);
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
        text: a.text.slice(0, 300), score: Math.round(a.score * 100) })) });
    } catch (e) { res.status(500).json({ error: 'Kon de antwoorden niet laden.' }); }
  });

  // Pool: aantal vragen per onderwerp en niveau (algemeen + eigen)
  app.get('/api/teacher/training/pool', requireTeacherAuth, async (req, res) => {
    try {
      const rijen = await dbModule.getTrainingPoolCounts(req.teacher.id);
      res.json({ topics: ONDERWERPEN.map(t => ({ id: t.id, name: t.name })), counts: rijen, kanAlgemeenBeheren: kanAlgemeen(req.teacher), heeftAccount: !!req.teacher.id });
    } catch (e) { res.status(500).json({ error: 'Kon de pool niet laden.' }); }
  });

  app.get('/api/teacher/training/questions', requireTeacherAuth, async (req, res) => {
    try {
      const lijst = await dbModule.listTrainingQuestions({ teacherId: req.teacher.id,
        topic: req.query.topic || null, level: req.query.level ? Number(req.query.level) : null });
      res.json({ questions: lijst.map(q => ({ ...q, text: q.text.slice(0, 200) })) });
    } catch (e) { res.status(500).json({ error: 'Kon de vragen niet laden.' }); }
  });

  app.delete('/api/teacher/training/questions/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      const ok = await dbModule.deactivateTrainingQuestion(Number(req.params.id), req.teacher.id, kanAlgemeen(req.teacher));
      res.status(ok ? 200 : 403).json(ok ? { ok: true } : { error: 'Je kan enkel je eigen vragen verwijderen.' });
    } catch (e) { res.status(500).json({ error: 'Kon de vraag niet verwijderen.' }); }
  });

  // JSON-import: eerst controleren (check:true), pas daarna opslaan.
  app.post('/api/teacher/training/import', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      const scope = req.body && req.body.scope === 'general' ? 'general' : 'own';
      if (scope === 'general' && !kanAlgemeen(req.teacher)) return res.status(403).json({ error: 'Enkel de platformbeheerder kan vragen aan de algemene pool toevoegen.' });
      if (scope === 'own' && !req.teacher.id) return res.status(400).json({ error: 'Log in met een eigen account om eigen vragen toe te voegen.' });
      const r = T.valideerImport(req.body && req.body.questions, topicIds);
      if (req.body && req.body.check) return res.json({ geldig: r.geldig.length, fouten: r.fouten.slice(0, 30), totaalFouten: r.fouten.length });
      if (r.fouten.length) return res.status(400).json({ error: 'De import bevat fouten. Los ze eerst op.', fouten: r.fouten.slice(0, 30) });
      const uit = await dbModule.insertTrainingQuestions(r.geldig, scope === 'general' ? null : req.teacher.id, T.vraagHash);
      res.json({ ok: true, ...uit });
    } catch (e) { log.error('[training] import', e); res.status(500).json({ error: 'Kon de vragen niet opslaan.' }); }
  });

  app.get('/api/teacher/training/settings', requireTeacherAuth, async (req, res) => {
    res.json({ instellingen: await instellingen(), mayEdit: kanAlgemeen(req.teacher), standaard: T.STANDAARD_INSTELLINGEN });
  });
  app.put('/api/teacher/training/settings', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      if (!kanAlgemeen(req.teacher)) return res.status(403).json({ error: 'Enkel de platformbeheerder kan de instellingen wijzigen.' });
      const r = T.normaliseerInstellingen(req.body || {});
      if (r.fouten.length) return res.status(400).json({ error: r.fouten.join(' ') });
      await dbModule.setTrainingConfig(r.instellingen);
      res.json({ ok: true, instellingen: r.instellingen });
    } catch (e) { res.status(500).json({ error: 'Kon de instellingen niet opslaan.' }); }
  });

  // ── Eerste keer: onderwerpen + startpool zaaien ──────────────────────────────
  async function zaai() {
    await dbModule.seedTrainingTopics(ONDERWERPEN);
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
