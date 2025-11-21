export default {
  async fetch(request, env, ctx) {
    // আপনার দেওয়া টোকেন এবং কী এখানে সরাসরি বসানো হলো
    const BOT_TOKEN = "8205025354:AAHcabaH_MPU8RpOb8xicmL-12Ws0ujaMBo";
    const GEMINI_API_KEY = "AIzaSyAUDb215MhOc_nmdmTwQCj_Zijfsb8Z0pA";

    if (request.method === "POST") {
      try {
        const payload = await request.json();
        if (payload.message && payload.message.text) {
          const chatId = payload.message.chat.id;
          const text = payload.message.text;
          const user = payload.message.from;

          // --- ১. কমান্ড হ্যান্ডলিং (/start) ---
          if (text === "/start") {
            // ডাটাবেস কানেকশন (env.DB) আগের মতোই থাকবে কারণ এটা Wrangler.toml থেকে আসে
            await env.DB.prepare(
              "INSERT OR IGNORE INTO users (chat_id, username, first_name, balance) VALUES (?, ?, ?, ?)"
            ).bind(chatId, user.username, user.first_name, 50).run();

            await sendTelegramMessage(BOT_TOKEN, chatId, `স্বাগতম ${user.first_name}! আমি এখন একটি স্মার্ট AI বট। আপনি আমার সাথে যেকোনো বিষয়ে কথা বলতে পারেন।`);
          }

          // --- ২. প্রোফাইল চেকিং (/me) ---
          else if (text === "/me") {
            const userData = await env.DB.prepare("SELECT * FROM users WHERE chat_id = ?").bind(chatId).first();
            if (userData) {
              const msg = `👤 নাম: ${userData.first_name}\n💰 ব্যালেন্স: ${userData.balance} টাকা`;
              await sendTelegramMessage(BOT_TOKEN, chatId, msg);
            } else {
              await sendTelegramMessage(BOT_TOKEN, chatId, "আপনার প্রোফাইল পাওয়া যায়নি। দয়া করে /start দিন।");
            }
          }

          // --- ৩. বাকি সব মেসেজ জেমিনি AI এর কাছে যাবে ---
          else {
            // জেমিনিকে কল করা হচ্ছে (সরাসরি কী ব্যবহার করে)
            const aiReply = await askGemini(GEMINI_API_KEY, text);
            
            // জেমিনির উত্তর টেলিগ্রামে পাঠানো
            await sendTelegramMessage(BOT_TOKEN, chatId, aiReply);
          }
        }
      } catch (e) {
        // কোনো এরর হলে ইগনোর করবে
      }
    }
    return new Response("Smart AI Bot Running Directly!", { status: 200 });
  },
};

// --- টেলিগ্রামে মেসেজ পাঠানোর ফাংশন ---
async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text }),
  });
}

// --- জেমিনি AI এর সাথে কথা বলার ফাংশন ---
async function askGemini(apiKey, prompt) {
  // gemini-1.5-flash মডেল ব্যবহার করা হচ্ছে (দ্রুত এবং ফ্রি)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    const data = await response.json();
    
    // জেমিনির উত্তর বের করে আনা
    if (data.candidates && data.candidates.length > 0) {
      return data.candidates[0].content.parts[0].text;
    } else {
      return "আমি এখন উত্তর দিতে পারছি না, দয়া করে পরে চেষ্টা করুন।";
    }
  } catch (error) {
    return "AI কানেকশনে সমস্যা হয়েছে।";
  }
}
