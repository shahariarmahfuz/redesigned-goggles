export default {
  async fetch(request, env, ctx) {
    // env থেকে টোকেন নেওয়া হচ্ছে
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
            
            const welcomeMsg = `স্বাগতম *${user.first_name}*!\n\nএখন ফরম্যাটিং একদম ঠিকভাবে কাজ করবে:\n\n• প্লেইন টেক্সট লিস্ট\n• *বোল্ড লিস্ট*\n• _ইতালিক লিস্ট_`;
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

          // --- ৩. AI চ্যাট ---
          else {
            // মেসেজ সেভ
            await env.DB.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', ?)").bind(chatId, text).run();

            // হিস্ট্রি আনা
            const { results } = await env.DB.prepare("SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 10").bind(chatId).all();
            const history = results.reverse().map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }));

            // জেমিনির উত্তর আনা
            let aiReply = await askGemini(GEMINI_API_KEY, history);

            // ডাটাবেসে অরিজিনাল উত্তর সেভ
            await env.DB.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'model', ?)").bind(chatId, aiReply).run();

            // 🛠️ ফরম্যাট ঠিক করা (লাইন বাই লাইন)
            const formattedReply = convertToTelegramMarkdown(aiReply);
            
            // টেলিগ্রামে পাঠানো
            await sendTelegramMessage(BOT_TOKEN, chatId, formattedReply);
          }
        }
      } catch (e) {
        // Error ignore
      }
    }
    return new Response("Fixed Formatting Bot Running", { status: 200 });
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
      parse_mode: "Markdown" // লিগ্যাসি মার্কডাউন
    }),
  });
}

// --- জেমিনি ফাংশন ---
async function askGemini(apiKey, history) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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
// 🛠️ নতুন কনভার্টার ফাংশন (লাইন বাই লাইন প্রসেসিং)
// =======================================================
function convertToTelegramMarkdown(text) {
  if (!text) return "";

  // ১. পুরো টেক্সটকে লাইন ধরে আলাদা করি
  const lines = text.split('\n');

  // ২. প্রতিটি লাইন আলাদাভাবে ঠিক করি
  const formattedLines = lines.map(line => {
    let newLine = line;

    // ধাপ ক: লিস্ট বা বুলেট পয়েন্ট ঠিক করা
    // যদি লাইনটি "* " দিয়ে শুরু হয়, তবে সেটাকে "• " বানাই
    if (/^\*\s/.test(newLine)) {
      newLine = newLine.replace(/^\*\s/, '• ');
    }

    // ধাপ খ: বোল্ড ঠিক করা (**Text**) -> (*Text*)
    // আমরা সাময়িকভাবে এটাকে গোপন কোড (BOLD_MARKER) দিয়ে রিপ্লেস করব
    // যাতে পরের ধাপে ইতালিকের সাথে মিশে না যায়
    newLine = newLine.replace(/\*\*(.*?)\*\*/g, 'BOLD_MARKER_START$1BOLD_MARKER_END');

    // ধাপ গ: ইতালিক ঠিক করা (*Text*) -> (_Text_)
    // এখন যা বাকি আছে সিঙ্গেল স্টার, সেগুলো সব ইতালিক
    newLine = newLine.replace(/\*(.*?)\*/g, '_$1_');

    // ধাপ ঘ: গোপন কোডকে আসল বোল্ডে (*Text*) ফেরত আনা
    newLine = newLine.replace(/BOLD_MARKER_START/g, '*');
    newLine = newLine.replace(/BOLD_MARKER_END/g, '*');

    // ধাপ ঙ: হেডিং থাকলে বোল্ড করা
    newLine = newLine.replace(/^##\s+(.*)$/, '*$1*');

    return newLine;
  });

  // ৩. সব লাইন আবার জোড়া দিয়ে ফেরত দেই
  return formattedLines.join('\n');
}
