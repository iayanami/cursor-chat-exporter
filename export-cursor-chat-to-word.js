#!/usr/bin/env node
/**
 * Export Cursor chats to HTML and Word-friendly HTML.
 * Reads state.vscdb from workspaceStorage and globalStorage.
 *
 * Usage:
 *   node export-cursor-chat-to-word.js
 *   node export-cursor-chat-to-word.js "C:\Users\Руслан\AppData\Roaming\Cursor\User"
 *   node export-cursor-chat-to-word.js --workspace "path to workspaceStorage directory"
 *
 * Requirement: npm install better-sqlite3
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Cursor data path (Windows)
const APPDATA = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming')
const DEFAULT_CURSOR_USER = path.join(APPDATA, 'Cursor', 'User')

// Chat-related keys. Other keys are ignored.
const CHAT_KEYS = [
  'workbench.panel.aichat.view.aichat.chatdata',
  'aiService.prompts',
  'composerData',
  'aichat.chatdata',
]

/** Checks whether a key is chat-related. */
function isChatKey(key) {
  if (!key || typeof key !== 'string') return false
  if (CHAT_KEYS.includes(key)) return true
  if (key.startsWith('workbench.panel.aichat.') || key.startsWith('aichat.')) return true
  return false
}

function escapeHtml(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br/>')
}

/** Server-side Markdown to HTML conversion. */
function markdownToHtmlServer(text) {
  if (text == null) return ''
  let s = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const nl = '\n'
  const parts = s.split(/```/)
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    const block = parts[i]
    if (i % 2 === 1) {
      out += '<pre class="code-block"><code>' + block.replace(/^\n|\n$/g, '') + '</code></pre>'
      continue
    }
    const lines = block.split(nl)
    const listBuf = []
    const flushList = () => {
      if (listBuf.length) {
        out += '<ul><li>' + listBuf.join('</li><li>') + '</li></ul>'
        listBuf.length = 0
      }
    }
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j]
      const m = line.match(/^(#{1,3})\s+(.*)$/)
      if (m) {
        flushList()
        const tag = m[1].length === 3 ? 'h3' : m[1].length === 2 ? 'h2' : 'h1'
        out += `<${tag}>${inlineMdServer(m[2])}</${tag}>`
        continue
      }
      if (/^[-*]\s+/.test(line)) {
        listBuf.push(inlineMdServer(line.replace(/^[-*]\s+/, '')))
        continue
      }
      flushList()
      out += (j > 0 ? '<br/>' : '') + inlineMdServer(line)
    }
    flushList()
  }
  function inlineMdServer(t) {
    return t
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  }
  return out
}

/** Extracts messages from different Cursor JSON formats. */
function extractMessages(valueStr) {
  const messages = []
  let data
  try {
    data = JSON.parse(valueStr)
  } catch (e) {
    return messages
  }
  if (!data || typeof data !== 'object') return messages

  // Variant: { conversations: [ { messages: [ { role, content } ] } ] }
  const convs = data.conversations || data.chats || (Array.isArray(data) ? data : [data])
  for (const c of Array.isArray(convs) ? convs : [convs]) {
    const list = c.messages || c.bubbles || c.history || (Array.isArray(c) ? c : [])
    for (const m of Array.isArray(list) ? list : []) {
      const role = (m.role || m.type || '').toLowerCase()
      const text = m.content ?? m.text ?? m.message ?? (typeof m === 'string' ? m : '')
      if (String(text).trim()) {
        messages.push({
          role: role.includes('user') || role === 'human' ? 'user' : 'assistant',
          text: String(text).trim(),
        })
      }
    }
  }

  // Variant: direct messages array
  const direct = data.messages || data.bubbles
  if (Array.isArray(direct) && messages.length === 0) {
    for (const m of direct) {
      const role = (m.role || m.type || '').toLowerCase()
      const text = m.content ?? m.text ?? m.message ?? ''
      if (String(text).trim()) {
        messages.push({
          role: role.includes('user') || role === 'human' ? 'user' : 'assistant',
          text: String(text).trim(),
        })
      }
    }
  }

  // Variant: prompt/response pairs
  if (data.prompts && Array.isArray(data.prompts) && messages.length === 0) {
    for (const p of data.prompts) {
      const req = p.prompt ?? p.request ?? p.text ?? ''
      const res = p.response ?? p.completion ?? p.text ?? ''
      if (String(req).trim()) messages.push({ role: 'user', text: String(req).trim() })
      if (String(res).trim()) messages.push({ role: 'assistant', text: String(res).trim() })
    }
  }

  // Recursive fallback scan for role/content arrays
  if (messages.length === 0) {
    function dig(o) {
      if (Array.isArray(o)) {
        for (const m of o) {
          if (m && typeof m === 'object') {
            const text = m.content ?? m.text ?? m.message ?? m.parts?.[0]?.text ?? (typeof m.parts?.[0] === 'string' ? m.parts[0] : '')
            const role = (m.role || m.type || m.kind || '').toLowerCase()
            if (String(text).trim()) {
              messages.push({
                role: role.includes('user') || role === 'human' || role === 'request' ? 'user' : 'assistant',
                text: String(text).trim(),
              })
            }
          }
        }
        return
      }
      if (o && typeof o === 'object') {
        for (const k of ['messages', 'bubbles', 'history', 'conversations', 'chats', 'items']) {
          if (Array.isArray(o[k])) dig(o[k])
        }
        for (const v of Object.values(o)) dig(v)
      }
    }
    dig(data)
  }

  return messages
}

/** Extracts date/time from chat JSON and returns Date or null. */
function extractTimestampFromData(valueStr) {
  let data
  try {
    data = JSON.parse(valueStr)
  } catch (e) {
    return null
  }
  if (!data || typeof data !== 'object') return null

  const keys = ['createdAt', 'timestamp', 'date', 'time', 'lastModified', 'updatedAt']
  let found = null
  function dig(o, depth) {
    if (depth > 10) return
    if (o == null) return
    if (Array.isArray(o)) {
      for (const x of o) dig(x, depth + 1)
      return
    }
    if (typeof o === 'object') {
      for (const k of keys) {
        const v = o[k]
        if (v == null) continue
        if (typeof v === 'number') {
          const d = v > 1e12 ? new Date(v) : new Date(v * 1000)
          if (!isNaN(d.getTime())) {
            if (!found || d.getTime() < found.getTime()) found = d
          }
          continue
        }
        if (typeof v === 'string') {
          const d = new Date(v)
          if (!isNaN(d.getTime())) {
            if (!found || d.getTime() < found.getTime()) found = d
          }
        }
      }
      for (const v of Object.values(o)) dig(v, depth + 1)
    }
  }
  dig(data, 0)
  return found
}

function formatDateForFilename(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}_${h}${min}`
}

function formatDateForDisplay(date) {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Merges consecutive messages with the same role into one bubble. */
function mergeConsecutiveMessages(messages) {
  if (!messages.length) return []
  const out = []
  let cur = { role: messages[0].role, texts: [messages[0].text] }
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === cur.role) {
      cur.texts.push(messages[i].text)
    } else {
      out.push({ role: cur.role, text: cur.texts.join('\n\n') })
      cur = { role: messages[i].role, texts: [messages[i].text] }
    }
  }
  out.push({ role: cur.role, text: cur.texts.join('\n\n') })
  return out
}

const CHAT_FILE_CSS = `
  :root{--user:#7cb342;--user-bg:#e8f5e9;--assistant:#78909c;--assistant-bg:#eceff1;--bg:#fafafa;--card:#fff;--border:#e0e0e0;--code-bg:#1e1e1e;--code-fg:#d4d4d4;}
  *{box-sizing:border-box;}
  body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;margin:0;padding:24px;background:var(--bg);line-height:1.6;color:#333;}
  .meta{font-size:12px;color:#666;margin-bottom:20px;padding:10px 14px;background:var(--card);border-radius:8px;border-left:4px solid var(--user);}
  .bubble{margin:16px 0;padding:16px 20px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);}
  .bubble.user{background:linear-gradient(135deg,#f1f8e9 0%,#dcedc8 100%);border-left:4px solid var(--user);}
  .bubble.assistant{background:linear-gradient(135deg,#fafafa 0%,#eceff1 100%);border-left:4px solid var(--assistant);}
  .bubble-label{font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;}
  .bubble.user .bubble-label{color:var(--user);}
  .bubble.assistant .bubble-label{color:var(--assistant);}
  .bubble-body{margin:0;}
  .bubble-body h1,.bubble-body h2,.bubble-body h3{margin:.8em 0 .4em;font-size:1.1em;font-weight:700;}
  .bubble-body h1{font-size:1.25em;}
  .bubble-body ul{margin:.5em 0;padding-left:1.5em;}
  .bubble-body li{margin:.25em 0;}
  .bubble-body code{background:var(--code-bg);color:var(--code-fg);padding:.15em .4em;border-radius:4px;font-size:.9em;}
  .bubble-body pre.code-block{margin:.8em 0;padding:14px;background:var(--code-bg);color:var(--code-fg);border-radius:8px;overflow-x:auto;font-size:13px;}
  .bubble-body pre.code-block code{background:none;padding:0;}
`

function buildHtml(messages, workspaceLabel, dateStr = null) {
  const merged = mergeConsecutiveMessages(messages)
  const parts = []
  parts.push('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Cursor Chat</title>')
  parts.push('<style>' + CHAT_FILE_CSS + '</style></head><body>')
  const metaParts = []
  if (dateStr) metaParts.push(`Date: ${escapeHtml(dateStr)}`)
  if (workspaceLabel) metaParts.push(workspaceLabel)
  if (metaParts.length) parts.push(`<p class="meta">${metaParts.join(' | ')}</p>`)
  for (const m of merged) {
    const cls = m.role === 'user' ? 'user' : 'assistant'
    const label = m.role === 'user' ? 'You' : 'Assistant'
    const body = markdownToHtmlServer(m.text)
    parts.push(`<div class="bubble ${cls}"><div class="bubble-label">${label}</div><div class="bubble-body">${body}</div></div>`)
  }
  parts.push('</body></html>')
  return parts.join('\n')
}

/** HTML for Microsoft Word: each user question is Heading 2, answers are body text. */
function buildHtmlForWord(messages, workspaceLabel, dateStr = null) {
  const parts = []
  parts.push('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Cursor Chat for Word</title>')
  parts.push('<style>body{font-family:Calibri,Arial,sans-serif;margin:24px;max-width:720px;}')
  parts.push('h2{font-size:14pt;font-weight:bold;margin:16px 0 8px 0;}')
  parts.push('.meta{font-size:11px;color:#666;margin-bottom:16px;}')
  parts.push('p{margin:0 0 8px 0;} pre{background:#f5f5f5;padding:10px;} code{background:#f0f0f0;padding:0 2px;}</style></head><body>')
  const metaParts = []
  if (dateStr) metaParts.push(`Date: ${escapeHtml(dateStr)}`)
  if (workspaceLabel) metaParts.push(workspaceLabel)
  if (metaParts.length) parts.push(`<p class="meta">${metaParts.join(' | ')}</p>`)
  for (const m of messages) {
    if (m.role === 'user') {
      const headingText = m.text.trim().replace(/\s+/g, ' ').slice(0, 200)
      parts.push(`<h2>${escapeHtml(headingText)}</h2>`)
    } else {
      const body = markdownToHtmlServer(m.text)
      parts.push(`<div class="answer">${body}</div>`)
    }
  }
  parts.push('</body></html>')
  return parts.join('\n')
}

/** Escapes </script> in JSON before HTML embedding. */
function safeJsonForScript(obj) {
  let s = JSON.stringify(obj)
  return s.replace(/<\/script>/gi, '\\u003c/script\\u003e')
}

function buildIndexHtml(entries, allChatsForIndex) {
  const chatsPayload = allChatsForIndex.map((c, idx) => ({
    id: idx,
    workspace: c.workspace,
    key: c.key,
    date: c.dateStr || '—',
    count: c.messages.length,
    questionCount: c.messages.filter((m) => m.role === 'user').length,
    messages: c.messages,
    filename: c.filename,
  }))
  const workspaces = [...new Set(chatsPayload.map((c) => c.workspace))].sort()
  const jsonScript = `<script type="application/json" id="chats-data">${safeJsonForScript(chatsPayload)}</script>`

  const indexCss = `
  :root{--user:#7cb342;--assistant:#78909c;--card:#ffffff;--card-alt:#f8f9fa;--border:#d7dce0;--code-bg:#1f2430;--code-fg:#e6edf3;--bg:#eef2f6;--fg:#1e2630;--muted:#5a6572;}
  body.theme-dark{--card:#151b22;--card-alt:#1c2430;--border:#2f3b4b;--bg:#0d1117;--fg:#e6edf3;--muted:#9fb0c3;}
  *{box-sizing:border-box;} body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;margin:0;padding:24px;background:var(--bg);color:var(--fg);}
  h1{font-size:1.6rem;margin:0 0 10px;} p{color:var(--muted);} .topbar{position:fixed;top:14px;right:14px;z-index:1000;display:flex;gap:8px;align-items:center;padding:8px;background:var(--card);border:1px solid var(--border);border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.18);}
  .topbar .icon-btn{width:40px;height:40px;border-radius:999px;border:1px solid var(--border);background:var(--card-alt);color:var(--fg);cursor:pointer;font-size:18px;line-height:1;}
  .topbar .lang-flag{width:26px;height:26px;border-radius:999px;border:1px solid var(--border);display:block;object-fit:cover;}
  .topbar .lang-select{max-width:210px;padding:10px 12px;border-radius:999px;border:1px solid var(--border);background:var(--card-alt);color:var(--fg);font-weight:600;}
  .filter{margin-bottom:20px;padding:16px;background:var(--card);border-radius:12px;border:1px solid var(--border);} .filter label{margin-right:10px;font-weight:600;}
  .filter select{padding:8px 14px;min-width:220px;border-radius:8px;border:1px solid var(--border);background:var(--card-alt);color:var(--fg);font-size:14px;}
  #chat-list{background:var(--card);border-radius:12px;border:1px solid var(--border);overflow:hidden;} table{width:100%;border-collapse:collapse;}
  th,td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--border);} th{background:var(--card-alt);font-weight:600;font-size:13px;} tr:hover{background:var(--card-alt);}
  .btn-show{cursor:pointer;padding:8px 16px;border-radius:8px;border:none;background:var(--user);color:#fff;font-weight:600;} .btn-show:hover{background:#689f38;}
  a{color:var(--user);text-decoration:none;} a:hover{text-decoration:underline;} #chat-content{margin-top:24px;}
  .chat-detail{padding:20px;background:var(--card);border-radius:12px;border:1px solid var(--border);} .chat-detail h4{margin:0 0 16px;font-size:14px;color:var(--muted);}
  .bubble{margin:16px 0;padding:16px 20px;border-radius:12px;border:1px solid var(--border);} .bubble.user{background:linear-gradient(135deg,rgba(124,179,66,.2) 0%,rgba(124,179,66,.1) 100%);border-left:4px solid var(--user);}
  .bubble.assistant{background:linear-gradient(135deg,rgba(120,144,156,.2) 0%,rgba(120,144,156,.1) 100%);border-left:4px solid var(--assistant);}
  .bubble-label{font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;} .bubble.user .bubble-label{color:var(--user);} .bubble.assistant .bubble-label{color:var(--assistant);}
  .bubble-body h1,.bubble-body h2,.bubble-body h3{margin:.8em 0 .4em;font-size:1.05em;} .bubble-body ul{margin:.5em 0;padding-left:1.5em;} .bubble-body li{margin:.25em 0;}
  .bubble-body code{background:var(--code-bg);color:var(--code-fg);padding:.15em .4em;border-radius:4px;font-size:.9em;} .bubble-body pre.code-block{margin:.8em 0;padding:14px;background:var(--code-bg);color:var(--code-fg);border-radius:8px;overflow-x:auto;}
  .bubble-body pre.code-block code{background:none;padding:0;} .chat-detail .file-link{margin-top:16px;display:inline-block;}
  `

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Cursor Chat Export</title><style>${indexCss}</style></head><body>
<h1 id="title">Cursor Chat Export</h1><p id="subtitle">Select a <strong>Workspace</strong>, then click <strong>Show</strong> to open questions and answers with Markdown formatting.</p>
<div class="topbar"><img id="langFlag" class="lang-flag" alt="flag"/><select id="ui-lang" class="lang-select"><option value="en">English</option><option value="zh">Chinese</option><option value="es">Spanish</option><option value="hi">Hindi</option><option value="ar">Arabic</option><option value="fr">French</option><option value="pt">Portuguese</option><option value="ru">Russian</option><option value="ja">Japanese</option><option value="de">German</option><option value="ko">Korean</option><option value="it">Italian</option><option value="tr">Turkish</option><option value="vi">Vietnamese</option><option value="id">Indonesian</option></select><button id="themeToggle" class="icon-btn" type="button" title="Toggle theme">🌙</button></div>
<div class="filter"><label for="ws" id="workspaceLabel">Workspace:</label><select id="ws"><option value="">-- all --</option>${workspaces.map((w) => `<option value="${escapeHtml(w)}">${escapeHtml(w)}</option>`).join('')}</select></div>
<div id="chat-list"></div><div id="chat-content"></div>${jsonScript}<script>
(function(){var dataEl=document.getElementById('chats-data');var wsSel=document.getElementById('ws');var langSel=document.getElementById('ui-lang');var langFlagEl=document.getElementById('langFlag');var themeBtn=document.getElementById('themeToggle');var listEl=document.getElementById('chat-list');var contentEl=document.getElementById('chat-content');var titleEl=document.getElementById('title');var subtitleEl=document.getElementById('subtitle');var workspaceLabelEl=document.getElementById('workspaceLabel');if(!listEl||!contentEl)return;
var i18n={en:{title:'Cursor Chat Export',subtitle:'Select a Workspace, then click Show to open questions and answers with Markdown formatting.',lang:'Language:',workspace:'Workspace:',all:'-- all --',date:'Date',key:'Key',messages:'Messages',questions:'Questions',show:'Show',file:'File',openFile:'Open as separate file',you:'You',assistant:'Assistant',themeDark:'Dark Theme',themeLight:'Light Theme',dataError:'Error: data not found.',loadError:'Error loading data.'},ru:{title:'Экспорт чатов Cursor',subtitle:'Выберите Workspace и нажмите Показать, чтобы открыть вопросы и ответы с Markdown.',lang:'Язык:',workspace:'Workspace:',all:'-- все --',date:'Дата',key:'Ключ',messages:'Сообщения',questions:'Вопросы',show:'Показать',file:'Файл',openFile:'Открыть как отдельный файл',you:'Вы',assistant:'Ассистент',themeDark:'Темная тема',themeLight:'Светлая тема',dataError:'Ошибка: данные не найдены.',loadError:'Ошибка загрузки данных.'},fr:{title:'Export de chats Cursor',subtitle:'Selectionnez un workspace puis cliquez sur Afficher pour voir les messages en Markdown.',lang:'Langue:',workspace:'Workspace:',all:'-- tous --',date:'Date',key:'Cle',messages:'Messages',questions:'Questions',show:'Afficher',file:'Fichier',openFile:'Ouvrir comme fichier separe',you:'Vous',assistant:'Assistant',themeDark:'Theme sombre',themeLight:'Theme clair',dataError:'Erreur: donnees introuvables.',loadError:'Erreur de chargement.'},ja:{title:'Cursor chat export',subtitle:'Workspace を選択して 表示 を押すと Markdown 付きで表示します。',lang:'言語:',workspace:'Workspace:',all:'-- すべて --',date:'日付',key:'キー',messages:'メッセージ',questions:'質問',show:'表示',file:'ファイル',openFile:'別ファイルで開く',you:'あなた',assistant:'アシスタント',themeDark:'ダークテーマ',themeLight:'ライトテーマ',dataError:'エラー: データが見つかりません。',loadError:'読み込みエラー。'},ko:{title:'Cursor 채팅 내보내기',subtitle:'Workspace 를 선택하고 표시 를 누르면 Markdown 형식으로 확인할 수 있습니다.',lang:'언어:',workspace:'Workspace:',all:'-- 전체 --',date:'날짜',key:'키',messages:'메시지',questions:'질문',show:'보기',file:'파일',openFile:'별도 파일로 열기',you:'사용자',assistant:'어시스턴트',themeDark:'다크 테마',themeLight:'라이트 테마',dataError:'오류: 데이터를 찾을 수 없습니다.',loadError:'로딩 오류.'},zh:{title:'Cursor 聊天导出',subtitle:'选择 Workspace 后点击 显示，可查看带 Markdown 的问答。',lang:'语言：',workspace:'Workspace：',all:'-- 全部 --',date:'日期',key:'键',messages:'消息',questions:'问题',show:'显示',file:'文件',openFile:'作为独立文件打开',you:'你',assistant:'助手',themeDark:'深色主题',themeLight:'浅色主题',dataError:'错误：未找到数据。',loadError:'加载数据失败。'},es:{title:'Exportacion de chat Cursor',subtitle:'Elige un workspace y pulsa Mostrar para ver preguntas y respuestas con Markdown.',lang:'Idioma:',workspace:'Workspace:',all:'-- todos --',date:'Fecha',key:'Clave',messages:'Mensajes',questions:'Preguntas',show:'Mostrar',file:'Archivo',openFile:'Abrir como archivo separado',you:'Tu',assistant:'Asistente',themeDark:'Tema oscuro',themeLight:'Tema claro',dataError:'Error: no se encontraron datos.',loadError:'Error al cargar datos.'},hi:{title:'Cursor chat export',subtitle:'Workspace chunen aur Show dabakar Markdown ke saath chats dekhen.',lang:'Bhasha:',workspace:'Workspace:',all:'-- sabhi --',date:'Tarikh',key:'Key',messages:'Messages',questions:'Questions',show:'Show',file:'File',openFile:'Alag file me kholo',you:'Aap',assistant:'Assistant',themeDark:'Dark Theme',themeLight:'Light Theme',dataError:'Error: data nahi mila.',loadError:'Data load error.'},ar:{title:'تصدير محادثات Cursor',subtitle:'اختر Workspace ثم اضغط عرض لعرض الرسائل مع تنسيق Markdown.',lang:'اللغة:',workspace:'Workspace:',all:'-- الكل --',date:'التاريخ',key:'المفتاح',messages:'الرسائل',questions:'الاسئلة',show:'عرض',file:'ملف',openFile:'فتح كملف منفصل',you:'انت',assistant:'المساعد',themeDark:'الوضع الداكن',themeLight:'الوضع الفاتح',dataError:'خطا: لم يتم العثور على البيانات.',loadError:'خطا في تحميل البيانات.'},pt:{title:'Exportacao de chat Cursor',subtitle:'Selecione um workspace e clique em Mostrar para ver mensagens com Markdown.',lang:'Idioma:',workspace:'Workspace:',all:'-- todos --',date:'Data',key:'Chave',messages:'Mensagens',questions:'Perguntas',show:'Mostrar',file:'Arquivo',openFile:'Abrir como arquivo separado',you:'Voce',assistant:'Assistente',themeDark:'Tema escuro',themeLight:'Tema claro',dataError:'Erro: dados nao encontrados.',loadError:'Erro ao carregar dados.'},de:{title:'Cursor-Chat-Export',subtitle:'Workspace auswahlen und Anzeigen klicken, um Fragen und Antworten mit Markdown zu sehen.',lang:'Sprache:',workspace:'Workspace:',all:'-- alle --',date:'Datum',key:'Schlussel',messages:'Nachrichten',questions:'Fragen',show:'Anzeigen',file:'Datei',openFile:'Als separate Datei offnen',you:'Du',assistant:'Assistent',themeDark:'Dunkles Design',themeLight:'Helles Design',dataError:'Fehler: Daten nicht gefunden.',loadError:'Fehler beim Laden der Daten.'},it:{title:'Esportazione chat Cursor',subtitle:'Seleziona un workspace e clicca Mostra per vedere la chat con Markdown.',lang:'Lingua:',workspace:'Workspace:',all:'-- tutti --',date:'Data',key:'Chiave',messages:'Messaggi',questions:'Domande',show:'Mostra',file:'File',openFile:'Apri come file separato',you:'Tu',assistant:'Assistente',themeDark:'Tema scuro',themeLight:'Tema chiaro',dataError:'Errore: dati non trovati.',loadError:'Errore nel caricamento dati.'},tr:{title:'Cursor sohbet disa aktarma',subtitle:'Workspace secin ve Goster e basin, Markdown bicimlendirmesi ile goruntuleyin.',lang:'Dil:',workspace:'Workspace:',all:'-- tumu --',date:'Tarih',key:'Anahtar',messages:'Mesajlar',questions:'Sorular',show:'Goster',file:'Dosya',openFile:'Ayrı dosya olarak ac',you:'Sen',assistant:'Asistan',themeDark:'Koyu tema',themeLight:'Acik tema',dataError:'Hata: veri bulunamadi.',loadError:'Veri yukleme hatasi.'},vi:{title:'Xuat chat Cursor',subtitle:'Chon workspace va bam Hien thi de xem hoi dap co Markdown.',lang:'Ngon ngu:',workspace:'Workspace:',all:'-- tat ca --',date:'Ngay',key:'Khoa',messages:'Tin nhan',questions:'Cau hoi',show:'Hien thi',file:'Tep',openFile:'Mo duoi dang tep rieng',you:'Ban',assistant:'Tro ly',themeDark:'Chu de toi',themeLight:'Chu de sang',dataError:'Loi: khong tim thay du lieu.',loadError:'Loi tai du lieu.'},id:{title:'Ekspor chat Cursor',subtitle:'Pilih workspace lalu klik Tampilkan untuk melihat chat dengan Markdown.',lang:'Bahasa:',workspace:'Workspace:',all:'-- semua --',date:'Tanggal',key:'Kunci',messages:'Pesan',questions:'Pertanyaan',show:'Tampilkan',file:'File',openFile:'Buka sebagai file terpisah',you:'Anda',assistant:'Asisten',themeDark:'Tema gelap',themeLight:'Tema terang',dataError:'Error: data tidak ditemukan.',loadError:'Error memuat data.'}};
var lang='en';function t(k){return(i18n[lang]&&i18n[lang][k])||(i18n.en&&i18n.en[k])||k;}function flagSvg(code){if(code==='en')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#012169"/><path d="M0 0L36 24M36 0L0 24" stroke="#fff" stroke-width="5"/><path d="M0 0L36 24M36 0L0 24" stroke="#c8102e" stroke-width="2.5"/><path d="M18 0V24M0 12H36" stroke="#fff" stroke-width="8"/><path d="M18 0V24M0 12H36" stroke="#c8102e" stroke-width="4.5"/></svg>';if(code==='fr')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="12" height="24" fill="#0055a4"/><rect x="12" width="12" height="24" fill="#fff"/><rect x="24" width="12" height="24" fill="#ef4135"/></svg>';if(code==='de')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="8" fill="#000"/><rect y="8" width="36" height="8" fill="#dd0000"/><rect y="16" width="36" height="8" fill="#ffce00"/></svg>';if(code==='pt')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="14" height="24" fill="#046a38"/><rect x="14" width="22" height="24" fill="#da291c"/><circle cx="14" cy="12" r="4" fill="#ffcc29"/></svg>';if(code==='ko')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#fff"/><circle cx="18" cy="12" r="4.5" fill="#c60c30"/><path d="M18 7.5a4.5 4.5 0 0 0 0 9a2.25 2.25 0 0 1 0-4.5a2.25 2.25 0 0 0 0-4.5z" fill="#003478"/></svg>';if(code==='ar')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#006c35"/><path d="M9 12a5 5 0 1 0 0.1 0" fill="#fff"/><circle cx="11.2" cy="12" r="3.6" fill="#006c35"/><path d="M16 12l1.2 0.4l-0.8-1l1.3-0.1l-1-0.8l1.2-0.5l-1.3-0.3l0.6-1.1l-1.1 0.7l-0.4-1.2l-0.4 1.2l-1.1-0.7l0.6 1.1l-1.3 0.3l1.2 0.5l-1 0.8l1.3 0.1l-0.8 1z" fill="#fff"/></svg>';if(code==='id')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="12" fill="#ff0000"/><rect y="12" width="36" height="12" fill="#fff"/></svg>';if(code==='ja')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#fff"/><circle cx="18" cy="12" r="6" fill="#bc002d"/></svg>';if(code==='ru')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="8" fill="#fff"/><rect y="8" width="36" height="8" fill="#0039a6"/><rect y="16" width="36" height="8" fill="#d52b1e"/></svg>';if(code==='it')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="12" height="24" fill="#009246"/><rect x="12" width="12" height="24" fill="#fff"/><rect x="24" width="12" height="24" fill="#ce2b37"/></svg>';if(code==='tr')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#e30a17"/><circle cx="14" cy="12" r="5" fill="#fff"/><circle cx="15.5" cy="12" r="4" fill="#e30a17"/><path d="M21 12l1.4 0.5l-0.9-1.1l1.5-0.1l-1.1-0.9l1.4-0.6l-1.6-0.3l0.8-1.3l-1.3 0.8l-0.5-1.4l-0.5 1.4l-1.3-0.8l0.8 1.3l-1.6 0.3l1.4 0.6l-1.1 0.9l1.5 0.1l-0.9 1.1z" fill="#fff"/></svg>';if(code==='zh')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#de2910"/><path d="M8 6l1 2.8H12L9.6 10.5L10.5 13.3L8 11.5L5.5 13.3L6.4 10.5L4 8.8H7z" fill="#ffde00"/></svg>';if(code==='es')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="6" fill="#aa151b"/><rect y="6" width="36" height="12" fill="#f1bf00"/><rect y="18" width="36" height="6" fill="#aa151b"/></svg>';if(code==='hi')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="8" fill="#ff9933"/><rect y="8" width="36" height="8" fill="#fff"/><rect y="16" width="36" height="8" fill="#138808"/><circle cx="18" cy="12" r="2" fill="#000080"/></svg>';if(code==='vi')return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#da251d"/><path d="M18 6l1.6 4.4H24l-3.6 2.6l1.4 4.4L18 14.8l-3.8 2.6l1.4-4.4L12 10.4h4.4z" fill="#ffde00"/></svg>';return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#fff"/><rect y="8" width="36" height="8" fill="#1f2430"/></svg>';}function updateLangFlag(){if(!langFlagEl)return;langFlagEl.src='data:image/svg+xml;utf8,'+encodeURIComponent(flagSvg(lang));langFlagEl.alt=(lang||'en');}function applyLang(){titleEl.textContent=t('title');subtitleEl.textContent=t('subtitle');workspaceLabelEl.textContent=t('workspace');wsSel.options[0].text=t('all');themeBtn.textContent=document.body.classList.contains('theme-dark')?'☀️':'🌙';updateLangFlag();}
if(!dataEl){listEl.innerHTML='<p>'+t('dataError')+'</p>';return;}var data;try{data=JSON.parse(dataEl.textContent);}catch(err){listEl.innerHTML='<p>'+t('loadError')+'</p>';return;}
langSel.onchange=function(){lang=langSel.value||'en';applyLang();render();};themeBtn.onclick=function(){document.body.classList.toggle('theme-dark');themeBtn.textContent=document.body.classList.contains('theme-dark')?'☀️':'🌙';};
function escapeHtml(s){if(s==null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\\n/g,'<br/>');}
function markdownToHtml(s){if(s==null)return'';s=String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');var nl=String.fromCharCode(10);var parts=s.split(/\u0060\u0060\u0060/);var out='';for(var i=0;i<parts.length;i++){var block=parts[i];if(i%2===1){out+='<pre class="code-block"><code>'+block.replace(new RegExp('^'+nl+'|'+nl+'$'),'')+'</code></pre>';continue;}var lines=block.split(nl);var listBuf=[];function flushList(){if(listBuf.length){out+='<ul><li>'+listBuf.join('</li><li>')+'</li></ul>';listBuf=[];}}for(var j=0;j<lines.length;j++){var line=lines[j];var m=line.match(/^(#{1,3})\\s+(.*)$/);if(m){flushList();out+=(m[1].length===3?'<h3>':m[1].length===2?'<h2>':'<h1>')+inlineMd(m[2])+'</h'+(m[1].length===3?3:m[1].length===2?2:1)+'>';continue;}if(/^[-*]\\s+/.test(line)){listBuf.push(inlineMd(line.replace(/^[-*]\\s+/,'')));continue;}flushList();out+=(j>0?'<br/>':'')+inlineMd(line);}flushList();}function inlineMd(t){return t.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>').replace(/__([^_]+)__/g,'<strong>$1</strong>').replace(/\\*([^*]+)\\*/g,'<em>$1</em>').replace(/\u0060([^\u0060]+)\u0060/g,'<code>$1</code>');}return out;}
function mergeMessages(msgs){if(!msgs.length)return[];var out=[],cur={role:msgs[0].role,texts:[msgs[0].text]};for(var i=1;i<msgs.length;i++){if(msgs[i].role===cur.role)cur.texts.push(msgs[i].text);else{out.push({role:cur.role,text:cur.texts.join('\\n\\n')});cur={role:msgs[i].role,texts:[msgs[i].text]};}}out.push({role:cur.role,text:cur.texts.join('\\n\\n')});return out;}
window.showChat=function(id){var c=data.find(function(x){return x.id===id;});if(!c)return;var merged=mergeMessages(c.messages);var html='<div class="chat-detail"><h4>'+escapeHtml(c.date)+' — '+escapeHtml(c.workspace)+' / '+escapeHtml(c.key)+'</h4>';merged.forEach(function(m){var cls=m.role==='user'?'user':'assistant';var label=m.role==='user'?t('you'):t('assistant');html+='<div class="bubble '+cls+'"><div class="bubble-label">'+label+'</div><div class="bubble-body">'+markdownToHtml(m.text)+'</div></div>';});html+='<a class="file-link" href="'+escapeHtml(c.filename)+'">'+t('openFile')+'</a></div>';contentEl.innerHTML=html;contentEl.scrollIntoView({behavior:'smooth'});};
function render(){var ws=wsSel.value;var list=ws?data.filter(function(c){return c.workspace===ws;}):data;listEl.innerHTML='<table><thead><tr><th>'+t('date')+'</th><th>Workspace</th><th>'+t('key')+'</th><th>'+t('messages')+'</th><th>'+t('questions')+'</th><th></th></tr></thead><tbody>'+list.map(function(c){var q=c.questionCount!=null?c.questionCount:c.messages.filter(function(m){return m.role===\'user\';}).length;return '<tr><td>'+escapeHtml(c.date)+'</td><td>'+escapeHtml(c.workspace)+'</td><td>'+escapeHtml(c.key)+'</td><td>'+c.count+'</td><td>'+q+'</td><td><button type="button" class="btn-show" data-id="'+c.id+'" onclick="window.showChat('+c.id+')">'+t('show')+'</button> <a href="'+escapeHtml(c.filename)+'">'+t('file')+'</a></td></tr>';}).join('')+'</tbody></table>';contentEl.innerHTML='';}
wsSel.onchange=render;listEl.onclick=function(e){var t=e.target;while(t&&t.nodeType!==1)t=t.parentNode;while(t&&t.tagName!=='BUTTON'&&t.tagName!=='TR')t=t?t.parentNode:null;if(t&&t.tagName==='TR'&&t.cells&&t.cells[4]){var btn=t.cells[4].querySelector('button');if(btn&&btn.getAttribute('data-id'))window.showChat(parseInt(btn.getAttribute('data-id'),10));}};
applyLang();render();})();
</script></body></html>`
}

function readDb(dbPath) {
  try {
    const db = new Database(dbPath, { readonly: true })
    return db
  } catch (e) {
    console.error('Failed to open DB:', path.basename(dbPath), '-', e.message)
    return null
  }
}

function valueToString(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return new TextDecoder().decode(value)
  if (Buffer.isBuffer && Buffer.isBuffer(value)) return value.toString('utf8')
  return String(value)
}

function queryChatValues(db) {
  const results = []
  try {
    const rows = db.prepare('SELECT key, value FROM ItemTable WHERE value IS NOT NULL').all()
    for (const row of rows) {
      const key = row.key
      let value = valueToString(row.value)
      if (typeof value !== 'string' || value.length < 20) continue
      if (!isChatKey(key)) continue
      const looksLikeJson = value.trimStart().startsWith('{') || value.trimStart().startsWith('[')
      if (!looksLikeJson) continue
      results.push({ key, value })
    }
  } catch (e) {
    // ignore
  }
  return results
}

/** Checks if cursorDiskKV table exists (newer Cursor versions). */
function hasCursorDiskKV(db) {
  try {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cursorDiskKV'").all()
    return rows.length > 0
  } catch (e) {
    return false
  }
}

/** Extracts one message from a bubble row (type 1=user, 2=assistant). */
function messageFromBubble(bubble) {
  if (!bubble || typeof bubble !== 'object') return null
  const text = (bubble.text || '').trim()
  if (!text) return null
  const type = bubble.type
  const role = type === 1 ? 'user' : 'assistant'
  return { role, text }
}

/** Extracts date from timingInfo.clientStartTime (ms). */
function dateFromBubble(bubble) {
  try {
    const t = bubble?.timingInfo?.clientStartTime
    if (t != null) {
      const d = new Date(typeof t === 'number' ? (t > 1e12 ? t : t * 1000) : t)
      if (!isNaN(d.getTime())) return d
    }
  } catch (e) {}
  return null
}

/** Reads chats from cursorDiskKV (bubbleId:*, composerData:*). */
function queryCursorDiskKV(db) {
  const chats = []
  try {
    const rows = db.prepare(
      "SELECT rowid, key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' OR key LIKE 'composerData:%'"
    ).all()

    const composerToBubbles = new Map() // composerId -> [{ rowid, bubble }]
    const composerDataRows = []

    for (const row of rows) {
      const rowid = row.rowid ?? 0
      const key = row.key
      const value = valueToString(row.value)
      if (typeof value !== 'string' || value.length < 2) continue
      try {
        const data = JSON.parse(value)
        if (key.startsWith('composerData:')) {
          composerDataRows.push({ key, data, rowid })
          continue
        }
        if (key.startsWith('bubbleId:')) {
          const parts = key.split(':')
          const composerId = parts.length >= 2 ? parts[1] : 'default'
          if (!composerToBubbles.has(composerId)) composerToBubbles.set(composerId, [])
          composerToBubbles.get(composerId).push({ rowid, data })
        }
      } catch (e) {
        continue
      }
    }

    for (const [composerId, bubbles] of composerToBubbles) {
      bubbles.sort((a, b) => (a.rowid || 0) - (b.rowid || 0))
      const messages = []
      let date = null
      for (const { data } of bubbles) {
        const msg = messageFromBubble(data)
        if (msg) messages.push(msg)
        if (!date) date = dateFromBubble(data)
      }
      if (messages.length > 0) {
        chats.push({
          key: `cursorDiskKV:bubbleId:${composerId}`,
          messages,
          date,
        })
      }
    }

    for (const { key, data } of composerDataRows) {
      const conversation = data?.conversation || data?.messages || []
      const messages = []
      let date = null
      for (const m of conversation) {
        const msg = messageFromBubble(m)
        if (msg) messages.push(msg)
        if (!date) date = dateFromBubble(m)
      }
      if (messages.length > 0) {
        chats.push({
          key: `cursorDiskKV:${key.split(':')[1] || 'composer'}`,
          messages,
          date,
        })
      }
    }
  } catch (e) {
    // ignore
  }
  return chats
}

function scanStorage(storagePath, label) {
  const allMessages = []
  let workspaceLabel = label || storagePath
  if (!fs.existsSync(storagePath)) return []
  const entries = fs.readdirSync(storagePath, { withFileTypes: true })
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const dirPath = path.join(storagePath, ent.name)
    const dbPath = path.join(dirPath, 'state.vscdb')
    if (!fs.existsSync(dbPath)) continue
    const db = readDb(dbPath)
    if (!db) continue
    const workspaceJsonPath = path.join(dirPath, 'workspace.json')
    let wsLabel = ent.name
    if (fs.existsSync(workspaceJsonPath)) {
      try {
        const ws = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf8'))
        wsLabel = ws.folder || ws.workspace || ent.name
      } catch (e) {}
    }
    const rows = queryChatValues(db)
    db.close()
    for (const { key, value } of rows) {
      const messages = extractMessages(value)
      if (messages.length) {
        allMessages.push({ workspace: wsLabel, key, messages })
      }
    }
  }
  return allMessages
}

async function main() {
  let basePath = __dirname
  const args = process.argv.slice(2)
  if (args[0] === '--workspace') {
    basePath = args[1] || path.join(DEFAULT_CURSOR_USER, 'workspaceStorage')
  } else if (args[0] && !args[0].startsWith('--')) {
    basePath = args[0]
  }

  // First look for workspaceStorage next to this script.
  const localWorkspace = path.join(__dirname, 'workspaceStorage')
  const workspaceStorage = fs.existsSync(localWorkspace)
    ? localWorkspace
    : path.join(basePath, 'workspaceStorage')
  const globalStorage = path.join(basePath, 'globalStorage')

  console.error('Searching chats in:', workspaceStorage)
  if (fs.existsSync(globalStorage)) console.error('And in:', globalStorage)

  const outDir = path.join(__dirname, 'cursor-chat-exports')
  fs.mkdirSync(outDir, { recursive: true })

  const allChats = []
  if (fs.existsSync(workspaceStorage)) {
    const entries = fs.readdirSync(workspaceStorage, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const dirPath = path.join(workspaceStorage, ent.name)
      const dbPath = path.join(dirPath, 'state.vscdb')
      if (!fs.existsSync(dbPath)) continue
      const db = readDb(dbPath)
      if (!db) continue
      let wsLabel = ent.name
      const workspaceJsonPath = path.join(dirPath, 'workspace.json')
      if (fs.existsSync(workspaceJsonPath)) {
        try {
          const ws = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf8'))
          wsLabel = ws.folder || ws.workspace || wsLabel
        } catch (e) {}
      }
      const rows = queryChatValues(db)
      if (hasCursorDiskKV(db)) {
        const diskChats = queryCursorDiskKV(db)
        for (const { key, messages, date } of diskChats) {
          allChats.push({ workspace: wsLabel, key, messages, date })
        }
      }
      for (const { key, value } of rows) {
        const messages = extractMessages(value)
        if (messages.length > 0) {
          const date = extractTimestampFromData(value)
          allChats.push({ workspace: wsLabel, key, messages, date })
        }
      }
      db.close()
    }
  }

  if (fs.existsSync(globalStorage)) {
    try {
      const rootStateDb = path.join(globalStorage, 'state.vscdb')
      if (fs.existsSync(rootStateDb)) {
        const db = readDb(rootStateDb)
        if (db) {
          if (hasCursorDiskKV(db)) {
            const diskChats = queryCursorDiskKV(db)
            for (const { key, messages, date } of diskChats) allChats.push({ workspace: 'globalStorage', key, messages, date })
          }
          const rows = queryChatValues(db)
          for (const { key, value } of rows) {
            const messages = extractMessages(value)
            if (messages.length > 0) allChats.push({ workspace: 'globalStorage', key, messages, date: extractTimestampFromData(value) })
          }
          db.close()
          console.error('Chats found in: globalStorage/state.vscdb')
        }
      }
      const processedDbPaths = new Set()
      if (fs.existsSync(rootStateDb)) processedDbPaths.add(path.resolve(rootStateDb))
      const entries = fs.readdirSync(globalStorage, { withFileTypes: true })
      for (const ent of entries) {
        let dbPath = null
        if (ent.isDirectory()) {
          dbPath = path.join(globalStorage, ent.name, 'state.vscdb')
        } else if (ent.name.toLowerCase().endsWith('.vscdb') || ent.name.startsWith('state.vscdb')) {
          dbPath = path.join(globalStorage, ent.name)
        } else if (!/\.(json|bak)$/i.test(ent.name) && !ent.name.includes('.bak.')) {
          const fp = path.join(globalStorage, ent.name)
          try { if (fs.statSync(fp).size >= 8192) dbPath = fp } catch (e) {}
        }
        if (!dbPath || !fs.existsSync(dbPath)) continue
        const resolvedDb = path.resolve(dbPath)
        if (processedDbPaths.has(resolvedDb)) continue
        processedDbPaths.add(resolvedDb)
        const db = readDb(dbPath)
        if (!db) continue
        const sourceLabel = ent.isDirectory() ? 'globalStorage/' + ent.name : 'globalStorage/' + ent.name
        if (hasCursorDiskKV(db)) {
          const diskChats = queryCursorDiskKV(db)
          for (const { key, messages, date } of diskChats) {
            allChats.push({ workspace: 'globalStorage', key, messages, date })
          }
        }
        const rows = queryChatValues(db)
        for (const { key, value } of rows) {
          const messages = extractMessages(value)
          if (messages.length > 0) {
            const date = extractTimestampFromData(value)
            allChats.push({ workspace: 'globalStorage', key, messages, date })
          }
        }
        db.close()
        console.error('Chats found in:', sourceLabel)
      }
    } catch (e) {
      console.error('Error reading globalStorage:', e.message)
    }
  }

  // Additional Cursor folders may contain cached chat copies.
  const cursorRoot = path.join(basePath, '..')
  const extraPaths = [
    { dir: path.join(cursorRoot, 'Network'), label: 'Network' },
    { dir: path.join(basePath, 'History'), label: 'User/History' },
    { dir: path.join(cursorRoot, 'WebStorage'), label: 'WebStorage' },
    { dir: path.join(cursorRoot, 'logs'), label: 'logs' },
  ]
  for (const { dir, label } of extraPaths) {
    if (!fs.existsSync(dir)) continue
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const ent of entries) {
        let dbPath = null
        if (ent.isDirectory()) {
          dbPath = path.join(dir, ent.name, 'state.vscdb')
        } else if (ent.name.toLowerCase().endsWith('.vscdb')) {
          dbPath = path.join(dir, ent.name)
        }
        if (!dbPath || !fs.existsSync(dbPath)) continue
        const db = readDb(dbPath)
        if (!db) continue
        if (hasCursorDiskKV(db)) {
          const diskChats = queryCursorDiskKV(db)
          for (const { key, messages, date } of diskChats) {
            allChats.push({ workspace: `extra:${label}`, key, messages, date })
          }
        }
        const rows = queryChatValues(db)
        for (const { key, value } of rows) {
          const messages = extractMessages(value)
          if (messages.length > 0) {
            const date = extractTimestampFromData(value)
            allChats.push({ workspace: `extra:${label}`, key, messages, date })
          }
        }
        db.close()
        console.error('Chats found in:', label, path.basename(path.dirname(dbPath)))
      }
    } catch (e) {
      // ignore
    }
  }

  if (allChats.length === 0) {
    console.error('No chats found.')
    console.error('  Searched in:', workspaceStorage)
    console.error('  Put workspaceStorage in project root (workspaceStorage) or pass a path:')
    console.error('  node export-cursor-chat-to-word.js "C:\\Users\\...\\AppData\\Roaming\\Cursor\\User"')
    process.exit(1)
  }

  // Sort by date: newest first, undated last.
  allChats.sort((a, b) => {
    const ta = a.date ? a.date.getTime() : 0
    const tb = b.date ? b.date.getTime() : 0
    return tb - ta
  })

  let totalExported = 0
  const sanitize = (s) => String(s).replace(/[<>:"/\\|?*\0]/g, '_').replace(/\s+/g, '-').slice(0, 80)
  const indexEntries = []
  const allChatsForIndex = []

  for (let i = 0; i < allChats.length; i++) {
    const { workspace, key, messages, date } = allChats[i]
    const safeName = sanitize(workspace)
    const keyShort = sanitize(key.split(/[./\\]/).pop() || 'chat')
    const datePrefix = date ? formatDateForFilename(date) + '-' : ''
    const filename = `chat-${datePrefix}${safeName}-${keyShort}-${i + 1}.html`
    const filenameWord = `chat-${datePrefix}${safeName}-${keyShort}-${i + 1}-word.html`
    const filepath = path.join(outDir, path.basename(filename))
    const filepathWord = path.join(outDir, path.basename(filenameWord))
    const dateStr = date ? formatDateForDisplay(date) : null
    const metaLabel = `Workspace: ${workspace} | Key: ${key}`
    const html = buildHtml(messages, metaLabel, dateStr)
    fs.writeFileSync(filepath, '\ufeff' + html, 'utf8')
    const htmlWord = buildHtmlForWord(messages, metaLabel, dateStr)
    fs.writeFileSync(filepathWord, '\ufeff' + htmlWord, 'utf8')
    console.error(`Saved: ${filename}, ${filenameWord} (${messages.length} messages)${dateStr ? ' - ' + dateStr : ''}`)
    totalExported++
    indexEntries.push({
      filename: path.basename(filename),
      date: dateStr || '—',
      workspace,
      key: keyShort,
      count: messages.length,
    })
    allChatsForIndex.push({
      workspace,
      key: keyShort,
      dateStr: dateStr || '—',
      messages,
      filename: path.basename(filename),
    })
  }

  // Interactive index: workspace filter + chat preview.
  const existingFilenames = new Set(indexEntries.map((e) => e.filename));
  try {
    for (const f of fs.readdirSync(outDir)) {
      if (f === 'index.html' || !f.endsWith('.html') || f.endsWith('-word.html') || existingFilenames.has(f)) continue;
      indexEntries.push({ filename: f, date: '-', workspace: '-', key: f, count: 0 });
      allChatsForIndex.push({ workspace: '-', key: f, dateStr: '-', messages: [], filename: f });
      existingFilenames.add(f);
    }
  } catch (e) {}
    const indexPath = path.join(outDir, 'index.html')
  const indexHtml = buildIndexHtml(indexEntries, allChatsForIndex)
  fs.writeFileSync(indexPath, '\ufeff' + indexHtml, 'utf8')
  console.error(`Created index: ${outDir}/index.html`)

  // Auto-open index.html in the default browser.
  const absIndex = path.resolve(indexPath)
  const openCmd =
    process.platform === 'win32'
      ? `start "" "${absIndex}"`
      : process.platform === 'darwin'
        ? `open "${absIndex}"`
        : `xdg-open "${absIndex}"`
  try {
    exec(openCmd, (err) => {
      if (err) console.error('Failed to open browser:', err.message)
    })
  } catch (e) {
    console.error('Failed to open browser:', e.message)
  }

  console.error(`\nDone. Exported chats: ${totalExported}. Files in: ${outDir}`)
  console.error('index.html opened in browser (or open it manually).')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
