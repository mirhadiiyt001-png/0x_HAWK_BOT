import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger";
import { fetchSmsCached as fetchSms, fetchNumbersCached as fetchNumbers } from "./upstream";
const POLL_INTERVAL   = 5000;
const NUMS_POLL_INTERVAL = 15_000;
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

// ─── Custom Emoji Store ───────────────────────────────────────────────────────
// Maps standard Unicode emoji → Telegram custom_emoji_id from sticker packs
const customEmojiMap = new Map<string, string>();

const EMOJI_PACKS = [
  "Taj_Mehyar",
  "GiftsGiftsGifts",
  "Icon_2023",
  "GameEmoji",
  "TONEmoji",
  "NewsEmoji",
  "RestrictedEmoji",
  "Ntgbbvddf_by_fStikBot",
];

type StickerObj = { emoji: string; custom_emoji_id?: string; type: string };

async function loadCustomEmojiPacks(token: string): Promise<void> {
  let loaded = 0;
  for (const name of EMOJI_PACKS) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getStickerSet?name=${name}`);
      const d = await r.json() as { ok: boolean; result?: { stickers: StickerObj[] } };
      if (d.ok && d.result?.stickers) {
        for (const s of d.result.stickers) {
          if (s.type === "custom_emoji" && s.custom_emoji_id && s.emoji) {
            // First pack that has a given emoji wins
            if (!customEmojiMap.has(s.emoji)) {
              customEmojiMap.set(s.emoji, s.custom_emoji_id);
              loaded++;
            }
          }
        }
      }
    } catch { /* ignore per-pack errors */ }
  }
  logger.info({ packs: EMOJI_PACKS.length, uniqueEmojis: customEmojiMap.size }, "Custom emoji packs loaded");
}

// Wrap emoji in <tg-emoji> if a custom version is available, otherwise return plain emoji
// Tries exact match, then with/without variation selector U+FE0F to handle encoding mismatches
function ce(emoji: string): string {
  const VS16 = "\uFE0F";
  let id = customEmojiMap.get(emoji)
    ?? customEmojiMap.get(emoji.replace(/\uFE0F/g, ""))      // strip VS16
    ?? customEmojiMap.get(emoji.endsWith(VS16) ? emoji : emoji + VS16); // add VS16
  return id ? `<tg-emoji emoji-id="${id}">${emoji}</tg-emoji>` : emoji;
}

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
    `${ce("🚨")} <b>OTP INTERCEPTED</b> ${ce("🚨")}\n` +
    `——————————————————————\n\n` +
    `╭─ ${ce("✨")} <b>DETAILS</b>\n` +
    `├ ${ce("📲")} <b>Phone:</b>   <code>${escapeHtml(sms.phone)}</code>\n` +
    `├ ${ce("🔔")} <b>Time:</b>    ${escapeHtml(formatTime(sms.timestamp))}\n` +
    `├ ${ce("🃏")} <b>SIM:</b>     ${escapeHtml(sms.sim)}\n` +
    `├ ${ce("💻")} <b>Device:</b>  ${escapeHtml(sms.device)}\n` +
    `╰ ${ce("💵")} <b>Plan:</b>    ${escapeHtml(sms.plan)}\n\n` +
    `╭─ ${ce("💬")} <b>MESSAGE</b>\n` +
    `╰ <i>${escapeHtml(sms.body)}</i>\n\n` +
    `╭─ ${ce("🔓")} <b>OTP CODE</b>\n` +
    `╰ <code>${escapeHtml(otp)}</code>\n\n` +
    `${ce("⬆️")} <i>Tap the code to copy</i>`
  );
}

function formatSmsMessage(sms: SmsMessage): string {
  return (
    `${ce("💌")} <b>NEW SMS</b> ${ce("💌")}\n` +
    `——————————————————————\n\n` +
    `╭─ ${ce("✨")} <b>DETAILS</b>\n` +
    `├ ${ce("📲")} <b>Phone:</b>   <code>${escapeHtml(sms.phone)}</code>\n` +
    `├ ${ce("🔔")} <b>Time:</b>    ${escapeHtml(formatTime(sms.timestamp))}\n` +
    `├ ${ce("🃏")} <b>SIM:</b>     ${escapeHtml(sms.sim)}\n` +
    `├ ${ce("💻")} <b>Device:</b>  ${escapeHtml(sms.device)}\n` +
    `╰ ${ce("💵")} <b>Plan:</b>    ${escapeHtml(sms.plan)}\n\n` +
    `╭─ ${ce("💬")} <b>MESSAGE</b>\n` +
    `╰ <i>${escapeHtml(sms.body)}</i>`
  );
}

function buildOtpKeyboard(sms: SmsMessage, storeId: string): TelegramBot.InlineKeyboardMarkup {
  const otp = extractOtp(sms.body)!;
  return {
    inline_keyboard: [
      [
        { text: `🔓 Copy OTP Code`, callback_data: safeCallbackData("otp:", otp) },
        { text: `📲 Copy Number`, callback_data: safeCallbackData("num:", sms.phone) },
      ],
      [
        { text: `💬 Copy Full Message`, callback_data: `msg:${storeId}` },
      ],
    ],
  };
}

function buildSmsKeyboard(sms: SmsMessage, storeId: string): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: `📲 Copy Number`, callback_data: safeCallbackData("num:", sms.phone) },
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
    `${ce("🏆")} <b>LIVE STATISTICS</b> ${ce("🏆")}\n` +
    `——————————————————————\n\n` +
    `╭─ ${ce("⚡️")} <b>DATA</b>\n` +
    `├ ${ce("💌")} Total SMS        →  <b>${escapeHtml(total)}</b>\n` +
    `├ ${ce("📊")} Displayed        →  <b>${escapeHtml(displayed)}</b>\n` +
    `├ ${ce("🎁")} OTPs detected    →  <b>${otps}</b>\n` +
    `╰ ${ce("✨")} New this session →  <b>${sessionSms}</b>\n\n` +
    `╭─ ${ce("💎")} <b>SYSTEM</b>\n` +
    `├ ${ce("🟢")} Status   →  <b>ACTIVE</b>\n` +
    `╰ ${ce("🔄")} Refresh  →  <b>Every 5 seconds</b>\n` +
    `——————————————————————`
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

  // Load custom emoji packs in background (non-blocking — plain emoji used until ready)
  loadCustomEmojiPacks(token).catch((e) => logger.warn({ e }, "Emoji pack load failed"));

  // Register commands so Telegram shows them when user types /
  bot.setMyCommands([
    { command: "start",   description: "Welcome & activate access" },
    { command: "stats",   description: "Live SMS & OTP statistics" },
    { command: "status",  description: "System health check" },
    { command: "help",    description: "Command reference & guide" },
    { command: "users",   description: "Manage users (owner only)" },
    { command: "testmsg", description: "Preview OTP & SMS message format (owner)" },
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
      `${ce("🔔")} <b>ACCESS REQUEST</b> ${ce("🔔")}\n` +
      `——————————————————————\n\n` +
      `╭─ ${ce("👤")} <b>USER INFO</b>\n` +
      `├ ${ce("💫")} <b>Name</b>      ${escapeHtml(name)}\n` +
      `├ ${ce("✨")} <b>Username</b>  ${escapeHtml(username)}\n` +
      `╰ ${ce("🔢")} <b>User ID</b>   <code>${userId}</code>\n\n` +
      `<i>This user wants access to Zone SMS Bot.</i>\n` +
      `<i>Approve or decline below.</i>`;

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

          await bot.editMessageText(
            `${ce("🟢")} <b>ACCESS APPROVED</b> ${ce("🟢")}\n` +
            `——————————————————————\n\n` +
            `╭─ ${ce("👤")} <b>${escapeHtml(name)}</b>\n` +
            `├ ${ce("🔢")} ID: <code>${targetId}</code>\n` +
            `╰ ${ce("✅")} Status: <b>Approved</b>`,
            { chat_id: cid, message_id: query.message!.message_id, parse_mode: "HTML" }
          );

          await bot.sendMessage(targetId,
            `${ce("🎉")} <b>ACCESS GRANTED</b> ${ce("🎉")}\n` +
            `——————————————————————\n\n` +
            `${ce("✅")} The owner has approved your request.\n` +
            `${ce("💎")} You now have full access to Zone SMS Bot.\n\n` +
            `Use /start to begin.`,
            { parse_mode: "HTML" }
          );

        } else {
          pendingUsers.delete(targetId);

          await bot.answerCallbackQuery(query.id, { text: `❌ ${name} declined`, show_alert: false });

          await bot.editMessageText(
            `${ce("🔴")} <b>ACCESS DECLINED</b> ${ce("🔴")}\n` +
            `——————————————————————\n\n` +
            `╭─ ${ce("👤")} <b>${escapeHtml(name)}</b>\n` +
            `├ ${ce("🔢")} ID: <code>${targetId}</code>\n` +
            `╰ ${ce("❌")} Status: <b>Declined</b>`,
            { chat_id: cid, message_id: query.message!.message_id, parse_mode: "HTML" }
          );

          await bot.sendMessage(targetId,
            `${ce("🚫")} <b>ACCESS DENIED</b> ${ce("🚫")}\n` +
            `——————————————————————\n\n` +
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
        await bot.answerCallbackQuery(query.id, { text: "🔓 OTP copied — tap to use!", show_alert: false });
        await bot.sendMessage(actorId,
          `${ce("🔓")} <b>OTP CODE</b> ${ce("🔓")}\n` +
          `——————————————————————\n\n` +
          `<code>${escapeHtml(otp)}</code>\n\n` +
          `${ce("⬆️")} <i>Tap the code above to copy instantly</i>`,
          { parse_mode: "HTML" }
        );

      } else if (data.startsWith("num:")) {
        const num = data.replace("num:", "");
        await bot.answerCallbackQuery(query.id, { text: "📲 Number copied!", show_alert: false });
        await bot.sendMessage(actorId,
          `${ce("📲")} <b>PHONE NUMBER</b> ${ce("📲")}\n` +
          `——————————————————————\n\n` +
          `<code>${escapeHtml(num)}</code>\n\n` +
          `${ce("⬆️")} <i>Tap the number above to copy instantly</i>`,
          { parse_mode: "HTML" }
        );

      } else if (data.startsWith("msg:")) {
        const storeId = data.replace("msg:", "");
        const sms = messageStore.get(storeId);
        if (sms) {
          await bot.answerCallbackQuery(query.id, { text: "💬 Message copied!", show_alert: false });
          await bot.sendMessage(actorId,
            `${ce("💬")} <b>FULL MESSAGE</b> ${ce("💬")}\n` +
            `——————————————————————\n\n` +
            `<code>${escapeHtml(sms.body)}</code>\n\n` +
            `${ce("⬆️")} <i>Tap the text above to copy instantly</i>`,
            { parse_mode: "HTML" }
          );
        } else {
          await bot.answerCallbackQuery(query.id, { text: "⚠️ Message expired from cache", show_alert: true });
        }

      } else if (data === "refresh_stats") {
        await bot.answerCallbackQuery(query.id, { text: "⚡️ Refreshing...", show_alert: false });
        const d = (await fetchSms()) as unknown as ApiResponse;
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
        `${ce("🔒")} <b>ACCESS REQUIRED</b> ${ce("🔒")}\n` +
        `——————————————————————\n\n` +
        `${ce("🔔")} Your request has been sent to the owner.\n` +
        `${ce("⏳")} Please wait for approval.\n\n` +
        `<i>You'll be notified here once the owner responds.</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const welcome =
      `${ce("🚀")} <b>ZONE SMS MONITOR</b> ${ce("🚀")}\n` +
      `——————————————————————\n\n` +
      `${ce("🟢")} <b>ONLINE</b>  •  ${ce("💎")} <b>PREMIUM ACTIVE</b>\n\n` +
      `╭─ ${ce("🌟")} <b>FEATURES</b>\n` +
      `├ ${ce("🎁")} Auto OTP detection\n` +
      `├ ${ce("🔥")} Live SMS monitoring\n` +
      `├ ${ce("🔓")} One-tap copy codes\n` +
      `├ ${ce("🏆")} Real-time statistics\n` +
      `╰ ${ce("🌐")} Multi-country support\n\n` +
      `╭─ ${ce("⚡️")} <b>COMMANDS</b>\n` +
      `├ /stats  —  Live statistics\n` +
      `├ /status —  System health\n` +
      `╰ /help   —  Command guide\n\n` +
      `${ce("✨")} <i>Every new SMS arrives here instantly</i>`;
    await bot.sendMessage(userId, welcome, { parse_mode: "HTML" });
  });

  // ── /help ──
  bot.onText(/\/help/, async (msg) => {
    if (!isAllowed(msg.from!.id)) return;
    const help =
      `${ce("💎")} <b>HELP & GUIDE</b> ${ce("💎")}\n` +
      `——————————————————————\n\n` +
      `╭─ ${ce("⚡️")} <b>COMMANDS</b>\n` +
      `├ /start   →  Welcome screen\n` +
      `├ /stats   →  Live statistics\n` +
      `├ /status  →  System health\n` +
      `╰ /help    →  This guide\n\n` +
      `╭─ ${ce("✨")} <b>BUTTON ACTIONS</b>\n` +
      `├ ${ce("🔓")}  Copy OTP      →  tappable OTP code\n` +
      `├ ${ce("📲")}  Copy Number   →  tappable phone number\n` +
      `╰ ${ce("💬")}  Copy Message  →  full message\n\n` +
      `——————————————————————\n` +
      `${ce("💡")} <i>Tap any</i> <code>highlighted code</code> <i>to copy instantly</i>`;
    await bot.sendMessage(msg.chat.id, help, { parse_mode: "HTML" });
  });

  // ── /stats ──
  bot.onText(/\/stats/, async (msg) => {
    if (!isAllowed(msg.from!.id)) return;
    try {
      const data = (await fetchSms()) as unknown as ApiResponse;
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
      `${ce("🛡")} <b>SYSTEM HEALTH</b> ${ce("🛡")}\n` +
      `——————————————————————\n\n` +
      `╭─ ${ce("🔥")} <b>SERVICES</b>\n` +
      `├ ${ce("🤖")} Bot         ${ce("🟢")}  <b>Online</b>\n` +
      `├ ${ce("🌐")} SMS API     ${ce("🟢")}  <b>Connected</b>\n` +
      `╰ ${ce("⚡️")} Poll rate   ${ce("🟢")}  <b>Every 5 sec</b>\n\n` +
      `╭─ ${ce("📊")} <b>SESSION</b>\n` +
      `├ ${ce("🎁")} OTPs detected    →  <b>${otpCount}</b>\n` +
      `├ ${ce("💌")} SMS this session →  <b>${totalSmsToday}</b>\n` +
      `├ ${ce("👥")} Approved users   →  <b>${approvedUsers.size}</b>\n` +
      `╰ ${ce("⏳")} Pending requests →  <b>${pendingUsers.size}</b>\n` +
      `——————————————————————\n` +
      `${ce("✅")} <i>All systems operational</i>`;
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
      `${ce("👥")} <b>USER MANAGEMENT</b> ${ce("👥")}\n` +
      `——————————————————————\n\n` +
      `╭─ ${ce("✅")} <b>Approved</b>\n` +
      `╰ ${escapeHtml(approvedList)}\n\n` +
      `╭─ ${ce("⏳")} <b>Pending</b>\n` +
      `╰ ${escapeHtml(pendingList)}\n` +
      `——————————————————————`,
      { parse_mode: "HTML" }
    );
  });

  // ── Owner-only: /testmsg — preview OTP & SMS message formats instantly ──
  bot.onText(/\/testmsg/, async (msg) => {
    if (msg.from!.id !== ownerId) return;

    const fakeSms: SmsMessage = {
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 19),
      sim: "SIM 1 (PK)",
      phone: "+92 300 1234567",
      device: "Replit TestDevice",
      currency: "PKR",
      plan: "Zong Premium",
      status: 1,
      body: "Your OTP code is 847291. Do not share with anyone.",
    };

    const otpStoreId = storeMessage(fakeSms);
    const otpText   = formatOtpMessage(fakeSms);
    const otpKb     = buildOtpKeyboard(fakeSms, otpStoreId);
    await bot.sendMessage(msg.chat.id, otpText, { parse_mode: "HTML", reply_markup: otpKb });

    const fakeSms2: SmsMessage = { ...fakeSms, status: 0, body: "Your account statement for March 2026 is ready. Visit portal.bank.com to view." };
    const smsStoreId = storeMessage(fakeSms2);
    const smsText    = formatSmsMessage(fakeSms2);
    const smsKb      = buildSmsKeyboard(fakeSms2, smsStoreId);
    await bot.sendMessage(msg.chat.id, smsText, { parse_mode: "HTML", reply_markup: smsKb });
  });

  // ── Polling loop ──
  const poll = async () => {
    try {
      const data = (await fetchSms()) as unknown as ApiResponse;
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

  // ── Numbers polling — detects new phones & ranges ──────────────────────────
  const seenNumPhones = new Set<string>();
  const seenRanges    = new Set<string>();
  let isFirstNumRun   = true;

  const pollNumbers = async () => {
    try {
      const data = (await fetchNumbers()) as unknown as ApiResponse;
      const rows = data.data?.aaData ?? [];

      if (isFirstNumRun) {
        for (const row of rows) {
          if (!Array.isArray(row) || row.length < 2) continue;
          const phone = String(row[1]); const range = String(row[0]);
          if (phone && phone !== "0") seenNumPhones.add(phone);
          if (range && range !== "0") seenRanges.add(range);
        }
        isFirstNumRun = false;
        logger.info({ phones: seenNumPhones.size, ranges: seenRanges.size }, "Numbers cache initialized");
        return;
      }

      const forwardEnabled =
        process.env.NODE_ENV === "production" ||
        process.env.FORWARD_SMS === "true";

      const newRangeMap = new Map<string, string[]>();
      const newPhonesByRange = new Map<string, string[]>();

      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 2) continue;
        const range = String(row[0]); const phone = String(row[1]);
        if (!phone || phone === "0") continue;

        const isNewPhone = !seenNumPhones.has(phone);
        const isNewRange = range && range !== "0" && !seenRanges.has(range);

        if (isNewRange) {
          seenRanges.add(range);
          if (!newRangeMap.has(range)) newRangeMap.set(range, []);
        }
        if (isNewPhone) {
          seenNumPhones.add(phone);
          if (isNewRange) {
            newRangeMap.get(range)!.push(phone);
          } else {
            if (!newPhonesByRange.has(range)) newPhonesByRange.set(range, []);
            newPhonesByRange.get(range)!.push(phone);
          }
        }
      }

      if (!forwardEnabled) {
        if (newRangeMap.size > 0 || newPhonesByRange.size > 0)
          logger.info({ newRanges: newRangeMap.size, newPhoneGroups: newPhonesByRange.size }, "Dev: new numbers detected (not forwarded)");
        return;
      }

      // Notify: new ranges
      for (const [range, phones] of newRangeMap) {
        const preview = phones.slice(0, 8);
        const extra = phones.length - preview.length;
        const lines = preview.map((p, i) =>
          `${i === preview.length - 1 && extra === 0 ? "╰" : "├"} <code>${escapeHtml(p)}</code>`
        ).join("\n");
        const text =
          `${ce("📡")} <b>NEW RANGE ADDED</b> ${ce("📡")}\n` +
          `——————————————————————\n\n` +
          `╭─ ${ce("✨")} <b>DETAILS</b>\n` +
          `├ ${ce("🃏")} <b>Range:</b>   ${escapeHtml(range)}\n` +
          `╰ ${ce("💌")} <b>Numbers:</b> <b>${phones.length}</b> added\n\n` +
          (phones.length > 0
            ? `╭─ ${ce("📲")} <b>NUMBERS</b>\n${lines}` +
              (extra > 0 ? `\n╰ <i>+${extra} more...</i>` : "")
            : "");
        await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
        logger.info({ range, count: phones.length }, "New range notification sent");
      }

      // Notify: new phones in existing ranges
      for (const [range, phones] of newPhonesByRange) {
        const preview = phones.slice(0, 8);
        const extra = phones.length - preview.length;
        const lines = preview.map((p, i) =>
          `${i === preview.length - 1 && extra === 0 ? "╰" : "├"} <code>${escapeHtml(p)}</code>`
        ).join("\n");
        const text =
          `${ce("💌")} <b>NEW NUMBERS ADDED</b> ${ce("💌")}\n` +
          `——————————————————————\n\n` +
          `╭─ ${ce("✨")} <b>DETAILS</b>\n` +
          `├ ${ce("🃏")} <b>Range:</b>  ${escapeHtml(range)}\n` +
          `╰ ${ce("⚡️")} <b>Added:</b>  <b>${phones.length}</b> new numbers\n\n` +
          `╭─ ${ce("📲")} <b>NUMBERS</b>\n${lines}` +
          (extra > 0 ? `\n╰ <i>+${extra} more...</i>` : "");
        await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
        logger.info({ range, count: phones.length }, "New numbers notification sent");
      }

    } catch (err) {
      logger.error({ err }, "Error polling Numbers API");
    }
  };

  pollNumbers();
  setInterval(pollNumbers, NUMS_POLL_INTERVAL);

  return bot;
}
