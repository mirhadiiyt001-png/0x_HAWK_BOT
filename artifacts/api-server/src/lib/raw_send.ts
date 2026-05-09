/**
 * Raw HTTP Telegram helpers — adds two features the SDK can't:
 *   1. Rotating colored inline buttons via the `style` field
 *      (primary / success / danger). Telegram clients render these
 *      with tinted button backgrounds.
 *   2. `icon_custom_emoji_id` on buttons — premium custom emoji icons.
 *
 * Three-tier fallback (mirrors the CYPHER reference impl):
 *   styled keyboard → strip styles → strip <tg-emoji> tags from text.
 */
import { logger } from "./logger";

type RawButton = {
  text: string;
  callback_data?: string;
  url?: string;
  copy_text?: { text: string };
  icon_custom_emoji_id?: string;
  style?: "primary" | "success" | "danger";
};
type RawRow = RawButton[];

const STYLES = ["primary", "success", "danger"] as const;
let styleIdx = 0;
function nextStyle(): typeof STYLES[number] {
  const s = STYLES[styleIdx % STYLES.length]!;
  styleIdx++;
  return s;
}

function colorize(rows: RawRow[]): { inline_keyboard: RawButton[][] } {
  const out: RawButton[][] = [];
  for (const row of rows) {
    const colored: RawButton[] = [];
    for (const btn of row) {
      const b: RawButton = { ...btn };
      const interactive =
        (b.callback_data && b.callback_data !== "noop") || !!b.url || !!b.copy_text;
      if (interactive && !b.style) b.style = nextStyle();
      colored.push(b);
    }
    out.push(colored);
  }
  return { inline_keyboard: out };
}

function stripStyles(kb: { inline_keyboard: RawButton[][] }) {
  return {
    inline_keyboard: kb.inline_keyboard.map((r) =>
      r.map(({ style: _s, ...rest }) => rest),
    ),
  };
}

function stripIcons(kb: { inline_keyboard: RawButton[][] }) {
  return {
    inline_keyboard: kb.inline_keyboard.map((r) =>
      r.map(({ icon_custom_emoji_id: _i, style: _s, ...rest }) => rest),
    ),
  };
}

const TG_EMOJI_RE = /<tg-emoji[^>]*>(.*?)<\/tg-emoji>/gs;
function stripTgEmoji(text: string): string {
  return text.includes("<tg-emoji") ? text.replace(TG_EMOJI_RE, "$1") : text;
}

async function tgPost(token: string, method: string, payload: Record<string, unknown>) {
  const body = { ...payload };
  if (body["reply_markup"] && typeof body["reply_markup"] === "object") {
    body["reply_markup"] = JSON.stringify(body["reply_markup"]);
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await r.json()) as { ok: boolean; description?: string; result?: unknown };
  } catch (e) {
    return { ok: false, description: String((e as Error)?.message ?? e) };
  }
}

export interface RawSendOptions {
  token: string;
  chatId: number | string;
  text: string;
  rows: RawRow[];
  parseMode?: "HTML" | "MarkdownV2";
  disablePreview?: boolean;
}

export async function rawSend(opts: RawSendOptions) {
  const { token, chatId, text, rows, parseMode = "HTML", disablePreview = true } = opts;
  const kb = colorize(rows);
  const base: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    link_preview_options: { is_disabled: disablePreview },
  };

  // Tier 1: styled keyboard
  let resp = await tgPost(token, "sendMessage", { ...base, reply_markup: kb });
  if (resp.ok) return resp;

  // Tier 2: strip button styles (some clients reject unknown fields)
  const noStyles = stripStyles(kb);
  resp = await tgPost(token, "sendMessage", { ...base, reply_markup: noStyles });
  if (resp.ok) return resp;

  // Tier 3a: strip premium icons too
  const noIcons = stripIcons(kb);
  resp = await tgPost(token, "sendMessage", { ...base, reply_markup: noIcons });
  if (resp.ok) return resp;

  // Tier 3b: strip <tg-emoji> tags from text
  if (text.includes("<tg-emoji")) {
    resp = await tgPost(token, "sendMessage", {
      ...base,
      text: stripTgEmoji(text),
      reply_markup: noIcons,
    });
    if (resp.ok) return resp;
  }

  logger.warn({ description: resp.description }, "rawSend failed after all fallbacks");
  // Throw so callers' existing try/catch fallback paths engage. Tag the
  // message with ETELEGRAM so it matches the markup-error retry filter.
  throw new Error(`ETELEGRAM rawSend failed: ${resp.description ?? "unknown"}`);
}
