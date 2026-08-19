@echo off
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: run-tool.bat ^<tool^> [args...]
  echo   e.g. run-tool.bat verify-audit
  echo        run-tool.bat import-legacy --file C:\path\export.xlsx --dry-run
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\run-tool.ps1" -Tool %1 %2 %3 %4 %5 %6 %7 %8 %9
pause
