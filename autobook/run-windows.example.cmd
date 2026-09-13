@echo off
REM Auto-réservation Stadium — à planifier dans le Planificateur de tâches Windows.
REM Renseigne tes identifiants ci-dessous, puis teste avec :  run-windows.cmd --dry-run

set STADIUM_USER=ton.email@exemple.be
set STADIUM_PASSWORD=ton-mot-de-passe
set STADIUM_CLUB=1
set STADIUM_DAYS=8

cd /d "%~dp0"
node book.mjs %*
