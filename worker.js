// Cloudflare Worker Entry Point
export default {
  async fetch(request, env, ctx) {
    // শুধুমাত্র POST রিকোয়েস্ট (টেলিগ্রাম ওয়েব হুক থেকে) এলাউড
    if (request.method !== "POST") {
      return new Response("Bot is running via Webhook.", { status: 200 });
    }

    try {
      const update = await request.json();
      
      // মেইন লজিক ফাংশন কল করা হচ্ছে (ব্যাকগ্রাউন্ডে যাতে টাইমআউট না খায়)
      ctx.waitUntil(processUpdate(update, env));

      return new Response("Ok", { status: 200 });
    } catch (e) {
      return new Response("Error: " + e.message, { status: 500 });
    }
  }
};

// --- Main Logic Handler ---
async function processUpdate(update, env) {
  if (!update.message) return;

  const msg = update.message;
  const chatId = msg.chat.id;
  const uid = msg.from.id;
  
  // ইনপুট ডিটেকশন
  const photoArray = msg.photo;
  const hasPhoto = !!(photoArray && photoArray.length > 0);
  const text = msg.caption || msg.text || ""; // ছবি থাকলে ক্যাপশন, না থাকলে টেক্সট

  // টেক্সট বা ছবি কিছুই না থাকলে ইগনোর
  if (!text && !hasPhoto) return;

  // Typing or Upload status পাঠানো
  await sendChatAction(chatId, hasPhoto ? 'upload_photo' : 'typing', env);

  try {
    let responseData;
    
    // ২. লজিক ডিসিশন মেকিং (হুবহু আপনার আগের লজিক)
    // ছবি থাকলে = POST
    // টেক্সট > ৬০০ = POST
    // অন্যথায় = GET
    const shouldUsePost = hasPhoto || (text && text.length > 600);

    if (shouldUsePost) {
      // --- POST METHOD ---
      const formData = new FormData();
      formData.append('uid', String(uid));
      if (text) formData.append('q', text);

      if (hasPhoto) {
        // হাই কোয়ালিটি ছবি বের করা
        const fileId = photoArray[photoArray.length - 1].file_id;
        
        // ১. টেলিগ্রাম থেকে ফাইল পাথ আনা
        const fileInfoResp = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`);
        const fileInfo = await fileInfoResp.json();
        
        if (fileInfo.ok) {
          const filePath = fileInfo.result.file_path;
          const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;

          // ২. ছবি ডাউনলোড করা (Blob হিসেবে)
          const imageRes = await fetch(fileUrl);
          const imageBlob = await imageRes.blob();

          // ৩. ফর্মে ইমেজ যোগ করা
          formData.append('image', imageBlob, 'image.jpg');
        }
      }

      // আপনার ব্যাকএন্ডে পাঠানো
      const apiRes = await fetch(`${env.API_BASE}/ask`, {
        method: 'POST',
        body: formData
        // Cloudflare এ FormData পাঠালে হেডার অটো সেট হয়
      });
      responseData = await handleApiResponse(apiRes);

    } else {
      // --- GET METHOD ---
      const query = encodeURIComponent(text);
      const apiRes = await fetch(`${env.API_BASE}/ask?q=${query}&uid=${uid}`);
      responseData = await handleApiResponse(apiRes);
    }

    if (!responseData) {
      await sendMessage(chatId, '❌ Empty response from API', env);
      return;
    }

    if (responseData.status && responseData.status !== 'success') {
      await sendMessage(chatId, '❌ API Error: ' + (responseData.message || 'Unknown'), env);
      return;
    }

    const htmlResponse = responseData.text || responseData.output || 'No response text';
    
    // ৩. সেই স্পেশাল ফরম্যাটিং ফাংশন দিয়ে মেসেজ পাঠানো
    await sendHtmlSafeMessage(chatId, htmlResponse, env);

  } catch (err) {
    console.error('Handler error:', err);
    await sendMessage(chatId, '❌ Bot Error: ' + err.message, env);
  }
}

// --- Utilities (API Response Helper) ---
async function handleApiResponse(response) {
  const ctype = response.headers.get('content-type') || '';
  if (ctype.includes('application/json')) {
    return await response.json();
  } else {
    const raw = await response.text();
    try { return JSON.parse(raw); } catch { return { status: 'success', text: raw }; }
  }
}

// --- Telegram API Helpers (Node Lib Replacement) ---
async function sendMessage(chatId, text, env, parseMode = null) {
  const payload = {
    chat_id: chatId,
    text: text,
    disable_web_page_preview: true
  };
  if (parseMode) payload.parse_mode = parseMode;

  return await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function sendChatAction(chatId, action, env) {
  // ফায়ার এন্ড ফরগেট, রেসপন্সের দরকার নেই
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: action })
  }).catch(() => {}); 
}

// ---------------- FORMATTING UTILITIES (UNCHANGED LOGIC) ----------------
// আপনার আগের কোড থেকে হুবহু লজিক নিয়ে আসা হয়েছে যাতে প্রোডাক্টিভিটি সেম থাকে।

function escapeHtmlForCode(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function alreadyEscaped(s) {
  if (!s) return false;
  return s.includes("&lt;") || s.includes("&gt;") || s.includes("&amp;");
}

function normalizePreBlocks(html) {
  if (!html) return "";
  let t = String(html);
  t = t.replace(/(?:[^\n]*)\n([\s\S]*?)/g, (match, inner) => { // fixed regex slightly for strict mode
    const safeInner = alreadyEscaped(inner) ? inner : escapeHtmlForCode(inner);
    return `<pre><code>${safeInner}</code></pre>`;
  });
  // Fix recursive pre tags logic simplified for JS Regex
  t = t.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi, (match, inner) => {
     const safeInner = alreadyEscaped(inner) ? inner : escapeHtmlForCode(inner);
     return `<pre><code>${safeInner}</code></pre>`;
  });
  t = t.replace(/(<\/code><\/pre>)(\s*)(<pre><code>)/gi, "$1\n$3");
  return t;
}

// এই ফাংশনটি বড় মেসেজ ভেঙে পার্ট পার্ট করে
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
    parts.push({ type: 'code', content: m[0] }); // m[1] changed to m[0] for full match
    last = re.lastIndex;
  }
  if (last < s.length) parts.push({ type: 'text', content: s.slice(last) });
  
  const chunks = [];
  let cur = "";
  const pushCur = () => { if (cur) { chunks.push(cur); cur = ""; } };
  
  for (const p of parts) {
    if (p.type === 'code') {
      const block = p.content;
      if ((cur + block).length <= maxLen) {
        cur += block;
      } else {
        pushCur();
        if (block.length <= maxLen) {
          chunks.push(block);
        } else {
          // কোড ব্লক অনেক বড় হলে ফোর্স স্প্লিট
          const inner = block.replace(/<\/?pre>|<\/?code>/gi, "");
          const sliceSize = maxLen - 20;
          for (let i = 0; i < inner.length; i += sliceSize) {
            const piece = inner.slice(i, i + sliceSize);
            const safe = alreadyEscaped(piece) ? piece : escapeHtmlForCode(piece);
            chunks.push(`<pre><code>${safe}</code></pre>`);
          }
        }
      }
    } else {
      const paras = p.content.split(/\n{2,}/g);
      for (let i = 0; i < paras.length; i++) {
        const para = paras[i];
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
    }
  }
  pushCur();
  return chunks;
}

function findUnclosedOpenTags(piece) {
  const allowed = ['b','strong','i','em','code','pre','a'];
  const globalRegex = /<\/?([a-zA-Z0-9]+)(?:\s+[^>]*)?>/g;
  const stack = [];
  let m;
  while ((m = globalRegex.exec(piece)) !== null) {
    const token = m[0];
    const isClose = token.startsWith("</");
    const tag = m[1].toLowerCase();
    
    if (isClose) {
      if (stack.length && stack[stack.length-1].tag === tag) {
        stack.pop();
      }
    } else {
      if (allowed.includes(tag)) {
        stack.push({ tag, open: token });
      }
    }
  }
  return stack;
}

function balanceChunks(chunks) {
  const result = [...chunks];
  for (let i = 0; i < result.length; i++) {
    const piece = result[i];
    const unclosed = findUnclosedOpenTags(piece);
    if (unclosed && unclosed.length > 0) {
      const closes = unclosed.slice().reverse().map(x => `</${x.tag}>`).join('');
      result[i] = piece + closes;
      const openers = unclosed.map(x => x.open).join(''); // simplified reopening
      if (i + 1 < result.length) {
        result[i+1] = openers + result[i+1];
      }
    }
  }
  return result;
}

async function sendHtmlSafeMessage(chatId, html, env) {
  let normalized = normalizePreBlocks(html);
  normalized = normalized.replace(/<br\s*\/?>/gi, '\n');
  let chunks = splitRespectingPreAndParagraphs(normalized, 4000);
  chunks = balanceChunks(chunks);
  
  for (const chunk of chunks) {
    try {
      const res = await sendMessage(chatId, chunk, env, 'HTML');
      if (!res.ok) {
        throw new Error(`Telegram API ${res.status}`);
      }
    } catch (err) {
      // HTML ফেইল করলে প্লেইন টেক্সট পাঠানো
      console.error('Send Error, fallback plain:', err.message);
      const plain = chunk.replace(/<\/?[^>]+(>|$)/g, '');
      await sendMessage(chatId, plain, env);
    }
  }
}
