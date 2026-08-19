@echo off
cd /d "%~dp0"
set RESETFLAG=
if /I "%~1"=="--reset" set RESETFLAG=-Reset
powershell -NoProfile -ExecutionPolicy Bypass -File "setup\install.ps1" %RESETFLAG%
pause
