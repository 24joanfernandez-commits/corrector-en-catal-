@echo off
title Royal Casino
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No tienes Node.js instalado.
  echo  Descargalo gratis de https://nodejs.org  ^(version LTS^) y vuelve a abrir este archivo.
  echo.
  pause
  exit /b
)
if not exist node_modules (
  echo Instalando lo necesario ^(solo la primera vez^)...
  call npm install
)
node server.js
pause
