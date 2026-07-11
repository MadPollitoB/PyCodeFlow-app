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
          // Cookie is gezet door de server — navigeer door naar de bestemming
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

    btn.addEventListener('click', doLogin);
    [userInput, passInput].forEach(el =>
      el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); })
    );
  })();
