// Upstream client — fetches via the Railway proxy.
// Endpoints:
//   GET https://hadibhai-production.up.railway.app/api/zone?type=sms
//   GET https://hadibhai-production.up.railway.app/api/zone?type=numbers

import { logger } from "./logger";

const RAILWAY_BASE_URL =
  process.env.RAILWAY_BASE_URL ||
  "https://hadibhai-production.up.railway.app";

const FETCH_TIMEOUT_MS = 25000;

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Upstream ${url} returned HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
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

function wrapEnvelope(
  type: "sms" | "numbers",
  raw: unknown,
  startedAt: number,
  fromDate: string,
  toDate: string,
): UpstreamEnvelope {
  // Railway proxy returns the DataTables payload directly:
  //   { sEcho, iTotalRecords, iTotalDisplayRecords, aaData: [...] }
  // Some deployments may already wrap it in `{ data: {...} }` — handle both.
  const obj = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const inner =
    "aaData" in obj
      ? (obj as UpstreamEnvelope["data"])
      : ((obj["data"] as UpstreamEnvelope["data"] | undefined) ?? { aaData: [] });

  return {
    success: true,
    name: "Zone SMS Railway Proxy",
    version: "1.0",
    type,
    fromDate,
    toDate,
    data: inner,
    responseTimeMs: Date.now() - startedAt,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchSms(_opts: { date1?: string; date2?: string; session?: string } = {}): Promise<UpstreamEnvelope> {
  const start = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const url = `${RAILWAY_BASE_URL}/api/zone?type=sms`;
  const raw = await getJson(url);
  return wrapEnvelope("sms", raw, start, today, today);
}

export async function fetchNumbers(_opts: { session?: string } = {}): Promise<UpstreamEnvelope> {
  const start = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const url = `${RAILWAY_BASE_URL}/api/zone?type=numbers`;
  const raw = await getJson(url);
  return wrapEnvelope("numbers", raw, start, today, today);
}

export function logUpstreamConfig(): void {
  logger.info({ target: RAILWAY_BASE_URL }, "Upstream (Railway) client configured");
}

// ─── Cached wrappers — coalesce concurrent calls + serve stale on slow upstream ───
const CACHE_TTL_MS  = 1000;   // serve fresh within 1s — fast updates for live dashboard
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
