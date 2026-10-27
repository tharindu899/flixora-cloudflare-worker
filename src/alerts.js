/**
 * Backend health ping + Telegram alerts.
 * Alert state lives in the LogHub Durable Object; a cron trigger (wrangler.toml) runs the check every 5 min.
 * Secrets: TG_BOT_TOKEN, TG_CHAT_ID.  Optional vars: ALERT_ERRORS (default 5 errors / 10 min),
 * ALERT_MIN_HIT_PCT (default 0 = off; alerts when today's edge hit rate drops below it).
 */

const MIN = 60 * 1000;

export function alertConfig(env) {
  const n = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);
  return { errCount: Math.max(1, n(env.ALERT_ERRORS, 5)), minHit: Math.min(100, Math.max(0, n(env.ALERT_MIN_HIT_PCT, 0))) };
}

export const telegramReady = (env) => Boolean(env.TG_BOT_TOKEN && env.TG_CHAT_ID);

export async function sendTelegram(env, text) {
  if (!telegramReady(env)) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text, disable_web_page_preview: true }),
    });
    const ok = r.ok;
    try {
      await r.body?.cancel();
    } catch (_) {
      /* ignore */
    }
    return ok;
  } catch (_) {
    return false;
  }
}

/** Pings every allowed backend host (max 3). Any HTTP answer below 500 counts as "up". */
export async function pingBackends(env) {
  const hosts = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!hosts.length) return { up: false, ms: 0, host: "", code: 0, error: "ALLOWED_ORIGINS is empty", t: Date.now() };
  const results = await Promise.all(
    hosts.map(async (host) => {
      const t0 = Date.now();
      try {
        const r = await fetch(`https://${host}/`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000) });
        try {
          await r.body?.cancel();
        } catch (_) {
          /* ignore */
        }
        return { host, code: r.status, ms: Date.now() - t0, up: r.status < 500, error: r.status < 500 ? "" : `HTTP ${r.status}` };
      } catch (e) {
        return { host, code: 0, ms: Date.now() - t0, up: false, error: e && e.name === "TimeoutError" ? "timeout" : "unreachable" };
      }
    })
  );
  const bad = results.find((x) => !x.up);
  const worst = bad || results.reduce((a, b) => (b.ms > a.ms ? b : a));
  return { up: !bad, ms: worst.ms, host: worst.host, code: worst.code, error: bad ? bad.error : "", t: Date.now(), hosts: results.length };
}

export const freshAlertState = () => ({ down: false, fails: 0, downSince: 0, lastErr: 0, lastHit: 0 });

const fmtB = (n) => {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
};

/** Pure: (state, inputs) -> { state, messages } */
export function evaluate(prev, { ping, now, errTimes = [], today = null, cfg }) {
  const s = { ...freshAlertState(), ...prev };
  const messages = [];

  if (ping) {
    if (ping.up) {
      if (s.down) messages.push(`✅ Flixora backend is back up (${ping.host}, ${ping.ms} ms). Down for ${Math.max(1, Math.round((now - s.downSince) / MIN))} min.`);
      s.down = false;
      s.fails = 0;
    } else {
      s.fails++;
      if (s.fails >= 2 && !s.down) {
        s.down = true;
        s.downSince = now;
        messages.push(`🔴 Flixora backend is DOWN: ${ping.host} (${ping.error || "no answer"}).`);
      }
    }
  }

  const recent = errTimes.filter((t) => now - t <= 10 * MIN).length;
  if (recent >= cfg.errCount && now - s.lastErr > 30 * MIN) {
    s.lastErr = now;
    messages.push(`⚠️ ${recent} failed streams/downloads in the last 10 minutes. Check the Live log.`);
  }

  if (cfg.minHit > 0 && today) {
    const chunks = (today.h || 0) + (today.m || 0);
    const pct = chunks ? Math.round(((today.h || 0) * 100) / chunks) : 100;
    if (chunks >= 300 && pct < cfg.minHit && now - s.lastHit > 6 * 60 * MIN) {
      s.lastHit = now;
      messages.push(`📉 Edge cache hit rate today is ${pct}% (limit ${cfg.minHit}%). ${fmtB(today.mb || 0)} came from the VPS.`);
    }
  }
  return { state: s, messages };
}
