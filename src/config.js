/**
 * Settings that can be edited from the web UI (Config page) and the Cloudflare Free plan limits.
 *
 * Edited values ("overrides") live in the LogHub Durable Object and win over the [vars] of wrangler.toml.
 * Only the keys listed in FIELDS can be edited - secrets (TURNSTILE_SECRET, UI_PASS, TG_*) never can.
 * All values are stored as strings, exactly like Worker vars, so the rest of the code does not care
 * where a value came from.
 */

// ---------------------------------------------------------------- Cloudflare Free plan limits
// Source: developers.cloudflare.com (Workers limits + pricing, Durable Objects pricing). All daily limits reset at 00:00 UTC.
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

// ---------------------------------------------------------------- editable fields
const G = { cache: "Edge cache", backend: "Backend", guard: "Protection", alerts: "Alerts", cf: "Cloudflare limits", stats: "Stats" };

export const FIELDS = [
  { key: "CHUNK_MB", group: G.cache, label: "Chunk size (MB)", type: "int", min: 1, max: 32, def: "4",
    hint: "Size of every cached piece. 4 is a good balance for the Free plan (128 MB memory).",
    warn: "Cached chunks are keyed by their size. After a change the existing edge cache is not used until it refills, so the VPS / Telegram get the traffic again." },
  { key: "MAX_CHUNKS", group: G.cache, label: "Max chunks per open request", type: "int", min: 1, max: 40, def: "12",
    hint: "An open-ended Range (bytes=N-) is answered with at most this many chunks; the player asks for the next part itself.",
    warn: "Each chunk costs about 3 subrequests and the Free plan allows 50 per request. Above about 12 the worker falls back to one plain origin stream." },
  { key: "CACHE_TTL", group: G.cache, label: "Cache lifetime (seconds)", type: "int", min: 60, max: 31536000, def: "604800",
    hint: "How long a chunk stays in the edge cache. 604800 = 7 days." },
  { key: "ENABLE_CACHE", group: G.cache, label: "Edge cache", type: "enum", options: ["auto", "true", "false"], def: "auto",
    hint: "auto = on for custom domains, off for *.workers.dev.",
    warn: "Forcing it on a *.workers.dev address does nothing useful (the Cache API only works on a custom domain)." },
  { key: "CAP_OPEN_RANGES", group: G.cache, label: "Cap open ranges", type: "bool", def: "true",
    hint: "Turn off only if your player does not ask again after a shorter 206 answer." },
  { key: "PREFETCH_NEXT", group: G.cache, label: "Prefetch next chunk", type: "bool", def: "true",
    hint: "Look up / fetch the next chunk while the current one streams." },

  { key: "ALLOWED_ORIGINS", group: G.backend, label: "Allowed backend hosts", type: "hosts", required: true, def: "",
    hint: "Host of your Flixora backend (same host as API_BASE_URL). Several hosts separated by commas.",
    warn: "A wrong host stops the proxy at once (403 Origin not allowed) and the backend health check fails. Double check the spelling." },
  { key: "BACKEND_USES_TURNSTILE", group: G.backend, label: "Backend uses Turnstile", type: "bool", def: "true",
    hint: "Keep on when the backend has TURNSTILE_SECRET set. The worker then verifies the download token itself.",
    warn: "Turn this off only if the backend really has Turnstile off. Otherwise cached downloads skip the verification gate." },
  { key: "ORIGIN_URL", group: G.backend, label: "Short mode origin", type: "url", def: "",
    hint: "Optional. Lets https://worker/dl/<id>/<name> map to this backend, e.g. https://api.example.com. Empty = off." },

  { key: "BLOCK_COUNTRIES", group: G.guard, label: "Blocked countries", type: "list", def: "",
    hint: "ISO codes separated by commas, e.g. CN,RU. Only proxy traffic is blocked, never the UI login.",
    warn: "Viewers from these countries get 403 right away. Make sure your own country and your viewers' countries are not in the list." },
  { key: "MAX_CLIENT_REQS", group: G.guard, label: "Parallel connections per client", type: "int", min: 0, max: 1000, def: "24",
    hint: "Answered with 429 above this. 0 = no limit. Many mobile users can share one IP (CGNAT), so keep it generous." },
  { key: "MAX_CLIENT_FILES", group: G.guard, label: "Files at once per client", type: "int", min: 0, max: 1000, def: "6",
    hint: "Different files one client may stream at the same time. 0 = no limit." },
  { key: "ABUSE_GB_PER_HOUR", group: G.guard, label: "Heavy client alert (GB / hour)", type: "num", min: 0, max: 100000, def: "30",
    hint: "One client pulling more than this in an hour sends a Telegram alert. 0 = off." },

  { key: "ALERT_ERRORS", group: G.alerts, label: "Failed streams alert", type: "int", min: 1, max: 1000, def: "5",
    hint: "This many failed streams / downloads within 10 minutes sends a Telegram alert." },
  { key: "ALERT_MIN_HIT_PCT", group: G.alerts, label: "Low cache hit rate alert (%)", type: "int", min: 0, max: 100, def: "0",
    hint: "Alert when today's edge hit rate drops below this percent. 0 = off." },

  { key: "CF_REQ_LIMIT", group: G.cf, label: "Worker requests per day", type: "int", min: 1000, max: 1000000000, def: String(FREE.workerRequestsDay),
    hint: "Used for the usage meter and the Telegram alert. 100000 is the Free plan limit; Cloudflare enforces its own limit either way.",
    warn: "This only changes the meter and the alert. It does not raise Cloudflare's real limit." },
  { key: "CF_WARN_PCT", group: G.cf, label: "Limit alert at (%)", type: "int", min: 0, max: 100, def: "80",
    hint: "Telegram alert when any Cloudflare Free limit reaches this percent of the day (a second alert at 95%). 0 = off." },

  { key: "STATS_TZ_MIN", group: G.stats, label: "Stats day boundary (minutes after UTC)", type: "int", min: -720, max: 840, def: "330",
    hint: "330 = Sri Lanka. The Cloudflare limits always reset at 00:00 UTC, whatever this is.",
    warn: "Moves the midnight of the daily stats, so today's bucket may split once." },
];

export const FIELD_MAP = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
export const GROUPS = [...new Set(FIELDS.map((f) => f.group))];

// ---------------------------------------------------------------- validation
const BOOL_TRUE = /^(1|true|yes|on)$/i;
const BOOL_FALSE = /^(0|false|no|off)$/i;
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/;

/** -> { ok:true, value } with the normalized string, or { ok:false, error } */
export function validateValue(field, raw) {
  const text = String(raw ?? "").trim();
  const bad = (error) => ({ ok: false, error });
  switch (field.type) {
    case "int": {
      if (!/^-?\d+$/.test(text)) return bad("Whole number needed");
      const n = Number(text);
      if (n < field.min || n > field.max) return bad(`Between ${field.min} and ${field.max}`);
      return { ok: true, value: String(n) };
    }
    case "num": {
      if (!/^\d+(\.\d+)?$/.test(text)) return bad("Number needed");
      const n = Number(text);
      if (n < field.min || n > field.max) return bad(`Between ${field.min} and ${field.max}`);
      return { ok: true, value: String(n) };
    }
    case "bool":
      if (BOOL_TRUE.test(text)) return { ok: true, value: "true" };
      if (BOOL_FALSE.test(text)) return { ok: true, value: "false" };
      return bad("Use on or off");
    case "enum": {
      const v = text.toLowerCase();
      return field.options.includes(v) ? { ok: true, value: v } : bad("One of: " + field.options.join(", "));
    }
    case "list": {
      const parts = [...new Set(text.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
      if (parts.length > 60) return bad("At most 60 countries");
      const wrong = parts.find((x) => !/^[A-Z]{2}$/.test(x));
      if (wrong) return bad(`"${wrong.slice(0, 12)}" is not a 2-letter country code`);
      return { ok: true, value: parts.join(",") };
    }
    case "hosts": {
      const parts = [
        ...new Set(
          text
            .split(/[\s,]+/)
            .map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, ""))
            .filter(Boolean)
        ),
      ];
      if (!parts.length) return bad("At least one host is needed");
      if (parts.length > 5) return bad("At most 5 hosts");
      const wrong = parts.find((x) => !HOST_RE.test(x) || x.length > 253);
      if (wrong) return bad(`"${wrong.slice(0, 40)}" is not a valid host (no paths, no spaces)`);
      return { ok: true, value: parts.join(",") };
    }
    case "url": {
      if (!text) return { ok: true, value: "" };
      let u;
      try {
        u = new URL(text);
      } catch (_) {
        return bad("Not a valid URL");
      }
      if (u.protocol !== "https:") return bad("Must start with https://");
      if (u.username || u.password) return bad("No user or password in the URL");
      return { ok: true, value: (u.origin + u.pathname).replace(/\/+$/, "") };
    }
    default:
      return bad("Unknown setting");
  }
}

/** Keeps only known keys with valid values. Used when anything comes from storage or the network. */
export function sanitizeOverrides(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj && typeof obj === "object" ? obj : {})) {
    const f = FIELD_MAP[k];
    if (!f) continue;
    const r = validateValue(f, v);
    if (r.ok) out[k] = r.value;
  }
  return out;
}

/** The value the wrangler.toml / env gives (or the built-in default), as a normalized string. */
export function baseValue(env, field) {
  const raw = env?.[field.key];
  if (raw === undefined || raw === null || (raw === "" && field.def !== "")) return field.def;
  const r = validateValue(field, raw);
  return r.ok ? r.value : String(raw);
}

/** Worker env with the edited values on top. Reads fall through to the real env (bindings, secrets). */
export function withOverrides(env, ov) {
  const out = Object.create(env || {});
  for (const [k, v] of Object.entries(ov || {})) if (FIELD_MAP[k]) out[k] = v;
  return out;
}

/** UI model: every field with its current value, the wrangler value and whether it was edited. */
export function describeFields(env, ov) {
  return FIELDS.map((f) => {
    const base = baseValue(env, f);
    const edited = Object.prototype.hasOwnProperty.call(ov || {}, f.key);
    return {
      key: f.key, group: f.group, label: f.label, type: f.type, options: f.options, min: f.min, max: f.max,
      hint: f.hint, warn: f.warn || "", required: Boolean(f.required),
      base, def: f.def, value: edited ? ov[f.key] : base, edited,
    };
  });
}

/**
 * Applies one UI request to the stored overrides.
 *   body = { set: { KEY: value }, reset: [KEY], all: true }
 * -> { ok:true, values, changes:[{key, from, to}] } or { ok:false, errors:{ KEY: message } }
 * A value equal to the wrangler.toml value is stored as "no override", so later toml edits still apply.
 */
export function applyChanges(env, current, body) {
  const cur = sanitizeOverrides(current);
  const next = body?.all ? {} : { ...cur };
  const errors = {};
  for (const k of Array.isArray(body?.reset) ? body.reset : []) {
    if (FIELD_MAP[k]) delete next[k];
    else errors[String(k).slice(0, 40)] = "Unknown setting";
  }
  for (const [k, raw] of Object.entries(body?.set && typeof body.set === "object" ? body.set : {})) {
    const f = FIELD_MAP[k];
    if (!f) {
      errors[String(k).slice(0, 40)] = "Unknown setting";
      continue;
    }
    const r = validateValue(f, raw);
    if (!r.ok) {
      errors[k] = r.error;
      continue;
    }
    if (r.value === baseValue(env, f)) delete next[k];
    else next[k] = r.value;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const changes = [];
  for (const f of FIELDS) {
    const from = Object.prototype.hasOwnProperty.call(cur, f.key) ? cur[f.key] : baseValue(env, f);
    const to = Object.prototype.hasOwnProperty.call(next, f.key) ? next[f.key] : baseValue(env, f);
    if (from !== to) changes.push({ key: f.key, from, to });
  }
  return { ok: true, values: next, changes };
}
