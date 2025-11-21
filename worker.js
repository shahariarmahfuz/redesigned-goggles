export default {
  async fetch(request, env, ctx) {
    // ==================================================================
    // আপনার কনফিগারেশন (আসল কি এবং টোকেন বসাবেন)
    // ==================================================================
    const BOT_TOKEN = "8205025354:AAHcabaH_MPU8RpOb8xicmL-12Ws0ujaMBo"; 
    const GEMINI_API_KEY = "AIzaSyDqac3yFY5OnSeK4Kl5luWm8X9ASROdDJI"; 

    if (request.method === "POST") {
      try {
        const payload = await request.json();
        if (payload.message && payload.message.text) {
          const chatId = payload.message.chat.id;
          const text = payload.message.text;
          const user = payload.message.from;

          // --- ১. /start দিলে নতুন করে শুরু হবে ---
          if (text === "/start") {
            // ইউজার সেভ করা
            await env.DB.prepare(
              "INSERT OR IGNORE INTO users (chat_id, username, first_name, balance) VALUES (?, ?, ?, ?)"
            ).bind(chatId, user.username, user.first_name, 50).run();
            
            // আগের চ্যাট হিস্ট্রি মুছে ফেলা (রিসেট)
            await env.DB.prepare("DELETE FROM messages WHERE chat_id = ?").bind(chatId).run();
            
            await sendTelegramMessage(BOT_TOKEN, chatId, `স্বাগতম *${user.first_name}*! \nআমি আপনার আগের কথা মনে রাখতে পারি। \n(নতুন করে শুরু করতে চাইলে আবার /start দিবেন)`);
          }

          // --- ২. প্রোফাইল চেক ---
          else if (text === "/me") {
            const userData = await env.DB.prepare("SELECT * FROM users WHERE chat_id = ?").bind(chatId).first();
            if (userData) {
              const msg = `👤 *প্রোফাইল*\n\nনাম: ${userData.first_name}\n💰 ব্যালেন্স: ${userData.balance} টাকা`;
              await sendTelegramMessage(BOT_TOKEN, chatId, msg);
            }
          }

          // --- ৩. AI চ্যাট (মেমোরি সহ) ---
          else {
            // ক) ইউজারের বর্তমান মেসেজ ডাটাবেসে সেভ করা
            await env.DB.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', ?)").bind(chatId, text).run();

            // খ) আগের ১০টি মেসেজ ডাটাবেস থেকে আনা
            const { results } = await env.DB.prepare("SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 10").bind(chatId).all();
            
            // গ) হিস্ট্রি সাজানো (গুগলের ফরম্যাটে)
            // ডাটাবেস থেকে উল্টো আসে (DESC), তাই reverse() করে সোজা করলাম
            const history = results.reverse().map(msg => ({
              role: msg.role,
              parts: [{ text: msg.content }]
            }));

            // ঘ) জেমিনির কাছে পাঠানো
            let aiReply = await askGeminiWithHistory(GEMINI_API_KEY, history);

            // ঙ) জেমিনির ডাবল স্টার (**) কে টেলিগ্রামের সিঙ্গেল স্টার (*) এ কনভার্ট করা
            // যাতে লেখা বোল্ড হয়
            aiReply = aiReply.replace(/\*\*/g, "*");

            // চ) জেমিনির উত্তর ডাটাবেসে সেভ করা
            await env.DB.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'model', ?)").bind(chatId, aiReply).run();
            
            // ছ) টেলিগ্রামে পাঠানো
            await sendTelegramMessage(BOT_TOKEN, chatId, aiReply);
          }
        }
      } catch (e) {
        // Error ignore
      }
    }
    return new Response("Smart Bot Running", { status: 200 });
  },
};

// --- টেলিগ্রাম মেসেজ ফাংশন (Markdown অন করা) ---
async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown" // এটি লেখা বোল্ড বা লিস্ট করতে সাহায্য করে
    }),
  });
}

// --- জেমিনি ফাংশন (হিস্ট্রি সাপোর্ট) ---
async function askGeminiWithHistory(apiKey, history) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: history 
      })
    });

    const data = await response.json();

    if (data.candidates && data.candidates.length > 0) {
      return data.candidates[0].content.parts[0].text;
    } else if (data.error) {
      return `⚠️ Google Error: ${data.error.message}`;
    } else {
      return "দুঃখিত, কোনো উত্তর পাওয়া যায়নি।";
    }
  } catch (error) {
    return `নেটওয়ার্ক এরর: ${error.message}`;
  }
}
