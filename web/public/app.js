(() => {
  const socket = io();
  const page = location.pathname.split('/').pop() || 'index.html';

  // Sprint 10T: verbindingsstatus indicator
  function updateConnectionStatus(status) {
    const dot = document.getElementById('connection-status-dot');
    if (!dot) return;
    dot.className = 'connection-dot connection-' + status;
    dot.title = { connected: 'Verbonden', disconnected: 'Verbinding verbroken', reconnecting: 'Herverbinden...' }[status] || status;
  }
  socket.on('connect',      () => updateConnectionStatus('connected'));
  socket.on('disconnect',   () => updateConnectionStatus('disconnected'));
  socket.on('reconnecting', () => updateConnectionStatus('reconnecting'));
  let selectedMode = 'class';
  let selectedEditorAssist = true;

  // ── Centrale API fetch wrapper met CSRF-token ────────────────────────────
  let _csrfToken = null;
  async function getCSRFToken() {
    if (_csrfToken) return _csrfToken;
    try {
      const r = await fetch('/api/csrf-token');
      if (r.ok) { const d = await r.json(); _csrfToken = d.token; }
    } catch {}
    return _csrfToken || '';
  }
  async function apiFetch(url, options = {}) {
    const token = await getCSRFToken();
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-CSRF-Token': token } : {}),
        ...(options.headers || {}),
      },
    });
  }

  // Sprint 10J: sneltoetsen overlay
  function toggleShortcutsOverlay() {
    let overlay = document.getElementById('shortcuts-overlay');
    if (overlay) { overlay.remove(); return; }
    overlay = document.createElement('div');
    overlay.id = 'shortcuts-overlay';
    overlay.className = 'shortcuts-overlay';
    overlay.innerHTML = `
      <div class="shortcuts-modal">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <strong style="font-size:1rem;">⌨️ Sneltoetsen</strong>
          <button onclick="document.getElementById('shortcuts-overlay').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--muted);">✕</button>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
          <tr><td style="padding:6px 0;color:var(--muted);">Run code</td><td style="text-align:right;"><kbd>Ctrl+Enter</kbd></td></tr>
          <tr><td style="padding:6px 0;color:var(--muted);">Editor thema wisselen</td><td style="text-align:right;"><kbd>Ctrl+Shift+T</kbd></td></tr>
          <tr><td style="padding:6px 0;color:var(--muted);">Interface dark/light</td><td style="text-align:right;"><kbd>Ctrl+Shift+D</kbd></td></tr>
          <tr><td style="padding:6px 0;color:var(--muted);">Sneltoetsen tonen</td><td style="text-align:right;"><kbd>Ctrl+?</kbd></td></tr>
          <tr><td style="padding:6px 0;color:var(--muted);">Live control verlaten</td><td style="text-align:right;"><kbd>Escape</kbd></td></tr>
        </table>
      </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === '?') { e.preventDefault(); toggleShortcutsOverlay(); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') { e.preventDefault(); toggleEditorTheme('teacher'); toggleEditorTheme('free'); toggleEditorTheme('student'); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      document.getElementById('dark-mode-toggle')?.click();
    }
  });

  // ── Editor thema systeem (los van interface dark/light) ──────────────────────
  // pycodeflow_editor_theme: 'dark' | 'light', standaard 'dark'
  let _editorTheme = localStorage.getItem('pycodeflow_editor_theme') || 'dark';

  function applyEditorTheme(owner, theme) {
    const editor = editorStore[owner];
    if (!editor) return;
    const monacoTheme = theme === 'light' ? 'vs' : 'pycodeflow-dark';
    editor.updateOptions({ theme: monacoTheme });
    // Output paneel class
    const panel = qs(`${owner}-output-panel`);
    if (panel) {
      panel.classList.toggle('output-light', theme === 'light');
      panel.classList.toggle('output-dark',  theme !== 'light');
    }
    // Statusbalk thema
    const statusbar = qs(`${owner}-editor-statusbar`);
    if (statusbar) {
      statusbar.style.background = theme === 'light' ? '#f3f3f3' : '#007acc';
      statusbar.style.color      = theme === 'light' ? '#555'    : '#fff';
    }
    // Sprint 11A: gutter thema — CSS variabelen op de editor-frame-wrap
    const frameWrap = qs(`${owner}-code-panel`);
    if (frameWrap) {
      frameWrap.classList.toggle('editor-theme-light', theme === 'light');
      frameWrap.classList.toggle('editor-theme-dark',  theme !== 'light');
    }
    // Gutter direct updaten
    const gutter = qs(`${owner}-line-numbers`);
    if (gutter) {
      gutter.style.background = theme === 'light' ? '#e8edf5' : '#1f2f57';
      gutter.style.color      = theme === 'light' ? '#4a5568' : '#9fb3c8';
      // Monaco gutter background ook aanpassen
      editor.updateOptions({
        theme: monacoTheme,
      });
    }
    // Toggle knop icoon
    const btn = qs(`${owner}-editor-theme-btn`);
    if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
  }

  function toggleEditorTheme(owner) {
    _editorTheme = _editorTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('pycodeflow_editor_theme', _editorTheme);
    // Pas toe op alle editors die dezelfde voorkeur delen
    ['teacher', 'free', 'student'].forEach(o => applyEditorTheme(o, _editorTheme));
  }

  // Statusbalk updaten op basis van cursor-positie
  function updateStatusbar(owner, editor, isTeacherOrFree) {
    const pos = editor.getPosition();
    const model = editor.getModel();
    if (!pos || !model) return;
    const ln = pos.lineNumber;
    const col = pos.column;
    const lines = model.getLineCount();
    // Update via directe span IDs (inline styled, altijd zichtbaar)
    const posEl = document.getElementById(`${owner}-sb-pos`);
    const linesEl = document.getElementById(`${owner}-sb-lines`);
    if (posEl) posEl.textContent = `Ln ${ln}, Kol ${col}`;
    if (linesEl) linesEl.textContent = `${lines} regels`;
    // Fallback: update hele balk als spans niet bestaan
    const bar = qs(`${owner}-editor-statusbar`);
    if (bar && !posEl) {
      if (isTeacherOrFree) {
        bar.innerHTML = `<span>Ln ${ln}, Kol ${col}</span><span>|</span><span>${lines} regels</span><span>|</span><span>Python</span><span>|</span><span>UTF-8</span><span style="margin-left:auto;">Spaties: 4</span>`;
      } else {
        bar.innerHTML = `<span>Ln ${ln}, Kol ${col}</span><span>|</span><span>${lines} regels</span>`;
      }
    }
  }

  // ── Editor thema knop icoon bij pageload instellen ────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Zet correct icoon op alle editor thema knoppen
    const isDark = _editorTheme !== 'light';
    ['teacher', 'free', 'student'].forEach(owner => {
      const btn = document.getElementById(`${owner}-editor-theme-btn`);
      if (btn) btn.textContent = isDark ? '☀️' : '🌙';
    });
  });

  // ── Dark mode initialisatie ─────────────────────────────────────────────────
  (function initDarkMode() {
    // Interface dark/light mode — enkel de pagina-achtergrond en panelen
    const saved = localStorage.getItem('pycodeflow_theme') || 'light';
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

    function setInterfaceTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('pycodeflow_theme', theme);
      const btn = document.getElementById('dark-mode-toggle');
      if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    }

    // Correcte knop-toestand bij laden
    document.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('dark-mode-toggle');
      if (btn) btn.textContent = saved === 'dark' ? '☀️' : '🌙';
    });

    document.addEventListener('click', e => {
      const btn = e.target.closest('#dark-mode-toggle');
      if (!btn) return;
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      setInterfaceTheme(isDark ? 'light' : 'dark');
    });
  })();

  const editorStore = {
    teacher: null,
    student: null,
    free: null,
    teacherApplyingRemote: false,
    studentApplyingRemote: false,
    freeApplyingRemote: false
  };

  let studentWorkspaceState = { mode: "class", activeWorkspace: "shared", selectedTab: "shared", sharedCode: "", personalCode: "", classCanRun: true, classCanEdit: true, personalCanRun: true, personalCanEdit: true, editorAssist: true, output: "" };
  let studentVisiblePanel = 'code';

  let autosaveIndicatorTimer = null;
  function saveStudentLocalDraft() {
    const editor = editorStore.student;
    if (!editor) return;
    const visible = getStudentVisibleWorkspace(studentWorkspaceState);
    if (visible === 'personal') {
      studentWorkspaceState.localPersonalCode = editor.getValue();
      // Toon korte "💾 Concept opgeslagen" indicator
      const indicator = qs('student-autosave-indicator');
      if (indicator) {
        indicator.style.opacity = '1';
        clearTimeout(autosaveIndicatorTimer);
        autosaveIndicatorTimer = setTimeout(() => { indicator.style.opacity = '0'; }, 2000);
      }
    }
  }

  function qs(id) { return document.getElementById(id); }
  function setLS(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  function getLS(key, fallback = null) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
  }
  function go(url) { location.href = url; }

  // Sprint 13A: sessie-config paneel updaten op basis van ontvangen config
  function updateSessionConfigPanel(config) {
    const keys = ['autoIndent','autoClosingBrackets','autoClosingQuotes','quickSuggestions','parameterHints'];
    keys.forEach(key => {
      const toggle = document.getElementById(`config-toggle-${key}`);
      if (toggle) {
        toggle.checked = config[key] ?? true;
        toggle.dataset.value = String(config[key] ?? true);
      }
    });
  }

  // Sprint 13A: stuur config wijziging naar server
  function emitConfigChange(key, value) {
    socket.emit('teacher_update_session_config', { key, value });
  }

  // Sprint 13C: inline badge acties
  window._teacherBadgeAction = function(studentId, action) {
    socket.emit('teacher_update_student_badge', { studentId, action });
  };
  window._teacherAssignClass = function(studentId, classId) {
    socket.emit('teacher_assign_student_class', { studentId, classId });
  };

  // Sprint 10M: kopieer naar klembord met feedback
  function copyToClipboard(text, btnEl) {
    navigator.clipboard.writeText(text).then(() => {
      if (btnEl) {
        const orig = btnEl.textContent;
        btnEl.textContent = '✓ Gekopieerd!';
        setTimeout(() => { btnEl.textContent = orig; }, 2000);
      }
    }).catch(() => {
      if (btnEl) { btnEl.textContent = '✕ Mislukt'; setTimeout(() => { btnEl.textContent = '📋'; }, 2000); }
    });
  }
  // Sprint 10U: auto-scroll output paneel
  const _autoScrollPanels = new Map(); // panelId -> { auto: bool, btn: el }

  function setupAutoScroll(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel || _autoScrollPanels.has(panelId)) return;
    // Maak scroll-knop aan
    const btn = document.createElement('button');
    btn.className = 'scroll-to-bottom-btn hidden';
    btn.textContent = '↓';
    btn.title = 'Scroll naar het einde';
    btn.style.cssText = 'position:absolute;bottom:8px;right:16px;z-index:10;padding:4px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface);cursor:pointer;font-size:0.9rem;opacity:0.85;';
    panel.parentElement?.style && (panel.parentElement.style.position = 'relative');
    panel.parentElement?.appendChild(btn);
    const state = { auto: true, btn };
    _autoScrollPanels.set(panelId, state);
    panel.addEventListener('scroll', () => {
      const atBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 30;
      state.auto = atBottom;
      btn.classList.toggle('hidden', atBottom);
    });
    btn.addEventListener('click', () => {
      panel.scrollTop = panel.scrollHeight;
      state.auto = true;
      btn.classList.add('hidden');
    });
  }

  function autoScrollOutput(panelId) {
    const state = _autoScrollPanels.get(panelId);
    const panel = document.getElementById(panelId);
    if (panel && (!state || state.auto)) {
      panel.scrollTop = panel.scrollHeight;
    }
  }

  function escapeHtml(str = '') {
    return str.replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  }


  function normalizeStudentFieldValue(value, type = 'text') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (type === 'name') {
      return raw;
    }
    const upper = raw.toUpperCase();
    return upper;
  }

  function setStatusBox(el, text, type = 'info') {
    if (!el) return;
    el.textContent = text;
    el.className = `status-box status-${type}`;
  }

  function formatMonitorBytes(bytes) {
    if (bytes == null || Number.isNaN(Number(bytes))) return '-';
    const mb = Number(bytes) / 1024 / 1024;
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb.toFixed(0)} MB`;
  }

  async function loadTeacherMonitoring() {
    try {
      const res = await fetch('/api/monitoring', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const r = data.runner || {};

      const activeRuns  = Number(r.activeRuns  ?? 0);
      const maxRuns     = Number(r.maxRuns     ?? 18);
      const queuedRuns  = Number(r.queuedRuns  ?? 0);
      const maxQueue    = Number(r.maxQueue    ?? 90);

      // Wachtrij is het meest relevante signaal voor de leerkracht
      const queueRatio = maxQueue > 0 ? queuedRuns / maxQueue : 0;
      const runRatio   = maxRuns  > 0 ? activeRuns  / maxRuns  : 0;
      // Gebruik de ergste van de twee als balk-waarde
      const barRatio   = Math.max(queueRatio, runRatio);

      const bar = qs('teacher-runner-bar');
      if (bar) {
        bar.style.width = Math.min(100, Math.round(barRatio * 100)) + '%';
        bar.className = 'runner-health-bar-fill'
          + (barRatio >= 0.8 ? ' danger' : barRatio >= 0.55 ? ' warn' : '');
      }

      const note = qs('teacher-monitor-note');
      if (note) {
        const danger = queueRatio >= 0.6 || runRatio >= 0.9;
        const warn   = queueRatio >= 0.35 || runRatio >= 0.75;
        if (danger) {
          setStatusBox(note, '⚠️ Zware belasting — open systeembeheer', 'error');
        } else if (warn) {
          setStatusBox(note, '⚡ Merkbare belasting — hou het in de gaten', 'warning');
        } else {
          setStatusBox(note, '✓ Runner loopt vlot', 'success');
        }
      }
    } catch (err) {
      const note = qs('teacher-monitor-note');
      if (note) setStatusBox(note, 'Monitoring niet bereikbaar', 'error');
    }
  }


  function updateAnnouncement(prefix, text) {
    const card = qs(`${prefix}-announcement-card`);
    const body = qs(`${prefix}-announcement-text`);
    if (!card || !body) return;
    const value = (text || '').trim();
    body.textContent = value;
    card.classList.toggle('hidden', !value);
  }

  function layoutEditor(owner, resetView = false) {
    const editor = editorStore[owner];
    const host = qs(`${owner}-editor`);
    if (!editor || !host) return;
    const applyLayout = () => {
      editor.layout({ width: host.clientWidth, height: host.clientHeight });
      syncCustomGutter(owner);
      if (resetView) {
        editor.setScrollTop(0);
        editor.setScrollLeft(0);
        editor.revealPosition({ lineNumber: 1, column: 1 });
      }
    };
    applyLayout();
    // Één rAF-pass om te corrigeren na DOM-repaint (bv. na tab-wissel of panelresize).
    // Enkel bij resetView een extra setTimeout — anders wordt de scrollpositie
    // van de leerling onnodig overschreven door de herhaalde layout-calls.
    requestAnimationFrame(applyLayout);
    if (resetView) {
      setTimeout(applyLayout, 0);
      setTimeout(applyLayout, 60);
    }
  }



  function gutterEl(owner) { return qs(`${owner}-line-numbers`); }

  function renderCustomGutter(owner) {
    const editor = editorStore[owner];
    const gutter = gutterEl(owner);
    if (!editor || !gutter) return;
    const model = editor.getModel();
    if (!model) return;
    const lineCount = model.getLineCount();
    const current = editor.getPosition()?.lineNumber || 1;
    let html = '';
    for (let i = 1; i <= lineCount; i++) {
      html += `<div class="gutter-line${i === current ? ' active' : ''}">${i}</div>`;
    }
    gutter.innerHTML = html;
    gutter.scrollTop = editor.getScrollTop();
  }

  function syncCustomGutter(owner) {
    const editor = editorStore[owner];
    const gutter = gutterEl(owner);
    if (!editor || !gutter) return;
    gutter.scrollTop = editor.getScrollTop();
  }

  function setTab(owner, tab) {
    if (owner === 'student') studentVisiblePanel = tab;
    const codePanel = qs(`${owner}-code-panel`);
    const outputPanel = qs(`${owner}-output-panel`);
    const inputWrap = qs(`${owner}-runtime-input-wrap`);
    document.querySelectorAll(`[data-owner="${owner}"][data-tab]`).forEach(btn => {
      let active = btn.dataset.tab === tab;
      if (owner === 'student' && tab === 'code') {
        const workspaceTab = (studentWorkspaceState.mode === 'exam')
          ? 'personal'
          : ((studentWorkspaceState.activeWorkspace || 'shared') === 'personal'
              ? 'personal'
              : (studentWorkspaceState.selectedTab || 'shared'));
        active = btn.dataset.tab === workspaceTab;
      }
      btn.classList.toggle('active', active);
    });
    codePanel?.classList.toggle('hidden', tab !== 'code');
    outputPanel?.classList.toggle('hidden', tab !== 'output');
    inputWrap?.classList.toggle('hidden', tab !== 'output');
    if (tab === 'code') layoutEditor(owner);
  }

  function enableInput(prefix) {
    const input = qs(`${prefix}-runtime-input`);
    const btn = qs(`${prefix}-send-input-btn`);
    if (!input || !btn) return;
    input.disabled = false;
    btn.disabled = false;
    input.value = '';
    input.placeholder = 'Typ je antwoord...';
    // Sprint 10I: wacht-op-invoer indicator
    const wrap = qs(`${prefix}-runtime-input-wrap`);
    if (wrap) wrap.classList.add('waiting-for-input');
    let indicator = document.getElementById(`${prefix}-input-indicator`);
    if (!indicator && wrap) {
      indicator = document.createElement('div');
      indicator.id = `${prefix}-input-indicator`;
      indicator.className = 'input-waiting-indicator';
      indicator.textContent = '⌨️ Wacht op jouw invoer...';
      wrap.parentElement?.insertBefore(indicator, wrap);
    }
    if (indicator) indicator.style.display = 'flex';
    setTimeout(() => { if (!input.disabled) input.focus(); }, 50);
  }

  function disableInput(prefix) {
    const input = qs(`${prefix}-runtime-input`);
    const btn = qs(`${prefix}-send-input-btn`);
    if (!input || !btn) return;
    input.disabled = true;
    btn.disabled = true;
    input.value = '';
    input.placeholder = 'Input unavailable';
    // Sprint 10I: verberg indicator
    const wrap = qs(`${prefix}-runtime-input-wrap`);
    if (wrap) wrap.classList.remove('waiting-for-input');
    const indicator = document.getElementById(`${prefix}-input-indicator`);
    if (indicator) indicator.style.display = 'none';
  }

  // Sprint 13A: actieve sessie-config (ontvangen van server)
  let _sessionConfig = {};

  function monacoOptions(assist, readOnly = false, config = {}) {
    // config overschrijft standaard assist-gebaseerde opties
    // Lege config = normale modus (alles op basis van assist)
    const autoIndent          = config.autoIndent          ?? true;
    const autoClosingBrackets = config.autoClosingBrackets ?? true;
    const autoClosingQuotes   = config.autoClosingQuotes   ?? true;
    const quickSuggs          = config.quickSuggestions    ?? assist;
    const paramHints          = config.parameterHints      ?? assist;

    return {
      language: 'python',
      theme: _editorTheme === 'light' ? 'vs' : 'pycodeflow-dark',
      automaticLayout: false,
      minimap: { enabled: false },
      fontSize: 18,
      lineHeight: 30,
      lineNumbers: 'off',
      lineNumbersMinChars: 0,
      lineDecorationsWidth: 0,
      glyphMargin: false,
      folding: false,
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      fixedOverflowWidgets: true,
      renderLineHighlight: 'line',
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
        useShadows: false,
        alwaysConsumeMouseWheel: false
      },
      roundedSelection: false,
      scrollBeyondLastLine: false,
      readOnly,
      // Suggesties — config.quickSuggestions overschrijft assist
      quickSuggestions:           quickSuggs,
      suggestOnTriggerCharacters: quickSuggs,
      wordBasedSuggestions:       quickSuggs ? 'currentDocument' : 'off',
      snippetSuggestions:         quickSuggs ? 'inline' : 'none',
      parameterHints:             { enabled: paramHints },
      tabCompletion:              quickSuggs ? 'on' : 'off',
      acceptSuggestionOnEnter:    quickSuggs ? 'on' : 'off',
      // Auto-indent en haakjes — per-sessie instelbaar
      autoIndent:          autoIndent          ? 'full'   : 'none',
      autoClosingBrackets: autoClosingBrackets ? 'always' : 'never',
      autoClosingQuotes:   autoClosingQuotes   ? 'always' : 'never',
      rulers: [],
    };
  }

  let monacoThemeReady = false;

  function ensureMonacoTheme(monaco) {
    if (monacoThemeReady) return;
    monaco.editor.defineTheme('pycodeflow-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1e1e1e',
        'editorLineNumber.foreground': '#9fb3c8',
        'editorLineNumber.activeForeground': '#ffffff',
        'editorGutter.background': '#071737',
        'editor.lineHighlightBackground': '#23272e',
        'editor.lineHighlightBorder': '#23272e'
      }
    });
    monacoThemeReady = true;
    // Zet correct thema op basis van huidige dark/light voorkeur
    const isDarkNow = document.documentElement.getAttribute('data-theme') === 'dark';
    monaco.editor.setTheme(isDarkNow ? 'pycodeflow-dark' : 'vs');
  }

  function loadMonaco() {
    if (window.monaco && window.monaco.editor) return Promise.resolve(window.monaco);
    return new Promise((resolve, reject) => {
      if (!window.require) return reject(new Error('Monaco loader niet gevonden'));
      // Sprint 12a-D: MonacoEnvironment geconfigureerd via monaco-env.js
      // Workers laden via blob: URLs — geen unsafe-eval meer nodig in CSP
      window.require.config({ paths: { vs: '/monaco/min/vs' } });
      window.require(['vs/editor/editor.main'], () => {
        if (!window.monaco) return reject(new Error('Monaco niet geladen'));
        resolve(window.monaco);
      }, reject);
    });
  }

  async function ensureEditor(owner, initialValue = '', assist = true, readOnly = false) {
    const host = qs(`${owner}-editor`);
    if (!host) return null;
    const monaco = await loadMonaco();
    ensureMonacoTheme(monaco);
    if (!editorStore[owner]) {
      editorStore[owner] = monaco.editor.create(host, {
        value: initialValue,
        ...monacoOptions(assist, readOnly)
      });
      // Sprint 10E+L: statusbalk en thema initialiseren
      const isTeacherOrFree = owner === 'teacher' || owner === 'free';
      applyEditorTheme(owner, _editorTheme);
      editorStore[owner].onDidChangeCursorPosition(() => {
        updateStatusbar(owner, editorStore[owner], isTeacherOrFree);
      });
      updateStatusbar(owner, editorStore[owner], isTeacherOrFree);

      editorStore[owner].onDidChangeModelContent(() => {
        renderCustomGutter(owner);
        if (editorStore[`${owner}ApplyingRemote`]) return;
        // Bewaar personal code lokaal als leerling op personal tab zit
        if (owner === 'student') {
          const visible = getStudentVisibleWorkspace(studentWorkspaceState);
          if (visible === 'personal') {
            studentWorkspaceState.localPersonalCode = editorStore[owner].getValue();
          }
          socket.emit('code_update', {
            codeText: editorStore[owner].getValue(),
            workspace: visible
          });
          // Syntax check voor leerling (persoonlijk werkblad of gedeeld)
          scheduleSyntaxCheck('student', '/api/syntax-check-student');
          return;
        }
        // Vrije editor stuurt geen code_update naar de server (geen sessie-sync)
        if (owner === 'free') {
          scheduleSyntaxCheck('free', '/api/syntax-check-student');
        } else {
          socket.emit('code_update', { codeText: editorStore[owner].getValue() });
          // Syntax check voor leerkracht
          scheduleSyntaxCheck('teacher', '/api/syntax-check');
        }
      });
      editorStore[owner].onDidScrollChange(() => syncCustomGutter(owner));
      editorStore[owner].onDidChangeCursorPosition(() => renderCustomGutter(owner));
      window.addEventListener('resize', () => layoutEditor(owner));
      layoutEditor(owner, true);
      renderCustomGutter(owner);
    } else {
      updateEditorConfig(owner, { assist, readOnly });
      if (editorStore[owner].getValue() !== initialValue) {
        setEditorValue(owner, initialValue);
      }
    }
    return editorStore[owner];
  }

  function updateEditorConfig(owner, { assist, readOnly, config = null }) {
    const editor = editorStore[owner];
    if (!editor) return;
    // Gebruik config als meegegeven, anders de globale _sessionConfig (voor student-editor)
    const effectiveConfig = config || (owner === 'student' ? _sessionConfig : {});
    editor.updateOptions(monacoOptions(assist, readOnly, effectiveConfig));
    layoutEditor(owner);
    renderCustomGutter(owner);
  }

  function setEditorValue(owner, value, resetView = false) {
    const editor = editorStore[owner];
    if (!editor) return;
    const flag = `${owner}ApplyingRemote`;
    editorStore[flag] = true;
    const model = editor.getModel();
    if (model && model.getValue() !== value) {
      if (resetView) {
        // Volledige reset: cursor en scroll naar het begin (bv. bij workspace-wissel)
        model.setValue(value);
      } else {
        // Gebruik pushEditOperations i.p.v. setValue:
        // - cursor blijft op exacte positie (geen reset naar begin)
        // - undo/redo history blijft intact (Ctrl+Z werkt nog)
        // - scroll-positie blijft bewaard
        // Dit is de standaard Monaco-aanpak voor externe code-updates (zoals VS Code bij Git-merges)
        try {
          editor.pushUndoStop();
          model.pushEditOperations(
            editor.getSelections() || [],
            [{ range: model.getFullModelRange(), text: value }],
            () => editor.getSelections() || []
          );
          editor.pushUndoStop();
        } catch {
          // Fallback naar setValue met cursor-herstel als pushEditOperations faalt
          const savedPosition = editor.getPosition();
          const savedScrollTop = editor.getScrollTop();
          const savedScrollLeft = editor.getScrollLeft();
          model.setValue(value);
          if (savedPosition) {
            const lineCount = model.getLineCount();
            const safeLine = Math.min(savedPosition.lineNumber, lineCount);
            const safeCol = Math.min(savedPosition.column, model.getLineMaxColumn(safeLine));
            editor.setPosition({ lineNumber: safeLine, column: safeCol });
          }
          editor.setScrollTop(savedScrollTop);
          editor.setScrollLeft(savedScrollLeft);
        }
      }
    }
    layoutEditor(owner, resetView);
    renderCustomGutter(owner);
    editorStore[flag] = false;
  }

  function getEditorValue(owner) {
    return editorStore[owner]?.getValue() || '';
  }

  // Syntax check: vraagt de server ast.parse() uit te voeren en markeert fouten in Monaco
  let syntaxCheckTimer = null;
  async function scheduleSyntaxCheck(owner, endpoint) {
    clearTimeout(syntaxCheckTimer);
    syntaxCheckTimer = setTimeout(async () => {
      const editor = editorStore[owner];
      if (!editor) return;
      const code = editor.getValue();
      if (!code.trim()) {
        monaco.editor.setModelMarkers(editor.getModel(), 'syntax', []);
        return;
      }
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const model = editor.getModel();
        if (!model) return;
        if (data.ok) {
          monaco.editor.setModelMarkers(model, 'syntax', []);
        } else if (data.error) {
          const { line, col, message } = data.error;
          monaco.editor.setModelMarkers(model, 'syntax', [{
            severity: monaco.MarkerSeverity.Error,
            startLineNumber: line || 1,
            startColumn:     col  || 1,
            endLineNumber:   line || 1,
            endColumn:       (col || 1) + 10,
            message:         message || 'Syntaxfout',
          }]);
        }
      } catch { /* stil falen — runner tijdelijk niet beschikbaar */ }
    }, 800); // 800ms debounce
  }

  function setAssistBadge(el, enabled) {
    if (!el) return;
    el.textContent = enabled ? 'Codehulp aan' : 'Codehulp uit';
  }

  function updateCreateAssistBadge() {
    const badge = qs('selected-assist-badge');
    if (badge) setAssistBadge(badge, selectedEditorAssist);
  }

  async function toggleSessionBlock(code) {
    await fetch(`/api/sessions/${encodeURIComponent(code)}/block-toggle`, { method: 'POST' });
    await loadSessions();
  }

  async function deleteSession(code) {
    await fetch(`/api/sessions/${encodeURIComponent(code)}`, { method: 'DELETE' });
    const current = getLS('teacherSessionCode');
    if (current === code) localStorage.removeItem('teacherSessionCode');
    await loadSessions();
  }

  function renderSessions(list, showClosed = false) {
    const host = qs('session-list');
    if (!host) return;
    const activeList = list.filter(s => !s.closed);
    const closedList = list.filter(s => s.closed);
    if (!activeList.length && !closedList.length) {
      host.innerHTML = `<div class="student-item"><strong>Nog geen lopende sessies</strong><div class="muted">Maak eerst een sessie aan.</div></div>`;
      return;
    }
    host.innerHTML = activeList.map(s => `
      <div class="session-row">
        <div class="session-row-main">
          <div class="session-title-row">
            <strong class="session-title">${escapeHtml(s.name)}</strong>
            <span class="badge ${s.status === 'geblokkeerd' ? 'badge-warn' : 'badge-success'}">${s.status}</span>
          </div>
          <div class="session-meta-grid">
            <div><span class="session-meta-label">Type</span><span class="session-meta-value">${s.mode === 'exam' ? 'Examenmodus' : 'Klasmodus'}</span></div>
            <div><span class="session-meta-label">Leerlingen</span><span class="session-meta-value">${s.studentCount}</span></div>
            <div><span class="session-meta-label">Code</span><span class="session-meta-value">${s.code}</span></div>
            <div><span class="session-meta-label">Codehulp</span><span class="session-meta-value">${s.editorAssist ? 'Aan' : 'Uit'}</span></div>
          </div>
        </div>
        <div class="session-row-actions">
          <button class="btn btn-soft small" type="button" data-open-session="${s.code}">Open</button>
          <button class="btn btn-muted small" type="button" data-observe-session="${s.code}" title="Read-only meekijken">👁 Waarnemen</button>
          <button class="btn ${s.status === 'geblokkeerd' ? 'btn-success' : 'btn-muted'} small" type="button" data-toggle-session="${s.code}">${s.status === 'geblokkeerd' ? 'Starten' : 'Blokkeren'}</button>
          <button class="btn btn-danger small" type="button" data-delete-session="${s.code}">Verwijderen</button>
        </div>
      </div>
    `).join('');
    host.querySelectorAll('[data-open-session]').forEach(btn => btn.addEventListener('click', () => {
      setLS('teacherSessionCode', btn.dataset.openSession);
      go('/teacher-app.html');
    }));
    host.querySelectorAll('[data-observe-session]').forEach(btn => btn.addEventListener('click', () => {
      setLS('observerSessionCode', btn.dataset.observeSession);
      setLS('teacherSessionCode', btn.dataset.observeSession);
      go('/teacher-app.html?observer=1');
    }));
    host.querySelectorAll('[data-toggle-session]').forEach(btn => btn.addEventListener('click', async () => {
      await toggleSessionBlock(btn.dataset.toggleSession);
    }));
    host.querySelectorAll('[data-delete-session]').forEach(btn => btn.addEventListener('click', async () => {
      await deleteSession(btn.dataset.deleteSession);
    }));
    // Sprint 11B: gesloten sessies onderaan, grijs, enkel Export knop
    if (showClosed && closedList.length) {
      const closedHtml = '<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);"><p class="muted" style="font-size:0.82rem;margin-bottom:8px;">🔒 Gesloten sessies</p>' +
        closedList.map(s => `
          <div class="session-row" style="opacity:0.6;background:var(--surface-soft);">
            <div class="session-row-main">
              <div class="session-title-row">
                <strong class="session-title">${escapeHtml(s.name || s.code)}</strong>
                <span class="badge">${s.mode === 'exam' ? 'Examen' : 'Klas'} · Gesloten</span>
              </div>
              <div class="session-meta-grid">
                <div><span class="session-meta-label">Code</span><span class="session-meta-value">${s.code}</span></div>
                <div><span class="session-meta-label">Datum</span><span class="session-meta-value">${new Date(s.createdAt).toLocaleString('nl-BE',{dateStyle:'short',timeStyle:'short'})}</span></div>
              </div>
            </div>
            <div class="session-row-actions">
              <a class="btn btn-muted small" href="/api/sessions/${encodeURIComponent(s.code)}/export" target="_blank">⬇ Export</a>
            </div>
          </div>`).join('') + '</div>';
      host.innerHTML += closedHtml;
    }
  }

  // ── Code history playback ──────────────────────────────────────────────────
  function showHistoryPlayback(studentName, snapshots) {
    // Verwijder eventueel bestaand playback modal
    document.getElementById('history-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'history-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:20px;';

    const total = snapshots.length;
    let current = 0;
    let playing = false;
    let playInterval = null;

    modal.innerHTML = `
      <div style="background:var(--surface);border-radius:20px;box-shadow:var(--shadow);width:100%;max-width:780px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong style="font-size:1rem;">📜 Code-geschiedenis: ${escapeHtml(studentName)}</strong>
            <div style="font-size:0.8rem;color:var(--muted);margin-top:2px;">${total} snapshots</div>
          </div>
          <button onclick="document.getElementById('history-modal').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--muted);">✕</button>
        </div>
        <div id="history-code-display" style="flex:1;overflow:auto;padding:16px;background:#1e1e1e;font-family:Consolas,monospace;font-size:0.88rem;color:#d4d4d4;white-space:pre;min-height:200px;max-height:400px;line-height:1.5;"></div>
        <div style="padding:16px 20px;border-top:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;font-size:0.78rem;color:var(--muted);margin-bottom:6px;">
            <span id="history-time-label">—</span>
            <span id="history-pos-label">1 / ${total}</span>
          </div>
          <input type="range" id="history-slider" min="0" max="${total - 1}" value="0" style="width:100%;accent-color:var(--primary);margin-bottom:12px;"/>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
            <button id="hist-prev" class="btn btn-muted small">⏮ Vorige</button>
            <button id="hist-play" class="btn btn-soft small">▶ Afspelen</button>
            <button id="hist-next" class="btn btn-muted small">Volgende ⏭</button>
            <select id="hist-speed" style="padding:5px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:0.85rem;">
              <option value="2000">Langzaam</option>
              <option value="1000" selected>Normaal</option>
              <option value="500">Snel</option>
              <option value="200">Zeer snel</option>
            </select>
          </div>
        </div>
      </div>`;

    function showSnapshot(idx) {
      current = Math.max(0, Math.min(total - 1, idx));
      const snap = snapshots[current];
      document.getElementById('history-code-display').textContent = snap.code;
      document.getElementById('history-slider').value = current;
      document.getElementById('history-pos-label').textContent = `${current + 1} / ${total}`;
      const dt = new Date(snap.timestamp).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      document.getElementById('history-time-label').textContent = dt;
    }

    function stopPlay() {
      playing = false;
      clearInterval(playInterval);
      const btn = document.getElementById('hist-play');
      if (btn) btn.textContent = '▶ Afspelen';
    }

    function startPlay() {
      playing = true;
      const btn = document.getElementById('hist-play');
      if (btn) btn.textContent = '⏸ Pauzeer';
      const speed = parseInt(document.getElementById('hist-speed')?.value || '1000');
      playInterval = setInterval(() => {
        if (current >= total - 1) { stopPlay(); return; }
        showSnapshot(current + 1);
      }, speed);
    }

    showSnapshot(0);
    document.body.appendChild(modal);

    document.getElementById('hist-prev').addEventListener('click', () => { stopPlay(); showSnapshot(current - 1); });
    document.getElementById('hist-next').addEventListener('click', () => { stopPlay(); showSnapshot(current + 1); });
    document.getElementById('hist-play').addEventListener('click', () => playing ? stopPlay() : startPlay());
    document.getElementById('history-slider').addEventListener('input', e => { stopPlay(); showSnapshot(parseInt(e.target.value)); });
    modal.addEventListener('click', e => { if (e.target === modal) { stopPlay(); modal.remove(); } });
  }

  // ── Herbruikbare student list renderer ────────────────────────────────────
  // Wordt aangeroepen vanuit teacher_session_data EN vanuit de zoekfilter.
  function renderStudentList(data) {
    const host = qs('teacher-student-list');
    if (!host) return;
    const isExamMode = data.session.mode === 'exam';
    const filterTerm = (qs('student-filter-input')?.value || '').toLowerCase().trim();
    const statusFilter = window._statusFilter || null;
    const students = (data.students || []).filter(s => {
      if (filterTerm && !s.name.toLowerCase().includes(filterTerm)) return false;
      // Sprint 10O: statusfilter
      if (statusFilter === 'done'  && !s.isDone) return false;
      if (statusFilter === 'hand'  && !s.handRaised) return false;
      if (statusFilter === 'tab'   && !s.tabHidden) return false;
      return true;
    });

    if (!students.length) {
      host.innerHTML = filterTerm
        ? `<div class="muted" style="padding:12px; font-size:0.88rem;">Geen leerlingen gevonden voor "<strong>${escapeHtml(filterTerm)}</strong>".</div>`
        : `<div class="muted" style="padding:12px; font-size:0.88rem;">Nog geen leerlingen verbonden.</div>`;
      return;
    }

    host.innerHTML = students.map(s => {
      // Klaar-badge
      const doneBadge = s.isDone
        ? `<span class="tab-badge tab-badge-done" title="Leerling heeft oefening afgerond">✓ Klaar</span>`
        : '';

      // Tab-badge (enkel examenmodus)
      let tabBadge = '';
      if (isExamMode) {
        if (s.tabHidden) {
          tabBadge = `<span class="tab-badge tab-badge-danger" title="Leerling heeft tab verlaten">⚠️ Tab verlaten (${s.tabHiddenCount}×)</span>`;
        } else if (s.tabHiddenCount > 0) {
          const durStr = s.tabLastDurationMs ? ` — ${Math.round(s.tabLastDurationMs / 1000)}s` : '';
          const cls = s.tabHiddenCount >= 3 ? 'tab-badge-warn-high' : 'tab-badge-warn';
          tabBadge = `<span class="tab-badge ${cls}" title="${s.tabHiddenCount}× tab verlaten">👁 ${s.tabHiddenCount}× weg${durStr}</span>`;
        }
      }
      // Hand-badge
      const handBadge = s.handRaised
        ? `<span class="tab-badge tab-badge-hand">✋ Hand op</span>`
        : '';

      // Sprint 10Q: run-status icoon
      const runStatusIcon = {
        'running':       '<span class="run-status-icon run-status-running" title="Code loopt">▶</span>',
        'waiting_input': '<span class="run-status-icon run-status-waiting" title="Wacht op invoer">⌨️</span>',
        'queued':        '<span class="run-status-icon run-status-queued" title="In wachtrij">⏳</span>',
        'idle':          '',
      }[s.runStatus || 'idle'] || '';

      // Sprint 13B+C: join badge met inline acties
      const badgeHtml = {
        'new':     `<span class="join-badge join-badge-new" title="Onbekende leerling">⚠️ Nieuw</span>
                    <button class="btn-badge-action" onclick="window._teacherBadgeAction('${s.id}','accept')" title="Aanvaarden">✓</button>
                    <select class="badge-class-select" onchange="if(this.value) window._teacherAssignClass('${s.id}',this.value)" style="font-size:0.75rem;padding:2px 4px;border-radius:6px;border:1px solid var(--border);">
                      <option value="">→ Klas</option>
                      ${(window._classesList||[]).map(cl => `<option value="${cl.id}">${escapeHtml(cl.name)}</option>`).join('')}
                    </select>`,
        'pending': `<span class="join-badge join-badge-pending" title="In afwachting van bevestiging">⏳ Afwachting</span>
                    <button class="btn-badge-action" onclick="window._teacherBadgeAction('${s.id}','accept')" title="Aanvaarden">✓</button>`,
        'guest':   `<span class="join-badge join-badge-guest" title="Gast — geen klas">👤 Gast</span>`,
        'blocked': `<span class="join-badge join-badge-blocked" title="Geblokkeerd">✕ Geblokkeerd</span>`,
      }[s.joinBadge] || '';

      return `
      <div class="student-item${isExamMode && s.tabHidden ? ' student-item-alert' : ''}${s.handRaised ? ' student-item-hand' : ''}">
        <div class="student-head">
          <div>
            <strong>${escapeHtml(s.name)}</strong> ${runStatusIcon}
            ${doneBadge}${handBadge}${tabBadge}
            ${badgeHtml}
            <br/><span class="muted">${s.online ? 'online' : 'offline'}</span>
          </div>
        </div>
        <div class="row" style="flex-wrap:wrap; gap:4px; margin-top:6px;">
          ${s.isDone ? `<button class="btn btn-muted small" data-reset-done="${s.id}" title="Klaar-status wissen">✓ Reset</button>` : ''}
          ${s.handRaised ? `<button class="btn btn-warn small" data-lower-hand="${s.id}">✋ Wissen</button>` : ''}
          <button class="btn btn-muted small" data-show-history="${s.id}" title="Bekijk code-geschiedenis van ${escapeHtml(s.name)}">📜 History</button>
          ${isExamMode
            ? `<button class="btn btn-soft small" data-live-control="${s.id}">Live control</button>
               <button class="btn btn-muted small" data-remove-student="${s.id}">Verwijderen</button>`
            : `<button class="btn ${s.canRun ? 'btn-success' : 'btn-danger'} small" data-toggle-student="${s.id}" data-field="run">${s.canRun ? 'Run aan' : 'Run uit'}</button>
               <button class="btn ${s.canEdit ? 'btn-success' : 'btn-danger'} small" data-toggle-student="${s.id}" data-field="code">${s.canEdit ? 'Code aan' : 'Code uit'}</button>
               <button class="btn btn-muted small" data-remove-student="${s.id}">Verwijderen</button>`
          }
        </div>
      </div>`;
    }).join('');

    // Event listeners na render
    host.querySelectorAll('[data-toggle-student]').forEach(btn => btn.addEventListener('click', () =>
      socket.emit('teacher_toggle_student', { studentId: btn.dataset.toggleStudent, field: btn.dataset.field })
    ));
    host.querySelectorAll('[data-remove-student]').forEach(btn => btn.addEventListener('click', () =>
      socket.emit('teacher_remove_student', { studentId: btn.dataset.removeStudent })
    ));
    host.querySelectorAll('[data-reset-done]').forEach(btn => btn.addEventListener('click', () =>
      socket.emit('teacher_reset_done', { studentId: btn.dataset.resetDone })
    ));
    host.querySelectorAll('[data-lower-hand]').forEach(btn => btn.addEventListener('click', () =>
      socket.emit('teacher_lower_hand', { studentId: btn.dataset.lowerHand })
    ));
    host.querySelectorAll('[data-live-control]').forEach(btn => btn.addEventListener('click', () => {
      socket.emit('teacher_select_student', { studentId: btn.dataset.liveControl });
      qs('teacher-output-panel').textContent = '';
      setTab('teacher', 'code');
      layoutEditor('teacher', true);
    }));
    host.querySelectorAll('[data-show-history]').forEach(btn => btn.addEventListener('click', async () => {
      const sid = btn.dataset.showHistory;
      const sessionCode = getLS('teacherSessionCode');
      if (!sessionCode) return;
      try {
        const r = await fetch(`/api/sessions/${sessionCode}/history/${sid}`);
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          if (r.status === 404) {
            alert('Leerling of sessie niet gevonden.');
          } else if (r.status === 500 && err.error?.includes('no such table')) {
            alert('Code-geschiedenis nog niet beschikbaar.\nDe server moet opnieuw opgestart worden om de snapshot-tabel aan te maken.\nVoer uit: docker compose restart web');
          } else {
            alert(`Fout bij laden history: ${err.error || r.status}`);
          }
          return;
        }
        const { studentName, snapshots } = await r.json();
        if (!snapshots || !snapshots.length) {
          alert(`Nog geen code-snapshots voor ${studentName}.\nSnapshots worden elke 10 seconden opgeslagen na het begin van het typen.`);
          return;
        }
        showHistoryPlayback(studentName, snapshots);
      } catch(e) { alert(`Netwerkfout bij laden history: ${e.message}`); }
    }));
  }

  async function loadTemplates() {
    try {
      const r = await fetch('/api/templates');
      if (!r.ok) return;
      const { templates } = await r.json();
      const sel = qs('template-select');
      if (!sel || !templates) return;
      templates.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.name} — ${t.description}`;
        opt.dataset.code = t.code;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => {
        const selected = sel.options[sel.selectedIndex];
        const preview = qs('template-preview');
        if (!preview) return;
        if (selected.value && selected.dataset.code) {
          preview.textContent = selected.dataset.code;
          preview.style.display = 'block';
        } else {
          preview.style.display = 'none';
        }
      });
    } catch(e) { /* stil falen */ }
  }

  async function loadFreeStudents() {
    try {
      const r = await fetch('/api/free-students');
      if (!r.ok) return;
      const list = await r.json();
      renderFreeStudents(list);
    } catch (e) { /* server niet bereikbaar */ }
  }

  function renderFreeStudents(list) {
    const host = qs('free-student-list');
    const countBadge = qs('free-session-count');
    if (!host) return;
    if (countBadge) countBadge.textContent = `${list.length} actief`;

    if (!list.length) {
      host.innerHTML = '<div class="free-empty">Niemand is momenteel aan het vrij oefenen.</div>';
      return;
    }

    host.innerHTML = list.map(s => {
      const joined = new Date(s.joinedAt);
      const timeStr = joined.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="free-student-item">
          <div>
            <strong>${escapeHtml(s.name)}</strong>
            <span class="free-student-meta"> — ${escapeHtml(s.className)}</span>
            <div class="free-student-meta">Gejoind om ${timeStr}</div>
          </div>
          <button class="btn btn-danger small" data-kick-free="${escapeHtml(s.id)}" title="Verwijder uit vrije sessie">
            Verwijderen
          </button>
        </div>`;
    }).join('');

    host.querySelectorAll('[data-kick-free]').forEach(btn => {
      btn.addEventListener('click', () => {
        socket.emit('teacher_remove_free_student', { freeId: btn.dataset.kickFree });
      });
    });
  }

  async function loadSessions(includeClosed = false) {
    try {
      const url = includeClosed ? '/api/sessions?includeClosed=true' : '/api/sessions';
      const r = await fetch(url);
      if (!r.ok) return;
      const sessions = await r.json();
      renderSessions(sessions, includeClosed);
      const ts = qs('sessions-last-updated');
      if (ts) ts.textContent = new Date().toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch(e) { /* stil falen */ }
  }

  if (page === 'index.html' || page === 'landing.html' || page === '') {
    qs('go-student-start')?.addEventListener('click', () => go('/student-start.html'));
    qs('go-teacher-sessions')?.addEventListener('click', () => go('/teacher-sessions.html'));
  }

  // Sprint 16: tab switcher voor teacher-sessions
  window.showTab = function(name, btn) {
    document.getElementById('tab-sessions').style.display = name === 'sessions' ? '' : 'none';
    const quizDiv = document.getElementById('tab-quizzes');
    if (quizDiv) quizDiv.style.display = name === 'quizzes' ? '' : 'none';
    document.querySelectorAll('.active-tab').forEach(b => b.classList.remove('active-tab'));
    if (btn) btn.classList.add('active-tab');
    if (name === 'quizzes') loadQuizSessions();
  };

  async function loadQuizSessions() {
    try {
      // Haal sessies op en filter op mode='quiz'
      const r = await fetch('/api/sessions?includeClosed=true');
      if (!r.ok) return;
      const sessions = await r.json();
      const quizzes = sessions.filter(s => s.mode === 'quiz');
      const el = document.getElementById('quiz-list');
      if (!el) return;
      if (!quizzes.length) {
        el.innerHTML = '<p class="muted">Nog geen toetsen aangemaakt. Klik op "+ Nieuwe toets aanmaken".</p>';
        return;
      }
      el.innerHTML = quizzes.map(q => `
        <div class="student-item" style="margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <div>
              <strong>${escapeHtml(q.name || q.code)}</strong>
              <span class="badge" style="margin-left:6px;">Toets</span>
              ${q.closed ? '<span class="badge" style="background:#fee2e2;color:#991b1b;margin-left:4px;">Gesloten</span>' : ''}
            </div>
            <div class="muted" style="font-size:0.82rem;margin-left:auto;">
              Code: <strong>${q.code}</strong> ·
              ${new Date(q.createdAt).toLocaleDateString('nl-BE',{day:'2-digit',month:'2-digit',year:'numeric'})}
            </div>
            <div style="display:flex;gap:6px;">
              <a class="btn btn-muted small" href="/quiz-review.html?code=${q.code}">✏️ Verbeteren</a>
              <button class="btn btn-muted small" onclick="duplicateQuiz('${q.code}')">📋 Dupliceren</button>
            </div>
          </div>
        </div>`).join('');
    } catch {}
  }

  window.duplicateQuiz = async function(code) {
    const name = prompt('Naam voor de kopie:', '');
    if (name === null) return;
    const r = await fetch('/api/quiz/' + code + '/duplicate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name: name || undefined }),
    });
    const data = await r.json();
    if (data.ok) { alert('Toets gekopieerd! Nieuwe code: ' + data.code); loadQuizSessions(); }
    else alert('Fout: ' + data.error);
  };

  if (page === 'teacher-sessions.html') {
    // Sprint 11B: toggle gesloten sessies
    const closedToggle = document.getElementById('show-closed-toggle');
    if (closedToggle) {
      closedToggle.addEventListener('change', () => loadSessions(closedToggle.checked));
    }

    // Sprint 11E: autocheck badge ophalen
    async function loadAutocheckBadge() {
      try {
        const r = await apiFetch('/api/stress-test/autocheck-status');
        if (!r.ok) return;
        const { lastAutocheck } = await r.json();
        const badge = document.getElementById('autocheck-badge');
        if (!badge || !lastAutocheck) return;
        const ts = new Date(lastAutocheck.timestamp).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' });
        badge.style.display = 'inline-block';
        if (lastAutocheck.ok) {
          badge.style.background = '#d1fae5';
          badge.style.color = '#065f46';
          badge.textContent = `✅ Systeemcheck OK · ${ts}`;
        } else {
          badge.style.background = '#fee2e2';
          badge.style.color = '#991b1b';
          badge.textContent = `❌ Systeemcheck gefaald · ${ts}`;
        }
      } catch {}
    }
    loadAutocheckBadge();
    setInterval(loadAutocheckBadge, 5 * 60 * 1000); // elke 5 min bijwerken
    loadSessions();
    loadTemplates();
    const checkbox = qs('editor-assist-enabled');
    checkbox?.addEventListener('change', () => {
      selectedEditorAssist = checkbox.checked;
      updateCreateAssistBadge();
    });
    document.querySelectorAll('[data-mode-select]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedMode = btn.dataset.modeSelect;
        document.querySelectorAll('[data-mode-select]').forEach(b => b.classList.toggle('active', b === btn));
        qs('selected-mode-badge').textContent = selectedMode === 'exam' ? 'Examenmodus' : 'Klasmodus';
        if (checkbox) {
          checkbox.checked = selectedMode === 'class';
          selectedEditorAssist = checkbox.checked;
          updateCreateAssistBadge();
        }
      });
    });
    updateCreateAssistBadge();
    qs('create-session-btn')?.addEventListener('click', () => {
      const templateSel = qs('template-select');
      const templateCode = templateSel?.value
        ? (templateSel.options[templateSel.selectedIndex]?.dataset?.code || '')
        : '';
      socket.emit('teacher_create_session', {
        name: qs('session-name').value.trim() || 'Nieuwe sessie',
        mode: selectedMode,
        editorAssist: selectedEditorAssist,
        templateCode: templateCode || undefined,
      });
    });
    socket.on('session_created', ({ code }) => {
      setLS('teacherSessionCode', code);
      go('/teacher-app.html');
    });

    // Vrije sessie: laad initieel en abonneer op live updates
    loadFreeStudents();
    socket.on('free_students_updated', () => loadFreeStudents());

    // Auto-refresh sessieoverzicht via Socket.IO
    socket.on('sessions_updated', () => loadSessions());

    // Manuele refresh knop
    qs('sessions-refresh-btn')?.addEventListener('click', () => {
      const btn = qs('sessions-refresh-btn');
      if (btn) { btn.textContent = '↻'; btn.disabled = true; }
      loadSessions().finally(() => {
        if (btn) { btn.disabled = false; }
      });
    });
  }

  if (page === 'student-start.html') {
    // Sprint 13B: klas-dropdown initialiseren
    (async () => {
      const loading = document.getElementById('student-class-loading');
      const selectEl = document.getElementById('student-class-select');
      const inputEl  = document.getElementById('student-class');
      try {
        const r = await fetch('/api/classes');
        const classes = await r.json();
        if (loading) loading.style.display = 'none';
        if (classes.length > 0) {
          // Dropdown beschikbaar
          classes.forEach(cls => {
            const opt = document.createElement('option');
            opt.value = cls.name;
            opt.textContent = cls.name;
            selectEl?.appendChild(opt);
          });
          if (selectEl) selectEl.style.display = '';
          // Herstel vorige keuze
          const saved = localStorage.getItem('pycodeflow_student_class');
          if (saved && selectEl) {
            const match = [...selectEl.options].find(o => o.value === saved);
            if (match) selectEl.value = saved;
          }
        } else {
          // Geen klassen — gebruik vrij tekstveld
          if (inputEl) inputEl.style.display = '';
        }
      } catch {
        if (loading) loading.style.display = 'none';
        if (inputEl) inputEl.style.display = ''; // fallback bij API fout
      }
    })();
    const nameInput = qs('student-name');
    const codeInput = qs('student-code');
    if (nameInput) {
      nameInput.autocomplete = 'off';
      if (normalizeStudentFieldValue(nameInput.value, 'name') === '') nameInput.value = '';
    }
    if (codeInput) {
      codeInput.autocomplete = 'off';
      if (normalizeStudentFieldValue(codeInput.value, 'code') === '') codeInput.value = '';
    }

    const submitStudentJoin = () => {
      const name = normalizeStudentFieldValue(qs('student-name')?.value, 'name');
      const code = normalizeStudentFieldValue(qs('student-code')?.value, 'code');
      // Sprint 13B: klas ophalen uit dropdown of vrij tekstveld
      const selectEl = document.getElementById('student-class-select');
      const inputEl  = document.getElementById('student-class');
      const className = ((selectEl?.style.display !== 'none' ? selectEl?.value : inputEl?.value) || '').trim();
      if (className) localStorage.setItem('pycodeflow_student_class', className);
      const errorEl = qs('student-start-error');
      if (!name) {
        if (errorEl) errorEl.textContent = 'Geef eerst je naam in. De placeholder telt niet als naam.';
        qs('student-name')?.focus();
        return;
      }
      if (!code) {
        if (errorEl) errorEl.textContent = 'Geef eerst je sessiecode in.';
        qs('student-code')?.focus();
        return;
      }
      if (errorEl) errorEl.textContent = '';
      socket.emit('student_join', { name, code, className });
    };

    qs('student-join-btn')?.addEventListener('click', submitStudentJoin);
    qs('student-name')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitStudentJoin();
    });
    qs('student-code')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitStudentJoin();
    });

    // Vrij oefenen: geen sessiecode nodig, wel naam en klas
    const submitFreeJoin = () => {
      const name = normalizeStudentFieldValue(qs('student-name')?.value, 'name');
      // Sprint 13B: klas uit dropdown of tekstveld
      const selectEl = document.getElementById('student-class-select');
      const inputEl  = document.getElementById('student-class');
      const className = ((selectEl?.style.display !== 'none' ? selectEl?.value : inputEl?.value) || '').trim();
      if (className) localStorage.setItem('pycodeflow_student_class', className);
      const errorEl = qs('student-start-error');
      if (!name) {
        if (errorEl) errorEl.textContent = 'Geef eerst je naam in.';
        qs('student-name')?.focus();
        return;
      }
      if (errorEl) errorEl.textContent = '';
      setLS('freeStudentName', name);
      setLS('freeStudentClass', className);
      socket.emit('student_join_free', { name, className });
    };

    qs('student-free-btn')?.addEventListener('click', submitFreeJoin);

    socket.on('free_session_state', data => {
      setLS('freeStudentName', data.name);
      setLS('freeStudentClass', data.className);
      setLS('freeSessionCode', data.code);
      go('/free-editor.html');
    });

    socket.on('student_state', data => {
      setLS('studentSessionCode', data.session.code);
      setLS('studentId', data.student.id);
      setLS('studentName', data.student.name);
      setLS('studentState', data);
      go('/student-app.html');
    });
    socket.on('error_message', msg => {
      const el = qs('student-start-error');
      if (el) el.textContent = msg;
    });
  }

  // ── Vrije editor pagina ────────────────────────────────────────────────────
  if (page === 'free-editor.html') {
    // Sprint 19a: code bewaren in localStorage
    (async () => {
      await ensureEditor('free', '', true, false, {});
      // Herstel opgeslagen code
      const savedCode = localStorage.getItem('pycodeflow_free_code');
      if (savedCode && editorStore['free']) {
        editorStore['free'].setValue(savedCode);
      }
      // Elke 5s opslaan
      setInterval(() => {
        const code = editorStore['free']?.getValue();
        if (code !== undefined) localStorage.setItem('pycodeflow_free_code', code);
      }, 5000);
    })();
    const name = getLS('freeStudentName', '');
    const className = getLS('freeStudentClass', '');

    // Als er geen naam/klas in localStorage staat, terugsturen naar start
    if (!name || !className) { go('/student-start.html'); return; }

    // Badges invullen
    const nameBadge = qs('free-name-badge');
    const classBadge = qs('free-class-badge');
    if (nameBadge) nameBadge.textContent = name;
    if (classBadge) classBadge.textContent = className;

    // Herverbinden of nieuw joinen
    socket.emit('student_join_free', { name, className });

    // Editor initialiseren zodra server bevestigt
    // Sprint 10M: free editor kopieer knoppen
    qs('free-copy-code-btn')?.addEventListener('click', () =>
      copyToClipboard(getEditorValue('free') || '', qs('free-copy-code-btn'))
    );
    qs('free-copy-output-btn')?.addEventListener('click', () =>
      copyToClipboard(qs('free-output-panel')?.textContent || '', qs('free-copy-output-btn'))
    );
    // Sprint 10U: auto-scroll
    setupAutoScroll('free-output-panel');

    let _freeRunActive = false;
    socket.on('free_session_state', async data => {
      const assistBadge = qs('free-editor-assist');
      if (assistBadge) setAssistBadge(assistBadge, data.editorAssist !== false);
      await ensureEditor('free', data.code || '', data.editorAssist !== false, false);
      updateEditorConfig('free', { assist: data.editorAssist !== false, readOnly: false });
      if (!_freeRunActive) disableInput('free'); // Niet disablen tijdens actieve run
    });

    // Run-knop
    qs('free-run-btn')?.addEventListener('click', () => {
      _freeRunActive = true;
      const panel = qs('free-output-panel');
      if (panel) panel.textContent = '';
      const code = getEditorValue('free');
      socket.emit('free_run_request', { codeText: code });
    });
    // Ctrl+Enter shortcut voor Run (vrije editor)
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        qs('free-run-btn')?.click();
      }
    });

    // Enter in input-veld
    qs('free-runtime-input')?.addEventListener('input', () => {
      _freeUserTyped = true; // Gebruiker heeft actief iets getypt of gewist
    });
    qs('free-runtime-input')?.addEventListener('keyup', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        freeSendInput(); // _freeUserTyped vereist
      }
    });
    let _freeInputSent = false;
    let _freeUserTyped = false; // Wordt true zodra gebruiker echt iets typt

    let _freeMouseClick = false; // Wordt true bij echte muisklik op de knop

    function freeSendInput() {
      if (_freeInputSent) return;
      const inputEl = qs('free-runtime-input');
      const btn = qs('free-send-input-btn');
      if (!inputEl || !btn || btn.disabled) return;
      // Verzenden enkel als: gebruiker heeft getypt OF bewust met muis geklikt
      if (!_freeUserTyped && !_freeMouseClick) return;
      _freeInputSent = true;
      _freeUserTyped = false;
      _freeMouseClick = false;
      const val = inputEl.value;
      socket.emit('free_runtime_input', { value: val });
      disableInput('free');
    }

    // Muis-klik: zet vlag VOOR click event (mousedown komt eerst)
    qs('free-send-input-btn')?.addEventListener('mousedown', () => { _freeMouseClick = true; });
    qs('free-send-input-btn')?.addEventListener('click', () => freeSendInput());

    socket.on('free_input_request', () => {
      _freeInputSent = false;
      _freeUserTyped = false;
      enableInput('free');
    });

    // Tab-knoppen
    document.querySelectorAll('[data-owner="free"][data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        setTab('free', tab);
        if (tab === 'code') {
          document.querySelectorAll('[data-owner="free"][data-tab]').forEach(b =>
            b.classList.toggle('active', b === btn));
        }
      });
    });

    // Output events
    socket.on('free_run_output', ({ output }) => {
      const panel = qs('free-output-panel');
      if (panel) panel.textContent = output;
      setTab('free', 'output');
      autoScrollOutput('free-output-panel'); // Sprint 10U
      document.querySelectorAll('[data-owner="free"][data-tab]').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === 'output'));
    });
    socket.on('free_run_queued', ({ position }) => {
      const panel = qs('free-output-panel');
      if (panel) {
        // Sprint 11D: pulserende animatie + tijdschatting
        const estSec = (position || 1) * 8; // ~8s per run gemiddeld
        panel.innerHTML = `<span class="queue-pulse">⏳</span> In wachtrij — positie <strong>${position}</strong> · geschatte wachttijd ~${estSec}s`;
      }
      setTab('free', 'output');
    });


    // free_run_input_echo: echo zit nu in server-side outputAccum
    // client-side handler niet nodig (zou dubbele echo veroorzaken)
    socket.on('free_run_input_echo', () => { /* echo verwerkt via free_run_output */ });
    socket.on('free_run_end', () => {
      _freeRunActive = false;
      disableInput('free');
    });
    socket.on('free_run_rate_limited', ({ waitMs }) => {
      const panel = qs('free-output-panel');
      if (panel) {
        panel.textContent = `⏳ Even wachten — je kan opnieuw runnen over ${Math.ceil(waitMs / 1000)} seconde(n).`;
        setTab('free', 'output');
        document.querySelectorAll('[data-owner="free"][data-tab]').forEach(b =>
          b.classList.toggle('active', b.dataset.tab === 'output'));
      }
    });

    // Leerkracht heeft deze leerling verwijderd uit de vrije sessie
    socket.on('force_landing', () => {
      localStorage.removeItem('freeStudentName');
      localStorage.removeItem('freeStudentClass');
      localStorage.removeItem('freeSessionCode');
      go('/index.html');
    });
  }

  if (page === 'teacher-app.html') {
    const code = getLS('teacherSessionCode');
    if (!code) go('/teacher-sessions.html');
    socket.emit('teacher_join_session', { code });

    // Tab-klik: wissel paneel en stuur in klasmodus een force_panel naar alle leerlingen
    document.querySelectorAll('[data-owner="teacher"][data-tab]').forEach(btn => btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      setTab('teacher', tab);
      // Fix bug §7: bij klik op Code-tabblad → stuur force_panel naar alle leerlingen
      if (tab === 'code') socket.emit('teacher_force_panel', { panel: 'code' });
    }));

    qs('teacher-run-btn')?.addEventListener('click', () => {
      qs('teacher-output-panel').textContent = '';
      socket.emit('run_request', {
        codeText: getEditorValue('teacher'),
        workspace: 'shared'
      });
    });
    // Ctrl+Enter shortcut voor Run (leerkracht)
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        qs('teacher-run-btn')?.click();
      }
    });
    qs('toggle-run-all-btn')?.addEventListener('click', () => socket.emit('teacher_toggle_all', { field: 'run' }));
    qs('teacher-toggle-workspace-btn')?.addEventListener('click', () => socket.emit('teacher_toggle_class_workspace'));
    qs('toggle-code-all-btn')?.addEventListener('click', () => socket.emit('teacher_toggle_all', { field: 'code' }));
    qs('teacher-close-session-btn')?.addEventListener('click', () => {
      const online = (window._lastTeacherSessionData?.students || []).filter(s => s.online).length;
      const msg = online > 0
        ? `Weet je zeker dat je de sessie wil sluiten? ${online} leerling${online===1?'':'en'} ${online===1?'is':'zijn'} nog verbonden.`
        : 'Weet je zeker dat je de sessie wil sluiten?';
      if (confirm(msg)) socket.emit('teacher_close_session');
    });

    // Timer/countdown widget
    qs('teacher-timer-start-btn')?.addEventListener('click', () => {
      const minutes = parseInt(qs('teacher-timer-input')?.value || '5', 10);
      if (!minutes || minutes < 1) return;
      socket.emit('teacher_start_timer', { durationMs: minutes * 60 * 1000 });
    });
    qs('teacher-timer-stop-btn')?.addEventListener('click', () => {
      socket.emit('teacher_stop_timer');
    });
    socket.on('timer_update', ({ remainingMs, running }) => {
      // Alleen verwerken op de teacher-app pagina
      const display = qs('teacher-timer-display');
      if (!display) return; // niet op student-pagina
      if (!running || remainingMs <= 0) {
        display.textContent = '—';
        display.style.color = 'var(--text)';
        return;
      }
      const m = Math.floor(remainingMs / 60000);
      const s = Math.floor((remainingMs % 60000) / 1000);
      display.textContent = `${m}:${String(s).padStart(2, '0')}`;
      display.style.color = remainingMs < 60000 ? 'var(--accent)' : 'var(--text)';
    });
    qs('teacher-export-btn')?.addEventListener('click', () => {
      const code = getLS('teacherSessionCode');
      if (code) window.open(`/api/sessions/${code}/export`, '_blank');
    });

    // Reset alle klaar-statussen
    qs('teacher-reset-all-done-btn')?.addEventListener('click', () => {
      socket.emit('teacher_reset_all_done');
    });

    // Snippet sturen/wissen
    // Annotatie panel toggle
    // Sprint 10N: overzichtsmodus (grid view)
    let _gridViewActive = false;
    qs('teacher-grid-view-btn')?.addEventListener('click', () => {
      _gridViewActive = !_gridViewActive;
      const btn = qs('teacher-grid-view-btn');
      const gridPanel = qs('teacher-grid-view-panel');
      const studentList = qs('teacher-student-list');
      if (!gridPanel) return;
      if (_gridViewActive) {
        btn && (btn.textContent = '≡ Lijst');
        studentList && studentList.classList.add('hidden');
        gridPanel.classList.remove('hidden');
        renderGridView(window._lastTeacherSessionData);
      } else {
        btn && (btn.textContent = '⊞ Overzicht');
        studentList && studentList.classList.remove('hidden');
        gridPanel.classList.add('hidden');
      }
    });

    function renderGridView(data) {
      const panel = qs('teacher-grid-view-panel');
      if (!panel || !data) return;
      const students = data.students || [];
      if (!students.length) {
        panel.innerHTML = '<p class="muted" style="padding:8px;">Geen leerlingen verbonden.</p>';
        return;
      }
      panel.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;';
      panel.innerHTML = students.map(s => {
        const codePreview = (s.code || s.personalCode || '').split('\n').slice(0,3).join('\n');
        const statusColor = s.runStatus === 'running' ? '#4ade80' : s.runStatus === 'waiting_input' ? '#60a5fa' : 'transparent';
        return `<div class="student-grid-card" data-grid-live="${s.id}" style="border:2px solid ${statusColor};border-radius:10px;padding:8px;background:var(--surface);cursor:pointer;min-height:100px;overflow:hidden;">
          <div style="font-weight:700;font-size:0.82rem;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(s.name)}</div>
          <div style="font-size:0.72rem;color:var(--muted);margin-bottom:6px;">${s.online ? '● online' : '○ offline'}${s.handRaised ? ' ✋' : ''}${s.isDone ? ' ✓' : ''}</div>
          <pre style="font-size:0.7rem;color:#d4d4d4;background:#1e1e1e;border-radius:4px;padding:4px;margin:0;overflow:hidden;max-height:48px;line-height:1.3;">${escapeHtml(codePreview || '(leeg)')}</pre>
        </div>`;
      }).join('');
      panel.querySelectorAll('[data-grid-live]').forEach(card => {
        card.addEventListener('click', () => {
          socket.emit('teacher_select_student', { studentId: card.dataset.gridLive });
          _gridViewActive = false;
          const btn = qs('teacher-grid-view-btn');
          if (btn) btn.textContent = '⊞ Overzicht';
          qs('teacher-grid-view-panel')?.classList.add('hidden');
          qs('teacher-student-list')?.classList.remove('hidden');
          setTab('teacher', 'code');
          layoutEditor('teacher', true);
        });
      });
    }

    // Sprint 10M: kopieer knoppen teacher
    qs('teacher-copy-code-btn')?.addEventListener('click', () =>
      copyToClipboard(getEditorValue('teacher') || '', qs('teacher-copy-code-btn'))
    );
    qs('teacher-copy-output-btn')?.addEventListener('click', () =>
      copyToClipboard(qs('teacher-output-panel')?.textContent || '', qs('teacher-copy-output-btn'))
    );
    // Sprint 10U: auto-scroll instellen
    setupAutoScroll('teacher-output-panel');

    qs('teacher-annotation-btn')?.addEventListener('click', () => {
      const panel = qs('teacher-annotation-panel');
      if (panel) panel.classList.toggle('hidden');
    });
    // Sprint 10P: annotatie templates
    const _annotationTemplates = [
      'Let op de inspringing!',
      'Vergeet de dubbele punt niet.',
      'Controleer de variabelenaam.',
      'Goed bezig! Kleine fout op deze regel.',
      'Gebruik een lus hier.',
      'Vergeet de haakjes niet.',
      'Bekijk de ingebouwde functies.',
    ];
    qs('annotation-template-select')?.addEventListener('change', e => {
      const val = e.target.value;
      if (val && qs('annotation-message')) {
        qs('annotation-message').value = val;
        e.target.value = '';
      }
    });

    qs('teacher-send-annotation-btn')?.addEventListener('click', () => {
      const start = parseInt(qs('annotation-start-line')?.value || '1');
      const end   = parseInt(qs('annotation-end-line')?.value   || start.toString());
      const msg   = qs('annotation-message')?.value?.trim();
      const color = qs('annotation-color')?.value || 'yellow';
      if (!msg) { qs('annotation-message')?.focus(); return; }
      if (start < 1 || end < start) {
        alert('Ongeldige regelnummers. Eindregel moet ≥ startregel zijn.');
        return;
      }
      socket.emit('teacher_send_annotation', { startLine: start, endLine: end, message: msg, color });
      // Toon annotatie ook in de eigen editor van de leerkracht
      if (window.monaco && editorStore.teacher) {
        const cssClass = `annotation-highlight-${['yellow','blue','green','red'].includes(color) ? color : 'yellow'}`;
        const bgColor = { yellow: 'rgba(253,224,71,0.3)', blue: 'rgba(96,165,250,0.3)', green: 'rgba(74,222,128,0.3)', red: 'rgba(248,113,113,0.3)' }[color] || 'rgba(253,224,71,0.3)';
        const decs = editorStore.teacher.deltaDecorations([], [{
          range: new window.monaco.Range(start, 1, end, 1),
          options: {
            isWholeLine: true,
            className: cssClass,
            glyphMarginClassName: 'annotation-glyph',
            hoverMessage: { value: `**📌 Jouw annotatie:** ${msg}` },
            overviewRuler: { color: bgColor, position: 1 },
            after: { content: `   ← 📌 ${msg}`, inlineClassName: 'annotation-inline-msg' },
            stickiness: 1,
          },
        }]);
        if (!editorStore._annotationDecorations) editorStore._annotationDecorations = [];
        editorStore._annotationDecorations.push(...decs);
      }
      // Feedback: knop groen + reset tekstveld
      const sendBtn = qs('teacher-send-annotation-btn');
      if (sendBtn) {
        sendBtn.textContent = '✓ Verstuurd';
        sendBtn.style.background = 'var(--success-bg)';
        setTimeout(() => { sendBtn.textContent = '📌 Verstuur'; sendBtn.style.background = ''; }, 2000);
      }
      if (qs('annotation-message')) qs('annotation-message').value = '';
    });

    qs('teacher-clear-annotations-btn')?.addEventListener('click', () => {
      socket.emit('teacher_clear_annotations');
      // Wis eigen Monaco decoraties
      if (editorStore.teacher && editorStore._annotationDecorations?.length) {
        editorStore.teacher.deltaDecorations(editorStore._annotationDecorations, []);
        editorStore._annotationDecorations = [];
      }
    });

    qs('teacher-send-snippet-btn')?.addEventListener('click', () => {
      const code = getEditorValue('teacher');
      if (!code.trim()) return;
      socket.emit('teacher_send_snippet', { code });
      const btn = qs('teacher-send-snippet-btn');
      if (btn) { btn.textContent = '✓ Verstuurd'; setTimeout(() => { btn.textContent = '📎 Voorbeeld'; }, 2000); }
      // Toon de wis-knop zodat leerkracht weet er is een actief voorbeeld
      const clearBtn = qs('teacher-clear-snippet-btn');
      if (clearBtn) clearBtn.style.display = '';
    });
    qs('teacher-clear-snippet-btn')?.addEventListener('click', () => {
      socket.emit('teacher_clear_snippet');
      // Verberg wis-knop
      const clearBtn = qs('teacher-clear-snippet-btn');
      if (clearBtn) clearBtn.style.display = 'none';
    });

    // Zoekfilter leerlingenlijst — triggert een herrender van de lijst
    qs('student-filter-input')?.addEventListener('input', () => {
      if (window._lastTeacherSessionData) renderStudentList(window._lastTeacherSessionData);
    });
    // Sprint 13B: klassen ophalen voor badge dropdown
    fetch('/api/classes').then(r => r.json()).then(cls => {
      window._classesList = cls;
    }).catch(() => { window._classesList = []; });

    // Sprint 10O: statusfilter knoppen
    document.querySelectorAll('[data-status-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-status-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        window._statusFilter = btn.dataset.statusFilter === 'all' ? null : btn.dataset.statusFilter;
        if (window._lastTeacherSessionData) renderStudentList(window._lastTeacherSessionData);
      });
    });
    // Sprint 10V: keyboard navigatie leerlingenlijst (leerkracht-app)
    let _focusedStudentIdx = -1;
    document.addEventListener('keydown', e => {
      const host = qs('teacher-student-list');
      if (!host) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
      const items = [...host.querySelectorAll('.student-item')];
      if (!items.length) return;
      e.preventDefault();
      if (e.key === 'ArrowDown') _focusedStudentIdx = Math.min(_focusedStudentIdx + 1, items.length - 1);
      if (e.key === 'ArrowUp')   _focusedStudentIdx = Math.max(_focusedStudentIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle('student-item-focused', i === _focusedStudentIdx));
      items[_focusedStudentIdx]?.scrollIntoView({ block: 'nearest' });
      if (e.key === 'Enter' && _focusedStudentIdx >= 0) {
        items[_focusedStudentIdx].querySelector('[data-live-control]')?.click();
      }
    });
    qs('teacher-announcement-send-btn')?.addEventListener('click', () => {
      socket.emit('teacher_send_announcement', { text: qs('teacher-announcement-input').value });
    });
    qs('teacher-announcement-clear-btn')?.addEventListener('click', () => {
      qs('teacher-announcement-input').value = '';
      socket.emit('teacher_send_announcement', { text: '' });
    });
    qs('teacher-send-input-btn')?.addEventListener('click', () => {
      socket.emit('runtime_input', { value: qs('teacher-runtime-input').value });
      disableInput('teacher');
    });
    qs('teacher-runtime-input')?.addEventListener('keyup', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const btn = qs('teacher-send-input-btn');
        if (btn && !btn.disabled) btn.click();
      }
    });
    disableInput('teacher');
    loadTeacherMonitoring();
    setInterval(loadTeacherMonitoring, 3000);

    socket.on('teacher_session_data', async data => {
      window._lastTeacherSessionData = data;
    // Sprint 13A: update sessie-config paneel
    if (data.config) updateSessionConfigPanel(data.config);
      ['teacher-session-code','teacher-session-code-top'].forEach(id=>{ const el = qs(id); if (el) el.textContent = data.session.code; });
      qs('teacher-session-mode').textContent = data.session.mode === 'exam' ? 'Examenmodus' : 'Klasmodus';
      setAssistBadge(qs('teacher-editor-assist'), data.session.editorAssist);
      const onlineCount = data.students.filter(s => s.online).length;
      const doneCount   = data.students.filter(s => s.isDone).length;
      const handCount   = data.students.filter(s => s.handRaised).length;
      const tabCount    = data.students.filter(s => s.tabHidden).length;
      let countParts = [`${onlineCount} online`];
      if (doneCount > 0) countParts.push(`${doneCount} ✓ klaar`);
      if (handCount > 0) countParts.push(`${handCount} ✋`);
      if (tabCount  > 0) countParts.push(`${tabCount} ⚠️ tab weg`);
      qs('teacher-student-count').textContent = countParts.join(' · ');
      qs('teacher-workspace-mode').textContent = data.session.mode === 'class' ? ((data.session.classWorkspaceMode || 'shared') === 'personal' ? 'Individueel werk actief' : 'Klascode actief') : 'Individueel';
      const toggleBtn = qs('teacher-toggle-workspace-btn');
      if (toggleBtn) {
        toggleBtn.classList.toggle('hidden', data.session.mode !== 'class');
        toggleBtn.textContent = (data.session.classWorkspaceMode || 'shared') === 'personal' ? 'Terug naar klasmodus' : 'Start individuele werkfase';
      }
      qs('teacher-run-btn').disabled = data.session.mode === 'exam' && !data.view.selectedStudentId;
      qs('teacher-view-label').textContent = data.view.mode === 'exam'
        ? (data.view.selectedStudentName ? `Live control: ${data.view.selectedStudentName}` : 'Kies een leerling voor Live control')
        : 'Gedeelde sessie';
      await ensureEditor('teacher', data.view.code || '', data.session.editorAssist, data.view.readOnly);
      updateEditorConfig('teacher', { assist: data.session.editorAssist, readOnly: data.view.readOnly });
      if (getEditorValue('teacher') !== (data.view.code || '')) setEditorValue('teacher', data.view.code || '', true);
      else layoutEditor('teacher');
      qs('teacher-output-panel').textContent = data.view.output || '';

      // Overschrijf de announcement-input NIET als de leerkracht er op dit moment in typt
      const announcementInput = qs('teacher-announcement-input');
      if (announcementInput && document.activeElement !== announcementInput) {
        announcementInput.value = data.announcement || '';
      }
      updateAnnouncement('teacher', data.announcement || '');

      // Aankondigingsgeschiedenis — compact chip-grid
      const histWrap = qs('announcement-history-wrap');
      const histHost = qs('announcement-history-list');
      if (histHost && histWrap) {
        const history = data.announcementHistory || [];
        if (history.length > 0) {
          const historyItems = history.slice().reverse();
          histHost.innerHTML = historyItems.map((h, i) => `
            <button class="announcement-chip" data-idx="${i}" title="${escapeHtml(h)}">
              ${escapeHtml(h.length > 40 ? h.slice(0, 40) + '…' : h)}
            </button>`).join('');
          histHost.querySelectorAll('.announcement-chip').forEach(chip => {
            chip.addEventListener('click', () => {
              const raw = historyItems[parseInt(chip.dataset.idx, 10)];
              const input = qs('teacher-announcement-input');
              if (input && raw !== undefined) {
                input.value = raw;
                input.focus();
              }
            });
          });
          histWrap.classList.remove('hidden');
        } else {
          histWrap.classList.add('hidden');
        }
      }

      setStatusBox(qs('teacher-status-box'), data.statusText, data.statusType);
      // Run all / Code all zijn niet van toepassing in examenmodus:
      // leerlingen beheren daar altijd zelf hun run- en bewerkpermissie.
      const examMode = data.session.mode === 'exam';
      const runAllBtn = qs('toggle-run-all-btn');
      const codeAllBtn = qs('toggle-code-all-btn');
      if (runAllBtn) {
        runAllBtn.textContent = data.allRunEnabled ? 'Run all uit' : 'Run all aan';
        runAllBtn.classList.toggle('hidden', examMode);
      }
      if (codeAllBtn) {
        codeAllBtn.textContent = data.allCodeEnabled ? 'Code all uit' : 'Code all aan';
        codeAllBtn.classList.toggle('hidden', examMode);
      }

      renderStudentList(data);
      // Sprint 10N: grid view bijwerken als actief
      if (typeof _gridViewActive !== 'undefined' && _gridViewActive) renderGridView(data);
    });

    socket.on('run_output', ({ audience, output }) => {
      if (audience === 'teacher-all') {
        qs('teacher-output-panel').textContent = output;
        setTab('teacher', 'output');
      }
    });
    socket.on('input_request', ({ audience }) => {
      if (audience === 'teacher-all') enableInput('teacher');
    });
    socket.on('run_end', ({ audience }) => {
      if (audience === 'teacher-all') disableInput('teacher');
    });
    socket.on('teacher_preview_reset', () => {
      qs('teacher-output-panel').textContent = '';
      setTab('teacher', 'output');
      disableInput('teacher');
    });
    socket.on('teacher_preview_output', ({ output, append }) => {
      qs('teacher-output-panel').textContent = append ? qs('teacher-output-panel').textContent + output : output;
      setTab('teacher', 'output');
    });
    socket.on('teacher_preview_input_request', () => enableInput('teacher'));
    socket.on('teacher_preview_end', () => disableInput('teacher'));
  }


function getStudentVisibleWorkspace(data = studentWorkspaceState) {
  if (data.mode === 'exam') return 'personal';
  if ((data.activeWorkspace || 'shared') === 'personal') return 'personal';
  return data.selectedTab || 'shared';
}


function updateStudentRunAvailability(data = studentWorkspaceState) {
  const btn = qs('student-run-btn');
  if (!btn) return;
  const visible = getStudentVisibleWorkspace(data);
  const activeWorkspace = data.activeWorkspace || 'shared';
  let runDisabled = true;
  if (data.mode === 'exam') {
    runDisabled = !(data.personalCanRun !== false);
  } else if (activeWorkspace === 'personal') {
    runDisabled = !(data.personalCanRun !== false);
  } else {
    if (visible === 'shared') {
      runDisabled = !(data.classCanRun !== false);
    } else if (visible === 'personal') {
      runDisabled = true;
    } else {
      runDisabled = true;
    }
  }
  btn.disabled = runDisabled;
}

function refreshStudentWorkspaceUi(data) {
  const sharedBtn = qs('student-shared-tab-btn');
  const personalBtn = qs('student-personal-tab-btn');
  if (!sharedBtn || !personalBtn) return;
  const isExam = data.mode === 'exam';
  const active = data.activeWorkspace || (isExam ? 'personal' : 'shared');
  const visible = getStudentVisibleWorkspace(data);
  if (isExam) {
    sharedBtn.classList.add('hidden');
    personalBtn.textContent = 'Code';
    personalBtn.classList.remove('tab-disabled');
    personalBtn.classList.add('active');
  } else {
    sharedBtn.classList.remove('hidden');
    personalBtn.textContent = 'Mijn werkblad';
    sharedBtn.classList.toggle('active', visible === 'shared');
    personalBtn.classList.toggle('active', visible === 'personal');
    if (active === 'personal') {
      sharedBtn.classList.add('tab-disabled');
      personalBtn.classList.remove('tab-disabled');
    } else {
      sharedBtn.classList.remove('tab-disabled');
      personalBtn.classList.remove('tab-disabled');
    }
  }
}

async function applyStudentEditorFromState() {
  const data = studentWorkspaceState;
  const visible = getStudentVisibleWorkspace(data);
  const activeWorkspace = data.activeWorkspace || (data.mode === 'exam' ? 'personal' : 'shared');

  let codeText;
  if (visible === 'shared') {
    codeText = data.sharedCode || '';
  } else {
    // Personal tab: gebruik lokaal bewaarde versie als die er is
    // (voorkomt dat server-update de editor reset tijdens typen)
    codeText = studentWorkspaceState.localPersonalCode !== undefined
      ? studentWorkspaceState.localPersonalCode
      : (data.personalCode || '');
  }

  let readOnly = false;
  if (data.mode === 'exam') {
    readOnly = !(data.personalCanEdit !== false);
  } else if (activeWorkspace === 'personal') {
    readOnly = visible !== 'personal';
  } else {
    readOnly = visible === 'shared' ? !(data.classCanEdit !== false) : true;
  }

  await ensureEditor('student', codeText, data.editorAssist, readOnly);
  // Sprint 13A: pas sessie-config toe op student editor
  if (data.config) _sessionConfig = data.config;
  updateEditorConfig('student', { assist: data.editorAssist, readOnly, config: _sessionConfig });

  // In persoonlijke werkruimte (individuele fase of examenmodus): als de leerling een
  // lokale draft heeft, is localPersonalCode de bron van waarheid. Skip setValue dan
  // volledig — de editor bevat al de correcte tekst en een setValue reset de cursor.
  const studentIsOwningPersonal = (visible !== 'shared')
    && (studentWorkspaceState.localPersonalCode !== undefined);

  if (studentIsOwningPersonal) {
    // Geen setValue nodig: lokale draft staat al in de editor.
    // Enkel layout bijwerken zonder resetView zodat scroll/cursor intact blijft.
    layoutEditor('student');
  } else if (getEditorValue('student') !== codeText) {
    setEditorValue('student', codeText, false);
  } else {
    layoutEditor('student');
  }

  const outputToShow = studentWorkspaceState.localOutput !== undefined
    ? studentWorkspaceState.localOutput
    : (data.output || '');
  qs('student-output-panel').textContent = outputToShow;
  refreshStudentWorkspaceUi(data);
  updateStudentRunAvailability(data);

  // Herstel annotaties bij reconnect/join
  // applyAnnotationToEditor is gedefinieerd in de student-app sectie hieronder,
  // maar wordt hier aangeroepen via een uitgestelde call zodat Monaco geladen is.
  if (data.annotations && data.annotations.length > 0) {
    setTimeout(() => {
      if (!window.monaco || !editorStore.student) return;
      const decs = [];
      for (const ann of data.annotations) {
        const d = applyAnnotationToEditor(editorStore.student, ann);
        decs.push(...d);
      }
      studentAnnotationDecorations.push(...decs);
    }, 500); // wacht tot Monaco editor volledig geïnitialiseerd is
  }
}

  if (page === 'student-app.html') {
    const state = getLS('studentState');
    if (!state) go('/student-start.html');
    const code = getLS('studentSessionCode');
    const studentId = getLS('studentId');
    socket.emit('student_reconnect', { code, studentId });

    qs('student-run-btn')?.addEventListener('click', () => {
      saveStudentLocalDraft();
      qs('student-output-panel').textContent = '';
      const visibleWorkspace = getStudentVisibleWorkspace(studentWorkspaceState);
      socket.emit('run_request', {
        codeText: getEditorValue('student'),
        workspace: visibleWorkspace
      });
    });
    // Ctrl+Enter shortcut voor Run (leerling)
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        qs('student-run-btn')?.click();
      }
    });
    document.querySelectorAll('[data-owner="student"][data-tab]').forEach(btn => btn.addEventListener('click', async () => {
      if (btn.classList.contains('tab-disabled')) return;
      saveStudentLocalDraft();
      if (btn.dataset.tab === 'output') {
        setTab('student', 'output');
        document.querySelectorAll('[data-owner="student"][data-tab]').forEach(b => b.classList.toggle('active', b === btn));
        return;
      }
      if (btn.dataset.tab === 'snippet') {
        // Toon snippet paneel, verberg anderen
        ['student-code-panel','student-output-panel'].forEach(id => qs(id)?.classList.add('hidden'));
        qs('student-snippet-panel')?.classList.remove('hidden');
        document.querySelectorAll('[data-owner="student"][data-tab]').forEach(b => b.classList.toggle('active', b === btn));
        // Wis annotatie-decoraties op snippet-tab (niet relevant)
        if (editorStore.student && studentAnnotationDecorations.length) {
          editorStore.student.deltaDecorations(studentAnnotationDecorations, []);
        }
        return;
      }
      // Verberg snippet paneel bij wisselen naar code tabs
      qs('student-snippet-panel')?.classList.add('hidden');

      const prevTab = studentWorkspaceState.selectedTab;
      studentWorkspaceState.selectedTab = btn.dataset.tab;

      // Annotaties zijn enkel relevant op het Klascode-tabblad (shared)
      // Bij wisselen naar personal: wis decoraties zodat ze niet op de persoonlijke code staan
      // Bij wisselen naar shared: herstel ze vanuit de server-annotaties
      if (editorStore.student) {
        if (btn.dataset.tab === 'personal' && studentAnnotationDecorations.length) {
          // Tijdelijk verbergen - de array bewaren voor herstel
          editorStore.student.deltaDecorations(studentAnnotationDecorations, []);
          studentAnnotationDecorations.length = 0;
        } else if (btn.dataset.tab === 'shared' && !studentAnnotationDecorations.length) {
          // Herstel vanuit opgeslagen annotaties
          const savedAnnotations = window._savedAnnotations || [];
          for (const ann of savedAnnotations) {
            const decs = applyAnnotationToEditor(editorStore.student, ann);
            studentAnnotationDecorations.push(...decs);
          }
        }
      }

      await applyStudentEditorFromState();
      updateStudentRunAvailability(studentWorkspaceState);
      setTab('student', 'code');
    }));
    let _studentInputSent = false; // Guard tegen dubbele verzending
    qs('student-send-input-btn')?.addEventListener('click', () => {
      if (_studentInputSent) return;
      const inputEl = qs('student-runtime-input');
      const val = inputEl ? inputEl.value : '';
      if (val === '' && inputEl) {
        inputEl.placeholder = '⚠️ Lege invoer — Python verwacht een waarde';
        setTimeout(() => { if (inputEl) inputEl.placeholder = 'Typ je antwoord...'; }, 3000);
      }
      _studentInputSent = true;
      socket.emit('runtime_input', { value: val });
      disableInput('student');
    });
    qs('student-runtime-input')?.addEventListener('keyup', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const btn = qs('student-send-input-btn');
        if (btn && !btn.disabled) btn.click();
      }
    });
    disableInput('student');

    // Reset guard bij nieuwe input_request — dit is de correcte volgorde
    socket.on('input_request', ({ audience }) => {
      if (audience === 'student') {
        _studentInputSent = false;
        enableInput('student');
      }
    });


async function applyStudentState(data) {
  saveStudentLocalDraft();
  const studentName = data?.student?.name || getLS('studentName', '') || '-';
  const nameBadge = qs('student-name-badge');
  if (nameBadge) nameBadge.textContent = `Naam: ${studentName}`;
  qs('student-session-code').textContent = data.session.code;
  qs('student-mode').textContent = data.mode === 'exam' ? 'Examenmodus' : 'Klasmodus';
  setAssistBadge(qs('student-editor-assist'), data.editorAssist);
  const previousActiveWorkspace = studentWorkspaceState.activeWorkspace || 'shared';
  const nextActiveWorkspace = data.activeWorkspace || (data.mode === 'exam' ? 'personal' : 'shared');
  const switchedBackToShared = previousActiveWorkspace === 'personal' && nextActiveWorkspace === 'shared';
  const prevRevision = studentWorkspaceState.personalCodeRevision || 0;
  const newRevision = data.personalCodeRevision || 0;
  // Bepaal of de server écht nieuwe persoonlijke code heeft die de leerling nog niet kent.
  // KRITIEK: als personalCodeSourceSocketId de socket van de leerling ZELF is,
  // dan is de server enkel zijn eigen code aan het echoën — localPersonalCode NOOIT wissen.
  // Dit was de oorzaak van de cursor-reset: nextRevision() gebruikt Date.now() waardoor
  // newRevision altijd > prevRevision is, zelfs als de server de eigen code terugstuurt.
  const serverIsEchoingOwnCode = data.personalCodeSourceSocketId === socket.id;
  const serverHasNewerPersonalCode = !serverIsEchoingOwnCode && (
    newRevision > prevRevision
    || data.personalCodeSourceSocketId !== studentWorkspaceState.personalCodeSourceSocketId
  );

  studentWorkspaceState = {
    mode: data.mode,
    activeWorkspace: nextActiveWorkspace,
    selectedTab: data.mode === 'exam'
      ? 'personal'
      : (nextActiveWorkspace === 'personal'
          ? 'personal'
          : 'shared'),
    sharedCode: data.sharedCode || data.code || '',
    personalCode: data.personalCode || (data.mode === 'exam' ? data.code || '' : ''),
    personalCodeRevision: newRevision,
    personalCodeSourceSocketId: data.personalCodeSourceSocketId || null,
    classCanRun: data.student.classCanRun !== false,
    classCanEdit: data.student.classCanEdit !== false,
    personalCanRun: data.student.personalCanRun !== false,
    personalCanEdit: data.student.personalCanEdit !== false,
    editorAssist: data.editorAssist,
    output: data.output || '',
    localOutput: studentWorkspaceState.localOutput,
    localPersonalCode: serverHasNewerPersonalCode ? undefined : studentWorkspaceState.localPersonalCode,
  };
  const visibleWorkspace = getStudentVisibleWorkspace(studentWorkspaceState);
  qs('student-subtitle').textContent = data.mode === 'exam'
    ? 'Je werkt in je eigen editor. Andere leerlingen zien jouw code niet.'
    : (studentWorkspaceState.activeWorkspace === 'personal'
        ? 'Je werkt tijdelijk op je eigen werkblad. Klascode is tijdelijk niet beschikbaar.'
        : (visibleWorkspace === 'personal'
            ? 'Je bekijkt je individuele werkblad in alleen-lezen modus. Run is tijdelijk niet beschikbaar.'
            : 'Dit is gedeelde live code. Iedereen volgt dezelfde editor.'));
  await applyStudentEditorFromState();
  if (switchedBackToShared || nextActiveWorkspace === 'personal' || data.mode === 'exam') {
    setTab('student', 'code');
  } else {
    setTab('student', studentVisiblePanel || 'code');
  }
  updateAnnouncement('student', data.announcement || '');
  updateStudentRunAvailability(studentWorkspaceState);
}

    if (state) applyStudentState(state);

    // Sprint 10M: student kopieer knoppen
    qs('student-copy-code-btn')?.addEventListener('click', () =>
      copyToClipboard(getEditorValue('student') || '', qs('student-copy-code-btn'))
    );
    qs('student-copy-output-btn')?.addEventListener('click', () =>
      copyToClipboard(qs('student-output-panel')?.textContent || '', qs('student-copy-output-btn'))
    );
    // Sprint 10U: auto-scroll
    setupAutoScroll('student-output-panel');

    // Sprint 11C: leerling ziet eigen code-history
    qs('student-history-btn')?.addEventListener('click', async () => {
      const sid = getLS('studentId');
      const code = getLS('studentSessionCode');
      if (!sid || !code) return;
      try {
        const r = await fetch(`/api/sessions/${encodeURIComponent(code)}/history/${encodeURIComponent(sid)}`);
        if (!r.ok) { alert('Geen history beschikbaar.'); return; }
        const { studentName, snapshots } = await r.json();
        if (!snapshots?.length) { alert('Nog geen snapshots opgeslagen.'); return; }
        showHistoryPlayback(studentName || 'Jouw code', snapshots);
      } catch { alert('Kon history niet laden.'); }
    });

    // Sprint 10S: naam wijzigen
    window._changeStudentName = () => {
      const badge = qs('student-name-badge');
      const currentName = badge?.textContent || '';
      const newName = prompt('Vul je naam in:', currentName)?.trim();
      if (newName && newName !== currentName) {
        socket.emit('student_change_name', { name: newName });
        if (badge) badge.textContent = newName;
        setLS('studentName', newName);
      }
    };

    socket.on('student_state', async data => {
      setLS('studentState', data);
      setLS('studentSessionCode', data.session.code);
      setLS('studentId', data.student.id);
      setLS('studentName', data.student.name);
      await applyStudentState(data);
    });

    // Lichtgewicht event: alleen de opdrachttekst bijwerken, zonder volledige state-reset
    // Lichtgewicht event: enkel de gedeelde klascode bijwerken, zonder volledige state-reset.
    // Wordt verstuurd door de server wanneer de leerkracht de gedeelde code aanpast
    // terwijl de klas in de individuele werkfase zit — zo wordt applyStudentState
    // (en dus setValue + cursor-reset op de persoonlijke editor) vermeden.
    socket.on('shared_code_update', ({ sharedCode, sharedCodeRevision, sharedCodeSourceSocketId }) => {
      const incomingRevision = sharedCodeRevision || 0;
      const currentRevision = studentWorkspaceState.sharedCodeRevision || 0;
      if (incomingRevision > currentRevision
          || sharedCodeSourceSocketId !== studentWorkspaceState.sharedCodeSourceSocketId) {
        studentWorkspaceState.sharedCode = sharedCode || '';
        studentWorkspaceState.sharedCodeRevision = incomingRevision;
        studentWorkspaceState.sharedCodeSourceSocketId = sharedCodeSourceSocketId || null;
        // Als de leerling toevallig het Klascode-tabblad bekijkt, update dan de editor.
        // Maar in persoonlijke werkfase is dit tabblad read-only en niet actief — geen cursor-impact.
        const visible = getStudentVisibleWorkspace(studentWorkspaceState);
        if (visible === 'shared') {
          const currentVal = getEditorValue('student');
          if (currentVal !== (sharedCode || '')) {
            setEditorValue('student', sharedCode || '', false);
          }
        }
      }
    });

    socket.on('announcement_update', ({ text }) => {
      updateAnnouncement('student', text || '');
    });
    socket.on('timer_update', ({ remainingMs, running, totalMs }) => {
      const display = qs('student-timer-display');
      if (!display) return;
      // Sprint 10K: voortgangsbalk
      let bar = qs('student-timer-bar-fill');
      let barWrap = qs('student-timer-bar');
      if (!barWrap) {
        barWrap = document.createElement('div');
        barWrap.id = 'student-timer-bar';
        barWrap.className = 'timer-progress-bar';
        bar = document.createElement('div');
        bar.id = 'student-timer-bar-fill';
        bar.className = 'timer-progress-fill';
        barWrap.appendChild(bar);
        display.parentElement?.insertBefore(barWrap, display);
      }
      if (!running || remainingMs <= 0) {
        display.style.display = 'none';
        if (barWrap) barWrap.style.display = 'none';
        return;
      }
      display.style.display = 'inline-flex';
      const m = Math.floor(remainingMs / 60000);
      const s = Math.floor((remainingMs % 60000) / 1000);
      display.textContent = `⏱ ${m}:${String(s).padStart(2, '0')}`;
      display.style.color = remainingMs < 60000 ? 'var(--accent)' : 'var(--primary)';
      display.style.fontWeight = remainingMs < 60000 ? '900' : '800';
      // Balk
      if (barWrap && bar && totalMs > 0) {
        barWrap.style.display = 'block';
        const pct = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
        bar.style.width = pct + '%';
        bar.style.background = pct > 50 ? '#4ade80' : pct > 20 ? '#fbbf24' : '#f87171';
      }
    });

    socket.on('run_output', ({ audience, output }) => {
      if (audience === 'student' || audience === 'teacher-all') {
        saveStudentLocalDraft();
        qs('student-output-panel').textContent = output;
        studentWorkspaceState.localOutput = output;
        if (audience === 'teacher-all') setTab('student', 'output');
      }
    });
    socket.on('switch_to_output', ({ audience }) => {
      if (audience === 'student' || audience === 'teacher-all') {
        saveStudentLocalDraft();
        studentWorkspaceState.localOutput = '';
        qs('student-output-panel').textContent = '';
        setTab('student', 'output');
      }
    });

    // Leerkracht klikt Code-tab → alle leerlingen volgen
    socket.on('force_panel', ({ panel }) => {
      setTab('student', panel === 'output' ? 'output' : 'code');
    });



    // runtime_input_echo: echo zit nu in server-side outputAccum
    socket.on('runtime_input_echo', () => { /* echo verwerkt via run_output */ });

    // Sprint 13A: sessie-config live bijwerken
    socket.on('session_config_update', ({ config }) => {
      _sessionConfig = config || {};
      // Pas editor config toe met nieuwe instellingen
      const assist = document.getElementById('student-editor-assist')?.dataset?.assist !== 'false';
      updateEditorConfig('student', { assist, readOnly: false, config: _sessionConfig });
    });

    socket.on('run_end', ({ audience, reason }) => {
      if (audience === 'student' || audience === 'teacher-all') {
        disableInput('student');
        const panel = qs('student-output-panel');
        if (panel) {
          const current = panel.textContent || '';
          if (!current.trim()) {
            panel.textContent = '✓ Klaar — geen output.';
          }
        }
      }
    });
    socket.on('run_rate_limited', ({ waitMs }) => {
      const panel = qs('student-output-panel');
      if (panel) {
        panel.textContent = `⏳ Even wachten — je kan opnieuw runnen over ${Math.ceil(waitMs / 1000)} seconde(n).`;
        setTab('student', 'output');
        document.querySelectorAll('[data-owner="student"][data-tab]').forEach(b =>
          b.classList.toggle('active', b.dataset.tab === 'output'));
      }
    });
    socket.on('run_error', ({ errorType, message, line }) => {
      const panel = qs('student-output-panel');
      if (!panel) return;
      const icons = { cpu_timeout: '⏱', input_timeout: '⏳', disconnect: '🔌', cancelled: '⏹' };
      const icon = icons[errorType] || '⚠️';
      const lineInfo = line ? ` (regel ${line})` : '';
      const existingText = panel.textContent || '';
      panel.innerHTML = (existingText ? existingText.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '<br>' : '') + `<span style="color:#f87171;font-weight:700;">${icon} ${message}${lineInfo}</span>`;
      setTab('student', 'output');
      // Sprint 10H: markeer de fout-regel in de editor
      if (line && window.monaco && editorStore.student) {
        editorStore.student.deltaDecorations(editorStore._errorDecorations || [], []);
        editorStore._errorDecorations = editorStore.student.deltaDecorations([], [{
          range: new window.monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: 'error-line-highlight',
            overviewRuler: { color: 'rgba(248,113,113,0.8)', position: 1 },
            hoverMessage: { value: `❌ ${message}` },
          }
        }]);
      }
    });
    socket.on('run_queued', ({ position, message }) => {
      studentWorkspaceState.localOutput = '';
      const panel = qs('student-output-panel');
      // Sprint 11D: pulserende indicator in student-app
      if (panel) {
        const estSec = (position || 1) * 8;
        panel.innerHTML = `<span class="queue-pulse">⏳</span> In wachtrij — positie <strong>${position}</strong> · geschatte wachttijd ~${estSec}s`;
      }
      if (panel) panel.textContent = message || '⏳ Wachten op uitvoerslot...';
      setTab('student', 'output');
    });
    socket.on('force_workspace', async ({ workspace, panel } = {}) => {
      saveStudentLocalDraft();
      if (workspace === 'personal' || workspace === 'shared') {
        studentWorkspaceState.activeWorkspace = workspace;
        studentWorkspaceState.selectedTab = workspace === 'personal' ? 'personal' : 'shared';
      }
      await applyStudentEditorFromState();
      setTab('student', panel === 'output' ? 'output' : 'code');
      updateStudentRunAvailability(studentWorkspaceState);
    });
    // Klaar-knop
    let studentIsDone = false;
    const doneBtn = qs('student-done-btn');

    function setDoneUI(done) {
      if (!doneBtn) return;
      doneBtn.textContent = done ? '✓ Klaar!' : '✓ Klaar';
      doneBtn.classList.toggle('btn-success', done);
      doneBtn.classList.toggle('btn-muted', !done);
    }

    doneBtn?.addEventListener('click', () => {
      studentIsDone = !studentIsDone;
      socket.emit(studentIsDone ? 'student_mark_done' : 'student_unmark_done');
      setDoneUI(studentIsDone);
    });

    socket.on('done_reset_by_teacher', () => {
      studentIsDone = false;
      setDoneUI(false);
    });

    // Hand opsteken — één toggle handler
    let handIsRaised = false;

    function setHandUI(raised) {
      const btn = qs('student-raise-hand-btn');
      if (!btn) return;
      btn.textContent = raised ? '✋ Hand omlaag' : '✋ Hand opsteken';
      btn.classList.toggle('btn-warn', raised);
    }

    qs('student-raise-hand-btn')?.addEventListener('click', () => {
      handIsRaised = !handIsRaised;
      socket.emit(handIsRaised ? 'student_raise_hand' : 'student_lower_hand');
      setHandUI(handIsRaised);
    });

    socket.on('hand_lowered_by_teacher', () => {
      handIsRaised = false;
      setHandUI(false);
    });

    // Read-only snippet van leerkracht
    let currentSnippetVersion = 0;
    // Annotaties van leerkracht — toon als Monaco decoraties
    const studentAnnotationDecorations = [];
    const annotationColorMap = {
      yellow: 'rgba(253,224,71,0.25)',
      blue:   'rgba(96,165,250,0.25)',
      green:  'rgba(74,222,128,0.25)',
      red:    'rgba(248,113,113,0.25)',
    };

    function applyAnnotationToEditor(editor, ann) {
      if (!window.monaco || !editor) return [];
      const { startLine, endLine, message, color, id } = ann;
      const cssClass = `annotation-highlight-${['yellow','blue','green','red'].includes(color) ? color : 'yellow'}`;
      const bgColor = annotationColorMap[color] || annotationColorMap.yellow;
      return editor.deltaDecorations([], [{
        range: new window.monaco.Range(
          Math.max(1, startLine),
          1,
          Math.max(1, endLine || startLine),
          1
        ),
        options: {
          isWholeLine: true,
          className: cssClass,
          glyphMarginClassName: 'annotation-glyph',
          hoverMessage: { value: `**📌 Leerkracht:** ${message}` },
          overviewRuler: { color: bgColor, position: 1 },
          minimap: { color: bgColor, position: 1 },
          after: {
            content: `   ← 📌 ${message}`,
            inlineClassName: 'annotation-inline-msg',
          },
          stickiness: 1, // GrowsOnlyWhenTypingAfter — beweegt mee met code
        },
      }]);
    }

    socket.on('annotation_added', (ann) => {
      const { startLine, endLine, message } = ann;
      if (!window.monaco) return;
      const editor = editorStore.student;
      if (!editor) return;

      // Bewaar annotatie in window._savedAnnotations voor herstel bij tab-wissel
      if (!window._savedAnnotations) window._savedAnnotations = [];
      window._savedAnnotations.push(ann);

      // Enkel tekenen als leerling op Klascode-tabblad staat
      const currentVisible = getStudentVisibleWorkspace(studentWorkspaceState);
      if (currentVisible !== 'shared') {
        // Niet tekenen maar wél bewaren (zie hierboven) + toast
        const notice = document.createElement('div');
        notice.textContent = `📌 Leerkracht: regel ${startLine}–${endLine}: ${message}`;
        notice.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#334ea2;color:#fff;padding:10px 18px;border-radius:12px;font-size:0.88rem;z-index:9999;max-width:90vw;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.2);cursor:pointer;';
        notice.addEventListener('click', () => {
          const sharedBtn = document.querySelector('[data-tab="shared"][data-owner="student"]');
          if (sharedBtn) sharedBtn.click();
          notice.remove();
        });
        document.body.appendChild(notice);
        setTimeout(() => notice.remove(), 5000);
        return; // Niet tekenen op personal werkblad
      }

      const newDecs = applyAnnotationToEditor(editor, ann);
      studentAnnotationDecorations.push(...newDecs);
    });

    socket.on('annotations_cleared', () => {
      const editor = editorStore.student;
      if (editor && studentAnnotationDecorations.length) {
        editor.deltaDecorations(studentAnnotationDecorations, []);
      }
      studentAnnotationDecorations.length = 0;
      window._savedAnnotations = []; // ook opgeslagen annotaties wissen
    });

    socket.on('snippet_update', ({ code, version }) => {
      if (version <= currentSnippetVersion) return;
      currentSnippetVersion = version;
      const tab = qs('student-snippet-tab');
      const panel = qs('student-snippet-panel');
      if (!tab) return;
      if (!code) {
        tab.classList.add('hidden');
        if (panel) panel.classList.add('hidden');
        return;
      }
      // Toon de tab
      tab.classList.remove('hidden');
      // Vul het paneel met de code (pre-formatted, donker thema via inline style)
      if (panel) panel.textContent = code;
      // Markeer de tab als "nieuw" voor 3 seconden
      tab.style.fontWeight = '800';
      tab.style.color = 'var(--accent)';
      setTimeout(() => { tab.style.fontWeight = ''; tab.style.color = ''; }, 3000);
    });

    // Tab-detectie: stuur event naar server wanneer leerling de tab verlaat/terugkeert
    // Enkel actief in examenmodus — server filtert op basis van sessie-type
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        socket.emit('student_tab_hidden');
      } else {
        socket.emit('student_tab_visible');
      }
    });

    socket.on('force_landing', () => {
      localStorage.removeItem('studentState');
      localStorage.removeItem('studentSessionCode');
      localStorage.removeItem('studentId');
      localStorage.removeItem('studentName');
      go('/index.html');
    });
  }

  socket.on('force_landing', () => go('/index.html'));
  socket.on('teacher_go_sessions', () => {
    localStorage.removeItem('teacherSessionCode');
    go('/teacher-sessions.html');
  });

  socket.on('error_message', msg => {
    const teacherStatus = qs('teacher-status-box');
    if (teacherStatus) {
      setStatusBox(teacherStatus, msg, 'error');
      return;
    }
    const studentBanner = qs('student-subtitle');
    if (studentBanner) {
      studentBanner.textContent = msg;
      return;
    }
    const studentStartError = qs('student-start-error');
    if (studentStartError) studentStartError.textContent = msg;
  });

  async function injectFooter() {
  if (document.querySelector('.footer-note')) return;

  let versionText = '';
  try {
    const res = await fetch('/api/version');
    const data = await res.json();
    if (data && data.version) {
      versionText = ` • v${data.version}`;
    }
  } catch (e) {
    console.warn('Versie kon niet geladen worden');
  }

  const footer = document.createElement('div');
  footer.className = 'footer-note';
  footer.innerHTML = `
    © 2026 PyCodeFlow — ontwikkeld door B. Claes<br/>
    GO! Atheneum Hoboken — alle rechten voorbehouden${versionText}
  `;

  document.body.appendChild(footer);
}

window.addEventListener('DOMContentLoaded', injectFooter);
})();
