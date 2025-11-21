export default {
  async fetch(request, env, ctx) {
    // ==================================================================
    // আপনার কনফিগারেশন
    // ==================================================================
    const BOT_TOKEN = "8205025354:AAHcabaH_MPU8RpOb8xicmL-12Ws0ujaMBo"; 
    const GEMINI_API_KEY = "AIzaSyAUDb215MhOc_nmdmTwQCj_Zijfsb8Z0pA"; 

    if (request.method === "POST") {
      try {
        const payload = await request.json();
        if (payload.message && payload.message.text) {
          const chatId = payload.message.chat.id;
          const text = payload.message.text;
          const user = payload.message.from;

          // --- ১. /start কমান্ড ---
          if (text === "/start") {
            await env.DB.prepare(
              "INSERT OR IGNORE INTO users (chat_id, username, first_name, balance) VALUES (?, ?, ?, ?)"
            ).bind(chatId, user.username, user.first_name, 50).run();
            
            await env.DB.prepare("DELETE FROM messages WHERE chat_id = ?").bind(chatId).run();
            
            // HTML ফরম্যাটে ওয়েলকাম মেসেজ
            await sendTelegramMessage(BOT_TOKEN, chatId, `স্বাগতম <b>${user.first_name}</b>! \nআমি এখন কোড এবং ডিজাইন সুন্দরভাবে দেখাতে পারি।`);
          }

          // --- ২. /me কমান্ড ---
          else if (text === "/me") {
            const userData = await env.DB.prepare("SELECT * FROM users WHERE chat_id = ?").bind(chatId).first();
            if (userData) {
              const msg = `👤 <b>প্রোফাইল</b>\n\nনাম: ${userData.first_name}\n💰 ব্যালেন্স: <code>${userData.balance}</code> টাকা`;
              await sendTelegramMessage(BOT_TOKEN, chatId, msg);
            }
          }

          // --- ৩. AI চ্যাট (HTML সাপোর্টেড) ---
          else {
            // ক) ইউজার মেসেজ সেভ
            await env.DB.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', ?)").bind(chatId, text).run();

            // খ) হিস্ট্রি আনা
            const { results } = await env.DB.prepare("SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 10").bind(chatId).all();
            
            // গ) জেমিনির জন্য হিস্ট্রি সাজানো
            const history = results.reverse().map(msg => ({
              role: msg.role,
              parts: [{ text: msg.content }]
            }));

            // ঘ) জেমিনির কাছে পাঠানো (HTML ইনস্ট্রাকশন সহ)
            const aiReply = await askGeminiHTML(GEMINI_API_KEY, history);

            // ঙ) জেমিনির উত্তর ডাটাবেসে সেভ
            await env.DB.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'model', ?)").bind(chatId, aiReply).run();
            
            // চ) টেলিগ্রামে পাঠানো
            await sendTelegramMessage(BOT_TOKEN, chatId, aiReply);
          }
        }
      } catch (e) {
        // Error ignore
      }
    }
    return new Response("HTML Bot Running", { status: 200 });
  },
};

// --- টেলিগ্রাম মেসেজ ফাংশন (HTML Mode) ---
async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "HTML" // এখন আমরা HTML ব্যবহার করছি, যা অনেক বেশি শক্তিশালী
    }),
  });
}

// --- জেমিনি ফাংশন (HTML ইনস্ট্রাকশন সহ) ---
async function askGeminiHTML(apiKey, history) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  // আমরা জেমিনিকে সিস্টেম মেসেজ দিচ্ছি যেন সে HTML এ উত্তর দেয়
  const systemInstruction = {
    role: "user",
    parts: [{ text: "System Rule: Answer in Telegram-supported HTML format. Use <b>bold</b> for bold, <i>italic</i> for italic, <code>code</code> for inline code, and <pre>code block</pre> for code blocks. Do not use Markdown." }]
  };

  // সিস্টেম ইনস্ট্রাকশনটি হিস্ট্রির একদম শুরুতে যোগ করে দিচ্ছি
  const finalContents = [systemInstruction, ...history];

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: finalContents
      })
    });

    const data = await response.json();

    if (data.candidates && data.candidates.length > 0) {
      return data.candidates[0].content.parts[0].text;
    } else if (data.error) {
      return `⚠️ Error: ${data.error.message}`;
    } else {
      return "No response from AI.";
    }
  } catch (error) {
    return `Network Error: ${error.message}`;
  }
}
