@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Exporting Cursor chats from manual config...
echo Source mode: Version 3 (manual config only, no CLI)
echo Config file: cursor-exporter.manual.config.json
echo ...
node export-cursor-chat-manual.js
if not %ERRORLEVEL% equ 0 (
  echo.
  echo ERROR: manual export failed. Check cursor-exporter.manual.config.json.
  pause
  exit /b 1
)
echo.
echo Done. Files are in cursor-chat-exports
explorer "cursor-chat-exports"
pause
