export default {
  async fetch(request, env, ctx) {
    // আপনার কনফিগারেশন
    const BOT_TOKEN = "8205025354:AAHcabaH_MPU8RpOb8xicmL-12Ws0ujaMBo"; 
    const GEMINI_API_KEY = "AIzaSyDqac3yFY5OnSeK4Kl5luWm8X9ASROdDJI"; // আপনার আসল কি বসাবেন

    if (request.method === "POST") {
      try {
        const payload = await request.json();
        if (payload.message && payload.message.text) {
          const chatId = payload.message.chat.id;
          const text = payload.message.text;
          const user = payload.message.from;

          // --- ১. /start হ্যান্ডলিং ---
          if (text === "/start") {
            // ইউজার সেভ করা
            await env.DB.prepare("INSERT OR IGNORE INTO users (chat_id, username, first_name, balance) VALUES (?, ?, ?, ?)").bind(chatId, user.username, user.first_name, 50).run();
            // পুরনো চ্যাট মুছে ফেলা (রিসেট)
            await env.DB.prepare("DELETE FROM messages WHERE chat_id = ?").bind(chatId).run();
            
            await sendTelegramMessage(BOT_TOKEN, chatId, `স্বাগতম ${user.first_name}! আমি আপনার আগের কথা মনে রাখতে পারি। কথা বলা শুরু করুন!`);
          }

          // --- ২. AI চ্যাট (হিস্ট্রি সহ) ---
          else {
            // ক) ইউজারের মেসেজ ডাটাবেসে সেভ করা
            await env.DB.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', ?)").bind(chatId, text).run();

            // খ) আগের ১০টি মেসেজ ডাটাবেস থেকে আনা (স্মৃতি)
            const { results } = await env.DB.prepare("SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 10").bind(chatId).all();
            
            // গ) ডাটাবেসের উল্টো লিস্ট সোজা করা এবং জেমিনির ফরমেটে সাজানো
            const history = results.reverse().map(msg => ({
              role: msg.role,
              parts: [{ text: msg.content }]
            }));

            // ঘ) জেমিনির কাছে পাঠানো (পুরো হিস্ট্রি সহ)
            const aiReply = await askGeminiWithHistory(GEMINI_API_KEY, history);

            // ঙ) জেমিনির উত্তর ডাটাবেসে সেভ করা
            await env.DB.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'model', ?)").bind(chatId, aiReply).run();
            
            // চ) টেলিগ্রামে পাঠানো
            await sendTelegramMessage(BOT_TOKEN, chatId, aiReply);
          }
        }
      } catch (e) {
        // Error ignore
      }
    }
    return new Response("Memory Bot Running", { status: 200 });
  },
};

// --- টেলিগ্রাম মেসেজ ফাংশন ---
async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text }),
  });
}

// --- জেমিনি ফাংশন (হিস্ট্রি সাপোর্ট সহ) ---
async function askGeminiWithHistory(apiKey, history) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: history // শুধু টেক্সট না, পুরো হিস্ট্রি যাচ্ছে
      })
    });

    const data = await response.json();

    if (data.candidates && data.candidates.length > 0) {
      return data.candidates[0].content.parts[0].text;
    } else if (data.error) {
      return `Error: ${data.error.message}`;
    } else {
      return "দুঃখিত, উত্তর দিতে পারছি না।";
    }
  } catch (error) {
    return "নেটওয়ার্ক সমস্যা।";
  }
}
