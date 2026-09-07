@echo off
REM Publie le depot sur GitHub. Usage : publier.cmd https://github.com/TON-USER/stadium-app.git
if "%~1"=="" (
  echo Usage: publier.cmd https://github.com/TON-USER/stadium-app.git
  exit /b 1
)
cd /d "%~dp0"
git remote remove origin 2>nul
git remote add origin %1
git branch -M main
git push -u origin main
