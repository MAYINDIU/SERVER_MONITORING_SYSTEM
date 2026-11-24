@echo off
setlocal
cd /d "%~dp0"
title Server Monitor Agent - Installer
echo.
echo  ==============================================
echo     Server Monitor Agent - Installer
echo  ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js is not installed on this PC.
  echo      Install it from https://nodejs.org  then run this file again.
  pause
  exit /b 1
)

rem ---- remove files copied from another PC ----
if exist ".agent-token.json" del /q ".agent-token.json"

set "SERVER_URL=http://192.168.11.133:5000"
set "KEY=SCL-ENROLL-2026"
set "IN="
set /p "IN= Monitoring server URL [%SERVER_URL%]: "
if not "%IN%"=="" set "SERVER_URL=%IN%"
set "IN="
set /p "IN= Enroll key [%KEY%]: "
if not "%IN%"=="" set "KEY=%IN%"

> .env echo SERVER_URL=%SERVER_URL%
>> .env echo ENROLL_KEY=%KEY%
echo  [OK] .env saved

echo.
echo  Checking connection to %SERVER_URL% ...
curl -s -m 5 "%SERVER_URL%/api/health" | find "ok" >nul
if errorlevel 1 (
  echo  [X] Cannot reach the monitoring server.
  echo      - Is the server running?  - Is port 5000 open in its firewall?
  pause
  exit /b 1
)
echo  [OK] Server reachable

echo.
echo  Installing packages ...
call npm install --no-audit --no-fund
if errorlevel 1 ( echo  [X] npm install failed & pause & exit /b 1 )

echo.
echo  Enabling login monitoring (who logged in, from which IP, failed passwords) ...
net session >nul 2>nul
if errorlevel 1 (
  echo  [!] Not running as Administrator - login names and failed passwords will NOT be tracked.
  echo      Right-click install-agent.bat and choose "Run as administrator" to enable it.
) else (
  rem allow the agent user to read the Windows Security log
  net localgroup "Event Log Readers" "%USERDOMAIN%\%USERNAME%" /add >nul 2>nul
  rem make sure successful AND failed logons are written to the log (Logon subcategory, by GUID = any language)
  auditpol /set /subcategory:{0CCE9215-69AE-11D9-BED3-505054503030} /success:enable /failure:enable >nul 2>nul
  echo  [OK] Login monitoring enabled - takes full effect after the next sign-out / reboot
)

echo.
echo  Installing auto-start (pm2) ...
call npm install -g pm2 pm2-windows-startup --no-audit --no-fund
call pm2 delete sm-agent >nul 2>nul
call pm2 start agent.js --name sm-agent
call pm2 save
call pm2-startup install

echo.
echo  ==============================================
echo   DONE. This PC will appear on the dashboard
echo   within 10 seconds and starts automatically
echo   after every reboot.
echo   Status:  pm2 status      Logs:  pm2 logs sm-agent
echo  ==============================================
pause
