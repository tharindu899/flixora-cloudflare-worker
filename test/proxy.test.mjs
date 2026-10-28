import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const MIB = 1024 * 1024;
const SIZE = 5 * MIB + 12345; // 6 chunks of 1 MiB, last one partial
const HOST = "api.example.com";
const SECRET = "turnstile-secret";
const FILE_ID = "abc123XYZ_-id";

const byteAt = (i) => (i * 31 + (i >> 8)) & 255;
const expected = (a, b) => {
  const out = new Uint8Array(b - a + 1);
  for (let i = a; i <= b; i++) out[i - a] = byteAt(i);
  return out;
};

// ---- mock backend (mirrors Backend/server/main.py range behaviour)
let originCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const h = new Headers(init.headers || {});
  originCalls.push({ url: u.toString(), range: h.get("range") });
  if (u.host !== HOST) return new Response("nope", { status: 502 });
  const common = { "Content-Type": "video/x-matroska", "Content-Disposition": 'inline; filename="movie.mkv"', "Accept-Ranges": "bytes" };
  const range = h.get("range");
  if (!range) return new Response(expected(0, SIZE - 1), { status: 200, headers: common });
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let a, b;
  if (m[1] === "") {
    a = Math.max(SIZE - Number(m[2]), 0);
    b = SIZE - 1;
  } else {
    a = Number(m[1]);
    b = m[2] === "" ? SIZE - 1 : Math.min(Number(m[2]), SIZE - 1);
  }
  if (a >= SIZE || b < a) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${SIZE}` } });
  return new Response(expected(a, b), {
    status: 206,
    headers: { ...common, "Content-Range": `bytes ${a}-${b}/${SIZE}`, "Content-Length": String(b - a + 1) },
  });
};

// ---- mock edge cache
const store = new Map();
globalThis.caches = {
  default: {
    async match(key) {
      const k = typeof key === "string" ? key : key.url;
      const e = store.get(k);
      return e ? new Response(e.buf.slice(0), { status: 200, headers: e.headers }) : undefined;
    },
    async put(key, resp) {
      const k = typeof key === "string" ? key : key.url;
      store.set(k, { buf: new Uint8Array(await resp.arrayBuffer()), headers: [...resp.headers] });
    },
    async delete(key) {
      return store.delete(typeof key === "string" ? key : key.url);
    },
  },
};

const { default: worker } = await import("../src/index.js");

const ENV = { ALLOWED_ORIGINS: HOST, CHUNK_MB: "1", MAX_CHUNKS: "3", ENABLE_CACHE: "true", TURNSTILE_SECRET: SECRET };

async function call(path, { headers = {}, method = "GET", env = ENV, payload } = {}) {
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const res = await worker.fetch(new Request(`https://stream.example.org${path}`, { method, headers, body: payload }), env, ctx);
  const body = new Uint8Array(await res.arrayBuffer());
  await Promise.all(waits);
  return { res, body };
}

const plain = (p = `/dl/${FILE_ID}/movie.mkv`) => `/https://${HOST}${p}`;
const resetAll = () => {
  store.clear();
  originCalls = [];
};

function makeToken(fileId, expires = Math.floor(Date.now() / 1000) + 600) {
  const idHash = crypto.createHash("sha256").update(fileId).digest("hex").slice(0, 24);
  const mac = crypto.createHmac("sha256", SECRET).update(`${expires}:${idHash}`).digest("hex").slice(0, 32);
  return `${expires}.${mac}`;
}

test("closed range inside one chunk: correct bytes, second request is a cache HIT", async () => {
  resetAll();
  const a = 100, b = 5000;
  const r1 = await call(plain(), { headers: { Range: `bytes=${a}-${b}` } });
  assert.equal(r1.res.status, 206);
  assert.equal(r1.res.headers.get("content-range"), `bytes ${a}-${b}/${SIZE}`);
  assert.deepEqual(r1.body, expected(a, b));
  assert.equal(r1.res.headers.get("x-flx-cache"), "MISS");
  const callsAfterFirst = originCalls.length;
  assert.equal(originCalls[0].range, `bytes=0-${MIB - 1}`); // aligned chunk, not the raw range

  const r2 = await call(plain(), { headers: { Range: `bytes=${a}-${b}` } });
  assert.deepEqual(r2.body, expected(a, b));
  assert.equal(r2.res.headers.get("x-flx-cache"), "HIT");
  assert.equal(originCalls.length, callsAfterFirst, "VPS must not be hit again");
});

test("range crossing chunk boundaries returns exact bytes", async () => {
  resetAll();
  const a = MIB - 10, b = 3 * MIB + 77;
  const { res, body } = await call(plain(), { headers: { Range: `bytes=${a}-${b}` } });
  assert.equal(res.status, 206);
  assert.equal(body.length, b - a + 1);
  assert.deepEqual(body, expected(a, b));
});

test("open-ended range is capped to MAX_CHUNKS and stays consistent", async () => {
  resetAll();
  const { res, body } = await call(plain(), { headers: { Range: "bytes=0-" } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), `bytes 0-${3 * MIB - 1}/${SIZE}`);
  assert.equal(body.length, 3 * MIB);
  assert.deepEqual(body, expected(0, 3 * MIB - 1));
});

test("CAP_OPEN_RANGES=false serves the whole open range", async () => {
  resetAll();
  const { res, body } = await call(plain(), { headers: { Range: `bytes=${MIB + 5}-` }, env: { ...ENV, CAP_OPEN_RANGES: "false" } });
  assert.equal(res.status, 206);
  assert.equal(body.length, SIZE - (MIB + 5));
  assert.deepEqual(body, expected(MIB + 5, SIZE - 1));
});

test("suffix range works (probe + tail chunk)", async () => {
  resetAll();
  const { res, body } = await call(plain(), { headers: { Range: "bytes=-1000" } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), `bytes ${SIZE - 1000}-${SIZE - 1}/${SIZE}`);
  assert.deepEqual(body, expected(SIZE - 1000, SIZE - 1));
});

test("full GET without Range returns 200 and the complete file (budget fallback ok)", async () => {
  resetAll();
  const env = { ...ENV, MAX_CHUNKS: "3" };
  const { res, body } = await call(plain(), { env });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), String(SIZE));
  assert.equal(body.length, SIZE);
  assert.deepEqual(body, expected(0, SIZE - 1));
});

test("HEAD answers from metadata only", async () => {
  resetAll();
  const { res, body } = await call(plain(), { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), String(SIZE));
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(body.length, 0);
  assert.equal(originCalls.length, 1);
  assert.equal(originCalls[0].range, "bytes=0-0");
});

test("range past EOF -> 416 with Content-Range */size", async () => {
  resetAll();
  const { res } = await call(plain(), { headers: { Range: `bytes=${SIZE + 10}-` } });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get("content-range"), `bytes */${SIZE}`);
});

test("origin allow-list and path restrictions", async () => {
  resetAll();
  let r = await call(`/https://evil.example.net/dl/${FILE_ID}/movie.mkv`);
  assert.equal(r.res.status, 403);
  r = await call(`/https://${HOST}/admin/api/media`);
  assert.equal(r.res.status, 403);
  r = await call(`/random`);
  assert.equal(r.res.status, 404);
  r = await call(plain(), { env: { ...ENV, ALLOWED_ORIGINS: "" } });
  assert.equal(r.res.status, 500);
  assert.equal(originCalls.length, 0);
});

test("collapsed-slash plain form and MediaFlow form both work", async () => {
  resetAll();
  let r = await call(`/https:/${HOST}/dl/${FILE_ID}/movie.mkv`, { headers: { Range: "bytes=0-9" } });
  assert.equal(r.res.status, 206);
  assert.deepEqual(r.body, expected(0, 9));

  const d = encodeURIComponent(`https://${HOST}/dl/${FILE_ID}/movie.mkv`);
  r = await call(`/proxy/stream?d=${d}&api_password=x`, { headers: { Range: "bytes=10-19" } });
  assert.equal(r.res.status, 206);
  assert.deepEqual(r.body, expected(10, 19));
});

test("download needs a valid Turnstile token (verified in the worker), then is served as attachment", async () => {
  resetAll();
  let r = await call(plain(`/dld/0/${FILE_ID}/movie.mkv`), { headers: { Range: "bytes=0-99" } });
  assert.equal(r.res.status, 403);
  assert.equal(originCalls.length, 0);

  r = await call(plain(`/dld/${makeToken("other-file")}/${FILE_ID}/movie.mkv`), { headers: { Range: "bytes=0-99" } });
  assert.equal(r.res.status, 403);

  r = await call(plain(`/dld/${makeToken("x", 1)}/${FILE_ID}/movie.mkv`), { headers: { Range: "bytes=0-99" } });
  assert.equal(r.res.status, 403, "expired token");

  r = await call(plain(`/dld/${makeToken(FILE_ID)}/${FILE_ID}/movie.mkv`), { headers: { Range: "bytes=0-99" } });
  assert.equal(r.res.status, 206);
  assert.match(r.res.headers.get("content-disposition"), /^attachment/);
  assert.deepEqual(r.body, expected(0, 99));
  // origin was asked for the plain /dl stream URL, never /dld
  assert.ok(originCalls.every((c) => c.url.includes("/dl/") && !c.url.includes("/dld/")));
});

test("download with no TURNSTILE_SECRET in the worker is passed through uncached", async () => {
  resetAll();
  const env = { ...ENV };
  delete env.TURNSTILE_SECRET;
  const { res } = await call(plain(`/dld/sometoken/${FILE_ID}/movie.mkv`), { headers: { Range: "bytes=0-9" }, env });
  assert.equal(res.headers.get("x-flx-cache"), "BYPASS");
  assert.equal(store.size, 0);
  assert.ok(originCalls[0].url.includes("/dld/sometoken/"));
});

test("BACKEND_USES_TURNSTILE=false lets downloads use the cache", async () => {
  resetAll();
  const env = { ...ENV, BACKEND_USES_TURNSTILE: "false" };
  delete env.TURNSTILE_SECRET;
  const { res, body } = await call(plain(`/dld/0/${FILE_ID}/movie.mkv`), { headers: { Range: "bytes=0-99" }, env });
  assert.equal(res.status, 206);
  assert.match(res.headers.get("content-disposition"), /^attachment/);
  assert.deepEqual(body, expected(0, 99));
});

test("subtitles bypass the chunk cache", async () => {
  resetAll();
  const { res } = await call(plain(`/dl/${FILE_ID}/movie.srt`));
  assert.equal(res.headers.get("x-flx-cache"), "BYPASS");
  assert.equal(store.size, 0);
});

test("CORS preflight and status page", async () => {
  let r = await call("/anything", { method: "OPTIONS" });
  assert.equal(r.res.status, 204);
  assert.match(r.res.headers.get("access-control-allow-headers"), /Range/);
  r = await call("/health");
  assert.equal(r.res.status, 200);
  assert.equal(JSON.parse(new TextDecoder().decode(r.body)).ok, true);
});

test("browser gets the Dracula UI, API clients still get JSON", async () => {
  let r = await call("/", { headers: { accept: "text/html" } });
  assert.equal(r.res.status, 200);
  assert.match(r.res.headers.get("content-type"), /text\/html/);
  assert.match(new TextDecoder().decode(r.body), /Flixora/);
  r = await call("/ui");
  assert.match(r.res.headers.get("content-type"), /text\/html/);
  r = await call("/health");
  assert.match(r.res.headers.get("content-type"), /json/);
});

// ---------------------------------------------------------------- activity log
const { LogHub, applyEvent, snapshot } = await import("../src/log.js");
const LOGENV = { ...ENV, UI_USER: "admin", UI_PASS: "s3cret pass" };
const login = async (env = LOGENV, user = "admin", pass = "s3cret pass") =>
  call("/login", { env, method: "POST", headers: { "content-type": "application/json" }, payload: JSON.stringify({ user, pass }) });
const sessionOf = async (env = LOGENV) => (await login(env)).res.headers.get("set-cookie").split(";")[0];
const AUTH = await sessionOf();
const getLog = async (env = LOGENV, cookie = AUTH) =>
  call("/logs.json", { env, headers: cookie ? { cookie } : {} });

test("login: wrong credentials rejected, right ones set an HttpOnly session cookie", async () => {
  assert.equal((await login(ENV)).res.status, 403); // UI_USER / UI_PASS not configured
  assert.equal((await login(LOGENV, "admin", "nope")).res.status, 401);
  assert.equal((await login(LOGENV, "nope", "s3cret pass")).res.status, 401);
  const r = await login();
  assert.equal(r.res.status, 200);
  const c = r.res.headers.get("set-cookie");
  assert.match(c, /^flx_sess=\d+\.[0-9a-f]{64};/);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Strict/);
  assert.match(c, /Secure/);
  assert.equal((await call("/login", { env: LOGENV, method: "POST", payload: "{}" })).res.status, 400); // not JSON content-type
  assert.equal((await call("/login", { env: LOGENV })).res.status, 405);
});

test("log endpoint is locked without a valid session", async () => {
  assert.equal((await getLog(ENV, AUTH)).res.status, 403);
  assert.equal((await getLog(LOGENV, "")).res.status, 401);
  assert.equal((await getLog(LOGENV, "flx_sess=1.abc")).res.status, 401);
  const past = Math.floor(Date.now() / 1000) - 10;
  assert.equal((await getLog(LOGENV, `flx_sess=${past}.${AUTH.split(".")[1]}`)).res.status, 401);
  // session signed for another password is not accepted
  assert.equal((await getLog({ ...LOGENV, UI_PASS: "changed" }, AUTH)).res.status, 401);
  assert.equal((await call("/logs/clear", { env: LOGENV, method: "POST" })).res.status, 401);
});

test("UI page shows the sign-in form until logged in; logout clears the cookie", async () => {
  let r = await call("/ui", { env: LOGENV });
  let html = new TextDecoder().decode(r.body);
  assert.match(html, /Sign in/);
  assert.doesNotMatch(html, /Cloudflare Free plan today/);
  r = await call("/ui", { env: LOGENV, headers: { cookie: AUTH } });
  html = new TextDecoder().decode(r.body);
  assert.match(html, /Cloudflare Free plan today/);
  r = await call("/logout", { env: LOGENV, method: "POST" });
  assert.match(r.res.headers.get("set-cookie"), /Max-Age=0/);
});

test("play and download show up in the log with file, size and speed", async () => {
  resetAll();
  await call("/logs/clear", { env: LOGENV, method: "POST", headers: { cookie: AUTH, "user-agent": "VLC/3.0 (Android)" } });
  await call(plain(), { env: LOGENV, headers: { Range: "bytes=0-", "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Safari/537.36" } });
  const tok = makeToken(FILE_ID);
  await call(`/https://${HOST}/dld/${tok}/${FILE_ID}/movie.mkv`, { env: LOGENV });
  const { body } = await getLog();
  const d = JSON.parse(new TextDecoder().decode(body));
  assert.equal(d.mode, "memory");
  const play = d.entries.find((e) => e.kind === "play");
  const dl = d.entries.find((e) => e.kind === "download");
  assert.ok(play && dl);
  assert.equal(play.name, "movie.mkv");
  assert.equal(play.state, "done");
  assert.equal(play.total, SIZE);
  assert.ok(play.sent > 0 && play.sent <= SIZE);
  assert.equal(play.dev, "Chrome on Android");
  assert.equal(dl.sent, SIZE);
  assert.equal(dl.state, "done");
  assert.ok(dl.hit + dl.miss >= 1);
  // clear works
  await call("/logs/clear", { env: LOGENV, method: "POST", headers: { cookie: AUTH } });
  assert.equal(JSON.parse(new TextDecoder().decode((await getLog()).body)).entries.length, 0);
});

test("sessions merge: several Range requests of one player = one log entry", () => {
  const entries = [];
  const base = { sid: "f|play|abc", name: "m.mkv", kind: "play", total: 1000 };
  applyEvent(entries, { ...base, rid: "r1", type: "start" }, 1000);
  applyEvent(entries, { ...base, rid: "r1", type: "end", state: "done", sent: 400, ms: 1000, bps: 400 }, 2000);
  applyEvent(entries, { ...base, rid: "r2", type: "start" }, 3000);
  applyEvent(entries, { ...base, rid: "r2", type: "progress", sent: 100, ms: 500, bps: 200 }, 3500);
  const [e] = snapshot(entries, 3600);
  assert.equal(entries.length, 1);
  assert.equal(e.reqs, 2);
  assert.equal(e.sent, 500);
  assert.equal(e.state, "active");
  assert.equal(e.avg, Math.round((500 * 1000) / 1500));
  assert.equal(snapshot(entries, 3500 + 21 * 60 * 1000)[0].state, "lost");
});

test("Durable Object mode: LogHub stores events and the worker reads them back", async () => {
  resetAll();
  const kv = new Map();
  const hub = new LogHub({
    storage: { get: async (k) => kv.get(k), put: async (k, v) => kv.set(k, structuredClone(v)) },
    blockConcurrencyWhile: (fn) => fn(),
  });
  const LOGS = { idFromName: (n) => n, get: () => ({ fetch: (u, init) => hub.fetch(new Request(u, init)) }) };
  const env = { ...LOGENV, LOGS };
  await call(plain(), { env, headers: { Range: "bytes=0-" } });
  const d = JSON.parse(new TextDecoder().decode((await getLog(env)).body));
  assert.equal(d.mode, "durable");
  assert.equal(d.entries.length, 1);
  assert.equal(d.entries[0].state, "done");
  assert.ok(d.entries[0].sent > 0);
  assert.ok(kv.get("entries").length === 1, "persisted to DO storage");
});

// ---------------------------------------------------------------- stats, alerts, purge, country block
const { addDaily, statsView, dayKey } = await import("../src/log.js");
const { evaluate, pingBackends, alertConfig } = await import("../src/alerts.js");

const tgSent = [];
{
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.telegram.org/")) {
      tgSent.push({ url: String(url), ...JSON.parse(init.body) });
      return new Response("{}", { status: 200 });
    }
    return inner(url, init);
  };
}
const postJson = (path, payload, env = LOGENV) =>
  call(path, { env, method: "POST", headers: { cookie: AUTH, "content-type": "application/json" }, payload: JSON.stringify(payload) });
const jsonOf = (r) => JSON.parse(new TextDecoder().decode(r.body));

test("daily stats: bytes, edge vs VPS bytes, errors, top files, day key follows the timezone", () => {
  const days = {};
  const now = Date.UTC(2026, 9, 27, 20, 0, 0); // 27 Oct 20:00 UTC = 28 Oct 01:30 in Colombo
  assert.equal(dayKey(now, 330), "2026-10-28");
  assert.equal(dayKey(now, 0), "2026-10-27");
  addDaily(days, { type: "progress", sent: 5 }, now);
  addDaily(days, { type: "end", name: "a.mkv", sent: 1000, hb: 700, mb: 300, h: 7, m: 3, state: "done" }, now);
  addDaily(days, { type: "end", name: "a.mkv", sent: 500, hb: 0, mb: 500, h: 0, m: 5, state: "error" }, now);
  addDaily(days, { type: "end", name: "b.mkv", sent: 10, hb: 10, mb: 0, h: 1, m: 0, state: "done" }, now);
  const d = days["2026-10-28"];
  assert.deepEqual([d.r, d.b, d.hb, d.mb, d.h, d.m, d.e], [3, 1510, 710, 800, 8, 8, 1]);
  assert.deepEqual(d.f["a.mkv"], [1500, 2]);
  assert.equal(statsView(days, now).today, "2026-10-28");
  // only the newest 31 days are kept
  for (let i = 0; i < 40; i++) addDaily(days, { type: "end", sent: 1 }, now - (i + 1) * 86400000);
  assert.equal(Object.keys(days).length, 31);
});

test("a replay is served from the edge and shows up as saved bytes in the log and in /stats.json", async () => {
  resetAll();
  await call("/logs/clear", { env: LOGENV, method: "POST", headers: { cookie: AUTH } });
  const range = { Range: "bytes=0-2097151" };
  await call(plain(), { env: LOGENV, headers: { ...range, "user-agent": "VLC/3.0 (Android)" } });
  await call(plain(), { env: LOGENV, headers: { ...range, "user-agent": "VLC/3.0 (Android)" } });
  const log = jsonOf(await getLog());
  const e = log.entries[0];
  assert.equal(e.hit_bytes, 2 * MIB);
  assert.equal(e.miss_bytes, 2 * MIB);
  const st = jsonOf(await call("/stats.json", { env: LOGENV, headers: { cookie: AUTH } }));
  const today = st.days.find((x) => x.d === st.today);
  assert.ok(today.hb >= 2 * MIB && today.mb >= 2 * MIB);
  assert.ok(today.f["movie.mkv"][0] >= 4 * MIB);
  assert.equal((await call("/stats.json", { env: LOGENV })).res.status, 401);
});

test("/status.json pings the backend and reports alert config (login required)", async () => {
  assert.equal((await call("/status.json", { env: LOGENV })).res.status, 401);
  const env = { ...LOGENV, TG_BOT_TOKEN: "t", TG_CHAT_ID: "1", BLOCK_COUNTRIES: "cn, ru", ALERT_MIN_HIT_PCT: "30" };
  const s = jsonOf(await call("/status.json", { env, headers: { cookie: AUTH } }));
  assert.equal(s.backend.up, true);
  assert.equal(s.backend.host, HOST);
  assert.equal(s.telegram, true);
  assert.equal(s.alert_min_hit, 30);
  assert.deepEqual(s.blocked_countries.sort(), ["CN", "RU"]);
  const down = jsonOf(await call("/status.json", { env: { ...LOGENV, ALLOWED_ORIGINS: "down.example.com" }, headers: { cookie: AUTH } }));
  assert.equal(down.backend.up, false);
});

test("alert rules: down after 2 failed checks, recovery, error spike, low hit rate (each with a cooldown)", () => {
  const cfg = { errCount: 3, minHit: 40 };
  const t = 1_000_000_000_000;
  const bad = { up: false, host: "api", ms: 8000, error: "timeout" };
  const good = { up: true, host: "api", ms: 120, error: "" };
  let r = evaluate(null, { ping: bad, now: t, cfg });
  assert.equal(r.messages.length, 0); // one failure is not enough
  r = evaluate(r.state, { ping: bad, now: t + 300000, cfg });
  assert.match(r.messages[0], /DOWN/);
  r = evaluate(r.state, { ping: bad, now: t + 600000, cfg });
  assert.equal(r.messages.length, 0); // no repeat
  r = evaluate(r.state, { ping: good, now: t + 900000, cfg });
  assert.match(r.messages[0], /back up/);
  assert.match(r.messages[0], /10 min/);

  const errs = [t - 1000, t - 2000, t - 3000, t - 20 * 60000];
  r = evaluate(null, { ping: good, now: t, errTimes: errs, cfg });
  assert.match(r.messages[0], /3 failed/);
  r = evaluate(r.state, { ping: good, now: t + 60000, errTimes: errs, cfg });
  assert.equal(r.messages.length, 0); // cooldown

  r = evaluate(null, { ping: good, now: t, today: { h: 100, m: 400, mb: 5 * MIB }, cfg });
  assert.match(r.messages[0], /20%/);
  r = evaluate(null, { ping: good, now: t, today: { h: 10, m: 40 }, cfg });
  assert.equal(r.messages.length, 0); // too little data
  assert.deepEqual(alertConfig({}), { errCount: 5, minHit: 0, cfWarn: 80, cfLimit: 100000 });
});

test("scheduled check: Durable Object remembers state, Telegram gets the DOWN and the recovery message", async () => {
  tgSent.length = 0;
  const kv = new Map();
  const hub = new LogHub({
    storage: { get: async (k) => kv.get(k), put: async (k, v) => kv.set(k, structuredClone(v)) },
    blockConcurrencyWhile: (fn) => fn(),
  });
  const LOGS = { idFromName: (n) => n, get: () => ({ fetch: (u, init) => hub.fetch(new Request(u, init)) }) };
  const base = { ...LOGENV, LOGS, TG_BOT_TOKEN: "tok", TG_CHAT_ID: "42" };
  const run = (env) => {
    const waits = [];
    return worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) }).then(() => Promise.all(waits));
  };
  const downEnv = { ...base, ALLOWED_ORIGINS: "down.example.com" };
  await run(downEnv);
  assert.equal(tgSent.length, 0);
  await run(downEnv);
  assert.equal(tgSent.length, 1);
  assert.match(tgSent[0].text, /DOWN/);
  assert.equal(tgSent[0].chat_id, "42");
  assert.match(tgSent[0].url, /bottok\/sendMessage/);
  await run(downEnv);
  assert.equal(tgSent.length, 1);
  await run(base);
  assert.equal(tgSent.length, 2);
  assert.match(tgSent[1].text, /back up/);
  assert.ok(kv.get("alert"));
});

test("Telegram test button needs the secrets and a login", async () => {
  tgSent.length = 0;
  assert.equal((await call("/alerts/test", { env: LOGENV, method: "POST" })).res.status, 401);
  assert.equal((await postJson("/alerts/test", {})).res.status, 400);
  const r = await postJson("/alerts/test", {}, { ...LOGENV, TG_BOT_TOKEN: "tok", TG_CHAT_ID: "42" });
  assert.equal(r.res.status, 200);
  assert.equal(tgSent.length, 1);
});

test("BLOCK_COUNTRIES blocks proxy traffic but never the UI or login", async () => {
  resetAll();
  const env = { ...LOGENV, BLOCK_COUNTRIES: "CN, ru" };
  assert.equal((await call(plain(), { env, headers: { "cf-ipcountry": "CN", Range: "bytes=0-9" } })).res.status, 403);
  assert.equal((await call(plain(), { env, headers: { "cf-ipcountry": "ru", Range: "bytes=0-9" } })).res.status, 403);
  assert.equal((await call(plain(), { env, headers: { "cf-ipcountry": "LK", Range: "bytes=0-9" } })).res.status, 206);
  assert.equal((await call("/ui", { env, headers: { "cf-ipcountry": "CN" } })).res.status, 200);
  assert.equal((await login(env)).res.status, 200);
});

// ---------------------------------------------------------------- login lockout, heavy clients, per-client limits
const { lockFail, lockStatus, lockClear, LOCK } = await import("../src/auth.js");
const { noteUsage, heavyClients, gateDecision, clientActivity, memEntries: seededEntries } = await import("../src/log.js");

test("lockout rules: 5 wrong passwords lock for 15 min, expire, and a good login clears the count", () => {
  const locks = {};
  const t = 1_000_000_000_000;
  for (let i = 0; i < 4; i++) assert.equal(lockFail(locks, "a", t + i).locked, false);
  const r = lockFail(locks, "a", t + 5);
  assert.deepEqual([r.locked, r.justLocked, r.retry], [true, true, 900]);
  assert.equal(lockFail(locks, "a", t + 6).justLocked, false); // already locked, no second alert
  assert.equal(lockStatus(locks, "a", t + 5 + 60_000).retry, 840);
  assert.equal(lockStatus(locks, "b", t).locked, false); // other clients unaffected
  assert.equal(lockStatus(locks, "a", t + LOCK.lockMs + 10).locked, false); // expired
  assert.equal(lockFail(locks, "a", t + LOCK.lockMs + 20).locked, false); // fresh count
  lockClear(locks, "a");
  assert.equal(locks.a, undefined);
  // old failures outside the window do not add up
  const l2 = {};
  for (let i = 0; i < 4; i++) lockFail(l2, "c", t);
  assert.equal(lockFail(l2, "c", t + LOCK.windowMs + 1).locked, false);
});

test("login endpoint locks a client after 5 wrong passwords, tells Telegram once, other clients still log in", async () => {
  tgSent.length = 0;
  const env = { ...LOGENV, TG_BOT_TOKEN: "tok", TG_CHAT_ID: "42" };
  const attempt = (ip, pass) =>
    call("/login", { env, method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, "cf-ipcountry": "LK" }, payload: JSON.stringify({ user: "admin", pass }) });
  for (let i = 0; i < 5; i++) assert.equal((await attempt("203.0.113.9", "wrong")).res.status, 401);
  assert.equal(tgSent.length, 1);
  assert.match(tgSent[0].text, /locked for 15 minutes/);
  const blocked = await attempt("203.0.113.9", "s3cret pass"); // even the right password is refused while locked
  assert.equal(blocked.res.status, 429);
  assert.equal(blocked.res.headers.get("retry-after"), "900");
  assert.match(jsonOf(blocked).error, /15 min/);
  assert.equal((await attempt("203.0.113.10", "s3cret pass")).res.status, 200);
  assert.equal(tgSent.length, 1);
});

test("heavy client: alert once per 6 h when one client pulls more than the hourly limit", () => {
  const usage = {};
  const GB = 1073741824;
  const t = 1_000_000_000_000;
  const ev = (sent, extra = {}) => ({ type: "end", sid: "f|download|ab12cd", sent, name: "big.mkv", ...extra });
  assert.equal(noteUsage(usage, ev(10 * GB), t, 30 * GB), "");
  assert.equal(noteUsage(usage, ev(15 * GB), t + 1000, 30 * GB), "");
  const msg = noteUsage(usage, ev(8 * GB), t + 2000, 30 * GB);
  assert.match(msg, /#ab12cd/);
  assert.match(msg, /33\.0 GB/);
  assert.match(msg, /big\.mkv/);
  assert.equal(noteUsage(usage, ev(8 * GB), t + 3000, 30 * GB), ""); // cooldown
  assert.equal(noteUsage({}, ev(900 * GB), t, 0), ""); // limit 0 = off
  assert.equal(noteUsage(usage, { type: "progress", sid: "f|play|x", sent: 99 * GB }, t, 1), ""); // only finished requests count
  const top = heavyClients(usage, [{ client: "ab12cd", country: "LK", dev: "VLC on Android" }], t + 4000);
  assert.deepEqual([top[0].client, top[0].country, top[0].dev], ["ab12cd", "LK", "VLC on Android"]);
  // a new hour starts a new count
  assert.equal(noteUsage(usage, ev(5 * GB), t + 3601_000 + 5000, 30 * GB), "");
  assert.equal(usage.ab12cd.b, 5 * GB);
});

test("Durable Object: real traffic over ABUSE_GB_PER_HOUR sends a Telegram alert and shows up under heavy clients", async () => {
  resetAll();
  tgSent.length = 0;
  const kv = new Map();
  const denv = { ABUSE_GB_PER_HOUR: "0.000001", TG_BOT_TOKEN: "tok", TG_CHAT_ID: "42" }; // ~1 KB
  const hub = new LogHub(
    { storage: { get: async (k) => kv.get(k), put: async (k, v) => kv.set(k, structuredClone(v)) }, blockConcurrencyWhile: (fn) => fn() },
    denv
  );
  const LOGS = { idFromName: (n) => n, get: () => ({ fetch: (u, init) => hub.fetch(new Request(u, init)) }) };
  const env = { ...LOGENV, LOGS };
  await call(plain(), { env, headers: { Range: "bytes=0-1048575", "cf-connecting-ip": "198.51.100.7" } });
  await call(plain(), { env, headers: { Range: "bytes=0-1048575", "cf-connecting-ip": "198.51.100.7" } });
  assert.equal(tgSent.filter((m) => /Heavy client/.test(m.text)).length, 1);
  const st = jsonOf(await call("/stats.json", { env, headers: { cookie: AUTH } }));
  assert.equal(st.heavy.length, 1);
  assert.ok(st.heavy[0].bytes >= 2 * MIB);
  assert.equal(st.heavy[0].name, "movie.mkv");
});

test("per-client limits: pure decision rules", () => {
  const t = Date.now();
  const entries = [];
  const start = (sid, rid, client) => applyEvent(entries, { sid, rid, type: "start", client, name: sid, kind: "play", total: 10 }, t);
  start("a|play|c1", "r1", "c1");
  start("a|play|c1", "r2", "c1");
  start("b|play|c1", "r3", "c1");
  start("z|play|c2", "r4", "c2");
  assert.deepEqual(clientActivity(entries, "c1", t, "a|play|c1"), { reqs: 3, files: 2, sidActive: true });
  assert.equal(gateDecision(entries, { client: "c1", sid: "new|play|c1", maxReqs: 3, maxFiles: 0 }, t).ok, false);
  assert.equal(gateDecision(entries, { client: "c1", sid: "new|play|c1", maxReqs: 0, maxFiles: 2 }, t).ok, false);
  assert.equal(gateDecision(entries, { client: "c1", sid: "a|play|c1", maxReqs: 0, maxFiles: 2 }, t).ok, true); // same file is fine
  assert.equal(gateDecision(entries, { client: "c2", sid: "new|play|c2", maxReqs: 3, maxFiles: 2 }, t).ok, true); // other client unaffected
  assert.equal(gateDecision(entries, { client: "c1", sid: "new|play|c1", maxReqs: 0, maxFiles: 0 }, t).ok, true); // 0 = off
  // a request silent for 8+ minutes is treated as dead
  assert.equal(clientActivity(entries, "c1", t + 9 * 60_000, "x").reqs, 0);
});

test("per-client limits: extra files / connections get 429 + Retry-After and are counted in the stats", async () => {
  resetAll();
  await call("/logs/clear", { env: LOGENV, method: "POST", headers: { cookie: AUTH } });
  seededEntries.length = 0;
  const now = Date.now();
  // the test client has no cf-connecting-ip -> client id "local"
  for (const [sid, rid] of [["f1|play|local", "r1"], ["f2|play|local", "r2"]]) {
    applyEvent(seededEntries, { sid, rid, type: "start", client: "local", name: sid, kind: "play", total: 10 }, now);
  }
  const lim = { ...LOGENV, MAX_CLIENT_FILES: "2" };
  const denied = await call(plain(), { env: lim, headers: { Range: "bytes=0-9" } });
  assert.equal(denied.res.status, 429);
  assert.equal(denied.res.headers.get("retry-after"), "5");
  assert.match(jsonOf(denied).error, /Too many files/);
  assert.equal(originCalls.length, 0, "nothing was fetched from the VPS");
  // the same file again, with the limits off, or from another client are fine
  assert.equal((await call(plain(), { env: { ...lim, MAX_CLIENT_FILES: "0" }, headers: { Range: "bytes=0-9" } })).res.status, 206);
  assert.equal((await call(plain(), { env: lim, headers: { Range: "bytes=0-9", "cf-connecting-ip": "192.0.2.50" } })).res.status, 206);
  const reqLim = { ...LOGENV, MAX_CLIENT_REQS: "2", MAX_CLIENT_FILES: "0" };
  assert.equal((await call(plain(), { env: reqLim, headers: { Range: "bytes=0-9" } })).res.status, 429);
  const st = jsonOf(await call("/stats.json", { env: LOGENV, headers: { cookie: AUTH } }));
  assert.ok(st.days.find((d) => d.d === st.today).x >= 2);
  seededEntries.length = 0;
  assert.equal((await call(plain(), { env: reqLim, headers: { Range: "bytes=0-9" } })).res.status, 206);
});

test("status.json reports the limits", async () => {
  const s = jsonOf(await call("/status.json", { env: { ...LOGENV, MAX_CLIENT_FILES: "3", ABUSE_GB_PER_HOUR: "12" }, headers: { cookie: AUTH } }));
  assert.deepEqual([s.max_files, s.max_reqs, s.abuse_gb], [3, 24, 12]);
});

// ---------------------------------------------------------------- UI-editable settings + Cloudflare Free limits
const { FREE } = await import("../src/config.js");
const { bumpCf, cfView } = await import("../src/log.js");

const makeHub = (baseEnv, kv = new Map()) => {
  const hub = new LogHub(
    { storage: { get: async (k) => kv.get(k), put: async (k, v) => kv.set(k, structuredClone(v)) }, blockConcurrencyWhile: (fn) => fn() },
    baseEnv
  );
  const LOGS = { idFromName: (n) => n, get: () => ({ fetch: (u, init) => hub.fetch(new Request(u, init)) }) };
  return { kv, hub, LOGS };
};

test("Cloudflare counters: the UTC day rolls over, limits come from the Free plan", () => {
  const u = { day: "", q: 0, dr: 0, dw: 0 };
  const t = Date.UTC(2026, 9, 28, 23, 59, 0);
  bumpCf(u, t, { q: 5, dr: 2, dw: 1 });
  bumpCf(u, t + 1000, { q: 1 });
  assert.deepEqual(cfView(u, t), { day: "2026-10-28", q: 6, dr: 2, dw: 1 });
  assert.deepEqual(cfView(u, t + 120000), { day: "2026-10-29", q: 0, dr: 0, dw: 0 }); // after 00:00 UTC
  bumpCf(u, t + 120000, { q: 1 });
  assert.deepEqual(u, { day: "2026-10-29", q: 1, dr: 0, dw: 0 });
  assert.deepEqual([FREE.workerRequestsDay, FREE.doRequestsDay, FREE.doRowsWrittenDay, FREE.cpuMs, FREE.subrequests], [100000, 100000, 100000, 10, 50]);
});

test("Cloudflare limit alerts: warn %, 95% and 100% once each per day, again after the reset", () => {
  const cfg = { errCount: 5, minHit: 0, cfWarn: 80 };
  const t = 1_000_000_000_000;
  const at = (day, used, prev) => evaluate(prev, { ping: null, now: t, cfg, cf: { day, meters: [{ id: "req", label: "Worker requests", used, limit: 100000 }] } });
  let r = at("2026-10-28", 79000, null);
  assert.equal(r.messages.length, 0);
  r = at("2026-10-28", 80500, r.state);
  assert.match(r.messages[0], /warning/);
  assert.match(r.messages[0], /80,500 \/ 100,000 today \(80%\)/);
  r = at("2026-10-28", 90000, r.state);
  assert.equal(r.messages.length, 0);
  r = at("2026-10-28", 96000, r.state);
  assert.match(r.messages[0], /almost reached/);
  r = at("2026-10-28", 100000, r.state);
  assert.match(r.messages[0], /reached/);
  r = at("2026-10-28", 120000, r.state);
  assert.equal(r.messages.length, 0);
  r = at("2026-10-29", 85000, r.state);
  assert.match(r.messages[0], /warning/); // new day, counters were reset
  assert.equal(evaluate(null, { now: t, cfg: { ...cfg, cfWarn: 0 }, cf: { day: "d", meters: [{ id: "req", label: "x", used: 99999, limit: 100000 }] } }).messages.length, 0); // 0 = off
});

test("usage.json counts every request (memory mode and Durable Object mode) and needs a login", async () => {
  resetAll();
  assert.equal((await call("/usage.json", { env: LOGENV })).res.status, 401);
  const usage = async (env) => jsonOf(await call("/usage.json", { env, headers: { cookie: AUTH } }));
  // memory mode
  let a = await usage(LOGENV);
  for (let i = 0; i < 4; i++) await call("/health", { env: LOGENV });
  let b = await usage(LOGENV);
  assert.equal(b.mode, "memory");
  assert.ok(b.meters.req.used >= a.meters.req.used + 4);
  assert.equal(b.meters.req.limit, 100000);
  assert.equal(b.reset_at - Date.parse(b.day + "T00:00:00Z"), 86400000);
  // Durable Object mode: counts go to the Durable Object (batched), the page adds what is not sent yet
  const { LOGS } = makeHub({ ...LOGENV });
  const env = { ...LOGENV, LOGS };
  a = await usage(env);
  for (let i = 0; i < 30; i++) await call("/health", { env });
  await call(plain(), { env, headers: { Range: "bytes=0-1048575" } });
  b = await usage(env);
  assert.equal(b.mode, "durable");
  assert.ok(b.meters.req.used >= a.meters.req.used + 31);
  assert.ok(b.meters.do.used > a.meters.do.used, "Durable Object requests are counted");
  assert.ok(b.meters.rows.used > 0, "Durable Object rows written are counted");
  assert.equal(b.meters.do.limit, 100000);
  assert.equal(b.sub_reserved, 10);
  // the limit and the alert level come from wrangler.toml vars
  const lim = await usage({ ...env, CF_REQ_LIMIT: "5000", CF_WARN_PCT: "60" });
  assert.deepEqual([lim.meters.req.limit, lim.warn_pct], [5000, 60]);
});

test("scheduled check sends a Telegram alert when a Cloudflare Free limit is nearly used up", async () => {
  resetAll();
  tgSent.length = 0;
  const base = { ...LOGENV, TG_BOT_TOKEN: "tok", TG_CHAT_ID: "42", CF_REQ_LIMIT: "10", CF_WARN_PCT: "50" };
  const { LOGS } = makeHub(base);
  const env = { ...base, LOGS };
  for (let i = 0; i < 30; i++) await call("/health", { env });
  const run = () => {
    const waits = [];
    return worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) }).then(() => Promise.all(waits));
  };
  await run();
  const msgs = tgSent.filter((m) => /Cloudflare Free limit/.test(m.text));
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].text, /Worker requests/);
  await run();
  assert.equal(tgSent.filter((m) => /Cloudflare Free limit/.test(m.text)).length, 1, "only once per level");
});

test("UI is small: only the Overview page, no polling, valid script", async () => {
  const { UI_HTML } = await import("../src/ui.js");
  for (const id of ["p-overview"]) assert.ok(UI_HTML.includes(`id="${id}"`), id);
  const script = /<script>([\s\S]*)<\/script>/.exec(UI_HTML)[1];
  assert.doesNotMatch(script, /setInterval/, "nothing refreshes by itself (every request counts against the Free plan)");
  for (const gone of ["p-log", "p-stats", "p-setup", "p-test", "p-config", "/logs.json", "/config", "/purge"]) assert.ok(!UI_HTML.includes(gone), gone + " was removed");
  const vm = await import("node:vm");
  assert.doesNotThrow(() => new vm.Script(script));
});
