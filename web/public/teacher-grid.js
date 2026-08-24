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
      _students = data.students || [];
      _lastUpdate = Date.now();

      const nameEl = document.getElementById('grid-session-name');
      const codeEl = document.getElementById('grid-session-code');
      if (nameEl) nameEl.textContent = data.name || 'Leerlingenoverzicht';
      if (codeEl) codeEl.textContent = 'Code: ' + sessionCode;

      renderGrid();
    });

    // Poll als fallback: vraag elke 3s een update
    setInterval(() => {
      if (_socket?.connected) {
        _socket.emit('teacher_grid_observe', { code: sessionCode });
      }
    }, 3000);
  }

  connect();
