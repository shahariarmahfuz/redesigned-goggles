export default {
  async fetch(request, env, ctx) {
    // ==================================================================
    // সেটিং এরিয়া: এখানে আপনার আসল টোকেন এবং কি বসান
    // ==================================================================
    const BOT_TOKEN = "8205025354:AAHcabaH_MPU8RpOb8xicmL-12Ws0ujaMBo"; 
    
    // ⚠️ নিচে আপনার আসল Gemini API Key বসান (ফেক দিলে কাজ করবে না)
    const GEMINI_API_KEY = "AIzaSyAUDb215MhOc_nmdmTwQCj_Zijfsb8Z0pA"; 
    // ==================================================================

    if (request.method === "POST") {
      try {
        const payload = await request.json();
        if (payload.message && payload.message.text) {
          const chatId = payload.message.chat.id;
          const text = payload.message.text;
          const user = payload.message.from;

          // ১. /start কমান্ড
          if (text === "/start") {
            // ডাটাবেসে ইউজার সেভ করা
            await env.DB.prepare(
              "INSERT OR IGNORE INTO users (chat_id, username, first_name, balance) VALUES (?, ?, ?, ?)"
            ).bind(chatId, user.username, user.first_name, 50).run();

            await sendTelegramMessage(BOT_TOKEN, chatId, `স্বাগতম ${user.first_name}! আমি রেডি। আমাকে যেকোনো প্রশ্ন করতে পারেন।`);
          }

          // ২. /me কমান্ড
          else if (text === "/me") {
            const userData = await env.DB.prepare("SELECT * FROM users WHERE chat_id = ?").bind(chatId).first();
            if (userData) {
              const msg = `👤 নাম: ${userData.first_name}\n💰 ব্যালেন্স: ${userData.balance} টাকা`;
              await sendTelegramMessage(BOT_TOKEN, chatId, msg);
            } else {
              await sendTelegramMessage(BOT_TOKEN, chatId, "প্রোফাইল পাওয়া যায়নি।");
            }
          }

          // ৩. বাকি সব কথা জেমিনি AI বলবে
          else {
            // জেমিনির কাছে পাঠানো হচ্ছে
            const aiReply = await askGemini(GEMINI_API_KEY, text);
            await sendTelegramMessage(BOT_TOKEN, chatId, aiReply);
          }
        }
      } catch (e) {
        // সিস্টেম এরর
      }
    }
    return new Response("Bot is Running", { status: 200 });
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

// --- জেমিনি AI ফাংশন (সাথে ডিবাগিং) ---
async function askGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
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

    // ১. যদি গুগল এরর দেয় (যেমন: Key Invalid)
    if (data.error) {
      return `⚠️ Google Error: ${data.error.message}\n(আপনার API Key টি চেক করুন)`;
    }

    // ২. যদি সঠিক উত্তর আসে
    if (data.candidates && data.candidates.length > 0) {
      return data.candidates[0].content.parts[0].text;
    } 
    
    // ৩. অন্য কোনো সমস্যা
    else {
      return `অদ্ভুত সমস্যা! রেসপন্স দেখুন: ${JSON.stringify(data)}`;
    }

  } catch (error) {
    return `কোড বা নেটওয়ার্ক এরর: ${error.message}`;
  }
}
