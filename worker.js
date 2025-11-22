export default {
  async fetch(request, env, ctx) {
    // এখন আমরা env থেকে টোকেন নিচ্ছি (সরাসরি কোডে নেই)
    const BOT_TOKEN = env.BOT_TOKEN; 
    const GEMINI_API_KEY = env.GEMINI_API_KEY;

    if (request.method === "POST") {
      try {
        const payload = await request.json();
        if (payload.message && payload.message.text) {
          const chatId = payload.message.chat.id;
          const text = payload.message.text;
          const user = payload.message.from;

          // --- ১. /start কমান্ড ---
          if (text === "/start") {
            await env.DB.prepare("INSERT OR IGNORE INTO users (chat_id, username, first_name, balance) VALUES (?, ?, ?, ?)").bind(chatId, user.username, user.first_name, 50).run();
            await env.DB.prepare("DELETE FROM messages WHERE chat_id = ?").bind(chatId).run();
            
            // ওয়েলকাম মেসেজ
            const welcomeMsg = `স্বাগতম *${user.first_name}*!\n\nআমি এখন আপনার পছন্দমতো ফরম্যাটিং সাপোর্ট করি:\n• **Bold** হবে *Bold*\n• *Italic* হবে _Italic_`;
            await sendTelegramMessage(BOT_TOKEN, chatId, welcomeMsg);
          }

          // --- ২. /me কমান্ড ---
          else if (text === "/me") {
            const userData = await env.DB.prepare("SELECT * FROM users WHERE chat_id = ?").bind(chatId).first();
            if (userData) {
              const msg = `👤 *প্রোফাইল*\n\nনাম: ${userData.first_name}\n💰 ব্যালেন্স: ${userData.balance} টাকা`;
              await sendTelegramMessage(BOT_TOKEN, chatId, msg);
            }
          }

          // --- ৩. AI চ্যাট (কনভার্টার সহ) ---
          else {
            // ক) মেসেজ সেভ
            await env.DB.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', ?)").bind(chatId, text).run();

            // খ) হিস্ট্রি আনা
            const { results } = await env.DB.prepare("SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 10").bind(chatId).all();
            
            const history = results.reverse().map(msg => ({
              role: msg.role,
              parts: [{ text: msg.content }]
            }));

            // গ) জেমিনির কাছে পাঠানো
            let aiReply = await askGemini(GEMINI_API_KEY, history);

            // ঘ) জেমিনির উত্তর ডাটাবেসে সেভ (অরিজিনালটা)
            await env.DB.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'model', ?)").bind(chatId, aiReply).run();

            // ঙ) টেলিগ্রামের জন্য টেক্সট কনভার্ট করা (ম্যাজিক এখানেই!)
            const formattedReply = convertToTelegramMarkdown(aiReply);
            
            // চ) টেলিগ্রামে পাঠানো
            await sendTelegramMessage(BOT_TOKEN, chatId, formattedReply);
          }
        }
      } catch (e) {
        // Error ignore
      }
    }
    return new Response("Secure Bot Running", { status: 200 });
  },
};

// --- টেলিগ্রাম মেসেজ ফাংশন ---
async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown" // আমরা লিগ্যাসি মার্কডাউন ব্যবহার করছি
    }),
  });
}

// --- জেমিনি ফাংশন ---
async function askGemini(apiKey, history) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: history })
    });
    const data = await response.json();
    if (data.candidates && data.candidates.length > 0) return data.candidates[0].content.parts[0].text;
    return "AI Response Error";
  } catch (error) {
    return "Network Error";
  }
}

// =======================================================
// 🛠️ কনভার্টার ফাংশন: এটি জেমিনির লেখাকে টেলিগ্রামের উপযোগী করে
// =======================================================
function convertToTelegramMarkdown(text) {
  // ১. জেমিনির ডাবল স্টার (**Bold**) কে টেলিগ্রামের সিঙ্গেল স্টার (*Bold*) বানাবে
  let cleanText = text.replace(/\*\*(.*?)\*\*/g, '*$1*');

  // ২. জেমিনির সিঙ্গেল স্টার (*Italic*) কে টেলিগ্রামের আন্ডারস্কোর (_Italic_) বানাবে
  // কিন্তু খেয়াল রাখবে যেন তালিকার শুরুতে থাকা স্টার (* List) নষ্ট না হয়
  // লজিক: স্টারের আগে যদি স্পেস বা লাইন ব্রেক থাকে এবং পরে টেক্সট থাকে, তবেই চেঞ্জ হবে
  cleanText = cleanText.replace(/(^|\s)\*([^\s*]+.*?)\*/g, '$1_$2_');

  // ৩. জেমিনির হেডিং (## Title) কে বোল্ড (*Title*) বানিয়ে দিবে
  cleanText = cleanText.replace(/^##\s+(.*)$/gm, '*$1*');

  return cleanText;
}
