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
  assert.doesNotMatch(html, /Live log/);
  r = await call("/ui", { env: LOGENV, headers: { cookie: AUTH } });
  html = new TextDecoder().decode(r.body);
  assert.match(html, /Live log/);
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
  assert.deepEqual(alertConfig({}), { errCount: 5, minHit: 0 });
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

test("purge removes every cached chunk of a file (works with a backend link or a proxy link)", async () => {
  resetAll();
  await call(plain(), { env: LOGENV, headers: { Range: "bytes=0-" } }); // caches MAX_CHUNKS=3 chunks
  const countFile = () => [...store.keys()].filter((k) => k.includes(`/${FILE_ID}`)).length;
  assert.ok(countFile() >= 4); // meta + chunks
  assert.equal((await call("/purge", { env: LOGENV, method: "POST", headers: { "content-type": "application/json" }, payload: "{}" })).res.status, 401);
  assert.equal((await postJson("/purge", { url: "" })).res.status, 400);
  assert.equal((await postJson("/purge", { url: "https://evil.example.com/dl/x/y.mkv" })).res.status, 403);
  const r = await postJson("/purge", { url: `https://${HOST}/dl/${FILE_ID}/movie.mkv` });
  const d = jsonOf(r);
  assert.equal(d.total, 6);
  assert.equal(d.next, null);
  assert.ok(d.deleted >= 3);
  assert.equal(countFile(), 0);
  // same through the proxy link
  await call(plain(), { env: LOGENV, headers: { Range: "bytes=0-" } });
  const d2 = jsonOf(await postJson("/purge", { url: `https://stream.example.org${plain()}` }));
  assert.equal(d2.next, null);
  assert.equal(countFile(), 0);
  originCalls = [];
  const again = await call(plain(), { env: LOGENV, headers: { Range: "bytes=0-10" } });
  assert.equal(again.res.headers.get("x-flx-cache"), "MISS");
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
