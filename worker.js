// bot.js — FINAL (uses your provided token & API base)
// Features:
// - History (sent as uid to API)
// - Image support (download from Telegram -> upload to your API as multipart)
// - Smart GET/POST: GET if <=600 chars and no image, else POST
// - Preserves code blocks and sends HTML (parse_mode: 'HTML')
// - Chunking for long replies
//
// Requires:
//   npm install node-telegram-bot-api node-fetch form-data
//
// NOTE: In production, move BOT_TOKEN out of source and into env variables.

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const FormData = require('form-data');
const TelegramBot = require('node-telegram-bot-api');

// ----- CONFIG (you provided these) -----
const BOT_TOKEN = "8205025354:AAHcabaH_MPU8RpOb8xicmL-12Ws0ujaMBo";
const API_BASE = "https://ff930dfe-3447-4745-9030-2102395ef11c-00-3sbm2vjl7iscd.sisko.replit.dev";
// ----------------------------------------

if (!BOT_TOKEN || BOT_TOKEN.includes("YOUR_TELEGRAM_BOT_TOKEN_HERE")) {
  console.warn("⚠️ BOT_TOKEN seems missing or placeholder.");
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("🤖 Bot started.");

// ---------------- Utilities ----------------

// Escape text for HTML inside <code> or anywhere we want to ensure safety
function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Detect if string already contains HTML entities (to avoid double-escape)
function alreadyEscaped(s) {
  if (!s) return false;
  return s.includes("&lt;") || s.includes("&gt;") || s.includes("&amp;");
}

// Normalize fenced and pre/code blocks: ensure inner is escaped if needed
function normalizePreBlocks(html) {
  if (!html) return "";
  let t = String(html);

  // Convert fenced ``` blocks to <pre><code>escaped...</code></pre>
  t = t.replace(/```(?:[^\n]*)\n([\s\S]*?)```/g, (_, inner) => {
    const safeInner = alreadyEscaped(inner) ? inner : escapeHtml(inner);
    return `<pre><code>${safeInner}</code></pre>`;
  });

  // Normalize existing <pre><code>...</code></pre>
  t = t.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi, (_, inner) => {
    const safeInner = alreadyEscaped(inner) ? inner : escapeHtml(inner);
    return `<pre><code>${safeInner}</code></pre>`;
  });

  // ensure adjacent pre blocks have newline between them
  t = t.replace(/(<\/code><\/pre>)(\s*)(<pre><code>)/gi, "$1\n$3");

  return t;
}

// Split into chunks <= maxLen, preserving pre/code blocks and preferring paragraph boundaries
function splitRespectingPreAndParagraphs(text, maxLen = 4000) {
  if (!text) return [""];
  const s = String(text);
  if (s.length <= maxLen) return [s];

  const re = /(<pre><code>[\s\S]*?<\/code><\/pre>)/gi;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push({ type: 'text', content: s.slice(last, m.index) });
    parts.push({ type: 'code', content: m[1] });
    last = re.lastIndex;
  }
  if (last < s.length) parts.push({ type: 'text', content: s.slice(last) });

  const chunks = [];
  let cur = "";
  const pushCur = () => { if (cur) { chunks.push(cur); cur = ""; } };

  for (const p of parts) {
    if (p.type === 'text') {
      const paras = p.content.split(/\n{2,}/g);
      for (const para of paras) {
        const piece = cur ? ("\n\n" + para) : para;
        if ((cur + piece).length <= maxLen) {
          cur += piece;
        } else {
          pushCur();
          if (piece.length > maxLen) {
            let rem = piece;
            while (rem.length > maxLen) {
              chunks.push(rem.slice(0, maxLen));
              rem = rem.slice(maxLen);
            }
            cur = rem;
          } else {
            cur = para;
          }
        }
      }
    } else { // pre/code block
      const block = p.content;
      if ((cur + block).length <= maxLen) {
        cur += block;
      } else {
        pushCur();
        if (block.length <= maxLen) {
          chunks.push(block);
        } else {
          // split very large code block into wrapped slices
          const inner = block.replace(/<\/?pre>|<\/?code>/gi, "");
          const sliceSize = maxLen - 20;
          for (let i = 0; i < inner.length; i += sliceSize) {
            const slice = inner.slice(i, i + sliceSize);
            const safe = alreadyEscaped(slice) ? slice : escapeHtml(slice);
            chunks.push(`<pre><code>${safe}</code></pre>`);
          }
        }
      }
    }
  }

  pushCur();
  return chunks;
}

// Find unclosed allowed tags in a piece and return array of open tag names (stack order)
function findUnclosedOpenTags(piece) {
  const allowed = new Set(['b','strong','i','em','code','pre','a']);
  const tokenRegex = /<\/?[a-zA-Z0-9]+(?:\s+[^>]*)?>/g;
  const stack = [];
  let m;
  while ((m = tokenRegex.exec(piece)) !== null) {
    const token = m[0];
    if (/^<\//.test(token)) {
      // closing tag
      const tag = token.replace(/^<\/\s*([^\s>]+).*>$/i, '$1').toLowerCase();
      if (stack.length && stack[stack.length - 1] === tag) {
        stack.pop();
      } else {
        // unmatched close — ignore
      }
    } else {
      const tag = token.replace(/^<\s*([^\s>]+).*>$/i, '$1').toLowerCase();
      if (allowed.has(tag)) {
        stack.push(tag);
      }
    }
  }
  return stack; // open tags left (in order of occurrence)
}

// Balance chunks: append closers to each chunk and prepend reopeners to next
function balanceChunks(chunks) {
  const result = [...chunks];
  for (let i = 0; i < result.length; i++) {
    const piece = result[i];
    const unclosed = findUnclosedOpenTags(piece);
    if (unclosed && unclosed.length > 0) {
      // append closers in reverse
      const closes = unclosed.slice().reverse().map(t => `</${t}>`).join('');
      result[i] = piece + closes;
      // create openers to add to next chunk
      const openers = unclosed.map(t => `<${t}>`).join('');
      if (i + 1 < result.length) {
        result[i+1] = openers + result[i+1];
      }
    }
  }
  return result;
}

// Send HTML-safe (balanced) message in chunks
async function sendHtmlSafeMessage(chatId, html) {
  let normalized = normalizePreBlocks(html);
  normalized = normalized.replace(/<br\s*\/?>/gi, "\n");

  let chunks = splitRespectingPreAndParagraphs(normalized, 4000);
  chunks = balanceChunks(chunks);

  for (const chunk of chunks) {
    try {
      await bot.sendMessage(chatId, chunk, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (err) {
      console.error('sendMessage failed for chunk, fallback to plain:', err && err.message);
      const plain = chunk.replace(/<\/?[^>]+(>|$)/g, '');
      await bot.sendMessage(chatId, plain);
    }
  }
}

// ---------------- API caller ----------------
// choose GET/POST depending on rules and send uid
async function callApi(uid, text, imageBuffer) {
  const mustPost = !!imageBuffer;
  const isLong = text && text.length > 600;
  const usePost = mustPost || isLong;

  if (!usePost) {
    // GET
    const q = encodeURIComponent(text || "");
    const url = `${API_BASE}/ask?uid=${encodeURIComponent(uid)}&q=${q}`;
    const res = await fetch(url);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    const raw = await res.text();
    try { return JSON.parse(raw); } catch { return { status: 'success', text: raw }; }
  }

  // POST (multipart)
  const form = new FormData();
  form.append('uid', String(uid));
  if (text) form.append('q', text);
  if (imageBuffer) {
    // node-form-data accepts Buffer with filename
    form.append('image', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
  }

  const res = await fetch(`${API_BASE}/ask`, { method: 'POST', body: form });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  const raw = await res.text();
  try { return JSON.parse(raw); } catch { return { status: 'success', text: raw }; }
}

// ---------------- Download image helper ----------------
async function downloadFileBuffer(filePathOrUrl) {
  // Accept either a Telegram file URL or direct file path (we'll detect)
  let url = filePathOrUrl;
  if (!/^https?:\/\//i.test(url)) {
    // it's a Telegram file_path — convert to full URL
    url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePathOrUrl}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------------- Main message handler ----------------
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const uid = msg.from.id; // telegram user id for history
  const hasPhoto = !!msg.photo;
  const text = hasPhoto ? (msg.caption || "") : (msg.text || "");

  if (!hasPhoto && !text) return; // ignore stickers etc.

  try {
    bot.sendChatAction(chatId, hasPhoto ? 'upload_photo' : 'typing');

    let imageBuffer = null;
    if (hasPhoto) {
      // get highest quality photo file_id
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      // get file info & file_path
      const fileInfo = await bot.getFile(fileId); // object with file_path
      if (!fileInfo || !fileInfo.file_path) throw new Error('Failed to get file info');
      // download buffer
      imageBuffer = await downloadFileBuffer(fileInfo.file_path);
    }

    // call API (GET/POST selection inside callApi)
    const apiResp = await callApi(uid, text, imageBuffer);

    if (!apiResp) {
      return bot.sendMessage(chatId, "❌ Empty response from API");
    }
    if (apiResp.status && apiResp.status !== 'success') {
      return bot.sendMessage(chatId, `❌ API Error: ${apiResp.message || apiResp.error || JSON.stringify(apiResp)}`);
    }

    // API returns formatted HTML in apiResp.text or apiResp.answer
    const html = apiResp.text || apiResp.answer || apiResp.output || (typeof apiResp === 'string' ? apiResp : '');

    if (!html) {
      return bot.sendMessage(chatId, "(empty response)");
    }

    // send safely in chunks
    await sendHtmlSafeMessage(chatId, html);

  } catch (err) {
    console.error('Handler error:', err);
    try { await bot.sendMessage(chatId, `❌ Bot error: ${err.message || err}`); } catch (e) {}
  }
});
