@echo off
setlocal enabledelayedexpansion

echo.
echo Starting PyCodeFlow...
echo.

if not exist .env (
  echo .env bestand ontbreekt.
  echo Maak eerst een .env aan op basis van .env.example
  echo.
  pause
  exit /b 1
)

set TEST_MODE_VALUE=
for /f "tokens=1,* delims==" %%A in (.env) do (
  if /I "%%A"=="TEST_MODE" set TEST_MODE_VALUE=%%B
)

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker engine is niet bereikbaar.
  echo Start eerst Docker Desktop en probeer opnieuw.
  echo.
  pause
  exit /b 1
)

if /I "%TEST_MODE_VALUE%"=="true" (
  echo Testmodus gedetecteerd - zonder Cloudflare Tunnel.
  docker compose up --build -d
) else (
  echo Servermodus gedetecteerd - met Cloudflare Tunnel.
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
)

if errorlevel 1 (
  echo.
  echo Er liep iets mis bij het opstarten.
  echo.
  pause
  exit /b 1
)

echo.
echo PyCodeFlow is gestart.
echo.
echo Lokaal openen via:
echo http://localhost:3000/index.html
echo.
pause
