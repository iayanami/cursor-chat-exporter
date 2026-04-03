#!/usr/bin/env node
/**
 * Strict manual mode (Version 3).
 * Reads only from cursor-exporter.manual.config.json.
 * No CLI required.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const configPath = path.join(__dirname, 'cursor-exporter.manual.config.json')

function readConfig() {
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (e) {
    return null
  }
}

function normalizeUsername(raw) {
  if (!raw) return ''
  return String(raw).trim().replace(/[\\/:"*?<>|]/g, '')
}

const cfg = readConfig()
if (!cfg) {
  console.error('Manual config is missing or invalid JSON:')
  console.error(configPath)
  process.exit(1)
}

const configuredPath = String(cfg.cursorUserPath || '').trim()
const username = normalizeUsername(cfg.username || '')
const resolvedPath =
  configuredPath ||
  (username ? path.join('C:\\Users', username, 'AppData', 'Roaming', 'Cursor', 'User') : '')

if (!resolvedPath) {
  console.error('Manual config is incomplete.')
  console.error('Set at least one of these fields in cursor-exporter.manual.config.json:')
  console.error('  - cursorUserPath')
  console.error('  - username')
  process.exit(1)
}

if (!fs.existsSync(resolvedPath)) {
  console.error('Configured Cursor User directory does not exist:')
  console.error(resolvedPath)
  console.error('Fix cursor-exporter.manual.config.json and run again.')
  process.exit(1)
}

console.error(`Using manual config path: ${resolvedPath}`)

const targetScript = path.join(__dirname, 'export-cursor-chat-to-word.js')
const result = spawnSync(process.execPath, [targetScript, resolvedPath], {
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
