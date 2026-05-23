import { Router, type IRouter } from "express";
import { pool } from "../lib/db";
import { fetchSmsCached, fetchNumbersCached } from "../lib/upstream";

const router: IRouter = Router();

type Status = "not_tried" | "registered" | "unregistered" | "already_other";
const VALID: Status[] = ["not_tried", "registered", "unregistered", "already_other"];

router.get("/proxy/sms", async (_req, res) => {
  try {
    const result = await fetchSmsCached();
    res.setHeader("Content-Type", "application/json");
    res.json(result);
  } catch (e) {
    console.error("[proxy/sms] upstream error:", (e as Error).message);
    res.status(502).json({ success: false, error: "Failed to fetch SMS data from upstream" });
  }
});

router.get("/proxy/numbers", async (_req, res) => {
  try {
    const result = await fetchNumbersCached();
    res.setHeader("Content-Type", "application/json");
    res.json(result);
  } catch (e) {
    console.error("[proxy/numbers] upstream error:", (e as Error).message);
    res.status(502).json({ success: false, error: "Failed to fetch numbers data from upstream" });
  }
});

router.get("/proxy/health", async (_req, res) => {
  res.json({
    status: "healthy",
    service: "0x_HAWK ZONE SMS API (local)",
    uptime: process.uptime(),
    time: new Date().toISOString(),
  });
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

export default router;
