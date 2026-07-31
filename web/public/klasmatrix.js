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
  ).join('') + '<span class="muted">· "Gewettigd afwezig" en "Nog geen lid" tellen niet mee voor het gemiddelde.</span>';
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

  const rijen = _matrix.rijen.map(r => {
    const cellen = kolommen.map(k => {
      const c = r.cellen.find(x => x.code === k.code);
      if (!c) return '<td></td>';
      const info = S[c.status] || {};
      const toon = (c.score !== null && (c.status === 'op_tijd' || c.status === 'te_laat'))
        ? c.score : (info.icoon || '');
      return `<td><span class="cel" style="background:#${esc(info.kleur || 'fff')};"
        title="${esc(info.label || '')}${c.score !== null ? ' · ' + c.score + ' punten' : ''}">${esc(toon)}</span></td>`;
    }).join('');
    // Gemiddelde over de zichtbare kolommen (volgt dus het typefilter).
    const zichtbaar = kolommen.map(k => r.cellen.find(x => x.code === k.code))
      .filter(c => c && c.score !== null && c.status !== 'gewettigd' && c.status !== 'nvt');
    const gem = zichtbaar.length
      ? Math.round((zichtbaar.reduce((n, c) => n + c.score, 0) / zichtbaar.length) * 100) / 100 : '';
    return `<tr><th>${esc(r.naam)}</th>${cellen}<td><strong>${gem}</strong></td></tr>`;
  }).join('');

  doel.innerHTML = `<div class="matrix-wrap"><table class="matrix">
    <thead>${kop}</thead><tbody>${rijen}</tbody></table></div>
    <p class="muted" style="font-size:0.8rem;margin-top:8px;">
      ${_matrix.rijen.length} leerlingen · ${kolommen.length} ${typeFilter ? esc(typeFilter) + 'en' : 'toetsen/taken'}.
      Het gemiddelde volgt het gekozen type.</p>`;
}

laadKlassen();
