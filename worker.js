export default {
  async fetch(request, env, ctx) {
    const BOT_TOKEN = "8205025354:AAHcabaH_MPU8RpOb8xicmL-12Ws0ujaMBo";

    if (request.method === "POST") {
      try {
        const payload = await request.json();
        if (payload.message && payload.message.text) {
          const chatId = payload.message.chat.id;
          const text = payload.message.text;
          const user = payload.message.from;

          // ১. ইউজার /start দিলে ডাটাবেসে সেভ হবে
          if (text === "/start") {
            // ডাটাবেসে তথ্য সেভ করা (INSERT)
            await env.DB.prepare(
              "INSERT OR IGNORE INTO users (chat_id, username, first_name, balance) VALUES (?, ?, ?, ?)"
            ).bind(chatId, user.username, user.first_name, 50).run();

            await sendTelegramMessage(BOT_TOKEN, chatId, `স্বাগতম ${user.first_name}! আপনার একাউন্ট তৈরি হয়েছে এবং ৫০ টাকা বোনাস দেওয়া হয়েছে।`);
          }

          // ২. ইউজার /me দিলে ডাটাবেস থেকে তথ্য দেখাবে
          else if (text === "/me") {
            // ডাটাবেস থেকে তথ্য আনা (SELECT)
            const userData = await env.DB.prepare(
              "SELECT * FROM users WHERE chat_id = ?"
            ).bind(chatId).first();

            if (userData) {
              const msg = `👤 **আপনার প্রোফাইল**\n\n` +
                          `Name: ${userData.first_name}\n` +
                          `💰 Balance: ${userData.balance} Taka\n` +
                          `📅 Joined: ${userData.joined_at}`;
              await sendTelegramMessage(BOT_TOKEN, chatId, msg);
            } else {
              await sendTelegramMessage(BOT_TOKEN, chatId, "আপনার একাউন্ট পাওয়া যায়নি। দয়া করে /start দিন।");
            }
          }
          
          else {
            await sendTelegramMessage(BOT_TOKEN, chatId, "আমি শুধু /start এবং /me কমান্ড বুঝি।");
          }
        }
      } catch (e) {
        // Error ignore
      }
    }
    return new Response("Database Bot Running", { status: 200 });
  },
};

async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text }),
  });
}
