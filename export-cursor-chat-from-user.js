#!/usr/bin/env node
/**
 * Wrapper for exporting chats directly from:
 * C:\Users\<username>\AppData\Roaming\Cursor\User
 *
 * Modes:
 *  - Version 2 (auto): detects current OS username.
 *  - Version 3 (manual): uses --username or cursor-exporter.config.json.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const configPath = path.join(__dirname, 'cursor-exporter.config.json')

function readConfig() {
  if (!fs.existsSync(configPath)) return {}
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) || {}
  } catch (e) {
    return {}
  }
}

function getArgValue(name) {
  const idx = process.argv.indexOf(name)
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]
  return ''
}

function hasArg(name) {
  return process.argv.includes(name)
}

function normalizeUsername(raw) {
  if (!raw) return ''
  return String(raw).trim().replace(/[\\/:"*?<>|]/g, '')
}

function candidatePathFromUsername(username) {
  if (!username) return ''
  return path.join('C:\\Users', username, 'AppData', 'Roaming', 'Cursor', 'User')
}

function listExistingCursorUserPaths() {
  const usersRoot = 'C:\\Users'
  if (!fs.existsSync(usersRoot)) return []
  const out = []
  try {
    const entries = fs.readdirSync(usersRoot, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const p = candidatePathFromUsername(ent.name)
      if (fs.existsSync(p)) out.push({ username: ent.name, path: p })
    }
  } catch (e) {
    return []
  }
  return out
}

function resolveCursorUserPath() {
  const cfg = readConfig()
  const debug = hasArg('--debug')
  const manualPath = getArgValue('--cursor-user-path') || cfg.cursorUserPath
  if (manualPath && fs.existsSync(manualPath)) return manualPath

  const argUsername = normalizeUsername(getArgValue('--username'))
  const cfgUsername = normalizeUsername(cfg.username)
  const envUsername = normalizeUsername(process.env.USERNAME)
  const profileUsername = normalizeUsername(path.basename(process.env.USERPROFILE || ''))
  const osUsername = normalizeUsername(os.userInfo().username)
  const candidates = [argUsername, cfgUsername, profileUsername, envUsername, osUsername].filter(Boolean)

  for (const user of candidates) {
    const p = candidatePathFromUsername(user)
    if (fs.existsSync(p)) return p
  }

  const existing = listExistingCursorUserPaths()
  if (existing.length === 1) return existing[0].path

  if (debug) {
    console.error('DEBUG candidates:')
    console.error(JSON.stringify(
      {
        argUsername,
        cfgUsername,
        profileUsername,
        envUsername,
        osUsername,
        existingCursorUsers: existing.map((x) => x.username),
      },
      null,
      2
    ))
  }

  const fallback = normalizeUsername(
    argUsername || cfgUsername || profileUsername || envUsername || osUsername
  )
  return candidatePathFromUsername(fallback)
}

const cursorUserPath = resolveCursorUserPath()
if (!cursorUserPath) {
  console.error('Could not resolve Cursor User path.')
  console.error('Use one of the options:')
  console.error('  1) node export-cursor-chat-from-user.js --username YourUserName')
  console.error('  2) Set "username" in cursor-exporter.config.json')
  console.error('  3) Set "cursorUserPath" in cursor-exporter.config.json')
  console.error('  4) Run with --debug to print detection candidates')
  process.exit(1)
}

if (!fs.existsSync(cursorUserPath)) {
  console.error('Cursor User directory does not exist:')
  console.error(cursorUserPath)
  console.error('Set a valid username/path in cursor-exporter.config.json or --username.')
  console.error('Tip: run with --debug to inspect auto-detection values.')
  process.exit(1)
}

console.error(`Using Cursor User path: ${cursorUserPath}`)

const targetScript = path.join(__dirname, 'export-cursor-chat-to-word.js')
const result = spawnSync(process.execPath, [targetScript, cursorUserPath], {
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
