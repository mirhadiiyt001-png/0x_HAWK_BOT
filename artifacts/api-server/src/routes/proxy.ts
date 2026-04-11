import { Router, type IRouter } from "express";
import fs from "fs";
import path from "path";

const router: IRouter = Router();

const RAILWAY_BASE = "https://0xhawk-production.up.railway.app";

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

const DATA_FILE = path.resolve(process.cwd(), "data", "statuses.json");
type Status = "not_tried" | "registered" | "unregistered" | "already_other";

function readStatuses(): Record<string, Status> {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Record<string, Status>;
  } catch { return {}; }
}

function writeStatuses(data: Record<string, Status>): void {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

router.get("/proxy/statuses", (_req, res) => { res.json(readStatuses()); });

router.post("/proxy/statuses", (req, res) => {
  const { phone, status } = req.body as { phone?: string; status?: string };
  const valid: Status[] = ["not_tried", "registered", "unregistered", "already_other"];
  if (!phone || !status || !valid.includes(status as Status)) {
    res.status(400).json({ error: "phone and valid status required" });
    return;
  }
  const all = readStatuses();
  all[phone] = status as Status;
  writeStatuses(all);
  res.json({ ok: true, phone, status });
});

router.delete("/proxy/statuses/:phone", (req, res) => {
  const { phone } = req.params;
  const all = readStatuses();
  delete all[phone];
  writeStatuses(all);
  res.json({ ok: true, phone });
});

export default router;
