export default {
  async fetch(request, env, ctx) {
    const BOT_TOKEN = env.BOT_TOKEN; 
    // GEMINI_API_KEY আর লাগছে না

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
            
            const welcomeMsg = `স্বাগতম *${user.first_name}*!\n\nআমি এখন একটি ইমেজ বট। আপনি যা লিখবেন, আমি তা ছবিতে রূপান্তর করে দিব!`;
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

          // --- ৩. টেক্সট টু ইমেজ কনভারশন ---
          else {
            // ক) ইউজারের টেক্সটকে URL এর জন্য এনকোড করা (যাতে স্পেস বা বিশেষ চিহ্নে সমস্যা না হয়)
            const encodedText = encodeURIComponent(text);

            // খ) ইমেজ তৈরির লিংক বানানো
            // 800x600 সাইজ, ffffff (সাদা) ব্যাকগ্রাউন্ড, 000000 (কালো) টেক্সট
            const imageUrl = `https://placehold.co/800x600/ffffff/000000/png?text=${encodedText}&font=roboto`;

            // গ) টেলিগ্রামে ছবি পাঠানো
            // আমরা ক্যাপশন হিসেবে আসল টেক্সটটি দিয়ে দিচ্ছি
            await sendTelegramPhoto(BOT_TOKEN, chatId, imageUrl, `আপনার লেখা: ${text}`);
          }
        }
      } catch (e) {
        // Error ignore
      }
    }
    return new Response("Image Bot Running", { status: 200 });
  },
};

// --- টেলিগ্রাম মেসেজ ফাংশন (টেক্সট এর জন্য) ---
async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown"
    }),
  });
}

// =======================================================
// 📸 নতুন ফাংশন: টেলিগ্রামে ছবি পাঠানোর জন্য
// =======================================================
async function sendTelegramPhoto(token, chatId, photoUrl, caption) {
  const url = `https://api.telegram.org/bot${token}/sendPhoto`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl, // টেলিগ্রাম এই লিংক থেকে ছবি ডাউনলোড করে ইউজারকে দেখাবে
      caption: caption || "" // ছবির নিচে লেখা থাকবে
    }),
  });
}
