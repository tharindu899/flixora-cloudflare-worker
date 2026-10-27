/**
 * Activity log for the Flixora proxy: who is playing / downloading what, how much and how fast.
 *
 * - LogHub  : Durable Object (SQLite backed -> works on the Free plan) that keeps the last entries.
 * - Fallback: when the LOGS binding is missing the same logic runs on a per-isolate memory buffer.
 * Entries are *sessions* (same file + same kind + same client); every Range request of a player
 * is merged into one entry so a movie shows up once, not 60 times.
 */

export const MAX_ENTRIES = 60;
const SESSION_GAP = 10 * 60 * 1000; // a new session starts after 10 min of silence
const LOST_AFTER = 20 * 60 * 1000; // "active" for this long without any event -> lost

export const memEntries = [];

export function uaLabel(ua) {
  ua = String(ua || "");
  const app = /(VLC|MX ?Player|ExoPlayer|Lavf|libmpv|mpv|Kodi|Infuse|okhttp|Dalvik|curl|Wget|python-requests|IDM|ADM)/i.exec(ua);
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iOS/i.test(ua)
    ? "iOS"
    : /Windows/i.test(ua)
    ? "Windows"
    : /Mac OS X|Macintosh/i.test(ua)
    ? "macOS"
    : /Linux/i.test(ua)
    ? "Linux"
    : "";
  const br = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
    ? "Opera"
    : /Firefox\//.test(ua)
    ? "Firefox"
    : /(Chrome|CriOS)\//.test(ua)
    ? "Chrome"
    : /Safari\//.test(ua)
    ? "Safari"
    : "";
  const who = app ? app[1] : br;
  return who && os ? `${who} on ${os}` : who || os || "unknown";
}

/**
 * ev: { sid, rid, type: "start"|"progress"|"end", state?, err?, sent?, ms?, h?, m?, bps?,
 *       name?, kind?, total?, range?, country?, dev?, client? }
 * Mutates `entries` (newest first) in place.
 */
export function applyEvent(entries, ev, now) {
  if (!ev || !ev.sid || !ev.rid) return;
  let e = entries.find((x) => x.sid === ev.sid && (x.live[ev.rid] || now - x.upd < SESSION_GAP));
  if (!e) {
    if (ev.type !== "start") return; // late event of a trimmed session
    e = {
      sid: ev.sid,
      name: String(ev.name || "?").slice(0, 160),
      kind: ev.kind === "download" ? "download" : "play",
      total: 0,
      country: String(ev.country || "").slice(0, 3),
      dev: String(ev.dev || "").slice(0, 40),
      client: String(ev.client || "").slice(0, 12),
      t0: now,
      upd: now,
      reqs: 0,
      done: 0,
      busy: 0,
      h: 0,
      m: 0,
      bps: 0,
      peak: 0,
      range: "",
      err: "",
      state: "active",
      live: {},
    };
    entries.unshift(e);
  }
  e.upd = now;
  if (Number(ev.total) > 0) e.total = Number(ev.total);

  if (ev.type === "start") {
    e.reqs++;
    e.range = String(ev.range || "");
    e.live[ev.rid] = { sent: 0, ms: 0, h: 0, m: 0 };
    e.state = "active";
  } else {
    const sent = Math.max(0, Number(ev.sent) || 0);
    const ms = Math.max(0, Number(ev.ms) || 0);
    const h = Math.max(0, Number(ev.h) || 0);
    const m = Math.max(0, Number(ev.m) || 0);
    if (ev.type === "end") {
      delete e.live[ev.rid];
      e.done += sent;
      e.busy += ms;
      e.h += h;
      e.m += m;
      e.state = Object.keys(e.live).length ? "active" : ev.state || "done";
      if (ev.err) e.err = String(ev.err).slice(0, 120);
    } else {
      e.live[ev.rid] = { sent, ms, h, m };
      e.state = "active";
    }
    const bps = Number(ev.bps) || 0;
    if (bps > 0) {
      e.bps = bps;
      if (bps > e.peak) e.peak = bps;
    }
  }

  // newest activity first, bounded
  const i = entries.indexOf(e);
  if (i > 0) {
    entries.splice(i, 1);
    entries.unshift(e);
  }
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
}

/** Plain, UI-ready copy of the entries (live requests folded into the totals). */
export function snapshot(entries, now) {
  return entries.map((e) => {
    let sent = e.done, ms = e.busy, h = e.h, m = e.m;
    for (const l of Object.values(e.live)) {
      sent += l.sent;
      ms += l.ms;
      h += l.h;
      m += l.m;
    }
    const active = Object.keys(e.live).length > 0;
    return {
      name: e.name,
      kind: e.kind,
      state: active && now - e.upd > LOST_AFTER ? "lost" : e.state,
      total: e.total,
      sent,
      busy_ms: ms,
      avg: ms > 0 ? Math.round((sent * 1000) / ms) : 0,
      bps: active ? e.bps : 0,
      peak: e.peak,
      reqs: e.reqs,
      hit: h,
      miss: m,
      t0: e.t0,
      upd: e.upd,
      country: e.country,
      dev: e.dev,
      client: e.client,
      range: e.range,
      err: e.err,
    };
  });
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Durable Object: one instance ("main") holds the log. */
export class LogHub {
  constructor(state) {
    this.state = state;
    this.entries = [];
    state.blockConcurrencyWhile(async () => {
      this.entries = (await state.storage.get("entries")) || [];
    });
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/event") {
      let ev;
      try {
        ev = await request.json();
      } catch (_) {
        return json({ error: "bad json" }, 400);
      }
      applyEvent(this.entries, ev, Date.now());
      await this.state.storage.put("entries", this.entries);
      return json({ ok: true });
    }
    if (path === "/list") return json({ entries: snapshot(this.entries, Date.now()) });
    if (request.method === "POST" && path === "/clear") {
      this.entries = [];
      await this.state.storage.put("entries", this.entries);
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }
}
