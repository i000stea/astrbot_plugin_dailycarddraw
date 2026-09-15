@echo off
REM ASCII-only launcher. Keep this file free of non-ASCII characters so cmd can parse it
REM regardless of the console code page. All logic lives in updatePush.ps1 (UTF-8 with BOM).
setlocal
set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0updatePush.ps1" %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  echo.
  echo [x] updatePush failed with exit code %CODE%. See update-push.log for details.
)
if "%~1"=="" pause
exit /b %CODE%