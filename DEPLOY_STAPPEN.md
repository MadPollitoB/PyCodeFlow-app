# PyCodeFlow – deploymentstappen

## 1. Lokale testmodus
1. Zet `.env.example` om naar `.env`
2. Zet:
   `TEST_MODE=true`
3. Start:
   `start.bat`
4. Open:
   `http://localhost:3000/index.html`

## 2. Servermodus op de UGREEN
1. Laat je bestaande Tunnels ongemoeid.
2. Maak in Cloudflare een **nieuwe** tunnel voor PyCodeFlow.
3. Gebruik als public hostname:
   `pycodeflow.clabalos.cc`
4. Zet de service in Cloudflare op:
   `http://web:3000`
5. Kopieer de tunnel token naar `.env`:
   `CLOUDFLARE_TUNNEL_TOKEN=...`
6. Zet:
   `TEST_MODE=false`
7. Start op de server met:
   `docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d`

## 3. Belangrijke Cloudflare-opmerking
- `pycodeflow.clabalos.cc` moet op een **aparte** Cloudflare Tunnel komen.

## 4. Veiligheid runner
De runner is hier met:
- read_only root filesystem
- tmpfs voor tijdelijke bestanden
- cap_drop ALL
- no-new-privileges
- geen exposed ports
- geen host volumes

Mount nooit NAS-shares of `/var/run/docker.sock` in de runner.

## 5. UGREEN
Op je UGREEN:
- Docker installeren
- SSH aanzetten
- projectmap uploaden
- `.env` invullen
- compose starten
