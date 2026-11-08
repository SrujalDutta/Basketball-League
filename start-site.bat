@echo off
title Hoop Ready - localhost
cd /d "%~dp0"

echo Checking GitHub for the latest version...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;" ^
  "try {" ^
  "  $u='https://github.com/SrujalDutta/Basketball-League/archive/refs/heads/main.zip';" ^
  "  $z=Join-Path $env:TEMP 'basketball-league-latest.zip'; $x=Join-Path $env:TEMP 'basketball-league-latest';" ^
  "  Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $z;" ^
  "  if (Test-Path $x) { Remove-Item $x -Recurse -Force };" ^
  "  Expand-Archive -Path $z -DestinationPath $x -Force;" ^
  "  $src=(Get-ChildItem $x | Select-Object -First 1).FullName;" ^
  "  Get-ChildItem $src -Exclude 'start-site.bat' | Copy-Item -Destination . -Recurse -Force;" ^
  "  Write-Host 'Updated to the latest version.' -ForegroundColor Green" ^
  "} catch { Write-Host 'Could not reach GitHub, starting the version you already have.' -ForegroundColor Yellow }"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo Python is not installed. Install it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during setup, then run this again.
  pause
  exit /b
)

start "" http://localhost:8000
python serve.py
pause
