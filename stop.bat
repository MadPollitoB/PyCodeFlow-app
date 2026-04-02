@echo off
echo.
echo Stopping PyCodeFlow...
echo.

docker compose -f docker-compose.yml -f docker-compose.prod.yml down >nul 2>&1
docker compose down >nul 2>&1

echo.
echo PyCodeFlow is gestopt.
echo.
pause
