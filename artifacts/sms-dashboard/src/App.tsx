import { useEffect, useRef, useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SmsRow {
  timestamp: string;
  sim: string;
  phone: string;
  device: string;
  plan: string;
  body: string;
  isOtp: boolean;
}

interface Stats {
  totalRecords: string;
  totalDisplayed: string;
  otpCount: number;
  recent: SmsRow[];
  lastUpdated: string;
}

function useStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);
  const fetchStats = async () => {
    try {
      const res = await fetch(`${BASE}/api/sms-stats`);
      if (!res.ok) throw new Error("fail");
      setStats(await res.json());
      setError(false);
    } catch {
      setError(true);
    }
  };
  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, 5000);
    return () => clearInterval(id);
  }, []);
  return { stats, error };
}

function useCountUp(target: number, duration = 800) {
  const [val, setVal] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    if (target === prev.current) return;
    const start = prev.current;
    const diff = target - start;
    const steps = 30;
    const stepMs = duration / steps;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setVal(Math.round(start + (diff * i) / steps));
      if (i >= steps) { clearInterval(timer); prev.current = target; }
    }, stepMs);
    return () => clearInterval(timer);
  }, [target, duration]);
  return val;
}

function extractOtp(text: string): string | null {
  const patterns = [
    /(?:OTP|otp|code|رمز|کد|verification|verify|confirm|auth|pin|passcode|пароль|код|senha)[^0-9]*(\d{4,8})/i,
    /(\d{4,8})[^0-9]*(?:OTP|otp|code|verify|confirm|пароль|код)/i,
    /(?:is|:|-|=)\s*(\d{6})\b/,
    /(?<!\d)(\d{6})(?!\d)/,
    /(?<!\d)(\d{4})(?!\d)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

// Parse API timestamp safely (handles both space and T separator)
function parseTs(ts: string): Date {
  return new Date(ts.replace(" ", "T"));
}

// "11:08 AM" — just the time portion
function formatClock(ts: string): string {
  const d = parseTs(ts);
  if (isNaN(d.getTime())) return ts.substring(11, 16);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

// "Apr 2" — just the date portion (short)
function formatDate(ts: string): string {
  const d = parseTs(ts);
  if (isNaN(d.getTime())) return ts.substring(0, 10);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// "2m ago" / "just now"
function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - parseTs(ts).getTime()) / 1000);
  if (diff < 30) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Hook: re-render every 30s so relative times stay fresh
function useNow() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);
}

function OtpBadge({ otp }: { otp: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(otp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} title="Tap to copy OTP"
      className="inline-flex items-center gap-3 mb-2.5 px-3.5 py-2 rounded-xl border transition-all duration-200 cursor-pointer active:scale-95"
      style={copied
        ? { background: "linear-gradient(135deg, rgba(52,211,153,0.15), rgba(16,185,129,0.08))", borderColor: "rgba(52,211,153,0.3)", boxShadow: "0 0 20px rgba(52,211,153,0.12)" }
        : { background: "linear-gradient(135deg, rgba(139,92,246,0.12), rgba(99,102,241,0.06))", borderColor: "rgba(139,92,246,0.2)", boxShadow: "0 0 20px rgba(139,92,246,0.08)" }
      }>
      {copied ? (
        <>
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-400/70">Copied</span>
          <svg className="w-4 h-4 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
        </>
      ) : (
        <>
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-violet-400/60">OTP</span>
          <span className="text-xl font-bold tracking-[0.25em] font-mono text-violet-200">{otp}</span>
          <svg className="w-3.5 h-3.5 text-violet-400/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
          </svg>
        </>
      )}
    </button>
  );
}

function CopyBtn({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  const [state, setState] = useState<"idle" | "copied">("idle");
  const copy = () => {
    navigator.clipboard.writeText(value);
    setState("copied");
    setTimeout(() => setState("idle"), 2000);
  };
  return (
    <button onClick={copy} className={`group/btn relative flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-all duration-300 overflow-hidden ${
      state === "copied"
        ? "bg-emerald-500/20 border-emerald-400/30 text-emerald-300"
        : accent
          ? "bg-violet-500/15 border-violet-400/25 text-violet-300 hover:bg-violet-500/25 hover:border-violet-400/40"
          : "bg-white/[0.06] border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80 hover:border-white/20"
    }`}>
      {state === "copied" ? (
        <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>Copied!</>
      ) : (
        <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>{label}</>
      )}
    </button>
  );
}

function StatCard({ label, value, icon, gradient, iconColor, textColor }: {
  label: string; value: string; icon: React.ReactNode;
  gradient: string; iconColor: string; textColor: string;
}) {
  const num = parseInt(value.replace(/\D/g, "")) || 0;
  const animated = useCountUp(num);
  const display = isNaN(parseInt(value)) ? value : animated.toString();
  return (
    <div className={`relative rounded-2xl border overflow-hidden p-5 ${gradient}`}>
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none" />
      <div className={`inline-flex p-2 rounded-xl ${iconColor} mb-4`}>{icon}</div>
      <div className={`text-3xl font-bold tracking-tight tabular-nums ${textColor}`}>{display}</div>
      <div className="text-xs text-white/30 mt-1 font-medium">{label}</div>
    </div>
  );
}

export default function App() {
  useNow(); // keeps relative timestamps fresh
  const { stats, error } = useStats();
  const [filter, setFilter] = useState<"all" | "otp" | "sms">("all");
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const prevLen = useRef(0);

  useEffect(() => {
    const len = stats?.recent.length ?? 0;
    if (len > prevLen.current && prevLen.current > 0) {
      setNewIds(new Set([0]));
      setTimeout(() => setNewIds(new Set()), 3000);
    }
    prevLen.current = len;
  }, [stats?.recent.length]);

  const filtered = (stats?.recent ?? []).filter((r) =>
    filter === "all" ? true : filter === "otp" ? r.isOtp : !r.isOtp
  );

  return (
    <div className="min-h-screen text-white relative overflow-hidden" style={{ background: "#060610", fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Background glow orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/10 rounded-full blur-[120px]" />
        <div className="absolute top-1/3 -right-40 w-80 h-80 bg-blue-600/8 rounded-full blur-[100px]" />
        <div className="absolute -bottom-20 left-1/3 w-72 h-72 bg-indigo-600/8 rounded-full blur-[100px]" />
        {/* Subtle grid */}
        <div className="absolute inset-0 opacity-[0.025]" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)`,
          backgroundSize: "40px 40px"
        }} />
      </div>

      {/* ── Navbar ── */}
      <nav className="relative z-20 border-b border-white/[0.05]" style={{ background: "rgba(6,6,16,0.8)", backdropFilter: "blur(20px)" }}>
        <div className="max-w-4xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <div className="relative">
              <div className="absolute inset-0 rounded-xl bg-violet-500/30 blur-md" />
              <div className="relative w-9 h-9 rounded-xl flex items-center justify-center border border-violet-400/20"
                style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.5), rgba(99,102,241,0.5))" }}>
                <svg className="w-4.5 h-4.5 text-violet-200" style={{width:18,height:18}} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"/>
                </svg>
              </div>
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-white">SMS Monitor</div>
              <div className="text-[9px] tracking-[0.2em] uppercase font-medium" style={{ color: "rgba(139,92,246,0.7)" }}>Zone SMS</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {stats && (
              <span className="text-[10px] text-white/20 hidden sm:block">
                updated {timeAgo(stats.lastUpdated)}
              </span>
            )}
            <div className={`flex items-center gap-2 text-[11px] font-semibold px-3 py-1.5 rounded-full border ${
              error
                ? "border-red-500/25 text-red-400" : "border-emerald-500/25 text-emerald-400"
            }`} style={{ background: error ? "rgba(239,68,68,0.08)" : "rgba(52,211,153,0.08)" }}>
              <span className={`w-1.5 h-1.5 rounded-full ${error ? "bg-red-400" : "bg-emerald-400"}`}
                style={error ? {} : { animation: "pulse 2s infinite", boxShadow: "0 0 6px rgba(52,211,153,0.8)" }} />
              {error ? "Offline" : "Live"}
            </div>
          </div>
        </div>
      </nav>

      <main className="relative z-10 max-w-4xl mx-auto px-5 py-8 space-y-5">

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Total SMS"
            value={stats?.totalRecords ?? "—"}
            icon={<svg style={{width:16,height:16}} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/></svg>}
            gradient="bg-gradient-to-br from-blue-500/[0.07] to-transparent border-blue-500/[0.1]"
            iconColor="bg-blue-500/15 text-blue-400"
            textColor="text-blue-300"
          />
          <StatCard
            label="OTPs Detected"
            value={stats?.otpCount != null ? String(stats.otpCount) : "—"}
            icon={<svg style={{width:16,height:16}} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"/></svg>}
            gradient="bg-gradient-to-br from-violet-500/[0.09] to-transparent border-violet-500/[0.12]"
            iconColor="bg-violet-500/15 text-violet-400"
            textColor="text-violet-300"
          />
          <StatCard
            label="Bot Status"
            value={error ? "Offline" : "Online"}
            icon={<svg style={{width:16,height:16}} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728M8.464 15.536a5 5 0 010-7.072m7.072 0a5 5 0 010 7.072M12 12h.01"/></svg>}
            gradient={error ? "bg-gradient-to-br from-red-500/[0.07] to-transparent border-red-500/[0.1]" : "bg-gradient-to-br from-emerald-500/[0.07] to-transparent border-emerald-500/[0.1]"}
            iconColor={error ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"}
            textColor={error ? "text-red-300" : "text-emerald-300"}
          />
        </div>

        {/* ── Message Feed ── */}
        <div className="rounded-2xl border border-white/[0.06] overflow-hidden" style={{ background: "rgba(12,12,22,0.8)", backdropFilter: "blur(12px)" }}>

          {/* Header */}
          <div className="px-5 py-3.5 border-b border-white/[0.05] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-1.5 h-5 rounded-full bg-gradient-to-b from-violet-400 to-indigo-500" />
              <h2 className="text-sm font-semibold text-white/80">Messages</h2>
              {stats && (
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/[0.08] text-white/25" style={{ background: "rgba(255,255,255,0.03)" }}>
                  {stats.totalRecords} total
                </span>
              )}
            </div>
            {/* Filters */}
            <div className="flex items-center gap-1 p-1 rounded-xl border border-white/[0.06]" style={{ background: "rgba(255,255,255,0.03)" }}>
              {(["all", "otp", "sms"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-[11px] font-semibold px-3 py-1 rounded-lg transition-all duration-200 ${
                    filter === f ? "text-white" : "text-white/25 hover:text-white/50"
                  }`}
                  style={filter === f ? { background: "rgba(139,92,246,0.2)", boxShadow: "0 0 12px rgba(139,92,246,0.15)" } : {}}>
                  {f === "all" ? "All" : f === "otp" ? "⚡ OTP" : "📨 SMS"}
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          {!stats ? (
            <div className="flex items-center justify-center gap-2.5 py-20 text-white/20 text-sm">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Connecting...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-white/20 text-sm">No messages</div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {filtered.map((row, i) => {
                const otp = row.isOtp ? extractOtp(row.body) : null;
                const isNew = newIds.has(i);
                return (
                  <div key={i} className={`group relative px-5 py-4 transition-all duration-500 ${
                    isNew ? "bg-violet-500/[0.06]" : "hover:bg-white/[0.02]"
                  }`}>
                    {isNew && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-violet-400 rounded-r" />}
                    <div className="flex items-start gap-3.5">

                      {/* Type icon */}
                      <div className={`mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                        row.isOtp
                          ? "border-violet-500/20 text-violet-400"
                          : "border-blue-500/15 text-blue-400"
                      }`} style={{
                        background: row.isOtp ? "rgba(139,92,246,0.1)" : "rgba(59,130,246,0.08)"
                      }}>
                        {row.isOtp ? (
                          <svg style={{width:15,height:15}} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"/>
                          </svg>
                        ) : (
                          <svg style={{width:15,height:15}} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/>
                          </svg>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-2">
                          <span className={`text-[10px] font-bold uppercase tracking-widest ${row.isOtp ? "text-violet-400" : "text-blue-400"}`}>
                            {row.isOtp ? "OTP" : "SMS"}
                          </span>
                          <span className="text-white/15">·</span>
                          <span className="text-xs font-mono font-semibold text-white/70">{row.phone}</span>
                          <span className="text-white/15">·</span>
                          <span className="text-[11px] text-white/40 font-medium tabular-nums">{formatClock(row.timestamp)}</span>
                          <span className="text-white/10">·</span>
                          <span className="text-[10px] text-white/20">{formatDate(row.timestamp)}</span>
                          <span className="text-white/10">·</span>
                          <span className="text-[10px] text-white/15">{timeAgo(row.timestamp)}</span>
                        </div>

                        {/* OTP code badge — tap to copy */}
                        {otp && <OtpBadge otp={otp} />}

                        <p className="text-[12px] text-white/35 leading-relaxed break-all line-clamp-2">{row.body}</p>
                        <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-white/15">
                          <span>{row.device}</span>
                          <span>·</span>
                          <span>{row.plan}</span>
                        </div>
                      </div>

                      {/* Copy actions — appear on hover */}
                      <div className="flex flex-col gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-1 group-hover:translate-x-0">
                        {otp && <CopyBtn label="Copy OTP" value={otp} accent />}
                        <CopyBtn label="Number" value={row.phone} />
                        <CopyBtn label="Message" value={row.body} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-white/10 pb-2 tracking-wide">
          Auto-refresh every 5s · SMS Monitor · Powered by Telegram
        </p>
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
