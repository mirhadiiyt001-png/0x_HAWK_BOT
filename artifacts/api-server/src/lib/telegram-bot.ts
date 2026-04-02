import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger";

const API_URL = "https://mis-panel-production.up.railway.app/api/bhadi?type=sms";
const POLL_INTERVAL = 5000;

interface SmsMessage {
  timestamp: string;
  sim: string;
  phone: string;
  device: string;
  currency: string;
  plan: string;
  status: number;
  body: string;
}

function parseSmsRow(row: unknown[]): SmsMessage {
  return {
    timestamp: String(row[0] ?? ""),
    sim: String(row[1] ?? ""),
    phone: String(row[2] ?? ""),
    device: String(row[3] ?? ""),
    currency: String(row[4] ?? "").replace(/&euro;/g, "€").replace(/&amp;/g, "&"),
    plan: String(row[5] ?? ""),
    status: Number(row[6] ?? 0),
    body: String(row[7] ?? ""),
  };
}

function extractOtp(text: string): string | null {
  const patterns = [
    /\b(\d{4,8})\b(?=.*(?:OTP|otp|code|kode|رمز|کد|verification|verify|confirm|auth))/i,
    /(?:OTP|code|kode|رمز|کد|verification|verify|confirm|auth)[^0-9]*(\d{4,8})/i,
    /(?:is|:|-|=)\s*(\d{4,8})\b/i,
    /\b([0-9]{6})\b/,
    /\b([0-9]{4})\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function isOtpMessage(text: string): boolean {
  const keywords = [
    "otp", "one-time", "one time", "verification code", "verify", "confirm",
    "رمز", "کد", "تأیید", "code", "passcode", "password", "pin",
    "authentication", "auth", "token",
  ];
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw)) || /\b\d{4,8}\b/.test(text);
}

function formatSmsMessage(sms: SmsMessage, totalRecords: string): string {
  const otp = extractOtp(sms.body);
  const hasOtp = isOtpMessage(sms.body);
  const statusIcon = sms.status === 0 ? "✅" : "⚠️";
  const timeStr = sms.timestamp.replace("T", " ").substring(0, 19);

  if (hasOtp && otp) {
    return (
      `🔐 *OTP MESSAGE RECEIVED*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `📱 *Phone:* \`${sms.phone}\`\n` +
      `🕐 *Time:* ${timeStr}\n` +
      `📡 *SIM:* ${sms.sim}\n` +
      `📲 *Device:* ${sms.device}\n` +
      `💳 *Plan:* ${sms.plan}\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `📩 *Message:*\n${sms.body}\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔑 *OTP Code:* \`${otp}\`\n` +
      `📊 Total SMS: ${totalRecords} ${statusIcon}`
    );
  }

  return (
    `📨 *New SMS Received*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📱 *Phone:* \`${sms.phone}\`\n` +
    `🕐 *Time:* ${timeStr}\n` +
    `📡 *SIM:* ${sms.sim}\n` +
    `📲 *Device:* ${sms.device}\n` +
    `💳 *Plan:* ${sms.plan}\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📩 *Message:*\n${sms.body}\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 Total SMS: ${totalRecords} ${statusIcon}`
  );
}

function buildInlineKeyboard(sms: SmsMessage): TelegramBot.InlineKeyboardMarkup | undefined {
  const otp = extractOtp(sms.body);
  const hasOtp = isOtpMessage(sms.body);

  const buttons: TelegramBot.InlineKeyboardButton[][] = [];

  if (hasOtp && otp) {
    buttons.push([
      { text: `📋 Copy OTP: ${otp}`, callback_data: `copy_otp:${otp}` },
    ]);
  }

  buttons.push([
    { text: `📋 Copy Number`, callback_data: `copy_num:${sms.phone}` },
    { text: `📨 Copy Message`, callback_data: `copy_msg:${sms.body.substring(0, 50)}` },
  ]);

  return { inline_keyboard: buttons };
}

function makeMessageKey(sms: SmsMessage): string {
  return `${sms.timestamp}|${sms.phone}|${sms.body.substring(0, 30)}`;
}

export function startTelegramBot(): void {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];

  if (!token || !chatId) {
    logger.warn("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — bot disabled");
    return;
  }

  const bot = new TelegramBot(token, { polling: true });
  const seenMessages = new Set<string>();
  let isFirstRun = true;

  logger.info("Telegram bot started, polling SMS API...");

  bot.on("callback_query", async (query) => {
    const data = query.data ?? "";
    let replyText = "";

    if (data.startsWith("copy_otp:")) {
      const otp = data.replace("copy_otp:", "");
      replyText = `✅ OTP Copied!\n\`${otp}\`\n\nPaste it wherever needed.`;
    } else if (data.startsWith("copy_num:")) {
      const num = data.replace("copy_num:", "");
      replyText = `✅ Number Copied!\n\`${num}\``;
    } else if (data.startsWith("copy_msg:")) {
      const msg = data.replace("copy_msg:", "");
      replyText = `📨 Message:\n\`${msg}\``;
    }

    if (replyText) {
      await bot.answerCallbackQuery(query.id, { text: "Copied! ✅", show_alert: false });
      await bot.sendMessage(query.message!.chat.id, replyText, { parse_mode: "Markdown" });
    }
  });

  bot.onText(/\/start/, async (msg) => {
    const welcomeMsg =
      `🤖 *SMS Monitor Bot Active!*\n\n` +
      `I'm watching your SMS inbox and will send you every new message automatically.\n\n` +
      `🔄 *Refresh rate:* Every 5 seconds\n` +
      `🔐 *OTP detection:* Automatic\n` +
      `📋 *Copy buttons:* Available on each message\n\n` +
      `Just add me to your group and I'll keep everyone updated! ✅`;
    await bot.sendMessage(msg.chat.id, welcomeMsg, { parse_mode: "Markdown" });
  });

  bot.onText(/\/stats/, async (msg) => {
    try {
      const res = await fetch(API_URL);
      const data = (await res.json()) as {
        iTotalRecords: string;
        iTotalDisplayRecords: string;
        aaData: unknown[][];
        sEcho: number;
      };
      const statsMsg =
        `📊 *SMS Statistics*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `📩 *Total SMS:* ${data.iTotalRecords}\n` +
        `📋 *Displayed:* ${data.iTotalDisplayRecords}\n` +
        `🔄 *Monitoring:* Active ✅\n` +
        `⏱ *Refresh:* Every 5 seconds`;
      await bot.sendMessage(msg.chat.id, statsMsg, { parse_mode: "Markdown" });
    } catch (e) {
      await bot.sendMessage(msg.chat.id, "❌ Failed to fetch stats.");
    }
  });

  const poll = async () => {
    try {
      const res = await fetch(API_URL);
      const data = (await res.json()) as {
        iTotalRecords: string;
        iTotalDisplayRecords: string;
        aaData: unknown[][];
      };

      const rows = data.aaData ?? [];
      const total = data.iTotalRecords ?? "0";

      if (isFirstRun) {
        for (const row of rows) {
          const sms = parseSmsRow(row);
          seenMessages.add(makeMessageKey(sms));
        }
        isFirstRun = false;
        logger.info({ count: rows.length }, "Initialized SMS cache — future new messages will be sent");
        return;
      }

      const newMessages: SmsMessage[] = [];
      for (const row of rows) {
        const sms = parseSmsRow(row);
        const key = makeMessageKey(sms);
        if (!seenMessages.has(key)) {
          seenMessages.add(key);
          newMessages.push(sms);
        }
      }

      for (const sms of newMessages.reverse()) {
        const text = formatSmsMessage(sms, total);
        const keyboard = buildInlineKeyboard(sms);
        await bot.sendMessage(chatId, text, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
        logger.info({ phone: sms.phone, time: sms.timestamp }, "Sent SMS to Telegram");
      }
    } catch (err) {
      logger.error({ err }, "Error polling SMS API");
    }
  };

  poll();
  setInterval(poll, POLL_INTERVAL);
}
