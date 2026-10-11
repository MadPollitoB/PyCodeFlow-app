// Sprint 71 — Klasoverzicht: alle toetsen/taken van één klas naast elkaar.
// Gebruikt exact dezelfde statusbepaling als de server (validation.bepaalInleverStatus),
// dus scherm, Excel en het voortgangspaneel kunnen nooit iets anders zeggen.
'use strict';

let _matrix = null;

function esc(x) { const d = document.createElement('div'); d.textContent = x == null ? '' : String(x); return d.innerHTML; }

async function laadKlassen() {
  const sel = document.getElementById('klas-keuze');
  try {
    // Mijn klassen eerst: dat is waar een leerkracht mee werkt.
    const r = await fetch('/api/mijn-klassen');
    const klassen = r.ok ? await r.json() : [];
    if (!klassen.length) {
      sel.innerHTML = '<option value="">Geen klassen gevonden</option>';
      document.getElementById('matrix-inhoud').innerHTML =
        '<p class="muted">Je bent aan geen enkele klas gekoppeld. Vraag je beheerder om je te koppelen (Beheer → Klassen → 🧑‍🏫).</p>';
      return;
    }
    sel.innerHTML = klassen.map(k =>
      `<option value="${esc(k.id)}">${esc(k.name)} (${esc(k.schoolYear)})</option>`).join('');
    sel.addEventListener('change', laadMatrix);
    laadMatrix();
  } catch (e) {
    sel.innerHTML = '<option value="">Kon klassen niet laden</option>';
  }
}

async function laadMatrix() {
  const classId = document.getElementById('klas-keuze').value;
  const doel = document.getElementById('matrix-inhoud');
  if (!classId) return;
  doel.innerHTML = '<p class="muted">Laden…</p>';
  document.getElementById('excel-knop').href =
    '/api/klasmatrix/export.xlsx?classId=' + encodeURIComponent(classId);
  try {
    const r = await fetch('/api/klasmatrix?classId=' + encodeURIComponent(classId));
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    _matrix = await r.json();
    tekenLegende();
    tekenMatrix();
  } catch (e) {
    doel.innerHTML = '<p class="muted">Kon het overzicht niet laden: ' + esc(e.message) + '</p>';
  }
}

function tekenLegende() {
  const S = _matrix?.statussen || {};
  document.getElementById('legende').innerHTML = Object.values(S).map(info =>
    `<span class="item"><i style="background:#${esc(info.kleur)};"></i>${esc(info.icoon)} ${esc(info.label)}</span>`
  ).join('') + '<span class="muted">· "Gewettigd afwezig" en "Nog geen lid" tellen niet mee voor het gemiddelde ' +
    '(🚫 "auto-ingediend (tabwissel)" telt wél mee).</span>';
}

function tekenMatrix() {
  if (!_matrix) return;
  const doel = document.getElementById('matrix-inhoud');
  const S = _matrix.statussen || {};
  const typeFilter = document.getElementById('type-keuze').value;
  const kolommen = _matrix.kolommen.filter(k => !typeFilter || k.type === typeFilter);

  if (!kolommen.length) {
    doel.innerHTML = '<p class="muted">Voor deze klas zijn er nog geen ' +
      (typeFilter ? esc(typeFilter) + 'en' : 'toetsen of taken') + '.</p>';
    return;
  }

  const kop = '<tr><th>Leerling</th>' + kolommen.map(k =>
    `<th title="${esc(k.naam)}">${k.type === 'taak' ? '📝' : '🧪'} ${esc(k.naam.length > 22 ? k.naam.slice(0, 21) + '…' : k.naam)}
      <br/><span class="muted" style="font-weight:400;">${new Date(k.datum).toLocaleDateString('nl-BE')}</span></th>`
  ).join('') + '<th>Gemiddelde</th></tr>';

  // Sprint 64: testaccounts staan hier apart — geen aparte matrix-tabel nodig, wél
  // duidelijk gescheiden van de rest (zelfde reden als bij het nakijkscherm: dit zijn
  // geen "echte" leerlingen voor statistiekdoeleinden).
  const gewoneRijen = _matrix.rijen.filter(r => !r.isTestAccount);
  const testRijen = _matrix.rijen.filter(r => r.isTestAccount);

  function bouwRij(r) {
    const cellen = kolommen.map(k => {
      const c = r.cellen.find(x => x.code === k.code);
      if (!c) return '<td></td>';
      const info = S[c.status] || {};
      // Sprint 84: 'tab_switch' (auto-ingediend door anti-spiek) telt ook mee voor het
      // gemiddelde (zie de filter hieronder) — toon dan ook het cijfer, niet enkel het
      // icoon, anders lijkt de cel leeg terwijl ze wél meetelt.
      const toon = (c.score !== null && (c.status === 'op_tijd' || c.status === 'te_laat' || c.status === 'tab_switch'))
        ? c.score : (info.icoon || '');
      // v111: "niets ingeleverd" kan hier met één klik op gewettigd afwezig gezet worden
      // (en terug); enkel bij wie niets indiende, een leerling met inhoud blijft ongemoeid.
      const klikbaar = (c.status === 'niets' || c.status === 'gewettigd') && !r.isTestAccount;
      const aan = c.status === 'niets';
      const klikAttr = klikbaar
        ? ` data-code="${esc(c.code)}" data-student="${esc(r.id)}" data-naam="${esc(r.naam)}" data-aan="${aan ? '1' : '0'}" role="button" tabindex="0" style="cursor:pointer;"`
        : '';
      const hint = klikbaar ? (aan ? ' · klik om gewettigd afwezig te zetten' : ' · klik om af te zetten') : '';
      return `<td><span class="cel${klikbaar ? ' afw-klik' : ''}"${klikAttr} style="background:#${esc(info.kleur || 'fff')};${klikbaar ? 'cursor:pointer;' : ''}"
        title="${esc(info.label || '')}${c.score !== null ? ' · ' + c.score + ' punten' : ''}${hint}">${esc(toon)}</span></td>`;
    }).join('');
    // Gemiddelde over de zichtbare kolommen (volgt dus het typefilter).
    const zichtbaar = kolommen.map(k => r.cellen.find(x => x.code === k.code))
      .filter(c => c && c.score !== null && c.status !== 'gewettigd' && c.status !== 'nvt');
    const gem = zichtbaar.length
      ? Math.round((zichtbaar.reduce((n, c) => n + c.score, 0) / zichtbaar.length) * 100) / 100 : '';
    return `<tr><th>${esc(r.naam)}</th>${cellen}<td><strong>${gem}</strong></td></tr>`;
  }

  const rijen = gewoneRijen.map(bouwRij).join('');
  const testRijenHtml = testRijen.map(bouwRij).join('');

  doel.innerHTML = `<div class="matrix-wrap"><table class="matrix">
    <thead>${kop}</thead><tbody>${rijen}</tbody></table></div>
    <p class="muted" style="font-size:0.8rem;margin-top:8px;">
      ${gewoneRijen.length} leerlingen · ${kolommen.length} ${typeFilter ? esc(typeFilter) + 'en' : 'toetsen/taken'}.
      Het gemiddelde volgt het gekozen type.</p>
    ${testRijen.length ? `
    <div style="margin-top:22px;padding:14px 16px;background:#fdf3d1;border:1.5px solid #e6c860;border-radius:12px;">
      <div style="font-weight:700;margin-bottom:8px;">🧪 Testaccounts <span class="muted" style="font-weight:400;">(tellen niet mee in de gemiddelden/statistieken hierboven)</span></div>
      <div class="matrix-wrap"><table class="matrix"><thead>${kop}</thead><tbody>${testRijenHtml}</tbody></table></div>
    </div>` : ''}`;
}

// v111: gewettigd afwezig aan/uit vanuit de scores (enkel voor wie niets inleverde).
async function zetAfwezigVanuitMatrix(code, studentId, naam, aan) {
  const ok = window.pyConfirm
    ? await window.pyConfirm({
        title: aan ? 'Gewettigd afwezig?' : 'Afwezigheid ongedaan maken?',
        body: aan ? `"${naam}" als gewettigd afwezig zetten voor deze toets/taak? Dit telt dan niet mee voor het gemiddelde.`
                  : `"${naam}" niet langer als gewettigd afwezig beschouwen? Dit telt dan weer mee als niets ingeleverd (0).`,
        confirmLabel: aan ? 'Afwezig zetten' : 'Ongedaan maken',
      })
    : true;
  if (!ok) return;
  try {
    const f = window.apiFetch || fetch;
    const r = await f('/api/quiz-sessions/' + encodeURIComponent(code) + '/roster/' + encodeURIComponent(studentId) + '/status', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: aan ? 'gewettigd' : null }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    await laadMatrix();
  } catch (e) {
    await window.pyAlert('Kon de afwezigheid niet bewaren: ' + e.message, 'error');
  }
}
document.addEventListener('click', ev => {
  const el = ev.target.closest && ev.target.closest('.afw-klik');
  if (el) zetAfwezigVanuitMatrix(el.dataset.code, el.dataset.student, el.dataset.naam, el.dataset.aan === '1');
});
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const el = ev.target.closest && ev.target.closest('.afw-klik');
  if (el) { ev.preventDefault(); zetAfwezigVanuitMatrix(el.dataset.code, el.dataset.student, el.dataset.naam, el.dataset.aan === '1'); }
});

laadKlassen();
