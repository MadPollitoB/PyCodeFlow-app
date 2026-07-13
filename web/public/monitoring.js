// PyCodeFlow — geëxtraheerd uit monitoring.html (sprint 32a)
// Inline scripts naar apart bestand voor onderhoudbaarheid + CSP (30b).

(function () {
  function fmt(bytes) {
    if (!bytes) return '0 MB';
    if (bytes > 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    return (bytes / 1048576).toFixed(0) + ' MB';
  }

  function setBar(id, ratio, valId, label) {
    const pct = Math.min(100, Math.max(0, ratio * 100));
    const fill = document.getElementById(id);
    const val  = document.getElementById(valId);
    if (!fill) return;
    fill.style.width = pct + '%';
    fill.className = 'mon-bar-fill' + (pct >= 80 ? ' danger' : pct >= 55 ? ' warn' : '');
    if (val) val.textContent = label;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setHealth(level, text) {
    const banner = document.getElementById('health-banner');
    const dot    = document.getElementById('health-dot');
    const txt    = document.getElementById('health-text');
    if (!banner) return;
    banner.className = 'status-box status-' + (level === 'ok' ? 'success' : level === 'warn' ? 'warning' : 'error');
    dot.className = 'health-dot ' + (level === 'ok' ? 'green' : level === 'warn' ? 'orange' : 'red');
    txt.textContent = text;
  }

  function renderSessions(sessions) {
    const tbody = document.getElementById('session-tbody');
    if (!sessions.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-table">Geen actieve sessies.</td></tr>';
      return;
    }
    tbody.innerHTML = sessions.map(s => {
      const runRatio = s.total > 0 ? s.running / s.total : 0;
      const pct = Math.round(runRatio * 100);
      const fillClass = pct >= 80 ? 'danger' : pct >= 50 ? 'warn' : '';
      const statusBadge = s.blocked
        ? '<span class="badge badge-warn">geblokkeerd</span>'
        : '<span class="badge badge-success">actief</span>';
      return `<tr>
        <td><strong>${s.name}</strong><br/><span class="muted" style="font-size:0.8rem;">${s.code}</span></td>
        <td>${s.mode === 'exam' ? 'Examen' : s.mode === 'quiz' ? 'Toets' : s.mode === 'task' ? 'Taak' : 'Klas'}</td>
        <td>${s.online} / ${s.total}</td>
        <td>
          <div class="run-mini-bar">
            <div class="run-mini-track"><div class="run-mini-fill ${fillClass}" style="width:${pct}%"></div></div>
            <span style="font-size:0.8rem; color:var(--muted); white-space:nowrap;">${s.running} actief</span>
          </div>
        </td>
        <td>${statusBadge}</td>
      </tr>`;
    }).join('');
  }

  function renderHistoryChart(history) {
    const canvas = document.getElementById('history-chart');
    if (!canvas || !history.length) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth || 600;
    const H = 80;
    canvas.width  = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    const maxRuns  = Math.max(18, ...history.map(h => h.activeRuns), ...history.map(h => h.queuedRuns), 1);
    const pad = { l: 4, r: 4, t: 6, b: 4 };
    const chartW = W - pad.l - pad.r;
    const chartH = H - pad.t - pad.b;
    const xStep  = history.length > 1 ? chartW / (history.length - 1) : chartW;

    function drawLine(data, color) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      data.forEach((val, i) => {
        const x = pad.l + i * xStep;
        const y = pad.t + chartH - (val / maxRuns) * chartH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Grid lijn bij 75%
    const gridY = pad.t + chartH * 0.25;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.moveTo(pad.l, gridY); ctx.lineTo(W - pad.r, gridY);
    ctx.stroke();
    ctx.setLineDash([]);

    drawLine(history.map(h => h.activeRuns),  '#334ea2');
    drawLine(history.map(h => h.queuedRuns),  '#e25830');
  }

  async function refresh() {
    try {
      const res = await fetch('/api/monitoring', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();

      const r = d.runner;
      const w = d.web;
      const sys = d.system;

      // Runner runs
      const runRatio   = r.maxRuns   > 0 ? r.activeRuns  / r.maxRuns   : 0;
      const queueRatio = r.maxQueue  > 0 ? r.queuedRuns  / r.maxQueue  : 0;
      const rMemRatio  = r.memoryMaxBytes > 0 ? r.memoryBytes / r.memoryMaxBytes : 0;
      const wMemRatio  = w.memoryMaxBytes > 0 ? w.memoryBytes / w.memoryMaxBytes : 0;

      setBar('bar-runs',  runRatio,   'bar-runs-val',  `${r.activeRuns} / ${r.maxRuns}`);
      setBar('bar-queue', queueRatio, 'bar-queue-val', `${r.queuedRuns} / ${r.maxQueue}`);
      setBar('bar-rmem',  rMemRatio,  'bar-rmem-val',  `${fmt(r.memoryBytes)} / ${fmt(r.memoryMaxBytes)}`);
      setBar('bar-wmem',  wMemRatio,  'bar-wmem-val',  `${fmt(w.memoryBytes)} / ${fmt(w.memoryMaxBytes)}`);

      setText('stat-peak-runs',    String(r.peakRuns));
      setText('stat-peak-queue',   String(r.peakQueue));
      setText('stat-runner-cpu',   r.cpuPercent != null ? r.cpuPercent.toFixed(1) + '%' : '—');
      setText('stat-runner-mem-max', fmt(r.memoryMaxBytes));
      setText('stat-host-free',    fmt(sys.freeMemBytes));
      setText('stat-host-total',   fmt(sys.totalMemBytes));
      setText('stat-load',         sys.loadAvg ? sys.loadAvg[0].toFixed(2) : '—');
      setText('stat-free-total',   String(d.free.total));
      setText('stat-free-running', String(d.free.running));

      // Gezondheid
      const danger = runRatio >= 0.9 || queueRatio >= 0.6 || rMemRatio >= 0.85;
      const warn   = runRatio >= 0.75 || queueRatio >= 0.35 || rMemRatio >= 0.7;
      if (danger) {
        setHealth('error', '⚠️ Zware belasting — runner zit dicht bij zijn limiet. Overweeg actie.');
      } else if (warn) {
        setHealth('warn', '⚡ Merkbare belasting — hou de wachtrij in de gaten.');
      } else {
        setHealth('ok', '✓ Alles loopt vlot — voldoende marge voor de huidige belasting.');
      }

      renderSessions(d.sessions || []);
      renderHistoryChart(d.history || []);

      const now = new Date();
      setText('last-update', now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));

    } catch (err) {
      setHealth('error', `Monitoring niet bereikbaar: ${err.message}`);
    }
  }

  async function refreshAutocheck() {
    try {
      const res = await fetch('/api/stress-test/autocheck-status', { cache: 'no-store' });
      if (!res.ok) return;
      const d = await res.json();
      const badge = document.getElementById('autocheck-badge');
      if (!badge) return;
      if (!d.lastAutocheck) {
        badge.textContent = 'Autocheck: nog niet uitgevoerd (volgende om 06:00)';
        return;
      }
      const ac = d.lastAutocheck;
      const dt = new Date(ac.timestamp).toLocaleString('nl-BE', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      const icon = ac.ok ? '✅' : '❌';
      badge.innerHTML = `Autocheck ${dt}: ${icon} ${ac.passed}/${ac.total} (${ac.pct}%)` +
        (ac.logFilename ? ` &nbsp;<a href="/api/stress-test/logs/${encodeURIComponent(ac.logFilename)}" style="color:var(--primary); font-weight:700;" download>log</a>` : '');
      badge.style.color = ac.ok ? 'var(--success-fg)' : 'var(--error-fg)';
    } catch(e) { /* stil falen */ }
  }

  refresh();
  refreshAutocheck();
  setInterval(refresh, 3000);
  setInterval(refreshAutocheck, 60000); // autocheck badge elke minuut verversen
})();

/* ─── volgend script-blok ─── */

(function () {
  let stressEventSource = null;
  let resultCount = 0;
  let progressTotal = 1;

  // Toon/verberg parameters op basis van geselecteerde test
  // Load preview en max-safe knop
  function updateLoadPreview() {
    const type = document.getElementById('stress-type').value;
    const concEl = document.getElementById('stress-concurrency');
    const sessEl = document.getElementById('stress-sessions');
    const rpsEl  = document.getElementById('stress-runs-per-session');
    const banner = document.getElementById('load-preview-banner');
    if (!banner) return;

    let totalRuns = 0;
    if (concEl && ['runner-capaciteit','ramp-up','sustained','memory-leak','aangepast'].includes(type)) {
      totalRuns = parseInt(concEl.value || 10);
    } else if (sessEl && rpsEl && ['multi-sessie','aangepast'].includes(type)) {
      totalRuns = parseInt(sessEl.value || 3) * parseInt(rpsEl.value || 5);
    }

    if (!totalRuns) { banner.style.display = 'none'; return; }
    banner.style.display = 'block';
    const pct = Math.round((totalRuns / 18) * 100);
    if (pct >= 90) {
      banner.style.background = 'var(--error-bg)'; banner.style.color = 'var(--error-fg)';
      banner.textContent = `⚠️ ${totalRuns} runs = ~${pct}% van de runner capaciteit — kans op wachtrij`;
    } else if (pct >= 60) {
      banner.style.background = 'var(--warn-bg)'; banner.style.color = 'var(--warn-fg)';
      banner.textContent = `⚡ ${totalRuns} runs = ~${pct}% van de runner capaciteit — merkbare belasting`;
    } else {
      banner.style.background = 'var(--success-bg)'; banner.style.color = 'var(--success-fg)';
      banner.textContent = `✓ ${totalRuns} runs = ~${pct}% van de runner capaciteit — comfortabel`;
    }
  }

  window.setMaxSafeParams = function() {
    const concEl = document.getElementById('stress-concurrency');
    const valEl  = document.getElementById('concurrency-val');
    if (concEl) { concEl.value = 14; if (valEl) valEl.textContent = '14'; }
    const sessEl = document.getElementById('stress-sessions');
    const sessValEl = document.getElementById('sessions-val');
    if (sessEl) { sessEl.value = 3; if (sessValEl) sessValEl.textContent = '3'; }
    const rpsEl = document.getElementById('stress-runs-per-session');
    const rpsValEl = document.getElementById('runs-val');
    if (rpsEl) { rpsEl.value = 6; if (rpsValEl) rpsValEl.textContent = '6'; }
    updateLoadPreview();
  };

  document.getElementById('stress-type').addEventListener('change', function () {
    const t = this.value;
    document.getElementById('param-concurrency').style.display =
      ['runner-capaciteit','ramp-up','sustained','memory-leak','aangepast','volledig','websocket'].includes(t) ? '' : 'none';
    document.getElementById('param-sessions').style.display =
      ['multi-sessie','aangepast','volledig'].includes(t) ? '' : 'none';
    const durEl = document.getElementById('param-duration');
    if (durEl) durEl.style.display = ['sustained','ramp-up','aangepast'].includes(t) ? '' : 'none';
    updateLoadPreview();
  });

  window.startStressTest = async function () {
    const type           = document.getElementById('stress-type').value;
    const concurrencyEl  = document.getElementById('stress-concurrency');
    const sessionsEl     = document.getElementById('stress-sessions');
    const rpsEl          = document.getElementById('stress-runs-per-session');
    const durationEl     = document.getElementById('stress-duration');
    const concurrency    = parseInt(concurrencyEl?.value || '10');
    const numSessions    = parseInt(sessionsEl?.value    || '3');
    const runsPerSession = parseInt(rpsEl?.value         || '5');
    const durationSec    = parseInt(durationEl?.value    || '60');

    // Reset UI
    resultCount = 0;
    document.getElementById('stress-results-list').innerHTML = '';
    document.getElementById('stress-log').innerHTML = '';
    document.getElementById('stress-report-content').innerHTML = '';
    document.getElementById('stress-progress-bar').style.width = '0%';
    document.getElementById('stress-progress-label').textContent = 'Starten…';
    document.getElementById('stress-progress-wrap').style.display = '';
    document.getElementById('stress-results-wrap').style.display = '';
    document.getElementById('stress-log-wrap').style.display = '';
    document.getElementById('stress-report-wrap').style.display = 'none';
    document.getElementById('stress-start-btn').disabled = true;
    document.getElementById('stress-stop-btn').style.display = '';

    try {
      const res = await fetch('/api/stress-test/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, concurrency, numSessions, runsPerSession, durationSec }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const err = await res.json();
        await pyAlert(err.error || 'Kon test niet starten', "error");
        resetStressUI();
        return;
      }
    } catch(e) {
      await pyAlert('Verbindingsfout: ' + e.message, "error");
      resetStressUI();
      return;
    }

    // Start SSE stream
    stressEventSource = new EventSource('/api/stress-test/stream');

    stressEventSource.addEventListener('log', e => {
      const d = JSON.parse(e.data);
      appendLog(d.level, `${d.ts.slice(11, 23)} ${d.msg}`);
    });

    stressEventSource.addEventListener('progress', e => {
      const d = JSON.parse(e.data);
      const pct = Math.round((d.step / (d.total || 1)) * 100);
      document.getElementById('stress-progress-bar').style.width = pct + '%';
      document.getElementById('stress-progress-label').textContent = d.label || '';
      document.getElementById('stress-progress-title').textContent =
        `Voortgang — stap ${d.step} van ${d.total}`;
    });

    stressEventSource.addEventListener('result', e => {
      const d = JSON.parse(e.data);
      appendResult(d.component, d.status, d.detail);
    });

    stressEventSource.addEventListener('done', e => {
      const d = JSON.parse(e.data);
      stressEventSource.close();
      stressEventSource = null;
      showReport(d);
      resetStressUI();
      loadLogFiles();
    });

    stressEventSource.onerror = () => {
      appendLog('warn', 'SSE verbinding verbroken');
      if (stressEventSource) { stressEventSource.close(); stressEventSource = null; }
      resetStressUI();
    };
  };

  window.stopStressTest = async function () {
    await fetch('/api/stress-test/stop', { method: 'POST', credentials: 'same-origin' });
    appendLog('warn', 'Stop-signaal verstuurd…');
  };

  function resetStressUI() {
    document.getElementById('stress-start-btn').disabled = false;
    document.getElementById('stress-stop-btn').style.display = 'none';
  }

  function appendLog(level, msg) {
    const log = document.getElementById('stress-log');
    const line = document.createElement('div');
    line.className = `log-${level}`;
    line.textContent = msg;
    log.appendChild(line);
    if (document.getElementById('stress-log-autoscroll')?.checked) {
      log.scrollTop = log.scrollHeight;
    }
  }

  function appendResult(component, status, detail) {
    const wrap = document.getElementById('stress-results-list');
    const icons = { ok: '✅', warn: '⚠️', fail: '❌' };
    const item = document.createElement('div');
    item.className = `result-item result-${status}`;
    item.innerHTML = `
      <span class="result-icon">${icons[status] || '?'}</span>
      <div>
        <div class="result-component">${component}</div>
        <div class="result-detail">${detail || ''}</div>
      </div>`;
    wrap.appendChild(item);
    resultCount++;
  }

  function showReport(d) {
    document.getElementById('stress-report-wrap').style.display = '';
    document.getElementById('stress-progress-bar').style.width = '100%';

    const pctClass = d.pct >= 85 ? 'success' : d.pct >= 60 ? 'warning' : 'error';
    const icon = d.overallOk ? '✅' : '❌';

    let html = `
      <div class="status-box status-${pctClass}" style="margin-bottom:12px;">
        <strong>${icon} ${d.passed}/${d.total} checks geslaagd (${d.pct}%)</strong>
        &nbsp;·&nbsp; Duur: ${(d.totalMs/1000).toFixed(1)}s
        ${d.stopped ? '&nbsp;·&nbsp; ⚠️ Vroegtijdig gestopt' : ''}
      </div>`;

    if (d.baselineComparison) {
      html += `<div style="font-size:0.85rem; color:var(--muted); margin-bottom:10px;">
        <strong>Vergelijking met vorige run</strong> (${d.baselineComparison.ageStr}):<br>
        ${d.baselineComparison.comparison.map(l => `• ${l}`).join('<br>')}
      </div>`;
    }

    if (d.logFilename) {
      html += `<a href="/api/stress-test/logs/${encodeURIComponent(d.logFilename)}"
        class="btn btn-soft small" download>⬇ Download logbestand</a>`;
    }

    document.getElementById('stress-report-content').innerHTML = html;
  }

  window.loadLogFiles = async function () {
    const wrap = document.getElementById('log-file-list');
    try {
      const res = await fetch('/api/stress-test/logs', { credentials: 'same-origin' });
      const data = await res.json();
      if (!data.logs.length) {
        wrap.innerHTML = '<span style="color:var(--muted);">Nog geen logbestanden.</span>';
        return;
      }
      wrap.innerHTML = data.logs.map(l => {
        const kb = (l.sizeBytes / 1024).toFixed(1);
        const dt = new Date(l.mtime).toLocaleString('nl-BE');
        return `<div style="display:flex; justify-content:space-between; align-items:center;
          padding:6px 0; border-bottom:1px solid var(--border);">
          <span>${l.filename} <span style="color:var(--muted);">(${kb} KB · ${dt})</span></span>
          <a href="/api/stress-test/logs/${encodeURIComponent(l.filename)}"
            class="btn btn-soft small" download>⬇</a>
        </div>`;
      }).join('');
    } catch(e) {
      wrap.innerHTML = `<span style="color:var(--error-fg);">Fout: ${e.message}</span>`;
    }
  };

  // Init
  loadLogFiles();
  // Controleer bij laden of er al een test loopt
  fetch('/api/stress-test/status', { credentials: 'same-origin' })
    .then(r => r.json())
    .then(d => {
      if (d.running) {
        document.getElementById('stress-start-btn').disabled = true;
        document.getElementById('stress-stop-btn').style.display = '';
        document.getElementById('stress-progress-wrap').style.display = '';
        document.getElementById('stress-log-wrap').style.display = '';
        document.getElementById('stress-results-wrap').style.display = '';
        // Herverbind met de lopende test
        stressEventSource = new EventSource('/api/stress-test/stream');
        stressEventSource.addEventListener('log', e => {
          const d = JSON.parse(e.data);
          appendLog(d.level, `${d.ts.slice(11, 23)} ${d.msg}`);
        });
        stressEventSource.addEventListener('result', e => {
          const d = JSON.parse(e.data); appendResult(d.component, d.status, d.detail);
        });
        stressEventSource.addEventListener('done', e => {
          const d = JSON.parse(e.data);
          stressEventSource.close(); stressEventSource = null;
          showReport(d); resetStressUI(); loadLogFiles();
        });
      }
    }).catch(() => {});
})();

// ═══ Sprint 20/21: Nieuwe monitoring functies ═══════════════════════════════

async function loadExtraMonitoring() {
  // PostgreSQL status
  try {
    const r = await fetch('/api/monitoring', { credentials: 'same-origin' });
    const d = await r.json();

    // PostgreSQL
    const pgEl = document.getElementById('pg-status');
    if (pgEl) pgEl.textContent = '● Verbonden';

    const pgDetail = document.getElementById('pg-detail');
    if (pgDetail && d.dbStats) {
      pgDetail.textContent = `${d.dbStats.tableCount || '?'} tabellen`;
    }

    const pgTables = document.getElementById('pg-tables');
    if (pgTables && d.dbStats) {
      const stats = d.dbStats;
      pgTables.innerHTML = [
        `Leerkrachten: <strong>${stats.teacherCount || 0}</strong>`,
        `Klassen: <strong>${stats.classCount || 0}</strong>`,
        `Leerlingen: <strong>${stats.studentCount || 0}</strong>`,
        `Sessies: <strong>${stats.sessionCount || 0}</strong>`,
      ].join('<br/>');
    }

    const pgQuiz = document.getElementById('pg-quiz');
    if (pgQuiz && d.quizStats) {
      const qs = d.quizStats;
      pgQuiz.innerHTML = [
        `Vragen in bank: <strong>${qs.totalQuestions || 0}</strong>`,
        `Toetsen ooit: <strong>${qs.totalSessions || 0}</strong>`,
        `Antwoorden totaal: <strong>${qs.totalAnswers || 0}</strong>`,
        `Gem. runs/antwoord: <strong>${qs.avgRuns || 0}</strong>`,
      ].join('<br/>');
    }
  } catch (e) { console.warn('[monitoring] fout:', e.message); }

  // Versie
  try {
    const vr = await fetch('/api/version', { credentials: 'same-origin' });
    const vd = await vr.json();
    const vEl = document.getElementById('version-info');
    if (vEl) vEl.innerHTML = [
      `Versie: <strong>${vd.version || '?'}</strong>`,
      `Uptime: <strong>${Math.round((vd.uptime || 0) / 3600)}u ${Math.round(((vd.uptime||0)%3600)/60)}m</strong>`,
      `Node.js: <strong>${vd.node || '?'}</strong>`,
    ].join('<br/>');
  } catch (e) { console.warn('[monitoring] fout:', e.message); }

  // Log status
  try {
    const lr = await fetch('/api/admin/logs/info', { credentials: 'same-origin' });
    const ld = await lr.json();
    const lEl = document.getElementById('log-status');
    if (lEl) lEl.innerHTML = [
      `Bestanden: <strong>${ld.totalFiles || 0}</strong>`,
      `Grootte: <strong>${ld.totalMB || 0} MB</strong>`,
      `Retentie: <strong>${ld.retentionDays || 7} dagen</strong>`,
      `Oud (te verwijderen): <strong>${ld.oldCount || 0}</strong>`,
    ].join('<br/>');
  } catch (e) { console.warn('[monitoring] fout:', e.message); }

  // Audit log
  loadAuditLog();

  // Stresstest historiek
  loadStressHistory();
}

async function loadAuditLog() {
  const action = document.getElementById('audit-filter-action')?.value || '';
  try {
    const url = '/api/admin/audit-log?limit=25' + (action ? '&action=' + action : '');
    const r = await fetch(url, { credentials: 'same-origin' });
    const logs = await r.json();
    const tbody = document.getElementById('audit-tbody');
    if (!tbody) return;

    const actionLabels = {
      score_changed: '✏️ Score gewijzigd',
      quiz_deleted: '🗑 Toets verwijderd',
      results_released: '🔓 Resultaten vrijgegeven',
    };

    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--muted);">Nog geen acties gelogd.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(log => {
      const detail = (() => { try { return JSON.parse(log.detail_json || '{}'); } catch { return {}; } })();
      let detailStr = '';
      if (log.action === 'score_changed') {
        detailStr = `${detail.studentName || '?'}: ${detail.oldScore ?? '—'} → ${detail.newScore ?? '—'}`;
      } else if (detail.sessionName) {
        detailStr = detail.sessionName;
      }
      const ts = new Date(Number(log.created_at)).toLocaleString('nl-BE', {
        day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
      });
      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:6px 8px;color:var(--muted);font-size:0.82rem;">${ts}</td>
        <td style="padding:6px 8px;"><strong>${log.actor || '?'}</strong></td>
        <td style="padding:6px 8px;">${actionLabels[log.action] || log.action}</td>
        <td style="padding:6px 8px;font-size:0.82rem;">${log.target || ''}</td>
        <td style="padding:6px 8px;color:var(--muted);font-size:0.82rem;">${detailStr}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    const tbody = document.getElementById('audit-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);padding:12px;">Audit-log niet beschikbaar.</td></tr>';
  }
}

async function loadStressHistory() {
  try {
    const r = await fetch('/api/stress-results', { credentials: 'same-origin' });
    const results = await r.json();

    // Grafiek
    const canvas = document.getElementById('stress-history-chart');
    if (canvas && results.length > 0) {
      const ctx = canvas.getContext('2d');
      const W = canvas.offsetWidth || 600;
      const H = 80;
      canvas.width = W; canvas.height = H;
      ctx.clearRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
      [25, 50, 75].forEach(y => {
        const py = H - (y / 100) * (H - 20) - 10;
        ctx.beginPath(); ctx.moveTo(30, py); ctx.lineTo(W - 10, py); ctx.stroke();
        ctx.fillStyle = '#9ca3af'; ctx.font = '10px sans-serif';
        ctx.fillText(y + '%', 2, py + 4);
      });

      const pts = results.slice().reverse();
      const step = (W - 40) / Math.max(pts.length - 1, 1);

      // Lijn
      ctx.beginPath(); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2;
      pts.forEach((r, i) => {
        const x = 30 + i * step;
        const y = H - ((r.stress_pct || 0) / 100) * (H - 20) - 10;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Punten
      pts.forEach((r, i) => {
        const x = 30 + i * step;
        const y = H - ((r.stress_pct || 0) / 100) * (H - 20) - 10;
        const color = r.stress_pct > 85 ? '#dc2626' : r.stress_pct > 70 ? '#f59e0b' : '#22c55e';
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
      });
    }

    // Tabel
    const tEl = document.getElementById('stress-history-table');
    if (tEl && results.length > 0) {
      const labelColor = {LAAG:'#22c55e', NORMAAL:'#3b82f6', MATIG:'#f59e0b', HOOG:'#ef4444', KRITIEK:'#7f1d1d'};
      tEl.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">' +
        '<thead><tr style="border-bottom:2px solid var(--border);">' +
        '<th style="text-align:left;padding:5px 8px;color:var(--muted);">Datum</th>' +
        '<th style="text-align:left;padding:5px 8px;color:var(--muted);">Type</th>' +
        '<th style="padding:5px 8px;color:var(--muted);">Stressload</th>' +
        '<th style="padding:5px 8px;color:var(--muted);">Runs</th>' +
        '<th style="padding:5px 8px;color:var(--muted);">Gem. tijd</th>' +
        '<th style="padding:5px 8px;color:var(--muted);">Fouten</th>' +
        '</tr></thead><tbody>' +
        results.map(r => {
          const color = labelColor[r.stress_label] || '#6b7280';
          const ts = new Date(Number(r.ran_at)).toLocaleString('nl-BE', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
          const failPct = r.runs_total > 0 ? Math.round(r.runs_failed / r.runs_total * 100) : 0;
          return `<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:5px 8px;">${ts}</td>
            <td style="padding:5px 8px;">${r.test_type}</td>
            <td style="padding:5px 8px;text-align:center;">
              <span style="background:${color}22;color:${color};padding:2px 10px;border-radius:8px;font-weight:700;">
                ${r.stress_pct}% ${r.stress_label}
              </span>
            </td>
            <td style="padding:5px 8px;text-align:center;">${r.runs_ok}/${r.runs_total}</td>
            <td style="padding:5px 8px;text-align:center;">${r.avg_run_ms ? r.avg_run_ms + 'ms' : '—'}</td>
            <td style="padding:5px 8px;text-align:center;color:${failPct>0?'#dc2626':'inherit'};">${failPct}%</td>
          </tr>`;
        }).join('') +
        '</tbody></table>';
    } else if (tEl) {
      tEl.innerHTML = '<p style="color:var(--muted);text-align:center;padding:16px;">Nog geen stresstest-resultaten beschikbaar. Voer eerst een stresstest uit.</p>';
    }
  } catch (e) { console.warn('[monitoring] fout:', e.message); }
}

// Laad extra monitoring bij page load
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(loadExtraMonitoring, 1500);
  setInterval(loadExtraMonitoring, 60000);
});

// ── Sprint 24g: Database viewer ───────────────────────────────────────────────
let _dbActiveTable = null;
let _dbOffset = 0;
let _dbSearch = '';
const _dbLimit = 50;

const _dbCategoryColor = {
  kern:    { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' },
  quiz:    { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' },
  systeem: { bg: '#f9fafb', border: '#e5e7eb', text: '#374151' },
};

async function loadDbViewer() {
  const grid = document.getElementById('db-tables-grid');
  grid.innerHTML = '<div class="muted" style="grid-column:1/-1;padding:16px;text-align:center;">Tabellen laden...</div>';
  try {
    const r = await fetch('/api/admin/db/tables');
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);
    grid.innerHTML = data.tables.map(t => {
      const col = _dbCategoryColor[t.category] || _dbCategoryColor.systeem;
      const isActive = _dbActiveTable === t.name;
      return `<div onclick="openDbTable('${t.name}')" style="
          cursor:pointer; border-radius:10px; padding:12px 14px;
          background:${isActive ? col.border : col.bg};
          border:2px solid ${isActive ? col.text : col.border};
          transition:all .15s;">
        <div style="font-weight:700;font-size:0.88rem;color:${col.text};margin-bottom:4px;">${t.name}</div>
        <div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px;">${t.rowCount} rijen</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px;">
          ${t.columns.slice(0,5).map(c =>
            `<span style="font-size:0.68rem;background:rgba(0,0,0,0.06);padding:1px 5px;border-radius:4px;color:var(--muted);">${c.name}</span>`
          ).join('')}
          ${t.columns.length > 5 ? `<span style="font-size:0.68rem;color:var(--muted);">+${t.columns.length - 5}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    grid.innerHTML = `<div style="grid-column:1/-1;color:var(--error-fg);padding:16px;">Fout: ${e.message}</div>`;
  }
}

async function openDbTable(name) {
  _dbActiveTable = name;
  _dbOffset = 0;
  _dbSearch = '';
  document.getElementById('db-search-input').value = '';
  document.getElementById('db-table-detail').style.display = 'block';
  document.getElementById('db-detail-title').textContent = '📋 ' + name;
  document.getElementById('db-detail-title').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  loadDbViewer(); // herlaad grid met actieve markering
  await fetchDbRows();
}

function closeDbDetail() {
  _dbActiveTable = null;
  document.getElementById('db-table-detail').style.display = 'none';
  loadDbViewer();
}

let _dbSearchTimer = null;
function onDbSearch(val) {
  _dbSearch = val;
  _dbOffset = 0;
  clearTimeout(_dbSearchTimer);
  _dbSearchTimer = setTimeout(fetchDbRows, 350);
}

function dbPageNav(dir) {
  _dbOffset = Math.max(0, _dbOffset + dir * _dbLimit);
  fetchDbRows();
}

async function fetchDbRows() {
  if (!_dbActiveTable) return;
  const tbody = document.getElementById('db-detail-body');
  const thead = document.getElementById('db-detail-head');
  tbody.innerHTML = '<tr><td colspan="99" style="padding:16px;color:var(--muted);text-align:center;">Laden...</td></tr>';
  try {
    const params = new URLSearchParams({ limit: _dbLimit, offset: _dbOffset });
    if (_dbSearch) params.set('search', _dbSearch);
    const r = await fetch(`/api/admin/db/tables/${_dbActiveTable}/rows?${params}`);
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);
    thead.innerHTML = '<tr>' + data.columns.map(c =>
      `<th style="padding:8px 10px;text-align:left;font-size:0.78rem;color:var(--muted);font-weight:700;white-space:nowrap;border-bottom:2px solid var(--border);">${c}</th>`
    ).join('') + '</tr>';
    tbody.innerHTML = data.rows.length === 0
      ? '<tr><td colspan="99" style="padding:16px;color:var(--muted);text-align:center;">Geen rijen gevonden.</td></tr>'
      : data.rows.map(row =>
        '<tr>' + data.columns.map(c => {
          const raw = row[c];
          const val = raw === null ? '<em style="color:var(--muted);">null</em>'
                    : String(raw).length > 80
                      ? `<span title="${String(raw).replace(/"/g,'&quot;')}">${String(raw).slice(0,80)}…</span>`
                      : String(raw);
          return `<td style="padding:6px 10px;border-bottom:1px solid var(--border);font-size:0.8rem;max-width:220px;overflow:hidden;white-space:nowrap;">${val}</td>`;
        }).join('') + '</tr>'
      ).join('');
    const from = _dbOffset + 1;
    const to   = Math.min(_dbOffset + data.rows.length, data.total);
    document.getElementById('db-detail-count').textContent = `${from}–${to} van ${data.total} rijen`;
    document.getElementById('db-prev-btn').style.display = _dbOffset > 0 ? '' : 'none';
    document.getElementById('db-next-btn').style.display = to < data.total ? '' : 'none';
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="99" style="padding:16px;color:var(--error-fg);">Fout: ${e.message}</td></tr>`;
  }
}
