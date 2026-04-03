@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Exporting Cursor chats from AppData user profile...
echo Source mode: Version 2/3 (auto username or config/manual override)
echo ...
node export-cursor-chat-from-user.js
if not %ERRORLEVEL% equ 0 (
  echo.
  echo ERROR: export failed. Check cursor-exporter.config.json or pass --username.
  pause
  exit /b 1
)
echo.
echo Done. Files are in cursor-chat-exports
explorer "cursor-chat-exports"
pause
