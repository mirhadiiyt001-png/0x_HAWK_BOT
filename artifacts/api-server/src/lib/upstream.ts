// Direct upstream client for the SMS panel — replaces external Railway proxy.
// Hits the panel directly with proper headers + PHPSESSID cookie.

import http from "http";
import https from "https";
import zlib from "zlib";
import { logger } from "./logger";

const TARGET_BASE_URL = process.env.TARGET_BASE_URL || "http://51.68.39.124";
const DEFAULT_PHPSESSID = process.env.PHPSESSID || "qeekdt0k1pe457tlkd5pg9d6e6";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

function fetchWithDecompression(url: string, headers: Record<string, string>, timeoutMs = 25000): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (c: Buffer) => chunks.push(c));
      response.on("end", () => {
        const buf = Buffer.concat(chunks);
        const enc = response.headers["content-encoding"];
        if (enc === "gzip") {
          zlib.gunzip(buf, (err, out) => err ? reject(err) : resolve(out.toString()));
        } else if (enc === "deflate") {
          zlib.inflate(buf, (err, out) => err ? reject(err) : resolve(out.toString()));
        } else {
          resolve(buf.toString());
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Request timeout")); });
  });
}

function baseHeaders(referer: string, session: string): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "X-Requested-With": "XMLHttpRequest",
    "Cookie": `PHPSESSID=${session}`,
    "Referer": referer,
  };
}

export interface UpstreamEnvelope {
  success: boolean;
  name: string;
  version: string;
  type: "sms" | "numbers";
  fromDate: string;
  toDate: string;
  data: {
    sEcho?: number;
    iTotalRecords?: string;
    iTotalDisplayRecords?: string;
    aaData?: unknown[][];
    [k: string]: unknown;
  };
  responseTimeMs: number;
  fetchedAt: string;
}

export async function fetchSms(opts: { date1?: string; date2?: string; session?: string } = {}): Promise<UpstreamEnvelope> {
  const start = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const date1 = opts.date1 || today;
  const date2 = opts.date2 || date1;
  const session = opts.session || DEFAULT_PHPSESSID;
  const ts = Date.now();

  const url =
    `${TARGET_BASE_URL}/sms/subclient/ajax/dt_reports.php` +
    `?fdate1=${date1}%2000:00:00&fdate2=${date2}%2023:59:59` +
    `&ftermination=&fnum=&fcli=&fgdate=0&fgtermination=0&fgnumber=0&fgcli=0&fg=0` +
    `&sEcho=1&iColumns=8&sColumns=%2C%2C%2C%2C%2C%2C%2C` +
    `&iDisplayStart=0&iDisplayLength=-1` +
    `&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true` +
    `&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true` +
    `&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true` +
    `&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true` +
    `&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true` +
    `&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true` +
    `&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true` +
    `&mDataProp_7=7&sSearch_7=&bRegex_7=false&bSearchable_7=true&bSortable_7=true` +
    `&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1&_=${ts}`;

  const headers = baseHeaders(`${TARGET_BASE_URL}/sms/subclient/Reports`, session);
  const raw = await fetchWithDecompression(url, headers);
  let data: UpstreamEnvelope["data"];
  try { data = JSON.parse(raw); } catch { data = { error: "JSON parse failed", raw: raw.slice(0, 400) } as never; }

  return {
    success: true,
    name: "0x_HAWK ZONE SMS API",
    version: "2.0-local",
    type: "sms",
    fromDate: date1,
    toDate: date2,
    data,
    responseTimeMs: Date.now() - start,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchNumbers(opts: { session?: string } = {}): Promise<UpstreamEnvelope> {
  const start = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const session = opts.session || DEFAULT_PHPSESSID;
  const ts = Date.now();

  const url =
    `${TARGET_BASE_URL}/sms/subclient/ajax/dt_numbers.php` +
    `?ftermination=&sEcho=1&iColumns=3&sColumns=%2C%2C` +
    `&iDisplayStart=0&iDisplayLength=-1` +
    `&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true` +
    `&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true` +
    `&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true` +
    `&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1&_=${ts}`;

  const headers = baseHeaders(`${TARGET_BASE_URL}/sms/subclient/AssignedNumbers`, session);
  const raw = await fetchWithDecompression(url, headers);
  let data: UpstreamEnvelope["data"];
  try { data = JSON.parse(raw); } catch { data = { error: "JSON parse failed", raw: raw.slice(0, 400) } as never; }

  return {
    success: true,
    name: "0x_HAWK ZONE SMS API",
    version: "2.0-local",
    type: "numbers",
    fromDate: today,
    toDate: today,
    data,
    responseTimeMs: Date.now() - start,
    fetchedAt: new Date().toISOString(),
  };
}

export function logUpstreamConfig(): void {
  logger.info({ target: TARGET_BASE_URL, hasSession: !!process.env.PHPSESSID }, "Upstream client configured");
}

// ─── Cached wrappers — coalesce concurrent calls + serve stale on slow upstream ───
const CACHE_TTL_MS  = 4000;   // serve fresh within 4s
const STALE_TTL_MS  = 60000;  // serve stale up to 60s on upstream failure

interface CacheEntry { at: number; data: UpstreamEnvelope; }
const smsCache: Map<string, CacheEntry> = new Map();
const numCache: Map<string, CacheEntry> = new Map();
const inflight: Map<string, Promise<UpstreamEnvelope>> = new Map();

async function cached(
  key: string,
  cache: Map<string, CacheEntry>,
  loader: () => Promise<UpstreamEnvelope>,
): Promise<UpstreamEnvelope> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.data;

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      const fresh = await loader();
      cache.set(key, { at: Date.now(), data: fresh });
      return fresh;
    } catch (err) {
      // Serve stale data if available within stale window
      if (hit && now - hit.at < STALE_TTL_MS) {
        logger.warn({ key, ageMs: now - hit.at, err: (err as Error).message }, "Serving stale upstream data");
        return hit.data;
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

export async function fetchSmsCached(opts: { date1?: string; date2?: string; session?: string } = {}): Promise<UpstreamEnvelope> {
  const today = new Date().toISOString().slice(0, 10);
  const d1 = opts.date1 || today, d2 = opts.date2 || d1, s = opts.session || "default";
  return cached(`sms:${d1}:${d2}:${s}`, smsCache, () => fetchSms(opts));
}

export async function fetchNumbersCached(opts: { session?: string } = {}): Promise<UpstreamEnvelope> {
  const s = opts.session || "default";
  return cached(`num:${s}`, numCache, () => fetchNumbers(opts));
}
