// PyCodeFlow — geextraheerd uit teacher-login.html (sprint 32a/30b)

(function () {
    // Lees de redirect-bestemming uit de query string (?next=/teacher-sessions.html)
    const params = new URLSearchParams(location.search);
    const next = params.get('next') || '/teacher-sessions.html';

    const userInput = document.getElementById('login-user');
    const passInput = document.getElementById('login-pass');
    const btn       = document.getElementById('login-btn');
    const errBox    = document.getElementById('login-error');
    const blockBox  = document.getElementById('login-blocked');
    // Sprint 48b2: schoolkeuze bij meerdere scholen
    const schoolGrid    = document.getElementById('school-grid');
    const schoolSelect  = document.getElementById('school-select');
    const schoolActions = document.getElementById('school-actions');
    const schoolPick    = document.getElementById('school-pick');
    const schoolCancel  = document.getElementById('school-cancel');

    function showError(msg) {
      errBox.textContent = msg || 'Gebruikersnaam of wachtwoord onjuist.';
      errBox.classList.add('visible');
      blockBox.classList.remove('visible');
      passInput.value = '';
      passInput.focus();
    }

    function showBlocked(retryAfter) {
      const sec = parseInt(retryAfter, 10);
      const msg = sec > 0
        ? `Te veel mislukte pogingen. Probeer opnieuw over ${Math.ceil(sec / 60)} minuut(en).`
        : 'Te veel mislukte pogingen. Probeer later opnieuw.';
      blockBox.textContent = msg;
      blockBox.classList.add('visible');
      errBox.classList.remove('visible');
      btn.disabled = true;
      if (sec > 0) {
        setTimeout(() => { btn.disabled = false; blockBox.classList.remove('visible'); }, sec * 1000);
      }
    }

    async function doLogin() {
      const username = userInput.value.trim();
      const password = passInput.value;
      if (!username || !password) {
        showError('Vul gebruikersnaam en wachtwoord in.');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Aanmelden…';
      errBox.classList.remove('visible');
      blockBox.classList.remove('visible');

      try {
        const res = await fetch('/api/teacher-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
          credentials: 'same-origin',
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          // Sprint 48b2: werkt deze leerkracht op meerdere scholen, dan is hij WEL
          // aangemeld maar moet hij nog kiezen. De lijst komt pas nu — dus ná een
          // geslaagde login — zodat niemand kan zien welke scholen er bestaan.
          if (Array.isArray(data.kiesSchool) && data.kiesSchool.length > 1) {
            toonSchoolKeuze(data.kiesSchool);
            return;
          }
          // Sessie is gezet door de server — navigeer door naar de bestemming
          location.href = next;
          return;
        }

        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After') || '0';
          showBlocked(retryAfter);
        } else {
          showError();
        }
      } catch (err) {
        showError('Verbindingsfout. Controleer je netwerk.');
      }

      btn.disabled = false;
      btn.textContent = 'Aanmelden';
    }

    // ── Sprint 48b2: schoolkeuze ─────────────────────────────────────────────
    function toonSchoolKeuze(scholen) {
      // De logingegevens grijs: je bent al aangemeld, alleen de school ontbreekt nog.
      // Uitgeschakeld i.p.v. verborgen, zodat je ziet met welk account je binnen bent.
      [userInput, passInput].forEach(el => { el.disabled = true; el.style.opacity = '0.5'; });
      btn.style.display = 'none';
      errBox.classList.remove('visible');

      schoolSelect.innerHTML = scholen
        .map(s => `<option value="${s.id}">${s.name.replace(/</g, '&lt;')}</option>`).join('');
      schoolGrid.style.display = '';
      schoolActions.style.display = 'flex';
      schoolSelect.focus();
    }

    async function kiesSchool() {
      schoolPick.disabled = true;
      schoolPick.textContent = 'Bezig…';
      try {
        const res = await fetch('/api/teacher-login/school', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schoolId: schoolSelect.value }),
          credentials: 'same-origin',
        });
        if (res.ok) { location.href = next; return; }
        const data = await res.json().catch(() => ({}));
        showError(data.error || 'Kiezen lukte niet.');
      } catch {
        showError('Verbindingsfout. Controleer je netwerk.');
      }
      schoolPick.disabled = false;
      schoolPick.textContent = 'Kiezen';
    }

    // Annuleren mag geen half-aangemelde toestand laten staan: je BENT aangemeld,
    // enkel zonder school. Daarom melden we echt af (server wist de sessie én de
    // cookies) en kom je terug op een schoon loginscherm.
    function annuleerKeuze() {
      location.href = '/api/teacher-logout';
    }

    btn.addEventListener('click', doLogin);
    schoolPick.addEventListener('click', kiesSchool);
    schoolCancel.addEventListener('click', annuleerKeuze);
    schoolSelect.addEventListener('keydown', e => { if (e.key === 'Enter') kiesSchool(); });
    [userInput, passInput].forEach(el =>
      el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); })
    );
  })();
