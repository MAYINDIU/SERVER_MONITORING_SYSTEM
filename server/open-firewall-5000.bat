@echo off
title Open port 5000 for Server Monitor
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [X] Administrator permission needed.
  echo      Right-click this file and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="Server Monitor 5000" >nul 2>&1
netsh advfirewall firewall add rule name="Server Monitor 5000" dir=in action=allow protocol=TCP localport=5000 profile=any
if errorlevel 1 (
  echo  [X] Failed to add firewall rule.
) else (
  echo.
  echo  [OK] Port 5000 is now open. Other PCs can reach http://THIS-PC-IP:5000
)
echo.
pause
