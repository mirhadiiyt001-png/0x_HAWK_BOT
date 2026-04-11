import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, RefreshCw, PhoneOff,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import "./index.css";

const API_BASE     = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const SMS_API      = `${API_BASE}/api/proxy/sms`;
const NUMBERS_API  = `${API_BASE}/api/proxy/numbers`;
const STATUSES_API = `${API_BASE}/api/proxy/statuses`;
const BOT_INFO_API = `${API_BASE}/api/proxy/bot-info`;
const PER_PAGE     = 25;

interface SmsRow {
  timestamp: string; sim: string; phone: string;
  device: string; plan: string; body: string; isOtp: boolean;
}
type Status = "not_tried" | "registered" | "unregistered" | "already_other";
interface NumItem { sim: string; phone: string; status: Status; }
interface BotInfo  { username: string; }

const STATUS_CFG: Record<Status, { label: string; color: string; bg: string; border: string }> = {
  not_tried:     { label: "Not Tried",    color: "#64748b", bg: "rgba(100,116,139,.1)", border: "rgba(100,116,139,.3)" },
  registered:    { label: "Registered",   color: "#10b981", bg: "rgba(16,185,129,.1)",  border: "rgba(16,185,129,.3)"  },
  unregistered:  { label: "Unregistered", color: "#f43f5e", bg: "rgba(244,63,94,.1)",   border: "rgba(244,63,94,.3)"   },
  already_other: { label: "Already Other",color: "#a855f7", bg: "rgba(168,85,247,.1)",  border: "rgba(168,85,247,.3)"  },
};

async function fetchServerStatuses(): Promise<Record<string, Status>> {
  try { const r = await fetch(STATUSES_API); if (!r.ok) return {}; return (await r.json()) as Record<string, Status>; }
  catch { return {}; }
}
async function saveServerStatus(phone: string, status: Status): Promise<void> {
  await fetch(STATUSES_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, status }) });
}

// ── Heroicons SVG Components ───────────────────────────────────────────────────
function IconEnvelope({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
    </svg>
  );
}
function IconKey({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
    </svg>
  );
}
function IconSignal({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 0 1 1.06 0Z" />
    </svg>
  );
}
function IconGrid({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
    </svg>
  );
}
function IconPhone({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3" />
    </svg>
  );
}
function IconCreditCard({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  );
}
function IconCopy({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 4v12a2 2 0 002 2h8a2 2 0 002-2V7.242a2 2 0 00-.602-1.43L16.083 2.57A2 2 0 0014.685 2H10a2 2 0 00-2 2z"/>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 18v2a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2"/>
    </svg>
  );
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}
function IconPhoneList({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </svg>
  );
}
function IconGlobe({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const COUNTRY_PREFIXES: string[] = [
  "358","359","380","381","385","386","420","421",
  "370","371","372","375","351","353","966","971",
  "44","49","33","34","39","31","32","41","43","45","46",
  "47","48","36","40","86","81","82","84","91",
  "92","90","62","60","65","66","98","20","27","55",
  "52","54","61","64","7","1",
].sort((a, b) => b.length - a.length);

function stripCountryCode(phone: string): string {
  const p = phone.replace(/\D/g, "");
  for (const prefix of COUNTRY_PREFIXES) {
    if (p.startsWith(prefix)) return p.slice(prefix.length);
  }
  return p;
}

function flag(phone: string): string {
  const p = phone.replace(/\D/g, "");
  const map: [string, string][] = [
    ["1","🇺🇸"],["44","🇬🇧"],["49","🇩🇪"],["33","🇫🇷"],["34","🇪🇸"],["39","🇮🇹"],
    ["31","🇳🇱"],["32","🇧🇪"],["41","🇨🇭"],["43","🇦🇹"],["45","🇩🇰"],["46","🇸🇪"],
    ["47","🇳🇴"],["48","🇵🇱"],["358","🇫🇮"],["359","🇧🇬"],["36","🇭🇺"],["40","🇷🇴"],
    ["380","🇺🇦"],["381","🇷🇸"],["385","🇭🇷"],["386","🇸🇮"],["420","🇨🇿"],["421","🇸🇰"],
    ["370","🇱🇹"],["371","🇱🇻"],["372","🇪🇪"],["375","🇧🇾"],["351","🇵🇹"],["353","🇮🇪"],
    ["7","🇷🇺"],["86","🇨🇳"],["81","🇯🇵"],["82","🇰🇷"],["84","🇻🇳"],["91","🇮🇳"],
    ["92","🇵🇰"],["90","🇹🇷"],["62","🇮🇩"],["60","🇲🇾"],["65","🇸🇬"],["66","🇹🇭"],
    ["966","🇸🇦"],["971","🇦🇪"],["98","🇮🇷"],["20","🇪🇬"],["27","🇿🇦"],["55","🇧🇷"],
    ["52","🇲🇽"],["54","🇦🇷"],["61","🇦🇺"],["64","🇳🇿"],
  ];
  for (const [prefix, emoji] of map.sort((a, b) => b[0].length - a[0].length)) {
    if (p.startsWith(prefix)) return emoji;
  }
  return "🌐";
}

// Common English words to skip when extracting OTP codes
const SKIP_WORDS = new Set(["code","otp","your","the","with","this","that","not","any","one","for","and","use","share","pin","key","from","anyone","verify","will","has","via","can","our","per","all"]);

function extractOtp(text: string): string | null {
  // 1. Alphanumeric/numeric token at very end of string (after colon, dash, space)
  //    e.g. "Do not share your code with anyone: fmerv"  → "fmerv"
  //    e.g. "Your OTP is: 123456"  → "123456"
  const endToken = /[:\-=]\s*([A-Za-z0-9]{4,10})\s*[.!]?\s*$/;
  const m1 = text.match(endToken);
  if (m1?.[1] && !SKIP_WORDS.has(m1[1].toLowerCase())) return m1[1];

  // 2. "is WORD" pattern near end: "Your OTP is 654321"
  const isPattern = /\bis\s+([A-Za-z0-9]{4,10})\b(?:\s*[.!]?\s*$|\s+(?:valid|expire|do\s+not))/i;
  const m2 = text.match(isPattern);
  if (m2?.[1] && !SKIP_WORDS.has(m2[1].toLowerCase())) return m2[1];

  // 3. OTP/PIN/PASS keyword immediately followed by alphanumeric (not a common word)
  const keyDirect = /\b(?:OTP|PIN|passcode|password|Token|кода?|رمز|کد)\b[^A-Za-z0-9]{0,5}([A-Za-z0-9]{4,10})/i;
  const m3 = text.match(keyDirect);
  if (m3?.[1] && !SKIP_WORDS.has(m3[1].toLowerCase())) return m3[1];

  // 4. Pure 6-digit number anywhere
  const num6 = /\b(\d{6})\b/;
  const m4 = text.match(num6);
  if (m4?.[1]) return m4[1];

  // 5. Pure 4-digit number anywhere
  const num4 = /\b(\d{4})\b/;
  const m5 = text.match(num4);
  if (m5?.[1]) return m5[1];

  // 6. Standalone alphanumeric token (4-8 chars, mix of letters+digits) as fallback
  const alphaNum = /\b([A-Z]{2,}[0-9]{2,}|[0-9]{2,}[A-Z]{2,})\b/i;
  const m6 = text.match(alphaNum);
  if (m6?.[1] && m6[1].length <= 8) return m6[1];

  return null;
}

function parseTs(ts: string): Date {
  const n = ts.replace(" ", "T");
  return new Date(n.endsWith("Z") ? n : n + "Z");
}
function timeAgo(ts: string): string {
  const d = Math.floor((Date.now() - parseTs(ts).getTime()) / 1000);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
function clockStr(ts: string): string {
  const d = parseTs(ts);
  return isNaN(d.getTime()) ? ts.slice(11, 16)
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

function useCountUp(target: number) {
  const [v, setV] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    if (target === prev.current) return;
    const start = prev.current; const diff = target - start; let i = 0;
    const id = setInterval(() => { i++; setV(Math.round(start + diff * i / 30)); if (i >= 30) { clearInterval(id); prev.current = target; } }, 20);
    return () => clearInterval(id);
  }, [target]);
  return v;
}

// ── Pagination ────────────────────────────────────────────────────────────────
function Pagination({ page, total, onChange, from, to, count }: {
  page: number; total: number; onChange: (p: number) => void;
  from: number; to: number; count: number;
}) {
  const pages: number[] = [];
  const s = Math.max(1, page - 2); const e = Math.min(total, s + 4);
  for (let i = s; i <= e; i++) pages.push(i);
  return (
    <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
      <span className="text-xs text-slate-500 font-mono">{from + 1}–{Math.min(to, count)} / {count}</span>
      <div className="flex items-center gap-1">
        <PgBtn onClick={() => onChange(1)} disabled={page === 1}><ChevronsLeft size={13}/></PgBtn>
        <PgBtn onClick={() => onChange(page - 1)} disabled={page === 1}><ChevronLeft size={13}/></PgBtn>
        {pages.map(p => (
          <button key={p} onClick={() => onChange(p)}
            className={`w-7 h-7 rounded-lg text-xs font-semibold transition-all ${
              p === page ? "bg-violet-500/20 border border-violet-400/30 text-violet-300"
                        : "text-slate-500 hover:text-white hover:bg-white/5"}`}>{p}</button>
        ))}
        {e < total && <><span className="text-slate-600 text-xs px-0.5">…</span>
          <button onClick={() => onChange(total)} className="w-7 h-7 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-white/5">{total}</button></>}
        <PgBtn onClick={() => onChange(page + 1)} disabled={page === total}><ChevronRight size={13}/></PgBtn>
        <PgBtn onClick={() => onChange(total)} disabled={page === total}><ChevronsRight size={13}/></PgBtn>
      </div>
    </div>
  );
}
function PgBtn({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/5 disabled:opacity-25 disabled:cursor-not-allowed transition-all">
      {children}
    </button>
  );
}

// ── OTP Code Display ──────────────────────────────────────────────────────────
function OtpCode({ otp }: { otp: string }) {
  const [done, setDone] = useState(false);
  const copy = () => { navigator.clipboard.writeText(otp); setDone(true); setTimeout(() => setDone(false), 2000); };
  return (
    <button onClick={copy}
      className="group flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all duration-200 active:scale-[.97] w-full"
      style={done
        ? { background: "linear-gradient(135deg,rgba(16,185,129,.15),rgba(52,211,153,.08))", borderColor: "rgba(52,211,153,.3)", boxShadow: "0 0 24px rgba(52,211,153,.1)" }
        : { background: "linear-gradient(135deg,rgba(139,92,246,.18),rgba(99,102,241,.1))", borderColor: "rgba(139,92,246,.3)", boxShadow: "0 0 24px rgba(139,92,246,.12)" }}>
      <span className={`text-[9px] font-black uppercase tracking-widest shrink-0 ${done ? "text-emerald-400" : "text-violet-400/70"}`}>
        {done ? "✓" : "OTP"}
      </span>
      <span className={`text-2xl sm:text-3xl font-black tracking-[.22em] font-mono ${done ? "text-emerald-300" : "text-white"}`}>{otp}</span>
      <span className={`ml-auto opacity-50 group-hover:opacity-100 transition-opacity shrink-0 ${done ? "text-emerald-400" : "text-violet-400"}`}>
        {done
          ? <IconCheck className="w-4 h-4"/>
          : <IconCopy className="w-4 h-4"/>}
      </span>
    </button>
  );
}

// ── Copy Pill ─────────────────────────────────────────────────────────────────
function CopyPill({ label, value, primary }: { label: string; value: string; primary?: boolean }) {
  const [ok, setOk] = useState(false);
  const go = () => { navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1800); };
  return (
    <button onClick={go}
      className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all ${
        ok ? "bg-emerald-500/15 border-emerald-400/25 text-emerald-300"
          : primary ? "bg-violet-500/12 border-violet-400/20 text-violet-300 hover:bg-violet-500/22"
          : "bg-white/[.05] border-white/10 text-white/45 hover:bg-white/10 hover:text-white/75"}`}>
      {ok
        ? <><IconCheck className="w-[11px] h-[11px]"/>Copied</>
        : <><IconCopy className="w-[11px] h-[11px]"/>{label}</>}
    </button>
  );
}

// ── Status Dropdown ───────────────────────────────────────────────────────────
function StatusDrop({ status, phone, onChange }: { status: Status; phone: string; onChange: (p: string, s: Status) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cfg = STATUS_CFG[status];
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all hover:brightness-110"
        style={{ background: cfg.bg, borderColor: cfg.border, color: cfg.color }}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: cfg.color }}/>
        <span className="hidden sm:inline">{cfg.label}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`}/>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-44 rounded-xl border border-white/10 p-1 z-50 shadow-2xl"
          style={{ background: "rgba(15,15,25,.98)", backdropFilter: "blur(20px)" }}>
          {(Object.entries(STATUS_CFG) as [Status, typeof STATUS_CFG[Status]][]).map(([k, v]) => (
            <button key={k} onClick={() => { setOpen(false); if (k !== status) onChange(phone, k); }}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all text-left">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: v.color }}/>
              {v.label}
              {k === status && <IconCheck className="w-3 h-3 ml-auto text-violet-400"/>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Number Row ────────────────────────────────────────────────────────────────
function NumRow({ item, idx, isNew, onStatus }: {
  item: NumItem; idx: number; isNew: boolean; onStatus: (p: string, s: Status) => void;
}) {
  const [copied, setCopied] = useState(false);
  const cfg = STATUS_CFG[item.status];
  const localNum = stripCountryCode(item.phone);
  const copy = async () => {
    await navigator.clipboard.writeText(localNum);
    setCopied(true);
    toast.success("Copied!", { description: localNum, duration: 1500 });
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <motion.div
      className={`flex items-center gap-2 sm:gap-3 px-3 py-2.5 rounded-xl border-l-[3px] transition-all hover:bg-white/[.03]`}
      style={{ borderLeftColor: item.status !== "not_tried" ? cfg.color : "transparent" }}
      initial={isNew ? { opacity: 0, x: -8 } : false} animate={{ opacity: 1, x: 0 }}>
      <span className="w-6 h-6 rounded-md bg-white/[.04] text-slate-500 text-[11px] font-mono font-semibold flex items-center justify-center shrink-0">{idx}</span>
      <span className="text-base shrink-0">{flag(item.phone)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-mono font-semibold text-white truncate cursor-pointer hover:text-violet-400 transition-colors" onClick={copy}>{item.phone}</p>
        <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-white/50 px-2 py-0.5 rounded-md bg-white/[.04] border border-white/[.07] font-medium">
          <IconGrid className="w-3 h-3 shrink-0"/> {item.sim}
        </span>
      </div>
      <StatusDrop status={item.status} phone={item.phone} onChange={onStatus}/>
      <button onClick={copy} className={`p-1.5 rounded-lg transition-all ${copied ? "text-emerald-400 bg-emerald-500/10" : "text-slate-500 hover:text-violet-400 hover:bg-violet-500/10"}`}>
        {copied ? <IconCheck className="w-[13px] h-[13px]"/> : <IconCopy className="w-[13px] h-[13px]"/>}
      </button>
    </motion.div>
  );
}

// ── Stat Card (Numbers tab) ────────────────────────────────────────────────────
function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: "blue" | "violet" }) {
  const animated = useCountUp(value);
  const styles = {
    blue:   { border: "border-indigo-500/[.12]", bg: "rgba(99,102,241,.08)", text: "text-indigo-300", iconBg: "rgba(99,102,241,.12)" },
    violet: { border: "border-violet-500/[.12]", bg: "rgba(139,92,246,.08)", text: "text-violet-300", iconBg: "rgba(139,92,246,.12)" },
  };
  const s = styles[color];
  return (
    <motion.div className={`stat-card glass-card p-3 sm:p-4 border ${s.border}`}
      style={{ background: s.bg }}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="stat-icon mb-3" style={{ background: s.iconBg }}>{icon}</div>
      <p className={`text-2xl sm:text-3xl font-black tabular-nums ${s.text}`}>{animated.toLocaleString()}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-1 font-medium">{label}</p>
    </motion.div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<"messages" | "numbers">("messages");
  const [online, setOnline] = useState(false);
  const [bot, setBot] = useState<BotInfo | null>(null);
  const [lastFetch, setLastFetch] = useState("");

  const [rows, setRows] = useState<SmsRow[]>([]);
  const [totalSms, setTotalSms] = useState(0);
  const [smsLoading, setSmsLoading] = useState(true);
  const [smsPage, setSmsPage] = useState(1);
  const [smsFilter, setSmsFilter] = useState<"all" | "otp" | "sms">("all");
  const prevLen = useRef(0);
  const [newIdx, setNewIdx] = useState<Set<number>>(new Set());

  const [nums, setNums] = useState<NumItem[]>([]);
  const [numTotal, setNumTotal] = useState(0);
  const [numLoading, setNumLoading] = useState(true);
  const [numPage, setNumPage] = useState(1);
  const [numFilter, setNumFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [newNums, setNewNums] = useState<Set<string>>(new Set());
  const prevPhones = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetch(BOT_INFO_API).then(r => r.json())
      .then((d: { ok: boolean; username?: string }) => { if (d.ok && d.username) setBot({ username: d.username }); })
      .catch(() => {});
  }, []);

  const fetchSms = useCallback(async () => {
    try {
      const r = await fetch(SMS_API); if (!r.ok) throw new Error();
      const j = await r.json(); if (!j.success) throw new Error();
      const aaData: unknown[][] = j.data?.aaData ?? [];
      const parsed: SmsRow[] = [];
      for (const row of aaData) {
        if (!Array.isArray(row) || row.length < 7) continue;
        const phone = String(row[2]); const body = String(row[7] || "");
        if (phone === "0" || phone === "" || body === "0" || body === "") continue;
        // isOtp: API flag at index 6 OR our own pattern detection
        const apiOtpFlag = Number(row[6]) === 1;
        const isOtp = apiOtpFlag || extractOtp(body) !== null;
        parsed.push({ timestamp: String(row[0]), sim: String(row[1]), phone, device: String(row[3]), plan: String(row[5] || row[4] || ""), body, isOtp });
      }
      setRows(parsed); setTotalSms(parseInt(String(j.data?.iTotalRecords || parsed.length)));
      setLastFetch(j.fetchedAt || new Date().toISOString()); setOnline(true);
      if (parsed.length > prevLen.current && prevLen.current > 0) {
        setNewIdx(new Set([0])); setTimeout(() => setNewIdx(new Set()), 3000);
      }
      prevLen.current = parsed.length;
    } catch { setOnline(false); }
    finally { setSmsLoading(false); }
  }, []);

  useEffect(() => { fetchSms(); const id = setInterval(fetchSms, 5000); return () => clearInterval(id); }, [fetchSms]);

  const fetchNums = useCallback(async () => {
    try {
      const r = await fetch(NUMBERS_API); if (!r.ok) throw new Error();
      const j = await r.json(); if (!j.success) throw new Error();
      const aaData: unknown[][] = j.data?.aaData ?? [];
      const saved = await fetchServerStatuses();
      const out: NumItem[] = []; const seen = new Set<string>();
      for (const row of aaData) {
        if (!Array.isArray(row) || row.length < 2) continue;
        const phone = String(row[1]);
        if (seen.has(phone) || phone === "" || phone === "0") continue;
        seen.add(phone);
        out.push({ sim: String(row[0]), phone, status: (saved[phone] as Status) || "not_tried" });
      }
      const cur = new Set<string>(out.map(n => n.phone));
      const added = new Set<string>();
      if (prevPhones.current.size > 0) out.forEach(n => { if (!prevPhones.current.has(n.phone)) added.add(n.phone); });
      setNewNums(added); prevPhones.current = cur;
      if (added.size > 0) setTimeout(() => setNewNums(new Set()), 3000);
      setNums(out); setNumTotal(parseInt(String(j.data?.iTotalRecords || out.length)));
    } catch {} finally { setNumLoading(false); }
  }, []);

  useEffect(() => { fetchNums(); }, [fetchNums]);

  const onStatus = useCallback((phone: string, status: Status) => {
    setNums(prev => prev.map(n => n.phone === phone ? { ...n, status } : n));
    toast.success("Status updated", { description: `${phone} → ${STATUS_CFG[status].label}` });
    saveServerStatus(phone, status).catch(() => toast.error("Failed to save status"));
  }, []);

  const filtered = rows.filter(r => smsFilter === "all" ? true : smsFilter === "otp" ? r.isOtp : !r.isOtp);
  const smsPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const smsFrom = (smsPage - 1) * PER_PAGE;
  const paged = filtered.slice(smsFrom, smsFrom + PER_PAGE);
  const pageOtpCount = paged.filter(r => r.isOtp).length;

  const filtNums = nums
    .filter(n => n.sim.toLowerCase().includes(search.toLowerCase()) || n.phone.includes(search))
    .filter(n => numFilter === "all" || n.status === numFilter);
  const numPages = Math.max(1, Math.ceil(filtNums.length / PER_PAGE));
  const numFrom  = (numPage - 1) * PER_PAGE;
  const pagedNums = filtNums.slice(numFrom, numFrom + PER_PAGE);

  const numCounts = {
    all:          nums.length,
    registered:   nums.filter(n => n.status === "registered").length,
    unregistered: nums.filter(n => n.status === "unregistered").length,
    not_tried:    nums.filter(n => n.status === "not_tried").length,
    already_other:nums.filter(n => n.status === "already_other").length,
  };
  const ranges = new Set(nums.map(n => n.sim.split(/\s+/)[0])).size;

  const aSms  = useCountUp(totalSms);
  const aOtps = useCountUp(pageOtpCount);

  useEffect(() => { setSmsPage(1); }, [smsFilter]);
  useEffect(() => { setNumPage(1); }, [search, numFilter]);

  return (
    <div className="min-h-screen text-white" style={{ background: "#060610", fontFamily: "'Inter',system-ui,sans-serif" }}>
      <Toaster position="top-center" richColors theme="dark"
        toastOptions={{ style: { background: "rgba(15,15,25,.95)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,.08)", fontSize: "13px" } }}/>

      {/* Glow blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-48 -left-32 w-[500px] h-[500px] bg-violet-600/[.07] rounded-full blur-[130px]"/>
        <div className="absolute top-1/2 -right-48 w-96 h-96 bg-indigo-600/[.06] rounded-full blur-[110px]"/>
        <div className="absolute -bottom-32 left-1/3 w-80 h-80 bg-purple-700/[.06] rounded-full blur-[100px]"/>
      </div>

      {/* Navbar */}
      <nav className="sticky top-0 z-30 border-b border-white/[.06]"
        style={{ background: "rgba(6,6,16,.92)", backdropFilter: "blur(28px)" }}>
        <div className="relative px-4 sm:px-6 lg:px-8 h-[60px] flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3 shrink-0 z-10">
            <div className="relative w-9 h-9">
              <div className="absolute inset-0 rounded-xl bg-violet-500/40 blur-lg"/>
              <div className="relative w-9 h-9 rounded-xl flex items-center justify-center border border-violet-400/25"
                style={{ background: "linear-gradient(135deg,rgba(139,92,246,.6),rgba(99,102,241,.5))" }}>
                <svg className="w-4 h-4 text-violet-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0"/>
                  <circle cx="12" cy="20" r="1" fill="currentColor"/>
                </svg>
              </div>
            </div>
            <div className="leading-tight">
              <p className="text-[13px] font-black text-white" style={{ letterSpacing: "0.12em" }}>ZONE SMS</p>
              <p className="text-[9px] tracking-[.22em] uppercase font-medium" style={{ color: "rgba(139,92,246,.65)" }}>SMS Monitor</p>
            </div>
          </div>

          {/* Tabs — absolutely centered */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 p-1 rounded-2xl border border-white/[.07]"
            style={{ background: "rgba(255,255,255,.025)" }}>
            <button onClick={() => setTab("messages")}
              className={`relative flex items-center gap-2 text-[11px] font-bold px-5 py-2 rounded-xl transition-all duration-200 whitespace-nowrap tracking-wide ${
                tab === "messages" ? "text-white" : "text-white/30 hover:text-white/60"}`}
              style={tab === "messages" ? {
                background: "linear-gradient(135deg,rgba(139,92,246,.35),rgba(99,102,241,.22))",
                boxShadow: "0 0 20px rgba(139,92,246,.25), inset 0 1px 0 rgba(255,255,255,.08)",
                border: "1px solid rgba(139,92,246,.3)"
              } : { border: "1px solid transparent" }}>
              <IconEnvelope className="w-3.5 h-3.5 shrink-0"/>
              <span>Messages</span>
            </button>
            <button onClick={() => setTab("numbers")}
              className={`relative flex items-center gap-2 text-[11px] font-bold px-5 py-2 rounded-xl transition-all duration-200 whitespace-nowrap tracking-wide ${
                tab === "numbers" ? "text-white" : "text-white/30 hover:text-white/60"}`}
              style={tab === "numbers" ? {
                background: "linear-gradient(135deg,rgba(139,92,246,.35),rgba(99,102,241,.22))",
                boxShadow: "0 0 20px rgba(139,92,246,.25), inset 0 1px 0 rgba(255,255,255,.08)",
                border: "1px solid rgba(139,92,246,.3)"
              } : { border: "1px solid transparent" }}>
              <IconPhoneList className="w-3.5 h-3.5 shrink-0"/>
              <span>Numbers</span>
            </button>
          </div>

          {/* Right */}
          <div className="flex items-center gap-2 shrink-0 z-10">
            {lastFetch && (
              <span className="hidden sm:flex items-center gap-1.5 text-[10px] text-white/30 font-medium px-2.5 py-1 rounded-full border border-white/[.07]"
                style={{ background: "rgba(255,255,255,.03)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400/60 animate-pulse shrink-0"/>
                {timeAgo(lastFetch)}
              </span>
            )}
            <div className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full border transition-all ${
              online ? "text-emerald-400 border-emerald-500/25" : "text-red-400 border-red-500/25"}`}
              style={{ background: online ? "rgba(16,185,129,.08)" : "rgba(239,68,68,.08)" }}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${online ? "bg-emerald-400" : "bg-red-400"}`}
                style={online ? { animation: "pulse 2s infinite", boxShadow: "0 0 8px rgba(52,211,153,.8)" } : {}}/>
              {online ? "Live" : "Offline"}
            </div>
          </div>
        </div>
      </nav>

      <AnimatePresence mode="wait">

        {/* ══ MESSAGES TAB ══ */}
        {tab === "messages" && (
          <motion.div key="msg" className="px-4 sm:px-6 lg:px-8 py-6 space-y-5"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .2 }}>

            {/* Stat Cards */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              {/* Total SMS */}
              <div className="rounded-2xl border border-blue-500/[.1] p-4 sm:p-5 relative overflow-hidden"
                style={{ background: "linear-gradient(135deg,rgba(59,130,246,.08),rgba(37,99,235,.04))" }}>
                <div className="absolute inset-0 bg-gradient-to-br from-white/[.02] to-transparent"/>
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center mb-3">
                  <IconEnvelope className="w-5 h-5 text-blue-400"/>
                </div>
                <p className="text-3xl sm:text-4xl font-black text-blue-300 tabular-nums">{aSms}</p>
                <p className="text-[11px] text-white/30 mt-1 font-medium">Total SMS</p>
              </div>

              {/* OTPs */}
              <div className="rounded-2xl border border-violet-500/[.12] p-4 sm:p-5 relative overflow-hidden"
                style={{ background: "linear-gradient(135deg,rgba(139,92,246,.1),rgba(99,102,241,.05))" }}>
                <div className="absolute inset-0 bg-gradient-to-br from-white/[.02] to-transparent"/>
                <div className="w-9 h-9 rounded-xl bg-violet-500/15 flex items-center justify-center mb-3">
                  <IconKey className="w-5 h-5 text-violet-300"/>
                </div>
                <p className="text-3xl sm:text-4xl font-black text-violet-300 tabular-nums">{aOtps}</p>
                <p className="text-[11px] text-white/30 mt-1 font-medium">OTPs This Page</p>
              </div>

              {/* Bot Status */}
              <div className={`rounded-2xl border p-4 sm:p-5 relative overflow-hidden ${online ? "border-emerald-500/[.12]" : "border-red-500/[.1]"}`}
                style={{ background: online ? "linear-gradient(135deg,rgba(16,185,129,.09),rgba(5,150,105,.04))" : "linear-gradient(135deg,rgba(239,68,68,.08),rgba(185,28,28,.03))" }}>
                <div className="absolute inset-0 bg-gradient-to-br from-white/[.02] to-transparent"/>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${online ? "bg-emerald-500/15" : "bg-red-500/15"}`}>
                  <IconSignal className={`w-5 h-5 ${online ? "text-emerald-400" : "text-red-400"}`}/>
                </div>
                <p className={`text-2xl sm:text-3xl font-black ${online ? "text-emerald-300" : "text-red-300"}`}>{online ? "Online" : "Offline"}</p>
                <p className="text-[11px] text-white/30 mt-1 font-medium">Bot Status</p>
              </div>
            </div>

            {/* Live Feed */}
            <div className="rounded-2xl border border-white/[.06] overflow-hidden"
              style={{ background: "rgba(10,10,20,.85)", backdropFilter: "blur(16px)" }}>

              <div className="px-5 py-3.5 border-b border-white/[.05] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-1 h-5 rounded-full" style={{ background: "linear-gradient(to bottom,#a78bfa,#818cf8)" }}/>
                  <h2 className="text-sm font-bold text-white/85">Live Feed</h2>
                  {totalSms > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[.04] border border-white/[.07] text-white/30 font-mono">
                      {totalSms} total
                    </span>
                  )}
                  {smsPages > 1 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-400/20 text-violet-400 font-mono">
                      {smsPage}/{smsPages}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={fetchSms} disabled={smsLoading}
                    className="w-7 h-7 rounded-lg flex items-center justify-center border border-white/[.08] text-white/30 hover:text-white/70 hover:border-white/20 transition-all">
                    <RefreshCw size={13} className={smsLoading ? "animate-spin" : ""}/>
                  </button>
                  <div className="flex p-1 gap-0.5 rounded-xl border border-white/[.06]" style={{ background: "rgba(255,255,255,.02)" }}>
                    {(["all","otp","sms"] as const).map(f => (
                      <button key={f} onClick={() => setSmsFilter(f)}
                        className={`text-[11px] font-bold px-3 py-1 rounded-lg transition-all ${
                          smsFilter === f ? "text-white bg-violet-500/20 shadow-sm" : "text-white/25 hover:text-white/50"}`}>
                        {f === "all" ? "All" : f === "otp" ? "⚡ OTP" : "📨 SMS"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {smsLoading ? (
                <div className="flex items-center justify-center gap-3 py-24 text-white/20">
                  <div className="w-5 h-5 rounded-full border-2 border-violet-500/30 border-t-violet-400 animate-spin"/>
                  <span className="text-sm">Connecting…</span>
                </div>
              ) : paged.length === 0 ? (
                <div className="py-24 text-center text-white/20 text-sm">No messages yet</div>
              ) : (
                <div>
                  {paged.map((row, i) => {
                    const otp = row.isOtp ? extractOtp(row.body) : null;
                    const isNew = newIdx.has(i) && smsPage === 1;
                    return (
                      <div key={`${smsFrom + i}`}
                        className={`group relative px-5 py-4 border-b border-white/[.035] last:border-none transition-colors ${
                          isNew ? "bg-violet-500/[.05]" : row.isOtp ? "hover:bg-violet-500/[.025]" : "hover:bg-white/[.012]"}`}>
                        <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-r transition-all ${
                          isNew ? "opacity-100" : row.isOtp ? "opacity-30 group-hover:opacity-70" : "opacity-0"}`}
                          style={{ background: "linear-gradient(#a78bfa,#818cf8)" }}/>

                        {/* Top row */}
                        <div className="flex items-center gap-2 mb-2.5">
                          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md shrink-0 ${
                            row.isOtp ? "bg-violet-500/20 text-violet-300 border border-violet-400/20"
                                      : "bg-blue-500/15 text-blue-300 border border-blue-400/15"}`}>
                            {row.isOtp ? "OTP" : "SMS"}
                          </span>
                          <span className="text-[15px] leading-none shrink-0">{flag(row.phone)}</span>
                          <span className="text-[11px] font-bold font-mono text-white/75 px-2 py-0.5 rounded-md bg-white/[.04] border border-white/[.07] flex-1 truncate">
                            {row.phone}
                          </span>
                          <div className="ml-auto flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] font-mono text-white/55 px-2 py-0.5 rounded-md bg-white/[.04] border border-white/[.07]">
                              {clockStr(row.timestamp)}
                            </span>
                            <span className="text-[10px] font-medium text-slate-400/80 px-2 py-0.5 rounded-md bg-white/[.03] border border-white/[.06]">
                              {timeAgo(row.timestamp)}
                            </span>
                          </div>
                        </div>

                        {otp && <div className="mb-3"><OtpCode otp={otp}/></div>}

                        <p className="text-[12px] text-slate-300 leading-relaxed mb-3 line-clamp-2">{row.body}</p>

                        {/* Meta chips */}
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-[10px] text-white/50 px-2 py-0.5 rounded-md bg-white/[.04] border border-white/[.07] font-medium">
                            <IconGrid className="w-3 h-3 shrink-0"/> {row.sim}
                          </span>
                          {row.device && row.device !== "0" && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-sky-300/70 px-2 py-0.5 rounded-md bg-sky-500/[.07] border border-sky-400/[.12] font-medium">
                              <IconPhone className="w-3 h-3 shrink-0"/> {row.device}
                            </span>
                          )}
                          {row.plan && row.plan !== "0" && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/70 px-2 py-0.5 rounded-md bg-emerald-500/[.07] border border-emerald-500/[.12] font-medium">
                              <IconCreditCard className="w-3 h-3 shrink-0"/> {row.plan}
                            </span>
                          )}
                          <div className="ml-auto flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200">
                            {otp && <CopyPill label="OTP" value={otp} primary/>}
                            <CopyPill label="Number" value={stripCountryCode(row.phone)}/>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {smsPages > 1 && (
                    <div className="px-5 pb-4">
                      <Pagination page={smsPage} total={smsPages} onChange={setSmsPage}
                        from={smsFrom} to={smsFrom + PER_PAGE} count={filtered.length}/>
                    </div>
                  )}
                </div>
              )}
            </div>

            <footer className="mt-2 pb-6 flex flex-col items-center gap-2">
              <div className="w-full h-px" style={{ background: "linear-gradient(to right,transparent,rgba(139,92,246,.18),transparent)" }}/>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[10px] text-white/25 font-medium tracking-widest uppercase">Powered by</span>
                <span className="text-[11px] font-black tracking-wide"
                  style={{ background: "linear-gradient(90deg,#a78bfa,#818cf8,#38bdf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  Shadow Logic
                </span>
                <span className="text-[11px]">🚀</span>
                <span className="text-[9px] text-white/40 font-mono border border-white/15 px-1.5 py-0.5 rounded-md">
                  © {new Date().getFullYear()}
                </span>
              </div>
            </footer>
          </motion.div>
        )}

        {/* ══ NUMBERS TAB ══ */}
        {tab === "numbers" && (
          <motion.div key="nums" className="main-content"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .2 }}>

            {/* Stat Cards */}
            <div className="stats-grid">
              <StatCard icon={<IconPhoneList className="w-5 h-5 text-indigo-300"/>} label="Total Numbers" value={numTotal} color="blue"/>
              <StatCard icon={<IconGlobe className="w-5 h-5 text-violet-300"/>} label="Ranges" value={ranges} color="violet"/>
              <div className="stat-card glass-card p-3 sm:p-4">
                <div className="stat-icon mb-3" style={{ background: online ? "rgba(16,185,129,.12)" : "rgba(239,68,68,.1)" }}>
                  <IconSignal className={`w-5 h-5 ${online ? "text-emerald-400" : "text-red-400"}`}/>
                </div>
                <p className={`text-2xl font-black ${online ? "text-emerald-400" : "text-red-400"}`}>{online ? "Online" : "Offline"}</p>
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-1 font-medium">Bot Status</p>
              </div>
            </div>

            {/* Numbers Panel */}
            <div className="glass-card p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="violet-bar"/>
                  <div>
                    <h2 className="text-base font-bold text-white">Phone Numbers</h2>
                    <p className="text-[10px] text-slate-500">{filtNums.length} shown · {numTotal} total</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {numPages > 1 && <span className="page-indicator">{numPage}/{numPages}</span>}
                  <button onClick={fetchNums} disabled={numLoading}
                    className="w-7 h-7 rounded-lg flex items-center justify-center border border-white/[.08] text-white/30 hover:text-white/70 hover:border-white/20 transition-all">
                    <RefreshCw size={12} className={numLoading ? "animate-spin" : ""}/>
                  </button>
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="filter-tabs mb-3">
                {([
                  { k: "all",          label: "All",          color: "#94a3b8", emoji: "📋" },
                  { k: "registered",   label: "Registered",   color: "#10b981", emoji: "✅" },
                  { k: "unregistered", label: "Unregistered", color: "#f43f5e", emoji: "❌" },
                  { k: "not_tried",    label: "Not Tried",    color: "#64748b", emoji: "⏳" },
                  { k: "already_other",label: "Already Other",color: "#a855f7", emoji: "🔄" },
                ] as const).map(f => (
                  <button key={f.k} onClick={() => setNumFilter(f.k)}
                    className={`filter-tab ${numFilter === f.k ? "active" : ""}`}
                    style={{ "--tab-color": f.color } as React.CSSProperties}>
                    <span>{f.emoji}</span>
                    <span className="hidden sm:inline">{f.label}</span>
                    <span className="filter-count">{numCounts[f.k as keyof typeof numCounts] || 0}</span>
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="search-wrapper mb-3">
                <Search className="search-icon" size={14}/>
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search by number or provider…" className="search-input"/>
              </div>

              {/* List */}
              <div className="space-y-0.5">
                {numLoading && nums.length === 0 ? (
                  <div className="flex flex-col items-center py-12 gap-3">
                    <div className="spinner"/>
                    <p className="text-xs text-slate-500 font-mono">Loading…</p>
                  </div>
                ) : pagedNums.length === 0 ? (
                  <div className="empty-state py-10">
                    <PhoneOff className="w-10 h-10 text-slate-600 mb-3"/>
                    <p className="text-sm text-slate-500">No numbers found</p>
                  </div>
                ) : (
                  <AnimatePresence>
                    {pagedNums.map((item, i) => (
                      <NumRow key={item.phone} item={item} idx={numFrom + i + 1}
                        isNew={newNums.has(item.phone)} onStatus={onStatus}/>
                    ))}
                  </AnimatePresence>
                )}
              </div>

              {numPages > 1 && (
                <Pagination page={numPage} total={numPages} onChange={setNumPage}
                  from={numFrom} to={numFrom + PER_PAGE} count={filtNums.length}/>
              )}
            </div>

            <footer className="mt-2 pb-6 flex flex-col items-center gap-2">
              <div className="w-full h-px" style={{ background: "linear-gradient(to right,transparent,rgba(139,92,246,.18),transparent)" }}/>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[10px] text-white/25 font-medium tracking-widest uppercase">Powered by</span>
                <span className="text-[11px] font-black tracking-wide"
                  style={{ background: "linear-gradient(90deg,#a78bfa,#818cf8,#38bdf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  Shadow Logic
                </span>
                <span className="text-[11px]">🚀</span>
                <span className="text-[9px] text-white/40 font-mono border border-white/15 px-1.5 py-0.5 rounded-md">
                  © {new Date().getFullYear()}
                </span>
              </div>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}
