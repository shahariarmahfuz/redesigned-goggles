export default {
  async fetch(request, env, ctx) {
    // ১. আমরা সিকিউর ভেরিয়েবল ব্যবহার করছি
    const BOT_TOKEN = env.BOT_TOKEN; 
    const GEMINI_API_KEY = env.GEMINI_API_KEY;

    if (request.method === "POST") {
      try {
        const payload = await request.json();
        if (payload.message && payload.message.text) {
          const chatId = payload.message.chat.id;
          const text = payload.message.text;
          const user = payload.message.from;

          // --- /start কমান্ড ---
          if (text === "/start") {
            await env.DB.prepare("INSERT OR IGNORE INTO users (chat_id, username, first_name, balance) VALUES (?, ?, ?, ?)").bind(chatId, user.username, user.first_name, 50).run();
            await env.DB.prepare("DELETE FROM messages WHERE chat_id = ?").bind(chatId).run();
            
            const welcomeMsg = `স্বাগতম *${user.first_name}*!\n\nআমি এখন ঠিকভাবে ফরম্যাটিং করতে পারি:\n• *Bold Text*\n• _Italic Text_`;
            await sendTelegramMessage(BOT_TOKEN, chatId, welcomeMsg);
          }

          // --- /me কমান্ড ---
          else if (text === "/me") {
            const userData = await env.DB.prepare("SELECT * FROM users WHERE chat_id = ?").bind(chatId).first();
            if (userData) {
              const msg = `👤 *প্রোফাইল*\n\nনাম: ${userData.first_name}\n💰 ব্যালেন্স: ${userData.balance} টাকা`;
              await sendTelegramMessage(BOT_TOKEN, chatId, msg);
            }
          }

          // --- AI চ্যাট ---
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

            // ঘ) ডাটাবেসে অরিজিনাল উত্তর সেভ করা
            await env.DB.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'model', ?)").bind(chatId, aiReply).run();

            // ঙ) কনভার্ট করা (আপনার দেওয়া নিয়ম অনুযায়ী)
            const formattedReply = convertToTelegramMarkdown(aiReply);
            
            // চ) টেলিগ্রামে পাঠানো
            await sendTelegramMessage(BOT_TOKEN, chatId, formattedReply);
          }
        }
      } catch (e) {
        // Error ignore
      }
    }
    return new Response("Bot Running with Strict Formatting", { status: 200 });
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
      parse_mode: "Markdown" // টেলিগ্রামের লিগ্যাসি মোড
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
    return "AI Error";
  } catch (error) {
    return "Network Error";
  }
}

// =======================================================
// 🛠️ কাস্টম কনভার্টার (আপনার নিয়ম অনুযায়ী)
// =======================================================
function convertToTelegramMarkdown(text) {
  if (!text) return "";

  // ধাপ ১: জেমিনির ডাবল স্টার (**Bold**) কে সাময়িকভাবে একটি গোপন কোড দিয়ে বদলে ফেলি
  // কারণ আমরা চাই না ইতালিক ঠিক করার সময় এগুলো নষ্ট হোক
  let cleanText = text.replace(/\*\*(.*?)\*\*/g, 'PLACEHOLDER_BOLD_START$1PLACEHOLDER_BOLD_END');

  // ধাপ ২: লিস্ট বা বুলেট পয়েন্ট ঠিক করা
  // যদি লাইনের শুরুতে "* " থাকে, সেটাকে "• " দিয়ে বদলে ফেলা
  cleanText = cleanText.replace(/(^|\n)\*\s/g, '$1• ');

  // ধাপ ৩: এবার বাকি থাকা সিঙ্গেল স্টার (*Italic*) কে টেলিগ্রামের আন্ডারস্কোর (_Italic_) এ বদলানো
  cleanText = cleanText.replace(/\*(.*?)\*/g, '_$1_');

  // ধাপ ৪: শেষে গোপন কোডগুলোকে টেলিগ্রামের বোল্ড (*Bold*) এ ফেরত আনা
  cleanText = cleanText.replace(/PLACEHOLDER_BOLD_START/g, '*');
  cleanText = cleanText.replace(/PLACEHOLDER_BOLD_END/g, '*');

  // অতিরিক্ত: হেডিং থাকলে সেটাকেও বোল্ড করে দেওয়া
  cleanText = cleanText.replace(/^##\s+(.*)$/gm, '*$1*');

  return cleanText;
}
