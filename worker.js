export default {
  async fetch(request, env, ctx) {
    const BOT_TOKEN = env.BOT_TOKEN; 

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
            
            const welcomeMsg = `স্বাগতম *${user.first_name}*!\n\nআপনি যত  6 বড় লেখাই দেন না কেন, আমি এখন সেটা সুন্দর করে সাজিয়ে ছবি বানিয়ে দিব!`;
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

          // --- ৩. টেক্সট টু ইমেজ (Wrapping সহ) ---
          else {
            // ক) টেক্সটকে ভেঙে ছোট ছোট লাইনে ভাগ করা (প্রতি লাইনে ৩৫টি অক্ষর)
            // যাতে লেখা ইমেজের বাইরে না যায়
            const formattedText = wrapText(text, 35);

            // খ) ইমেজ তৈরি করা (উচ্চতা একটু বাড়িয়ে দিলাম যাতে বেশি লেখা ধরে - 800x800)
            const imageUrl = `https://placehold.co/800x800/ffffff/000000/png?text=${formattedText}&font=roboto`;

            // গ) টেলিগ্রামে পাঠানো
            await sendTelegramPhoto(BOT_TOKEN, chatId, imageUrl, `আপনার লেখা:\n${text}`);
          }
        }
      } catch (e) {
        // Error ignore
      }
    }
    return new Response("Smart Image Bot Running", { status: 200 });
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
      parse_mode: "Markdown"
    }),
  });
}

// --- টেলিগ্রাম ফটো ফাংশন ---
async function sendTelegramPhoto(token, chatId, photoUrl, caption) {
  const url = `https://api.telegram.org/bot${token}/sendPhoto`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption: caption || ""
    }),
  });
}

// =======================================================
// 🛠️ টেক্সট র‍্যাপিং ফাংশন (Text Wrapper)
// =======================================================
// এটি লম্বা লাইনকে ভেঙে নিচে নিচে (New Line) সাজিয়ে দেয়
function wrapText(text, maxCharsPerLine) {
  const words = text.split(' '); // শব্দগুলো আলাদা করা
  let currentLine = "";
  let finalString = "";

  for (let word of words) {
    // যদি বর্তমান লাইনের সাথে নতুন শব্দ যোগ করলে লিমিট পার হয়ে যায়
    if ((currentLine + word).length > maxCharsPerLine) {
      // তাহলে বর্তমান লাইনটি শেষ করো এবং নতুন লাইনে যাও
      finalString += encodeURIComponent(currentLine.trim()) + "%0A"; // %0A মানে URL এর New Line
      currentLine = ""; // লাইন খালি করা
    }
    // লাইনে শব্দ যোগ করা
    currentLine += word + " ";
  }
  // শেষ লাইনটি যোগ করা
  finalString += encodeURIComponent(currentLine.trim());
  
  return finalString;
}
