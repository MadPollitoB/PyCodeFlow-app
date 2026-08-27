#!/usr/bin/env node
/**
 * PyCodeFlow — AI-trainingsdata exporteren (sprint 51-ai v5)
 *
 * Verzamelt alle bruikbare correctie-voorbeelden (expliciete leerkracht-feedback mét
 * correctie, en stille correcties bij handmatige aanpassingen) en zet ze om naar een
 * JSONL-bestand met {prompt, completion}-paren — hetzelfde promptformaat als het
 * AI-verbeteren zelf gebruikt (via lib/ai-grading.js:bouwPrompt), zodat een latere
 * fine-tuning zo dicht mogelijk aansluit bij hoe het model in de praktijk aangeroepen wordt.
 *
 * Wordt aangeroepen vanuit scripts/app/pycodeflow.sh (menu AI-training → downloaden), via
 * `docker exec pycodeflow-web-1 node scripts/export-ai-training.js <output-pad>`.
 *
 * Bewust GEEN HTTP-endpoint met sessie-authenticatie: dit draait binnen de container zelf
 * (via docker exec, wat al toegang tot de NAS vereist), dus geen aparte login-stap nodig
 * vanuit een bash-script.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const { bouwPrompt } = require('../lib/ai-grading');

// Sprint 51-ai (v5): bouwt één trainingsvoorbeeld — geeft null terug als er te weinig
// bruikbare informatie is (bv. geen leerlingantwoord), zodat lege/kapotte rijen de export
// niet vervuilen.
function bouwVoorbeeld(rij, { humanScore, humanComment }) {
  if (!rij.vraagstelling || humanScore === null || humanScore === undefined) return null;
  const prompt = bouwPrompt({
    type: rij.vraag_type,
    vraagstelling: rij.vraagstelling,
    modelAntwoord: rij.model_antwoord || '',
    leerlingAntwoord: rij.leerling_antwoord || '',
    uitvoerResultaat: rij.uitvoer_resultaat || null,
    modelUitvoerResultaat: rij.model_uitvoer_resultaat || null,
    maxPunten: rij.max_punten || 1,
  });
  // Sprint 51-fix: het "redenering"-veld van de AI zelf wordt bewust nooit bewaard (zie
  // lib/ai-grading.js) — voor een trainingsvoorbeeld gebruiken we het menselijke commentaar
  // ook als redenering-stand-in. Niet perfect, maar functioneel: het traint het model
  // vooral om tot de JUISTE score/commentaar te komen, wat het doel is.
  const completion = JSON.stringify({
    redenering: humanComment ? humanComment.slice(0, 200) : 'Gecontroleerd door de leerkracht.',
    score: Number(humanScore),
    comment: humanComment || '',
  });
  return { prompt, completion };
}

async function main() {
  const outputPad = process.argv[2] || path.join(__dirname, '../ai-training-export.jsonl');
  const { feedback, corrections } = await db.getAiTrainingExamples();

  const voorbeelden = [];
  for (const rij of feedback) {
    // "goed" bevestigt het AI-antwoord zelf als correct label; "kon_beter" gebruikt de
    // expliciete correctie (enkel rijen met corrected_score komen hier binnen, zie de
    // WHERE-clausule in getAiTrainingExamples).
    const humanScore = rij.verdict === 'goed' ? rij.ai_score : rij.corrected_score;
    const humanComment = rij.verdict === 'goed' ? rij.ai_comment : rij.corrected_comment;
    const voorbeeld = bouwVoorbeeld(rij, { humanScore, humanComment });
    if (voorbeeld) voorbeelden.push(voorbeeld);
  }
  for (const rij of corrections) {
    const voorbeeld = bouwVoorbeeld(rij, { humanScore: rij.human_score, humanComment: rij.human_comment });
    if (voorbeeld) voorbeelden.push(voorbeeld);
  }

  const jsonl = voorbeelden.map(v => JSON.stringify(v)).join('\n') + (voorbeelden.length ? '\n' : '');
  fs.writeFileSync(outputPad, jsonl, 'utf8');

  // Klein, leesbaar samenvattingsbestand ernaast — handig om snel te zien of er genoeg
  // materiaal is voordat je de moeite van een trainingsavond neemt.
  const samenvattingPad = outputPad.replace(/\.jsonl$/, '') + '-samenvatting.txt';
  const samenvatting = [
    `PyCodeFlow — AI-trainingsdata-export`,
    `Gegenereerd: ${new Date().toISOString()}`,
    ``,
    `Aantal trainingsvoorbeelden: ${voorbeelden.length}`,
    `  - uit expliciete feedback (goed/kon beter): ${feedback.length}`,
    `  - uit stille correcties (handmatige aanpassing van een AI-score): ${corrections.length}`,
    ``,
    voorbeelden.length < 20
      ? `⚠️  Nog vrij weinig voorbeelden. Fine-tunen op een kleine dataset kan het model`
        + `\n    eerder ONNAUWKEURIGER maken dan beter (overfitting) — overweeg te wachten`
        + `\n    tot je meer feedback/correcties verzameld hebt (richtwaarde: op zijn minst`
        + `\n    enkele tientallen, liever meer).`
      : `Aantal voorbeelden lijkt redelijk voor een eerste trainingspoging.`,
  ].join('\n');
  fs.writeFileSync(samenvattingPad, samenvatting, 'utf8');

  console.log(`✅ ${voorbeelden.length} trainingsvoorbeelden geëxporteerd naar ${outputPad}`);
  console.log(samenvatting);
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Export mislukt:', e.message);
  process.exit(1);
});
