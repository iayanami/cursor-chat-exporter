@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Exporting Cursor chats from local project folders...
echo Source mode: Version 1 (local folders near this script)
echo Looking for: globalStorage and workspaceStorage
echo ...
node export-cursor-chat-to-word.js
if not %ERRORLEVEL% equ 0 (
  echo.
  echo ERROR: export failed. Run install_dependencies.bat first.
  pause
  exit /b 1
)
echo.
echo Done. Files are in cursor-chat-exports
explorer "cursor-chat-exports"
pause
