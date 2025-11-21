export default {
  async fetch(request, env, ctx) {
    // আপনার দেওয়া টোকেনটি সরাসরি এখানে বসানো হলো
    const BOT_TOKEN = "8205025354:AAFO3-cOtMzEMkXR7kpSK0Rq_JrLmrHdlDk";

    if (request.method === "POST") {
      try {
        const payload = await request.json();
        if (payload.message && payload.message.text) {
          const chatId = payload.message.chat.id;
          const text = payload.message.text;

          // স্টার্ট কমান্ড চেক করা
          if (text === "/start") {
            const responses = ["Hello! 👋", "Hi there! 🤖", "Assalamu Alaikum!"];
            const randomResponse = responses[Math.floor(Math.random() * responses.length)];
            
            // সরাসরি টোকেন ব্যবহার করে মেসেজ পাঠানো
            await sendTelegramMessage(BOT_TOKEN, chatId, randomResponse);
          }
        }
      } catch (e) {
        return new Response("Error parsing JSON", { status: 400 });
      }
    }
    return new Response("Bot is running directly from GitHub code!", { status: 200 });
  },
};

// টেলিগ্রামে মেসেজ পাঠানোর ফাংশন
async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });
}
