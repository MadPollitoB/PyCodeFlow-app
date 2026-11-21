// PyCodeFlow — geextraheerd uit teacher-grid.html (sprint 32a)
// Inline scripts naar apart bestand voor onderhoudbaarheid + CSP (30b).

// Haal sessiecode uit URL
  const params = new URLSearchParams(location.search);
  // 29a: setLS() slaat JSON-encoded op (met quotes) — dus JSON-parsen bij lezen.
  // De URL-parameter is de primaire bron; localStorage is de fallback.
  function readStoredSessionCode() {
    try {
      const raw = localStorage.getItem('teacherSessionCode');
      if (!raw) return '';
      // Kan JSON-encoded zijn ("ABC") of raw (ABC) — beide afhandelen
      try { return JSON.parse(raw) || ''; } catch { return raw; }
    } catch { return ''; }
  }
  const sessionCode = params.get('code') || readStoredSessionCode() || '';

  let _students = [];
  let _sortBy = 'naam';
  let _socket = null;
  let _lastUpdate = null;
  // v145: toets/taak → mini-kaartjes met schermafbeelding
  let _isQuiz = false;
  let _kaarten = [];
  let _beelden = {};          // studentId → { img, at }
  let _intervalSec = 30;
  let _serverOffset = 0;      // serverklok − eigen klok (ms)

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function initials(name) {
    return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0,2).toUpperCase();
  }

  function setSort(by) {
    _sortBy = by;
    document.querySelectorAll('.sort-bar button').forEach(b => b.classList.remove('active'));
    document.getElementById('sort-' + by)?.classList.add('active');
    renderGrid();
  }

  function sortStudents(students) {
    return [...students].sort((a, b) => {
      if (_sortBy === 'naam')   return a.name.localeCompare(b.name, 'nl');
      if (_sortBy === 'klas')   return (a.className||'').localeCompare(b.className||'', 'nl') || a.name.localeCompare(b.name,'nl');
      if (_sortBy === 'status') {
        const order = s => s.runStatus === 'running' ? 0 : s.handRaised ? 1 : s.isDone ? 2 : s.online ? 3 : 4;
        return order(a) - order(b);
      }
      return 0;
    });
  }

  function renderGrid() {
    if (_isQuiz) return renderQuizGrid();
    const grid = document.getElementById('student-grid');
    if (!_students.length) {
      grid.innerHTML = '<div class="no-students"><div>🎓</div>Nog geen leerlingen verbonden.</div>';
      return;
    }

    const sorted = sortStudents(_students);

    // Stats
    document.getElementById('stat-total').textContent   = sorted.length;
    document.getElementById('stat-online').textContent  = sorted.filter(s => s.online).length;
    document.getElementById('stat-running').textContent = sorted.filter(s => s.runStatus === 'running').length;
    document.getElementById('stat-done').textContent    = sorted.filter(s => s.isDone || s.quizSubmitted).length;
    document.getElementById('stat-hand').textContent    = sorted.filter(s => s.handRaised).length;

    grid.innerHTML = sorted.map(s => {
      const code = s.personalCode || s.code || '';
      const codeLines = code.split('\n').slice(0, 5).join('\n');

      let cardClass = '';
      let chipHtml = '';

      if (!s.online) {
        cardClass = 'offline';
        chipHtml = '<span class="status-chip chip-idle">○ offline</span>';
      } else if (s.quizSubmitted) {
        cardClass = 'quiz-submitted';
        chipHtml = '<span class="status-chip chip-quiz">✅ Ingediend</span>';
      } else if (s.handRaised) {
        cardClass = 'hand';
        chipHtml = '<span class="status-chip chip-hand">✋ Hand op</span>';
      } else if (s.runStatus === 'running') {
        cardClass = 'running';
        chipHtml = '<span class="status-chip chip-running">▶ Loopt</span>';
      } else if (s.runStatus === 'waiting_input') {
        cardClass = 'waiting';
        chipHtml = '<span class="status-chip chip-waiting">⌨ Wacht input</span>';
      } else if (s.isDone) {
        cardClass = 'done';
        chipHtml = '<span class="status-chip chip-done">✓ Klaar</span>';
      } else {
        chipHtml = '<span class="status-chip chip-idle">● bezig</span>';
      }

      const quizInfo = s.quizCurrentQuestion !== undefined
        ? `<span>V${s.quizCurrentQuestion + 1}/${s.quizTotalQuestions || '?'}</span>` : '';

      const runCount = s.runCount > 0
        ? `<span>${s.runCount} run${s.runCount !== 1 ? 's' : ''}</span>` : '';

      return `<div class="student-card ${cardClass}" onclick="focusStudent('${esc(s.id)}')">
        <div class="card-header">
          <div class="card-avatar">${esc(initials(s.name))}</div>
          <div style="flex:1;min-width:0;">
            <div class="card-name" title="${esc(s.name)}">${esc(s.name)}</div>
            <div class="card-class">${esc(s.className || '')}</div>
          </div>
          <div class="card-badges">
            <div class="badge-dot ${s.online ? 'online' : 'offline'}" title="${s.online ? 'Online' : 'Offline'}"></div>
          </div>
        </div>
        <div class="card-code">${esc(codeLines || '(geen code)')}</div>
        <div class="card-footer">
          ${chipHtml}
          ${quizInfo}
          ${runCount}
        </div>
      </div>`;
    }).join('');
  }


  // ── v145: toets/taak — mini-kaartjes ────────────────────────────────────────
  function fmtDuur(sec) {
    if (sec == null) return '';
    const m = Math.floor(sec / 60), s2 = sec % 60;
    return m + ':' + String(s2).padStart(2, '0');
  }
  function geleden(ms) {
    const s2 = Math.max(0, Math.round(ms / 1000));
    if (s2 < 60) return s2 + ' s';
    return Math.floor(s2 / 60) + ' min';
  }
  function kaartStatus(k) {
    if (k.submitted) return ['quiz-submitted', '<span class="status-chip chip-quiz">✅ Ingediend</span>'];
    if (!k.online) return ['offline', '<span class="status-chip chip-idle">○ offline</span>'];
    if (!k.started) return ['', '<span class="status-chip chip-idle">… nog niet gestart</span>'];
    if (k.weg) return ['weg', '<span class="status-chip chip-weg">🚪 weg uit de toets</span>'];
    return ['running', '<span class="status-chip chip-running">✏️ bezig</span>'];
  }
  function sorteerKaarten(lijst) {
    return [...lijst].sort((a, b) => {
      if (_sortBy === 'klas') return (a.className || '').localeCompare(b.className || '', 'nl') || a.name.localeCompare(b.name, 'nl');
      if (_sortBy === 'status') {
        const o = k => k.weg ? 0 : (k.online && k.started && !k.submitted) ? 1 : k.submitted ? 3 : 2;
        return o(a) - o(b) || a.name.localeCompare(b.name, 'nl');
      }
      return a.name.localeCompare(b.name, 'nl');
    });
  }
  function beeldHtml(k) {
    const b = _beelden[k.id];
    if (k.submitted) return '<div class="card-beeld leeg">✅ ingediend</div>';
    if (_intervalSec === 0) return '<div class="card-beeld leeg">📷 schermbeeld staat uit voor deze toets</div>';
    if (b) return `<img class="card-beeld" alt="Scherm van ${esc(k.name)}" src="${b.img}"/>`;
    return `<div class="card-beeld leeg">📷 wacht op beeld (om de ${_intervalSec} s)</div>`;
  }
  function renderQuizGrid() {
    const grid = document.getElementById('student-grid');
    if (!_kaarten.length) {
      grid.innerHTML = '<div class="no-students"><div>🎓</div>Nog geen leerlingen verbonden.</div>';
      return;
    }
    const lijst = sorteerKaarten(_kaarten);
    document.getElementById('stat-total').textContent   = lijst.length;
    document.getElementById('stat-online').textContent  = lijst.filter(k => k.online).length;
    document.getElementById('stat-running').textContent = lijst.filter(k => k.online && k.started && !k.submitted).length;
    document.getElementById('stat-done').textContent    = lijst.filter(k => k.submitted).length;
    document.getElementById('stat-hand').textContent    = lijst.filter(k => k.weg && !k.submitted).length;

    const bestaand = new Map([...grid.querySelectorAll('.student-card[data-id]')].map(e => [e.dataset.id, e]));
    grid.querySelectorAll('.no-students, .student-card:not([data-id])').forEach(e => e.remove());   // kaartjes van de klas-weergave
    const nu = Date.now() + _serverOffset;
    lijst.forEach((k, i) => {
      const [klasse, chip] = kaartStatus(k);
      let el = bestaand.get(k.id);
      if (!el) { el = document.createElement('div'); el.dataset.id = k.id; el.onclick = () => focusStudent(k.id); }
      bestaand.delete(k.id);
      el.className = 'student-card quiz-kaart ' + klasse;
      const huidigeBeeld = _beelden[k.id] ? _beelden[k.id].at : 0;
      // Alleen herbouwen als er iets veranderde, zodat het beeld niet flikkert.
      const sleutel = JSON.stringify([k.name, k.className, k.online, k.submitted, k.started, k.vraag, k.totaal, k.beantwoord, k.snippet, k.weg, k.tabwissels, huidigeBeeld, _intervalSec]);
      if (el.dataset.sleutel !== sleutel) {
        el.dataset.sleutel = sleutel;
        el.innerHTML = `
          <div class="card-header">
            <div class="card-avatar">${esc(initials(k.name))}</div>
            <div style="flex:1;min-width:0;">
              <div class="card-name" title="${esc(k.name)}">${esc(k.name)}</div>
              <div class="card-class">${esc(k.className || '')}</div>
            </div>
            <div class="badge-dot ${k.online ? 'online' : 'offline'}" title="${k.online ? 'Online' : 'Offline'}"></div>
          </div>
          ${beeldHtml(k)}
          <div class="kaart-info">
            <div><strong>${k.vraag ? 'Vraag ' + k.vraag + (k.totaal ? '/' + k.totaal : '') : '—'}</strong>${k.totaal ? ` · ${k.beantwoord}/${k.totaal} beantwoord` : ''}</div>
            <div class="kaart-snippet">${k.snippet ? esc(k.snippet) : '<span class="muted">(nog geen antwoord)</span>'}</div>
            <div class="kaart-tijden"></div>
          </div>
          <div class="card-footer">${chip}${k.tabwissels ? `<span title="Aantal tabwissels">🔀 ${k.tabwissels}</span>` : ''}</div>`;
        grid.appendChild(el);
      } else if (!el.parentNode) grid.appendChild(el);
      el._kaart = k;
      if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
    });
    bestaand.forEach(e => e.remove());
    werkTijdenBij();
  }
  // Tijden (laatste activiteit, resterende tijd) lopen elke seconde zonder de kaart te herbouwen.
  function werkTijdenBij() {
    const nu = Date.now() + _serverOffset;
    const basis = _kaartenOp || nu;
    document.querySelectorAll('.quiz-kaart').forEach(el => {
      const k = el._kaart; const t = el.querySelector('.kaart-tijden');
      if (!k || !t) return;
      if (k.submitted) { t.textContent = ''; return; }
      const delen = [];
      if (k.laatsteActiviteit) delen.push('⌨ ' + geleden(nu - k.laatsteActiviteit) + ' geleden');
      if (k.resterendSec != null) delen.push('⏱ ' + fmtDuur(Math.max(0, k.resterendSec - Math.round((nu - basis) / 1000))));
      else if (k.indienOp) delen.push('📤 wordt ingediend om ' + new Date(k.indienOp).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
      t.textContent = delen.join(' · ');
    });
  }
  let _kaartenOp = null;
  setInterval(() => { if (_isQuiz) werkTijdenBij(); }, 1000);

  function focusStudent(id) {
    // Stuur bericht naar het leerkracht-venster om die leerling te selecteren
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'pycf_select_student', studentId: id }, '*');
    }
  }

  // ── Socket.IO verbinding ─────────────────────────────────────────────────
  function connect() {
    if (_socket) _socket.disconnect();

    _socket = io({ reconnection: true, reconnectionDelay: 2000 });

    _socket.on('connect', () => {
      document.getElementById('conn-status').classList.remove('visible');
      // Verbind als observer-achtige rol — vraag sessiedata op
      _socket.emit('teacher_grid_observe', { code: sessionCode });
    });

    _socket.on('disconnect', () => {
      document.getElementById('conn-status').classList.add('visible');
    });

    // Ontvang reguliere teacher_session_data updates
    _socket.on('teacher_session_data', (data) => {
      if (!data) return;
      if (_isQuiz) return;   // v145: toets/taak gebruikt quiz_live_data
      _students = data.students || [];
      _lastUpdate = Date.now();

      const nameEl = document.getElementById('grid-session-name');
      const codeEl = document.getElementById('grid-session-code');
      if (nameEl) nameEl.textContent = data.name || 'Leerlingenoverzicht';
      if (codeEl) codeEl.textContent = 'Code: ' + sessionCode;

      renderGrid();
    });

    // v145: toets/taak → kaartjes + schermafbeeldingen
    _socket.on('quiz_live_data', (d) => {
      if (!d) return;
      _isQuiz = true;
      _kaarten = d.kaarten || [];
      _intervalSec = d.intervalSec == null ? 30 : d.intervalSec;
      _serverOffset = (d.nu || Date.now()) - Date.now();
      _kaartenOp = d.nu || Date.now();
      const nameEl = document.getElementById('grid-session-name');
      const codeEl = document.getElementById('grid-session-code');
      if (nameEl) nameEl.textContent = d.name || 'Leerlingenoverzicht';
      if (codeEl) codeEl.textContent = 'Code: ' + sessionCode + (_intervalSec ? ` · schermbeeld om de ${_intervalSec} s` : ' · schermbeeld uit');
      const hand = document.getElementById('stat-hand');
      if (hand && hand.parentElement && !hand.dataset.quiz) { hand.parentElement.innerHTML = '🚪 <strong id="stat-hand" data-quiz="1">0</strong> weg'; }
      renderGrid();
    });
    _socket.on('quiz_screenshot_update', (d) => {
      if (!d || !d.studentId || !d.img) return;
      _beelden[d.studentId] = { img: d.img, at: d.at || Date.now() };
      if (_isQuiz) renderGrid();
    });

    // Poll als fallback: vraag elke 3s een update
    setInterval(() => {
      if (_socket?.connected) {
        _socket.emit('teacher_grid_observe', { code: sessionCode });
      }
    }, 3000);
  }

  // v145: bij het sluiten van het overzicht meteen stoppen (de server stopt de beelden ook zelf na ~12 s)
  window.addEventListener('pagehide', () => { try { if (_socket && _socket.connected) _socket.emit('teacher_grid_stop', { code: sessionCode }); } catch (e) { /* sluiten */ } });
  connect();
