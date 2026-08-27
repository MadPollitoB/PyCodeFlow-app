// ═══════════════════════════════════════════════════════════════════════════════
// PyCodeFlow — AI-verbeteren via een lokale Ollama-server (sprint 51-ai, v2)
//
// Bewust een LOKALE AI (Ollama, geen cloud-dienst): leerlingantwoorden verlaten hierdoor
// nooit het eigen netwerk. Ollama draait als eigen dienst (bv. in Docker naast deze app) en
// biedt een simpele HTTP-API met "structured output" — we vragen een JSON-schema af, zodat
// we een betrouwbare {score, comment} terugkrijgen i.p.v. vrije tekst te moeten parsen.
//
// Enkel open- en code-vragen worden hiermee nagekeken (keuzevragen zijn al automatisch
// scoorbaar, zie lib/scoring.js). Bij een code-vraag wordt zowel de leerlingcode ALS de
// modeloplossing echt uitgevoerd door de bestaande sandbox-runner, en BEIDE werkelijke
// uitvoerresultaten aan het model meegegeven — de AI hoeft dan enkel twee teksten naast
// elkaar te leggen, in plaats van zelf te moeten "berekenen" wat de juiste uitvoer zou
// moeten zijn. Dat laatste bleek voor een lokaal, CPU-gebonden model te foutgevoelig (bv.
// een off-by-one-fout in een range() die toch als 100% correct werd beoordeeld).
//
// BELANGRIJK (leerkracht-only): het commentaar dat hier terugkomt is PUUR, gewone tekst —
// zonder enige AI-markering erin. Of een score van de AI komt, wordt UITSLUITEND
// bijgehouden via de aparte ai_graded/part_ai_graded-kolommen (zie db/database.js), die
// enkel door leerkracht-gerichte endpoints worden meegestuurd. Zo ziet de leerling gewoon
// zijn score en commentaar, precies zoals bij een score die de leerkracht zelf typte.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b';
// Ruime, maar niet oneindige timeout — CPU-only inferentie op bescheiden hardware kan
// traag zijn; een enkel antwoord mag lang duren, een hele klas draait toch al als
// achtergrondtaak. Iets ruimer dan voorheen: het redenering-veld (zie hieronder) kost
// het model wat extra tijd, in ruil voor een nauwkeuriger score.
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) || 150000;

// Sprint 51-ai (v2): een "redenering"-veld VÓÓR score/comment in het schema — het model
// moet dus eerst kort onder woorden brengen wat wel/niet klopt, voordat het een getal
// kiest. Dit is een lichte vorm van chain-of-thought via structured output: dwingt het
// model om zijn eigen conclusie te funderen in plaats van meteen een score te "raden",
// wat merkbaar nauwkeuriger bleek — vooral bij code waar de uitvoer net iets afwijkt.
const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    redenering: { type: 'string', description: 'Korte, interne analyse (1-3 zinnen): wat klopt er, wat niet? Bij code: komt de uitvoer van de leerling exact overeen met de uitvoer van de modeloplossing? Dit veld wordt NOOIT aan de leerling getoond.' },
    score: { type: 'number', description: 'Score, een getal tussen 0 en het maximum aantal punten (mag decimalen bevatten), gebaseerd op de redenering hierboven.' },
    comment: { type: 'string', description: 'Kort, opbouwend commentaar voor de leerling in het Nederlands (1-3 zinnen). Geen verwijzing naar AI, automatische beoordeling, of het interne redenering-veld.' },
  },
  required: ['redenering', 'score', 'comment'],
};

const ALGEMEEN_SCHEMA = {
  type: 'object',
  properties: {
    comment: { type: 'string', description: 'Kort, samenvattend en opbouwend algemeen commentaar voor de leerling in het Nederlands (1-3 zinnen), gebaseerd op zijn score en de per-vraag commentaren.' },
  },
  required: ['comment'],
};

function bouwPrompt({ type, vraagstelling, modelAntwoord, leerlingAntwoord, uitvoerResultaat, modelUitvoerResultaat, maxPunten, verbeterNotities }) {
  const delen = [];
  delen.push(`Je bent een ervaren, vriendelijke ${type === 'code' ? 'Python-' : ''}leerkracht die het werk van een leerling nakijkt.`);
  delen.push(`Vraag: ${vraagstelling || '(geen vraagtekst)'}`);
  if (modelAntwoord && modelAntwoord.trim()) {
    delen.push(`${type === 'code' ? 'Modeloplossing (referentie, er kunnen ook andere correcte oplossingen zijn)' : 'Modelantwoord (referentie)'}:\n${modelAntwoord}`);
  }
  delen.push(`Antwoord van de leerling:\n${leerlingAntwoord && leerlingAntwoord.trim() ? leerlingAntwoord : '(niets ingevuld)'}`);
  if (type === 'code') {
    if (modelUitvoerResultaat) {
      delen.push(`Werkelijke uitvoer van de MODELOPLOSSING (door het systeem uitgevoerd — dit is de correcte, verwachte uitvoer):\n${modelUitvoerResultaat.slice(0, 2000)}`);
    }
    if (uitvoerResultaat) {
      delen.push(`Werkelijke uitvoer van de code van de LEERLING (door het systeem uitgevoerd, dus betrouwbaar):\n${uitvoerResultaat.slice(0, 2000)}`);
    }
  }
  delen.push(`Dit onderdeel is maximaal ${maxPunten} punt(en) waard.`);
  if (type === 'code') {
    delen.push('Beoordeel de code in deze volgorde: (1) komt de werkelijke uitvoer van de leerling EXACT overeen met de werkelijke uitvoer van de modeloplossing hierboven? Vergelijk de twee uitvoer-teksten letterlijk, teken voor teken en regel voor regel — reken zelf niets opnieuw uit, en verzin geen inhoud die niet letterlijk in de uitvoer-teksten hierboven staat. (2) Is de logica/aanpak verder correct, ook als de stijl verschilt van de modeloplossing? Kleine stijlverschillen zijn geen fout zolang de code werkt EN de uitvoer klopt.');
    delen.push('BELANGRIJK: een afwijkende uitvoer (zelfs een klein verschil, bv. één regel te veel of te weinig, een verkeerde grens, tekst op aparte regels i.p.v. op één regel, een typfout) betekent ALTIJD puntenverlies naar rato van hoe groot de code-logica wél correct is — nooit automatisch 0 punten als de kernaanpak/lus/logica grotendeels klopt, en nooit de volle punten als de uitvoer niet exact overeenkomt. Benoem in je commentaar EXACT en CONCREET wat het echte verschil is tussen de twee uitvoer-teksten (bijvoorbeeld: "je code print elk teken op een eigen regel in plaats van de volledige tekst op één regel", of "je range loopt tot en met 9 in plaats van tot en met 10") — nooit een vage of verzonnen inhoudelijke vergelijking. Gebruik zinnen als "geen puntenverlies" of "dit is geen fout" ENKEL als dat werkelijk klopt voor dit specifieke geval — niet als standaardformulering.');
  } else {
    delen.push('Beoordeel of het antwoord inhoudelijk correct en volledig is. BELANGRIJK: trek NOOIT punten af voor spelling-, schrijf- of taalfouten — enkel de inhoudelijke juistheid telt. Is de tekst begrijpelijk en beantwoordt ze de vraag inhoudelijk correct, dan is dat voldoende voor de volle punten, ook bij slordige spelling of formulering. Je mag in je commentaar wel de correcte schrijfwijze of een vlottere formulering voorstellen, maar dat mag nooit de score beïnvloeden. Geef wel minder punten voor een antwoord dat inhoudelijk onvolledig of onjuist is, en benoem concreet wat er inhoudelijk ontbreekt of fout is.');
  }
  // Sprint 51-ai (v4): eerdere correcties van de leerkracht op AI-scores van DEZELFDE vraag —
  // een lichte, in-context "leer"-stap (geen echte model-training). Helpt vooral om
  // herhaalde fouten (zoals een te soepele/onnauwkeurige beoordeling) te vermijden.
  if (Array.isArray(verbeterNotities) && verbeterNotities.length) {
    delen.push('Let op — bij eerdere nakijkbeurten van DEZE vraag gaf de leerkracht deze correcties op de AI-beoordeling mee, hou hier rekening mee:\n' +
      verbeterNotities.map(n => `- ${n}`).join('\n'));
  }
  delen.push('Vul eerst het redenering-veld in met je analyse, bepaal DAARNA pas de score op basis van die redenering. Schrijf het zichtbare commentaar alsof de leerkracht het zelf typte, rechtstreeks aan de leerling gericht ("je hebt...", "je code..."): geen verwijzing naar AI, automatische beoordeling, of een taalmodel. Bij een leeg antwoord: score 0 en een neutrale opmerking dat er niets werd ingevuld.');
  return delen.join('\n\n');
}

function bouwAlgemeenPrompt({ studentNaam, totaalScore, maxTotaal, vraagResultaten }) {
  const delen = [];
  delen.push('Je bent een ervaren, vriendelijke leerkracht die een kort, samenvattend algemeen commentaar schrijft onderaan een nagekeken toets.');
  delen.push(`De leerling behaalde ${totaalScore} van de ${maxTotaal} punten.`);
  if (vraagResultaten && vraagResultaten.length) {
    delen.push('Per-vraag resultaten (jouw eigen, eerder gegeven commentaren):\n' +
      vraagResultaten.map((v, i) => `Vraag ${i + 1} (${v.score}/${v.punten}): ${v.commentaar}`).join('\n'));
  }
  delen.push('Schrijf een kort (1-3 zinnen), opbouwend algemeen commentaar voor de leerling — gericht aan "je", in vlotte, natuurlijke spreektaal zoals een leerkracht dat er handmatig zou neerschrijven (geen opsomming, geen stijve/formele zinnen, geen verwijzing naar AI of automatische beoordeling). Vat het geheel samen, benoem een sterk punt en (indien relevant) een concreet aandachtspunt voor de volgende keer.');
  return delen.join('\n\n');
}

// Interne helper: roept Ollama aan met een gegeven prompt+schema, valideert het
// antwoord niet verder dan JSON-parsing (de aanroepers doen hun eigen validatie).
async function _ollamaChat(prompt, schema) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      format: schema,
      options: { temperature: 0.2 }, // laag: consistente, voorspelbare beoordelingen
    }),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Ollama gaf status ${res.status} terug`);
  const data = await res.json();
  const inhoud = data?.message?.content;
  if (!inhoud) throw new Error('Ollama gaf geen antwoord-inhoud terug');
  try { return JSON.parse(inhoud); }
  catch { throw new Error('Ollama-antwoord was geen geldige JSON'); }
}

// Roept Ollama aan met het gevraagde JSON-schema. Retourneert { score, comment } of gooit
// een fout (de aanroeper vangt dat op en slaat dat specifieke antwoord gewoon over — één
// falend antwoord mag een hele verbeter-batch niet laten stoppen). Het redenering-veld
// wordt bewust NIET teruggegeven aan de aanroeper — het dient enkel om het model tot een
// beter gefundeerde score te leiden, niet om te bewaren of te tonen.
async function gradeAnswer(opties) {
  const prompt = bouwPrompt(opties);
  const maxPunten = Number(opties.maxPunten) || 1;
  const parsed = await _ollamaChat(prompt, SCORE_SCHEMA);

  // Applicatie-laag-validatie: het "format"-schema is een sterke hint, geen garantie —
  // we vertrouwen het dus niet blind.
  let score = Number(parsed.score);
  if (!Number.isFinite(score)) throw new Error('Ollama gaf geen geldig getal als score');
  score = Math.max(0, Math.min(maxPunten, score));
  score = Math.round(score * 4) / 4; // afronden op kwart punten, geen valse precisie

  const comment = String(parsed.comment || '').trim().slice(0, 1000);
  return { score, comment: comment || '(geen commentaar gegenereerd)' };
}

// Sprint 51-ai (v2): genereert het ALGEMENE commentaar voor een leerling, gebaseerd op zijn
// totaalscore en de per-vraag commentaren die de AI (of de leerkracht) eerder al gaf.
// Geeft null terug bij een fout — de aanroeper laat het algemene-commentaarveld dan
// gewoon leeg in plaats van de hele batch te laten stoppen.
async function generateGeneralComment(opties) {
  try {
    const prompt = bouwAlgemeenPrompt(opties);
    const parsed = await _ollamaChat(prompt, ALGEMEEN_SCHEMA);
    const comment = String(parsed.comment || '').trim().slice(0, 1000);
    return comment || null;
  } catch {
    return null;
  }
}

// Korte bereikbaarheids-check — gebruikt door het endpoint dat de popup vult, zodat de
// leerkracht meteen een duidelijke fout ziet als Ollama niet bereikbaar/geconfigureerd is,
// in plaats van pas te falen nadat hij al "Starten" heeft geklikt.
async function checkOllamaBeschikbaar() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, reason: `Ollama gaf status ${res.status} terug` };
    const data = await res.json();
    const modellen = (data.models || []).map(m => m.name || m.model);
    const modelAanwezig = modellen.some(m => m === OLLAMA_MODEL || m.startsWith(OLLAMA_MODEL.split(':')[0]));
    if (!modelAanwezig) {
      return { ok: false, reason: `Model "${OLLAMA_MODEL}" niet gevonden op Ollama. Beschikbaar: ${modellen.join(', ') || '(geen)'}` };
    }
    return { ok: true, model: OLLAMA_MODEL };
  } catch (e) {
    return { ok: false, reason: `Ollama niet bereikbaar op ${OLLAMA_URL}: ${e.message}` };
  }
}

module.exports = { gradeAnswer, generateGeneralComment, checkOllamaBeschikbaar, bouwPrompt, OLLAMA_MODEL, OLLAMA_URL };
