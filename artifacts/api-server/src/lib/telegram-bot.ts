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

interface ApiResponse {
  iTotalRecords: string;
  iTotalDisplayRecords: string;
  aaData: unknown[][];
  sEcho: number;
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
    /(?:OTP|otp|code|kode|رمز|کد|verification|verify|confirm|auth|pin|password|passcode)[^0-9]*(\d{4,8})/i,
    /(\d{4,8})[^0-9]*(?:OTP|otp|code|کد|رمز|verification|verify|confirm)/i,
    /(?:is|:|-|=|\s)\s*(\d{6})\b/,
    /(?:is|:|-|=|\s)\s*(\d{4})\b/,
    /\b([0-9]{6})\b/,
    /\b([0-9]{4})\b/,
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
    "رمز", "کد", "تأیید", "code", "passcode", "password", "pin",
    "authentication", "auth", "token", "secret",
  ];
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(timestamp: string): string {
  return timestamp.replace("T", " ").substring(0, 19);
}

function formatOtpMessage(sms: SmsMessage, total: string, otpTotal: number): string {
  const otp = extractOtp(sms.body)!;
  const time = formatTime(sms.timestamp);
  const body = escapeHtml(sms.body);

  return (
    `🔐 <b>OTP RECEIVED</b>\n` +
    `┌─────────────────────────\n` +
    `│ 📱 <b>Phone:</b>  <code>${escapeHtml(sms.phone)}</code>\n` +
    `│ 🕐 <b>Time:</b>   ${escapeHtml(time)}\n` +
    `│ 📡 <b>SIM:</b>    ${escapeHtml(sms.sim)}\n` +
    `│ 📲 <b>Device:</b> ${escapeHtml(sms.device)}\n` +
    `│ 💳 <b>Plan:</b>   ${escapeHtml(sms.plan)}\n` +
    `├─────────────────────────\n` +
    `│ 💬 <b>Message:</b>\n` +
    `│ <i>${body}</i>\n` +
    `├─────────────────────────\n` +
    `│ 🔑 <b>OTP Code:</b>\n` +
    `│ <code>${otp}</code>  ← tap to copy\n` +
    `└─────────────────────────\n` +
    `📊 SMS: <b>${total}</b>  |  🔐 OTPs Today: <b>${otpTotal}</b>`
  );
}

function formatSmsMessage(sms: SmsMessage, total: string): string {
  const time = formatTime(sms.timestamp);
  const body = escapeHtml(sms.body);

  return (
    `📨 <b>NEW SMS</b>\n` +
    `┌─────────────────────────\n` +
    `│ 📱 <b>Phone:</b>  <code>${escapeHtml(sms.phone)}</code>\n` +
    `│ 🕐 <b>Time:</b>   ${escapeHtml(time)}\n` +
    `│ 📡 <b>SIM:</b>    ${escapeHtml(sms.sim)}\n` +
    `│ 📲 <b>Device:</b> ${escapeHtml(sms.device)}\n` +
    `│ 💳 <b>Plan:</b>   ${escapeHtml(sms.plan)}\n` +
    `├─────────────────────────\n` +
    `│ 💬 <b>Message:</b>\n` +
    `│ <i>${body}</i>\n` +
    `└─────────────────────────\n` +
    `📊 Total SMS: <b>${total}</b>`
  );
}

function buildOtpKeyboard(sms: SmsMessage): TelegramBot.InlineKeyboardMarkup {
  const otp = extractOtp(sms.body)!;
  return {
    inline_keyboard: [
      [{ text: `🔑 Copy OTP  ${otp}`, callback_data: `otp:${otp}` }],
      [
        { text: `📱 Copy Number`, callback_data: `num:${sms.phone}` },
        { text: `💬 Copy Message`, callback_data: `msg:${sms.body.substring(0, 200)}` },
      ],
    ],
  };
}

function buildSmsKeyboard(sms: SmsMessage): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: `📱 Copy Number`, callback_data: `num:${sms.phone}` },
        { text: `💬 Copy Message`, callback_data: `msg:${sms.body.substring(0, 200)}` },
      ],
    ],
  };
}

function makeMessageKey(sms: SmsMessage): string {
  return `${sms.timestamp}|${sms.phone}|${sms.body.substring(0, 40)}`;
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
    const chatIdStr = String(query.message!.chat.id);

    if (data.startsWith("otp:")) {
      const otp = data.replace("otp:", "");
      await bot.answerCallbackQuery(query.id, { text: `✅ OTP: ${otp}`, show_alert: true });
      await bot.sendMessage(chatIdStr,
        `🔑 <b>OTP Code</b>\n\n<code>${escapeHtml(otp)}</code>\n\n<i>Tap the code above to copy it</i>`,
        { parse_mode: "HTML" }
      );

    } else if (data.startsWith("num:")) {
      const num = data.replace("num:", "");
      await bot.answerCallbackQuery(query.id, { text: `✅ Number: ${num}`, show_alert: true });
      await bot.sendMessage(chatIdStr,
        `📱 <b>Phone Number</b>\n\n<code>${escapeHtml(num)}</code>\n\n<i>Tap the number above to copy it</i>`,
        { parse_mode: "HTML" }
      );

    } else if (data.startsWith("msg:")) {
      const msg = data.replace("msg:", "");
      await bot.answerCallbackQuery(query.id, { text: "✅ Message shown below", show_alert: false });
      await bot.sendMessage(chatIdStr,
        `💬 <b>Full Message</b>\n\n<code>${escapeHtml(msg)}</code>\n\n<i>Tap the text above to copy it</i>`,
        { parse_mode: "HTML" }
      );

    } else if (data === "refresh_stats") {
      await bot.answerCallbackQuery(query.id, { text: "🔄 Refreshing...", show_alert: false });
      try {
        const res = await fetch(API_URL);
        const d = (await res.json()) as ApiResponse;
        const statsText = buildStatsMessage(d.iTotalRecords, d.iTotalDisplayRecords, otpCount, totalSmsToday);
        const keyboard: TelegramBot.InlineKeyboardMarkup = {
          inline_keyboard: [[{ text: "🔄 Refresh", callback_data: "refresh_stats" }]],
        };
        await bot.editMessageText(statsText, {
          chat_id: chatIdStr,
          message_id: query.message!.message_id,
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
      } catch {
        await bot.answerCallbackQuery(query.id, { text: "❌ Failed to refresh", show_alert: true });
      }
    }
  });

  function buildStatsMessage(total: string, displayed: string, otps: number, sessionSms: number): string {
    return (
      `📊 <b>SMS MONITOR — STATS</b>\n` +
      `┌─────────────────────────\n` +
      `│ 📩 Total SMS:      <b>${total}</b>\n` +
      `│ 📋 Displayed:      <b>${displayed}</b>\n` +
      `│ 🔐 OTPs (session): <b>${otps}</b>\n` +
      `│ 📨 New (session):  <b>${sessionSms}</b>\n` +
      `├─────────────────────────\n` +
      `│ 🟢 Status:   <b>Active</b>\n` +
      `│ ⏱ Refresh:  <b>Every 5 sec</b>\n` +
      `└─────────────────────────`
    );
  }

  // /start command
  bot.onText(/\/start/, async (msg) => {
    const welcome =
      `🤖 <b>SMS Monitor Bot — Active</b>\n\n` +
      `I watch your SMS inbox and forward every new message here in real time.\n\n` +
      `<b>Features:</b>\n` +
      `┌─────────────────────────\n` +
      `│ 🔄 Auto-refresh every 5 seconds\n` +
      `│ 🔐 OTP auto-detection\n` +
      `│ 📋 One-tap copy for OTP &amp; number\n` +
      `│ 📊 Live statistics\n` +
      `└─────────────────────────\n\n` +
      `<b>Commands:</b>\n` +
      `/stats — SMS &amp; OTP statistics\n` +
      `/help — Show all commands\n` +
      `/status — Check monitoring status\n\n` +
      `✅ <i>Bot is running and monitoring your inbox.</i>`;
    await bot.sendMessage(msg.chat.id, welcome, { parse_mode: "HTML" });
  });

  // /help command
  bot.onText(/\/help/, async (msg) => {
    const help =
      `📖 <b>BOT COMMANDS</b>\n` +
      `┌─────────────────────────\n` +
      `│ /start   — Welcome message\n` +
      `│ /stats   — SMS &amp; OTP statistics\n` +
      `│ /status  — Monitoring status\n` +
      `│ /help    — This help message\n` +
      `└─────────────────────────\n\n` +
      `<b>Button Actions:</b>\n` +
      `🔑 <i>Copy OTP</i> — Shows OTP as tappable code\n` +
      `📱 <i>Copy Number</i> — Shows number as tappable code\n` +
      `💬 <i>Copy Message</i> — Shows full message as tappable code\n\n` +
      `<i>In Telegram, tap any</i> <code>code block</code> <i>to copy it instantly.</i>`;
    await bot.sendMessage(msg.chat.id, help, { parse_mode: "HTML" });
  });

  // /stats command
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
      await bot.sendMessage(msg.chat.id, "❌ <b>Failed to fetch stats.</b> Please try again.", { parse_mode: "HTML" });
    }
  });

  // /status command
  bot.onText(/\/status/, async (msg) => {
    const status =
      `🟢 <b>MONITORING STATUS</b>\n` +
      `┌─────────────────────────\n` +
      `│ 🤖 Bot:      <b>Online</b>\n` +
      `│ 📡 API:      <b>Connected</b>\n` +
      `│ ⏱ Interval: <b>5 seconds</b>\n` +
      `│ 🔐 OTPs:     <b>${otpCount} detected</b>\n` +
      `│ 📨 New SMS:  <b>${totalSmsToday} this session</b>\n` +
      `└─────────────────────────`;
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
        const hasOtp = isOtpMessage(sms.body);
        const otp = extractOtp(sms.body);

        if (hasOtp && otp) {
          otpCount++;
          const text = formatOtpMessage(sms, total, otpCount);
          const keyboard = buildOtpKeyboard(sms);
          await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
          logger.info({ phone: sms.phone, otp }, "OTP SMS sent to Telegram");
        } else {
          const text = formatSmsMessage(sms, total);
          const keyboard = buildSmsKeyboard(sms);
          await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
          logger.info({ phone: sms.phone }, "SMS sent to Telegram");
        }
      }
    } catch (err) {
      logger.error({ err }, "Error polling SMS API");
    }
  };

  poll();
  setInterval(poll, POLL_INTERVAL);
}
