// Upstream client — fetches from the 0xhawk API directly.
// Endpoints:
//   GET https://0xhawk-api.up.railway.app/?type=sms
//   GET https://0xhawk-api.up.railway.app/?type=numbers

import { logger } from "./logger";

const API_BASE_URL =
  process.env.UPSTREAM_API_URL ||
  "https://0xhawk-api.up.railway.app";

const FETCH_TIMEOUT_MS = 30000;

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

// ─── New API response types ──────────────────────────────────────────────────

export interface SmsRecord {
  date: string;
  termination: string;
  number: string;
  cli: string;
  currency: string;
  payterm: string;
  message: string;
}

export interface NumberRecord {
  number: string;       // e.g. "77 KAZAKHSTAN D1 18 APR" (the range/SIM name)
  termination: string;  // e.g. "77716949723" (the actual phone number)
  status: string;
}

export interface UpstreamSmsResponse {
  success: boolean;
  api: string;
  version: string;
  type: "sms";
  total: number;
  ms: number;
  fetchedAt: string;
  records: SmsRecord[];
  dateRange?: { from: string; to: string };
}

export interface UpstreamNumbersResponse {
  success: boolean;
  api: string;
  version: string;
  type: "numbers";
  total: number;
  ms: number;
  fetchedAt: string;
  records: NumberRecord[];
}

export async function fetchSms(): Promise<UpstreamSmsResponse> {
  const url = `${API_BASE_URL}/?type=sms`;
  const raw = await getJson(url) as UpstreamSmsResponse;
  return raw;
}

export async function fetchNumbers(): Promise<UpstreamNumbersResponse> {
  const url = `${API_BASE_URL}/?type=numbers`;
  const raw = await getJson(url) as UpstreamNumbersResponse;
  return raw;
}

export function logUpstreamConfig(): void {
  logger.info({ target: API_BASE_URL }, "Upstream (0xhawk) API configured");
}

// ─── Cached wrappers — coalesce concurrent calls + serve stale on slow upstream ───
const CACHE_TTL_MS  = 1000;   // serve fresh within 1s — fast updates for live dashboard
const STALE_TTL_MS  = 60000;  // serve stale up to 60s on upstream failure

interface CacheEntry<T> { at: number; data: T; }
const smsCache: Map<string, CacheEntry<UpstreamSmsResponse>> = new Map();
const numCache: Map<string, CacheEntry<UpstreamNumbersResponse>> = new Map();
const inflight: Map<string, Promise<unknown>> = new Map();

async function cached<T>(
  key: string,
  cache: Map<string, CacheEntry<T>>,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.data;

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

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

export async function fetchSmsCached(): Promise<UpstreamSmsResponse> {
  return cached("sms", smsCache, () => fetchSms());
}

export async function fetchNumbersCached(): Promise<UpstreamNumbersResponse> {
  return cached("numbers", numCache, () => fetchNumbers());
}
