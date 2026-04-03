@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Installing dependencies...
call npm install
if not %ERRORLEVEL% equ 0 (
  echo ERROR: npm install failed.
  pause
  exit /b 1
)
echo.
echo Done.
echo Run run_export_cursor_chat.bat for Version 1 (local globalStorage/workspaceStorage).
echo Run run_export_cursor_chat_from_user.bat for Version 2/3 (AppData Cursor User mode).
echo Run run_export_cursor_chat_manual.bat for Version 3 (manual config only).
pause
