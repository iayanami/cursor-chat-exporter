# Cursor Chat Exporter

> Export Cursor chats into beautiful HTML and Word-ready documents with one click.

---

## Why This Tool

`Cursor Chat Exporter` helps you extract chat history from Cursor storage and convert it into:

- Interactive browser view (`index.html`)
- Standalone per-chat HTML files
- Word-friendly HTML (`*-word.html`) where each user question is formatted as a heading

It is built for practical usage: local backups, documentation, reports, and clean sharing.

---

## Highlights

- Smart chat extraction from both `workspaceStorage` and `globalStorage`
- Supports modern `cursorDiskKV` and classic `ItemTable` formats
- Interactive UI with:
  - dark/light theme toggle (moon/sun icon)
  - language switcher
  - chat table + quick preview
- Three run modes (local, auto profile, manual profile)
- Designed for Windows workflows and `.bat` convenience

---

## UI Languages

Default UI language: **English**

Available language set includes top world languages:

- 🇬🇧 English
- 🇨🇳 Chinese
- 🇪🇸 Spanish
- 🇮🇳 Hindi
- 🇸🇦 Arabic
- 🇫🇷 French
- 🇵🇹 Portuguese
- 🇷🇺 Russian
- 🇯🇵 Japanese
- 🇩🇪 German
- 🇰🇷 Korean
- 🇮🇹 Italian
- 🇹🇷 Turkish
- 🇻🇳 Vietnamese
- 🇮🇩 Indonesian

---

## Requirements

| Requirement | Version / Notes |
|---|---|
| OS | Windows |
| Node.js | 18+ recommended |
| npm | Required for dependency install |

---

## Quick Start

### 1) Install dependencies

```bash
npm install
```

or:

```bat
install_dependencies.bat
```

### 2) Run your preferred export mode

- Version 1: `run_export_cursor_chat.bat`
- Version 2: `run_export_cursor_chat_from_user.bat`
- Version 3: `run_export_cursor_chat_manual.bat`

---

## Export Modes (Detailed)

### Version 1 - Local folder mode

Run:

```bat
run_export_cursor_chat.bat
```

This mode searches local project folders:

- `globalStorage`
- `workspaceStorage`

Best when you copied Cursor storage folders next to this exporter.

---

### Version 2 - Auto profile mode

Run:

```bat
run_export_cursor_chat_from_user.bat
```

Reads directly from:

`C:\Users\<username>\AppData\Roaming\Cursor\User`

Auto-detection checks:

- `USERPROFILE`
- `USERNAME`
- `os.userInfo()`
- known valid paths under `C:\Users\*\AppData\Roaming\Cursor\User`

If needed, debug detection:

```bash
node export-cursor-chat-from-user.js --debug
```

---

### Version 3 - Manual config mode (no CLI required)

Files:

- `cursor-exporter.manual.config.json`
- `run_export_cursor_chat_manual.bat`

Config example:

```json
{
  "username": "YourWindowsUser",
  "cursorUserPath": ""
}
```

Run:

```bat
run_export_cursor_chat_manual.bat
```

---

## Optional Advanced CLI

```bash
node export-cursor-chat-from-user.js --username YourWindowsUser
node export-cursor-chat-from-user.js --cursor-user-path "C:\\Users\\YourWindowsUser\\AppData\\Roaming\\Cursor\\User"
node export-cursor-chat-to-word.js
node export-cursor-chat-to-word.js "C:\\Users\\YourWindowsUser\\AppData\\Roaming\\Cursor\\User"
node export-cursor-chat-to-word.js --workspace "C:\\path\\to\\workspaceStorage"
```

---

## Output Structure

All generated files are saved to:

`cursor-chat-exports/`

Key outputs:

- `index.html` - interactive viewer
- `chat-*.html` - standalone chats
- `chat-*-word.html` - Word-friendly export

---

## Project Files (Core)

| File | Purpose |
|---|---|
| `export-cursor-chat-to-word.js` | Main export engine |
| `export-cursor-chat-from-user.js` | Auto user profile wrapper |
| `export-cursor-chat-manual.js` | Manual config wrapper |
| `run_export_cursor_chat.bat` | Version 1 runner |
| `run_export_cursor_chat_from_user.bat` | Version 2 runner |
| `run_export_cursor_chat_manual.bat` | Version 3 runner |
| `cursor-exporter.config.json` | Optional shared config |
| `cursor-exporter.manual.config.json` | Manual mode config |

---

## Troubleshooting

### "Cursor User directory does not exist"

- Verify username in config
- Or set full path in `cursorUserPath`
- For auto mode, run debug:
  - `node export-cursor-chat-from-user.js --debug`

### Browser does not auto-open

Export still completes successfully. Open this file manually:

`cursor-chat-exports/index.html`

### No chats found

- Confirm Cursor data exists in expected folders
- Ensure Cursor was used on this machine/user profile
- Try Version 2 or Version 3 path-based mode

---

## GitHub Publish Checklist

- Remove private/generated files in `cursor-chat-exports/`
- Ensure no personal data is accidentally included
- Keep source only (`*.js`, `*.bat`, `README.md`, config templates)
- Commit with clean history and clear message

---

## License

Add your preferred license (`MIT` recommended for open-source utility tooling).

