@echo off
title COOKED - the receipt your wallet was dreading
cd /d "%~dp0"

echo.
echo   COOKED - receipt printer
echo   -----------------------
echo   live site : https://cooked.shojaee76.workers.dev
echo   local host: http://localhost:8787
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   node.exe not found - opening the live site instead.
  start "" chrome "https://cooked.shojaee76.workers.dev"
  timeout /t 3 >nul
  exit /b 0
)

REM already running?
powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri 'http://localhost:8787/health' -TimeoutSec 2 -UseBasicParsing).StatusCode}catch{exit 1}" >nul 2>nul
if not errorlevel 1 goto open

echo   starting the local engine...
for /f "usebackq tokens=1,* delims==" %%a in ("%LOCALAPPDATA%\hermes\.env") do (
  if "%%a"=="OPENROUTER_API_KEY" set "JEV_KEY=%%b"
)
set COOKED_DEV=1
start "COOKED engine" /min cmd /c "node dist\local_server.js"

echo   waiting for the printer to warm up...
powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){try{$r=Invoke-WebRequest -Uri 'http://localhost:8787/health' -TimeoutSec 2 -UseBasicParsing; if($r.StatusCode -eq 200){exit 0}}catch{}; Start-Sleep -Milliseconds 700}; exit 1" >nul 2>nul
if errorlevel 1 (
  echo   the local engine did not answer - opening the live site instead.
  start "" chrome "https://cooked.shojaee76.workers.dev"
  exit /b 0
)

:open
echo   opening http://localhost:8787
start "" chrome "http://localhost:8787"
timeout /t 2 >nul
exit /b 0
