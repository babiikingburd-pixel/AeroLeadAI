@echo off
REM AeroLeadAI APEX 9.6 - Windows one-click installer.
REM Usage: Install-AeroLeadAI.cmd [-Start]
setlocal
set ARGS=%*
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" %ARGS%
if errorlevel 1 (
  echo.
  echo Install failed. See the output above.
  pause
  exit /b 1
)
echo.
echo Done.
pause
