import { Router, type IRouter } from "express";
import { pool } from "../lib/db";

const router: IRouter = Router();

type Status = "not_tried" | "registered" | "unregistered" | "already_other";
const VALID: Status[] = ["not_tried", "registered", "unregistered", "already_other"];

const RAILWAY_BASE = "https://0xhawk-production.up.railway.app";
const RAILWAY_V2_BASE = "https://0xhawk.up.railway.app";

router.get("/proxy/sms", async (_req, res) => {
  try {
    const upstream = await fetch(`${RAILWAY_BASE}/?type=sms`);
    const raw = await upstream.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(raw);
    res.setHeader("Content-Type", "application/json");
    res.send(text);
  } catch {
    res.status(502).json({ error: "Failed to fetch SMS data from upstream" });
  }
});

router.get("/proxy/numbers", async (_req, res) => {
  try {
    const upstream = await fetch(`${RAILWAY_BASE}/?type=numbers`);
    const raw = await upstream.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(raw);
    res.setHeader("Content-Type", "application/json");
    res.send(text);
  } catch {
    res.status(502).json({ error: "Failed to fetch numbers data from upstream" });
  }
});

router.get("/proxy/bot-info", async (_req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) { res.json({ ok: false }); return; }
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const d = await r.json() as { ok: boolean; result?: { username: string; first_name: string } };
    if (d.ok && d.result) {
      res.json({ ok: true, username: d.result.username, name: d.result.first_name });
    } else {
      res.json({ ok: false });
    }
  } catch {
    res.json({ ok: false });
  }
});

router.get("/proxy/statuses", async (_req, res) => {
  try {
    const { rows } = await pool.query<{ phone: string; status: Status }>(
      "SELECT phone, status FROM phone_statuses"
    );
    const map: Record<string, Status> = {};
    rows.forEach(r => { map[r.phone] = r.status; });
    res.json(map);
  } catch (e) {
    console.error("DB read error:", e);
    res.status(500).json({ error: "Database error" });
  }
});

router.post("/proxy/statuses/bulk", async (req, res) => {
  const { entries } = req.body as { entries?: Array<{ phone: string; status: string }> };
  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ error: "entries array required" }); return;
  }
  const valid = entries.filter(e => e.phone && VALID.includes(e.status as Status));
  if (valid.length === 0) { res.status(400).json({ error: "no valid entries" }); return; }
  try {
    const values = valid.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}, NOW())`).join(",");
    const params = valid.flatMap(e => [e.phone, e.status]);
    await pool.query(
      `INSERT INTO phone_statuses (phone, status, updated_at) VALUES ${values}
       ON CONFLICT (phone) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
      params
    );
    res.json({ ok: true, count: valid.length });
  } catch (e) {
    console.error("DB bulk write error:", e);
    res.status(500).json({ error: "Database error" });
  }
});

router.post("/proxy/statuses", async (req, res) => {
  const { phone, status } = req.body as { phone?: string; status?: string };
  if (!phone || !status || !VALID.includes(status as Status)) {
    res.status(400).json({ error: "phone and valid status required" });
    return;
  }
  try {
    await pool.query(
      `INSERT INTO phone_statuses (phone, status, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (phone) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
      [phone, status]
    );
    res.json({ ok: true, phone, status });
  } catch (e) {
    console.error("DB write error:", e);
    res.status(500).json({ error: "Database error" });
  }
});

router.delete("/proxy/statuses/:phone", async (req, res) => {
  const { phone } = req.params;
  try {
    await pool.query("DELETE FROM phone_statuses WHERE phone = $1", [phone]);
    res.json({ ok: true, phone });
  } catch (e) {
    console.error("DB delete error:", e);
    res.status(500).json({ error: "Database error" });
  }
});

// ─── New v2 API endpoints (0xhawk.up.railway.app) ───────────────────────────
// SMS with optional date range + session override
//   /proxy/v2/sms
//   /proxy/v2/sms?date1=2026-04-15&date2=2026-04-18
//   /proxy/v2/sms?session=PHPSESSID
router.get("/proxy/v2/sms", async (req, res) => {
  try {
    const params = new URLSearchParams({ type: "sms" });
    const { date1, date2, session } = req.query as Record<string, string | undefined>;
    if (date1) params.set("date1", date1);
    if (date2) params.set("date2", date2);
    if (session) params.set("session", session);
    const upstream = await fetch(`${RAILWAY_V2_BASE}/?${params.toString()}`);
    const raw = await upstream.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(raw);
    res.setHeader("Content-Type", "application/json");
    res.send(text);
  } catch {
    res.status(502).json({ error: "Failed to fetch v2 SMS data from upstream" });
  }
});

// Numbers (v2)
router.get("/proxy/v2/numbers", async (_req, res) => {
  try {
    const upstream = await fetch(`${RAILWAY_V2_BASE}/?type=numbers`);
    const raw = await upstream.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(raw);
    res.setHeader("Content-Type", "application/json");
    res.send(text);
  } catch {
    res.status(502).json({ error: "Failed to fetch v2 numbers data from upstream" });
  }
});

// Health check (v2)
router.get("/proxy/v2/health", async (_req, res) => {
  try {
    const upstream = await fetch(`${RAILWAY_V2_BASE}/health`);
    const raw = await upstream.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(raw);
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    res.status(upstream.status).send(text);
  } catch {
    res.status(502).json({ error: "Failed to fetch v2 health from upstream" });
  }
});

// Docs (v2) — pass through HTML/JSON
router.get("/proxy/v2/docs", async (_req, res) => {
  try {
    const upstream = await fetch(`${RAILWAY_V2_BASE}/docs`);
    const raw = await upstream.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(raw);
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "text/html");
    res.status(upstream.status).send(text);
  } catch {
    res.status(502).json({ error: "Failed to fetch v2 docs from upstream" });
  }
});

export default router;
