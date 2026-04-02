import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger";

const API_URL = "https://mis-panel-production.up.railway.app/api/bhadi?type=sms";
const POLL_INTERVAL = 5000;
const MAX_CALLBACK_DATA = 60; // Telegram limit is 64 bytes

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

interface ApiResponse {
  iTotalRecords: string;
  iTotalDisplayRecords: string;
  aaData: unknown[][];
  sEcho: number;
}

// In-memory store so full message can be retrieved by short key
const messageStore = new Map<string, SmsMessage>();
let msgStoreCounter = 0;

function storeMessage(sms: SmsMessage): string {
  const id = String(++msgStoreCounter);
  messageStore.set(id, sms);
  return id;
}

function parseSmsRow(row: unknown[]): SmsMessage {
  return {
    timestamp: String(row[0] ?? ""),
    sim:       String(row[1] ?? ""),
    phone:     String(row[2] ?? ""),
    device:    String(row[3] ?? ""),
    currency:  String(row[4] ?? "").replace(/&euro;/g, "€").replace(/&amp;/g, "&"),
    plan:      String(row[5] ?? ""),
    status:    Number(row[6] ?? 0),
    body:      String(row[7] ?? ""),
  };
}

function extractOtp(text: string): string | null {
  const patterns = [
    /(?:OTP|otp|code|رمز|کد|verification|verify|confirm|auth|pin|passcode)[^0-9]*(\d{4,8})/i,
    /(\d{4,8})[^0-9]*(?:OTP|otp|code|کد|رمز|verification|verify|confirm)/i,
    /(?:is|:|-|=)\s*(\d{6})\b/,
    /(?:is|:|-|=)\s*(\d{4})\b/,
    // Numbers preceded/followed by spaces (OTP patterns in non-latin scripts)
    /\s(\d{6})\s/,
    /\s(\d{4})\s/,
    /^(\d{6})\b/,
    /^(\d{4})\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

function isOtpMessage(text: string): boolean {
  const keywords = [
    "otp", "one-time", "one time", "verification code", "verify", "confirm",
    "رمز", "کد", "تأیید", "code", "passcode", "pin",
    "authentication", "auth", "token", "secret",
  ];
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Safely truncate to byte limit for callback_data
function truncateBytes(str: string, maxBytes: number): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(str);
  if (bytes.length <= maxBytes) return str;
  const dec = new TextDecoder();
  return dec.decode(bytes.slice(0, maxBytes));
}

function safeCallbackData(prefix: string, value: string): string {
  const maxValue = MAX_CALLBACK_DATA - prefix.length;
  return prefix + truncateBytes(value, maxValue);
}

function formatTime(ts: string): string {
  return ts.replace("T", " ").substring(0, 19);
}

function formatOtpMessage(sms: SmsMessage, total: string, otpTotal: number): string {
  const otp = extractOtp(sms.body)!;
  return (
    `⚡️ <b>OTP INTERCEPTED</b> ⚡️\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📱  <b>Phone</b>   <code>${escapeHtml(sms.phone)}</code>\n` +
    `🕐  <b>Time</b>    ${escapeHtml(formatTime(sms.timestamp))}\n` +
    `📡  <b>SIM</b>     ${escapeHtml(sms.sim)}\n` +
    `📲  <b>Device</b>  ${escapeHtml(sms.device)}\n` +
    `💳  <b>Plan</b>    ${escapeHtml(sms.plan)}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💬  <b>Message</b>\n` +
    `<i>${escapeHtml(sms.body)}</i>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔑  <b>OTP CODE  →  </b><code>${escapeHtml(otp)}</code>\n` +
    `        <i>⬆️ Tap code to copy instantly</i>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 SMS: <b>${escapeHtml(total)}</b>   🔐 OTPs: <b>${otpTotal}</b>`
  );
}

function formatSmsMessage(sms: SmsMessage, total: string): string {
  return (
    `📨 <b>NEW MESSAGE</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📱  <b>Phone</b>   <code>${escapeHtml(sms.phone)}</code>\n` +
    `🕐  <b>Time</b>    ${escapeHtml(formatTime(sms.timestamp))}\n` +
    `📡  <b>SIM</b>     ${escapeHtml(sms.sim)}\n` +
    `📲  <b>Device</b>  ${escapeHtml(sms.device)}\n` +
    `💳  <b>Plan</b>    ${escapeHtml(sms.plan)}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💬  <b>Message</b>\n` +
    `<i>${escapeHtml(sms.body)}</i>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 Total SMS: <b>${escapeHtml(total)}</b>`
  );
}

function buildOtpKeyboard(sms: SmsMessage, storeId: string): TelegramBot.InlineKeyboardMarkup {
  const otp = extractOtp(sms.body)!;
  return {
    inline_keyboard: [
      [{ text: `🔑 Copy OTP: ${otp}`, callback_data: safeCallbackData("otp:", otp) }],
      [
        { text: `📱 Copy Number`, callback_data: safeCallbackData("num:", sms.phone) },
        { text: `💬 Copy Message`, callback_data: `msg:${storeId}` },
      ],
    ],
  };
}

function buildSmsKeyboard(sms: SmsMessage, storeId: string): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: `📱 Copy Number`, callback_data: safeCallbackData("num:", sms.phone) },
        { text: `💬 Copy Message`, callback_data: `msg:${storeId}` },
      ],
    ],
  };
}

function makeMessageKey(sms: SmsMessage): string {
  return `${sms.timestamp}|${sms.phone}|${sms.body.substring(0, 40)}`;
}

function buildStatsMessage(total: string, displayed: string, otps: number, sessionSms: number): string {
  return (
    `📊  <b>LIVE STATISTICS</b>\n` +
    `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
    `📩  Total SMS       →  <b>${escapeHtml(total)}</b>\n` +
    `📋  Displayed       →  <b>${escapeHtml(displayed)}</b>\n` +
    `🔐  OTPs detected   →  <b>${otps}</b>\n` +
    `📨  New this session →  <b>${sessionSms}</b>\n` +
    `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
    `🟢  Status   <b>ACTIVE</b>\n` +
    `⏱   Refresh  <b>Every 5 seconds</b>\n` +
    `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`
  );
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
  let otpCount = 0;
  let totalSmsToday = 0;

  logger.info("Telegram bot started, polling SMS API...");

  // Handle inline button presses
  bot.on("callback_query", async (query) => {
    const data = query.data ?? "";
    const cid = String(query.message!.chat.id);

    try {
      if (data.startsWith("otp:")) {
        const otp = data.replace("otp:", "");
        await bot.answerCallbackQuery(query.id, { text: `✅ OTP: ${otp}`, show_alert: true });
        await bot.sendMessage(cid,
          `🔑  <b>OTP CODE</b>\n` +
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
          `<code>${escapeHtml(otp)}</code>\n` +
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
          `⬆️  <i>Tap the code above to copy it</i>`,
          { parse_mode: "HTML" }
        );

      } else if (data.startsWith("num:")) {
        const num = data.replace("num:", "");
        await bot.answerCallbackQuery(query.id, { text: `✅ Number: ${num}`, show_alert: true });
        await bot.sendMessage(cid,
          `📱  <b>PHONE NUMBER</b>\n` +
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
          `<code>${escapeHtml(num)}</code>\n` +
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
          `⬆️  <i>Tap the number above to copy it</i>`,
          { parse_mode: "HTML" }
        );

      } else if (data.startsWith("msg:")) {
        const storeId = data.replace("msg:", "");
        const sms = messageStore.get(storeId);
        await bot.answerCallbackQuery(query.id, { text: "✅ Message shown below", show_alert: false });
        if (sms) {
          await bot.sendMessage(cid,
            `💬  <b>FULL MESSAGE</b>\n` +
            `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
            `<code>${escapeHtml(sms.body)}</code>\n` +
            `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
            `⬆️  <i>Tap the text above to copy it</i>`,
            { parse_mode: "HTML" }
          );
        }

      } else if (data === "refresh_stats") {
        await bot.answerCallbackQuery(query.id, { text: "🔄 Refreshing...", show_alert: false });
        const res = await fetch(API_URL);
        const d = (await res.json()) as ApiResponse;
        const statsText = buildStatsMessage(d.iTotalRecords, d.iTotalDisplayRecords, otpCount, totalSmsToday);
        const keyboard: TelegramBot.InlineKeyboardMarkup = {
          inline_keyboard: [[{ text: "🔄 Refresh", callback_data: "refresh_stats" }]],
        };
        await bot.editMessageText(statsText, {
          chat_id: cid,
          message_id: query.message!.message_id,
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
      }
    } catch (err) {
      logger.error({ err }, "Callback query error");
    }
  });

  // /start
  bot.onText(/\/start/, async (msg) => {
    const welcome =
      `\n` +
      `🛰  <b>SMS MONITOR BOT</b>  🛰\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `🟢  <b>STATUS  —  ONLINE &amp; ACTIVE</b>\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
      `✦  <b>FEATURES</b>\n` +
      `  🔄  Auto-refresh every <b>5 seconds</b>\n` +
      `  🔐  OTP auto-detection &amp; highlight\n` +
      `  📋  One-tap copy  (OTP / Number / Message)\n` +
      `  📊  Live SMS &amp; OTP statistics\n` +
      `  🌐  Multi-language SMS support\n\n` +
      `✦  <b>COMMANDS</b>\n` +
      `  /stats   →  Live stats &amp; OTP count\n` +
      `  /status  →  Health check\n` +
      `  /help    →  All commands\n\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `✅  <i>Monitoring your inbox 24/7. Every new SMS will appear here automatically.</i>`;
    await bot.sendMessage(msg.chat.id, welcome, { parse_mode: "HTML" });
  });

  // /help
  bot.onText(/\/help/, async (msg) => {
    const help =
      `📖  <b>COMMANDS &amp; GUIDE</b>\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `✦  <b>BOT COMMANDS</b>\n` +
      `  /start   →  Welcome screen\n` +
      `  /stats   →  SMS &amp; OTP stats\n` +
      `  /status  →  Monitoring health\n` +
      `  /help    →  This guide\n\n` +
      `✦  <b>BUTTON ACTIONS</b>\n` +
      `  🔑  <i>Copy OTP</i>      →  shows OTP as tappable code\n` +
      `  📱  <i>Copy Number</i>   →  shows number as tappable code\n` +
      `  💬  <i>Copy Message</i>  →  shows full message as tappable code\n\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `💡  <i>In Telegram, tap any</i> <code>highlighted code</code> <i>to copy instantly — no long-press needed.</i>`;
    await bot.sendMessage(msg.chat.id, help, { parse_mode: "HTML" });
  });

  // /stats
  bot.onText(/\/stats/, async (msg) => {
    try {
      const res = await fetch(API_URL);
      const data = (await res.json()) as ApiResponse;
      const text = buildStatsMessage(data.iTotalRecords, data.iTotalDisplayRecords, otpCount, totalSmsToday);
      const keyboard: TelegramBot.InlineKeyboardMarkup = {
        inline_keyboard: [[{ text: "🔄 Refresh", callback_data: "refresh_stats" }]],
      };
      await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML", reply_markup: keyboard });
    } catch {
      await bot.sendMessage(msg.chat.id, "❌ <b>Failed to fetch stats.</b> Try again.", { parse_mode: "HTML" });
    }
  });

  // /status
  bot.onText(/\/status/, async (msg) => {
    const status =
      `🛰  <b>SYSTEM HEALTH CHECK</b>\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `🤖  Bot         🟢  <b>Online</b>\n` +
      `📡  SMS API     🟢  <b>Connected</b>\n` +
      `⏱   Poll rate   🟢  <b>Every 5 sec</b>\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `🔐  OTPs detected   →  <b>${otpCount}</b>\n` +
      `📨  SMS this session →  <b>${totalSmsToday}</b>\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `✅  <i>All systems operational</i>`;
    await bot.sendMessage(msg.chat.id, status, { parse_mode: "HTML" });
  });

  // Polling loop
  const poll = async () => {
    try {
      const res = await fetch(API_URL);
      const data = (await res.json()) as ApiResponse;

      const rows = data.aaData ?? [];
      const total = data.iTotalRecords ?? "0";

      if (isFirstRun) {
        for (const row of rows) {
          seenMessages.add(makeMessageKey(parseSmsRow(row)));
        }
        isFirstRun = false;
        logger.info({ count: rows.length }, "SMS cache initialized — monitoring for new messages");
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
        totalSmsToday++;
        const storeId = storeMessage(sms);
        const hasOtp = isOtpMessage(sms.body);
        const otp = extractOtp(sms.body);

        try {
          if (hasOtp && otp) {
            otpCount++;
            const text = formatOtpMessage(sms, total, otpCount);
            const keyboard = buildOtpKeyboard(sms, storeId);
            await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
            logger.info({ phone: sms.phone, otp }, "OTP SMS sent to Telegram");
          } else {
            const text = formatSmsMessage(sms, total);
            const keyboard = buildSmsKeyboard(sms, storeId);
            await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
            logger.info({ phone: sms.phone }, "SMS sent to Telegram");
          }
        } catch (sendErr) {
          // Fallback: try sending without keyboard if keyboard fails
          logger.error({ sendErr }, "Failed to send with keyboard, retrying without");
          try {
            const text = hasOtp && otp ? formatOtpMessage(sms, total, otpCount) : formatSmsMessage(sms, total);
            await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
          } catch (fallbackErr) {
            logger.error({ fallbackErr }, "Fallback send also failed");
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Error polling SMS API");
    }
  };

  poll();
  setInterval(poll, POLL_INTERVAL);
}
