/**
 * Activity log for the Flixora proxy: who is playing / downloading what, how much and how fast.
 *
 * - LogHub  : Durable Object (SQLite backed -> works on the Free plan) that keeps the last entries.
 * - Fallback: when the LOGS binding is missing the same logic runs on a per-isolate memory buffer.
 * Entries are *sessions* (same file + same kind + same client); every Range request of a player
 * is merged into one entry so a movie shows up once, not 60 times.
 */

import { evaluate, sendTelegram } from "./alerts.js";
import { lockStatus, lockFail, lockClear } from "./auth.js";

/** Cloudflare Free plan limits (developers.cloudflare.com). Daily limits reset at 00:00 UTC. */
export const FREE = {
  workerRequestsDay: 100000,
  burstPerMinute: 1000,
  cpuMs: 10,
  subrequests: 50,
  doRequestsDay: 100000,
  doRowsWrittenDay: 100000,
  doRowsReadDay: 5000000,
  doStorageGB: 5,
  memoryMB: 128,
  scriptMB: 3,
};

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
      hb: 0,
      mb: 0,
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
    e.live[ev.rid] = { sent: 0, ms: 0, h: 0, m: 0, hb: 0, mb: 0, t: now };
    e.state = "active";
  } else {
    const sent = Math.max(0, Number(ev.sent) || 0);
    const ms = Math.max(0, Number(ev.ms) || 0);
    const h = Math.max(0, Number(ev.h) || 0);
    const m = Math.max(0, Number(ev.m) || 0);
    const hb = Math.max(0, Number(ev.hb) || 0);
    const mb = Math.max(0, Number(ev.mb) || 0);
    if (ev.type === "end") {
      delete e.live[ev.rid];
      e.done += sent;
      e.busy += ms;
      e.h += h;
      e.m += m;
      e.hb = (e.hb || 0) + hb;
      e.mb = (e.mb || 0) + mb;
      e.state = Object.keys(e.live).length ? "active" : ev.state || "done";
      if (ev.err) e.err = String(ev.err).slice(0, 120);
    } else {
      e.live[ev.rid] = { sent, ms, h, m, hb, mb, t: now };
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
    let sent = e.done, ms = e.busy, h = e.h, m = e.m, hb = e.hb || 0, mb = e.mb || 0;
    for (const l of Object.values(e.live)) {
      sent += l.sent;
      ms += l.ms;
      h += l.h;
      m += l.m;
      hb += l.hb || 0;
      mb += l.mb || 0;
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
      hit_bytes: hb,
      miss_bytes: mb,
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

// ---------------------------------------------------------------- daily stats (kept 31 days)

export const MAX_DAYS = 31;
const MAX_FILES_PER_DAY = 25;
export const memDays = {};
export const memErrs = [];

export function dayKey(now, offsetMin = 330) {
  return new Date(now + offsetMin * 60000).toISOString().slice(0, 10);
}

/** Adds one finished request ("end" event) to today's bucket. Mutates `days`. */
export function addDaily(days, ev, now, offsetMin = 330) {
  if (!ev || ev.type !== "end") return;
  const k = dayKey(now, offsetMin);
  const d = (days[k] ||= { r: 0, b: 0, hb: 0, mb: 0, h: 0, m: 0, e: 0, x: 0, f: {} });
  const sent = Math.max(0, Number(ev.sent) || 0);
  d.r++;
  d.b += sent;
  d.hb += Math.max(0, Number(ev.hb) || 0);
  d.mb += Math.max(0, Number(ev.mb) || 0);
  d.h += Math.max(0, Number(ev.h) || 0);
  d.m += Math.max(0, Number(ev.m) || 0);
  if (ev.state === "error") d.e++;
  const name = String(ev.name || "?").slice(0, 100);
  const f = (d.f[name] ||= [0, 0]);
  f[0] += sent;
  f[1]++;
  const names = Object.keys(d.f);
  if (names.length > MAX_FILES_PER_DAY + 10) {
    names
      .sort((a, b) => d.f[b][0] - d.f[a][0])
      .slice(MAX_FILES_PER_DAY)
      .forEach((n) => delete d.f[n]);
  }
  const keys = Object.keys(days).sort();
  while (keys.length > MAX_DAYS) delete days[keys.shift()];
}

/** A request refused by the per-client limits. */
export function addDenied(days, now, offsetMin = 330) {
  const k = dayKey(now, offsetMin);
  const d = (days[k] ||= { r: 0, b: 0, hb: 0, mb: 0, h: 0, m: 0, e: 0, x: 0, f: {} });
  d.x = (d.x || 0) + 1;
}

// ---------------------------------------------------------------- per-client limits + heavy users

const FRESH_LIVE = 8 * 60 * 1000; // a request that has been silent this long is treated as dead
export const memUsage = {};

/** Live requests / distinct files of one client (client = the 6 hex chars at the end of the session id). */
export function clientActivity(entries, client, now, sid) {
  let reqs = 0;
  let files = 0;
  let sidActive = false;
  for (const e of entries) {
    if (e.client !== client) continue;
    const live = Object.values(e.live).filter((l) => now - (l.t || e.upd) < FRESH_LIVE).length;
    if (!live) continue;
    reqs += live;
    files++;
    if (e.sid === sid) sidActive = true;
  }
  return { reqs, files, sidActive };
}

/** -> { ok } or { ok:false, reason } */
export function gateDecision(entries, { client, sid, maxReqs, maxFiles }, now) {
  const a = clientActivity(entries, client, now, sid);
  if (maxReqs > 0 && a.reqs >= maxReqs) return { ok: false, reason: `Too many parallel connections (limit ${maxReqs})` };
  if (maxFiles > 0 && !a.sidActive && a.files >= maxFiles) return { ok: false, reason: `Too many files at once (limit ${maxFiles})` };
  return { ok: true };
}

const HOUR = 3600 * 1000;

/** Adds one finished request to the client's rolling hour. -> alert text or "" */
export function noteUsage(usage, ev, now, limitBytes) {
  if (!ev || ev.type !== "end" || !ev.sid) return "";
  const client = String(ev.sid).split("|").pop();
  if (!client) return "";
  let u = usage[client];
  if (!u || now - u.t0 > HOUR) u = usage[client] = { b: 0, t0: now, alerted: u ? u.alerted : 0, name: "" };
  u.b += Math.max(0, Number(ev.sent) || 0);
  u.name = String(ev.name || u.name).slice(0, 100);
  for (const k of Object.keys(usage)) if (now - usage[k].t0 > 2 * HOUR) delete usage[k];
  const keys = Object.keys(usage);
  if (keys.length > 300) keys.sort((a, b) => usage[a].t0 - usage[b].t0).slice(0, keys.length - 300).forEach((k) => delete usage[k]);
  if (limitBytes > 0 && u.b >= limitBytes && now - u.alerted > 6 * HOUR) {
    u.alerted = now;
    return `🚨 Heavy client #${client} pulled ${(u.b / 1073741824).toFixed(1)} GB in the last hour (limit ${Math.round(limitBytes / 1073741824)} GB). Latest file: ${u.name || "?"}`;
  }
  return "";
}

export function heavyClients(usage, entries, now, top = 5) {
  return Object.entries(usage)
    .filter(([, u]) => now - u.t0 <= HOUR)
    .sort((a, b) => b[1].b - a[1].b)
    .slice(0, top)
    .map(([client, u]) => {
      const e = entries.find((x) => x.client === client);
      return { client, bytes: u.b, since: u.t0, name: u.name, country: e?.country || "", dev: e?.dev || "" };
    });
}

export const abuseLimitBytes = (env) => {
  const g = env?.ABUSE_GB_PER_HOUR === undefined || env?.ABUSE_GB_PER_HOUR === "" ? 30 : Number(env.ABUSE_GB_PER_HOUR);
  return Number.isFinite(g) && g > 0 ? g * 1073741824 : 0;
};

export function noteError(errs, ev, now) {
  if (ev && ev.type === "end" && ev.state === "error") {
    errs.push(now);
    if (errs.length > 50) errs.splice(0, errs.length - 50);
  }
}

/** UI-ready: oldest first, plus the key of "today". */
export function statsView(days, now, offsetMin = 330) {
  return {
    today: dayKey(now, offsetMin),
    days: Object.keys(days)
      .sort()
      .map((k) => ({ d: k, ...days[k] })),
  };
}

// ---------------------------------------------------------------- Cloudflare usage counters (UTC day, like Cloudflare's limits)

export const utcDay = (now) => new Date(now).toISOString().slice(0, 10);
export const memCf = { day: "", q: 0, dr: 0, dw: 0 };

/** Adds to today's counters (q = Worker requests, dr = Durable Object requests, dw = DO rows written). Mutates `u`. */
export function bumpCf(u, now, add) {
  const day = utcDay(now);
  if (u.day !== day) {
    u.day = day;
    u.q = u.dr = u.dw = 0;
  }
  u.q += Math.max(0, Math.floor(Number(add?.q) || 0));
  u.dr += Math.max(0, Math.floor(Number(add?.dr) || 0));
  u.dw += Math.max(0, Math.floor(Number(add?.dw) || 0));
}

/** Today's numbers (zeros when the stored day is already over). */
export function cfView(u, now) {
  const day = utcDay(now);
  return u && u.day === day ? { day, q: u.q, dr: u.dr, dw: u.dw } : { day, q: 0, dr: 0, dw: 0 };
}

/** Meters in the shape evaluate() wants. */
export function cfMeters(view, cfLimit) {
  return {
    day: view.day,
    meters: [
      { id: "req", label: "Worker requests", used: view.q, limit: cfLimit || FREE.workerRequestsDay },
      { id: "do", label: "Durable Object requests", used: view.dr, limit: FREE.doRequestsDay },
      { id: "rows", label: "Durable Object rows written (estimate)", used: view.dw, limit: FREE.doRowsWrittenDay },
    ],
  };
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Durable Object: one instance ("main") holds the log, the daily stats and the alert state. */
export class LogHub {
  constructor(state, env) {
    this.state = state;
    this.env = env || {}; // the worker's own vars (wrangler.toml)
    this.entries = [];
    this.days = {};
    this.errs = [];
    this.alert = null;
    this.locks = {};
    this.usage = {};
    this.cf = { day: "", q: 0, dr: 0, dw: 0 }; // Cloudflare usage of the current UTC day
    this.refreshEnv();
    state.blockConcurrencyWhile(async () => {
      this.entries = (await state.storage.get("entries")) || [];
      this.days = (await state.storage.get("days")) || {};
      this.errs = (await state.storage.get("errs")) || [];
      this.alert = (await state.storage.get("alert")) || null;
      this.locks = (await state.storage.get("locks")) || {};
      this.cf = (await state.storage.get("cf")) || this.cf;
      this.refreshEnv();
    });
  }

  refreshEnv() {
    const t = this.env.STATS_TZ_MIN;
    this.off = Number.isFinite(Number(t)) && t !== "" && t != null ? Number(t) : 330;
  }

  bump(add) {
    bumpCf(this.cf, Date.now(), add);
  }

  /** Every storage write is one SQLite row written on the Free plan (limit 100,000 / day) - count it. */
  put(key, value) {
    this.bump({ dw: 1 });
    return this.state.storage.put(key, value);
  }

  async fetch(request) {
    this.bump({ dr: 1 });
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/event") {
      let ev;
      try {
        ev = await request.json();
      } catch (_) {
        return json({ error: "bad json" }, 400);
      }
      const now = Date.now();
      applyEvent(this.entries, ev, now);
      await this.put("entries", this.entries);
      if (ev && ev.type === "end") {
        addDaily(this.days, ev, now, this.off);
        await this.put("days", this.days);
        const warn = noteUsage(this.usage, ev, now, abuseLimitBytes(this.env));
        if (warn) await sendTelegram(this.env, warn);
        if (ev.state === "error") {
          noteError(this.errs, ev, now);
          await this.put("errs", this.errs);
        }
      }
      return json({ ok: true });
    }
    if (path === "/list") return json({ entries: snapshot(this.entries, Date.now()) });
    if (path === "/stats") {
      const now = Date.now();
      return json({ ...statsView(this.days, now, this.off), heavy: heavyClients(this.usage, this.entries, now), abuse_gb: abuseLimitBytes(this.env) / 1073741824 });
    }
    if (request.method === "POST" && path === "/gate") {
      const body = await request.json().catch(() => ({}));
      const now = Date.now();
      const r = gateDecision(this.entries, body, now);
      if (!r.ok) {
        addDenied(this.days, now, this.off);
        await this.put("days", this.days);
      }
      return json(r);
    }
    if (request.method === "POST" && path === "/lock") {
      const body = await request.json().catch(() => ({}));
      const key = String(body.key || "");
      const now = Date.now();
      if (!key) return json({ error: "no key" }, 400);
      if (body.op === "check") return json(lockStatus(this.locks, key, now));
      if (body.op === "clear") {
        if (this.locks[key]) {
          lockClear(this.locks, key);
          await this.put("locks", this.locks);
        }
        return json({ ok: true });
      }
      const r = lockFail(this.locks, key, now);
      await this.put("locks", this.locks);
      return json(r);
    }
    if (request.method === "POST" && path === "/alerts") {
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return json({ error: "bad json" }, 400);
      }
      const now = Date.now();
      const r = evaluate(this.alert, {
        ping: body.ping,
        now,
        errTimes: this.errs,
        today: this.days[dayKey(now, this.off)] || null,
        cfg: body.cfg,
        cf: cfMeters(cfView(this.cf, now), body.cfg?.cfLimit),
      });
      this.alert = r.state;
      await this.put("alert", this.alert);
      return json({ messages: r.messages, state: r.state });
    }
    if (path === "/usage") return json(cfView(this.cf, Date.now()));
    if (request.method === "POST" && path === "/count") {
      const body = await request.json().catch(() => ({}));
      this.bump({ q: Math.min(100000, Number(body.n) || 0) });
      await this.put("cf", this.cf);
      return json({ ok: true });
    }
    if (request.method === "POST" && path === "/clear") {
      this.entries = [];
      await this.put("entries", this.entries);
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }
}
