/**
 * Flixora Stream Proxy - Cloudflare Worker (Free plan friendly)
 *
 * Sits in front of the Flixora backend's /dl and /dld routes.
 *  - Splits every Range request into fixed-size aligned chunks and caches each chunk
 *    in Cloudflare's edge cache -> repeat viewers / seeks never touch the VPS or Telegram.
 *  - Streams chunks straight through (no buffering), so first byte is fast.
 *  - Works with the backend's HTTP_PROXY_URL (plain "<proxy><url>" and MediaFlow style).
 *  - Verifies the backend's Turnstile download token itself (same HMAC) so cached
 *    chunks can not be used to bypass the download gate.
 *
 * Free plan limits respected: 50 subrequests / invocation (tracked per request),
 * 10 ms CPU (bodies are piped natively, no per-byte JS except on the 2 edge chunks).
 */

import { UI_HTML } from "./ui.js";
import { loginHtml } from "./login.js";
import { authConfigured, checkLogin, isAuthed, sessionCookie, clearCookie, lockStatus, lockFail, lockClear, memLocks } from "./auth.js";
import { applyEvent, snapshot, uaLabel, memEntries, memDays, memErrs, memUsage, addDaily, noteError, noteUsage, statsView, abuseLimitBytes, heavyClients, gateDecision, addDenied, bumpCf, cfView, memCf } from "./log.js";
import { FREE } from "./config.js";
import { alertConfig, pingBackends, sendTelegram, telegramReady } from "./alerts.js";

export { LogHub } from "./log.js";

const MIB = 1024 * 1024;
const SUBTITLE_EXT = new Set([".srt", ".vtt", ".ass", ".ssa", ".sub"]);
const RETRY_STATUS = new Set([429, 502, 503, 504]);
const SUBREQUEST_BUDGET = 44; // Free plan hard limit is 50; keep headroom
const MIN_BUDGET_FOR_CACHED_CHUNK = 4; // match + fetch + put (+1 spare)
const LOG_RESERVE = 10; // subrequests kept for the Durable Object activity log (only when LOGS is bound)

// chunk key -> promise of the cache.put that is storing it (same isolate only)
const pending = new Map();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const flag = (v, d) => (v === undefined || v === null || v === "" ? d : /^(1|true|yes|on)$/i.test(String(v)));

function countrySet(v) {
  return new Set(
    String(v || "")
      .split(/[\s,]+/)
      .map((x) => x.trim().toUpperCase())
      .filter((x) => /^[A-Z]{2}$/.test(x))
  );
}

function readConfig(env, hostname) {
  const chunkMB = Math.min(32, Math.max(1, Math.floor(num(env.CHUNK_MB, 4))));
  const cacheMode = String(env.ENABLE_CACHE || "auto").toLowerCase();
  const cacheOn = cacheMode === "true" || (cacheMode === "auto" && !hostname.endsWith(".workers.dev"));
  return {
    chunkMB,
    chunk: chunkMB * MIB,
    maxChunks: Math.max(1, Math.floor(num(env.MAX_CHUNKS, 12))),
    ttl: Math.floor(num(env.CACHE_TTL, 7 * 86400)),
    capOpenRanges: flag(env.CAP_OPEN_RANGES, true),
    prefetchNext: flag(env.PREFETCH_NEXT, true),
    backendTurnstile: flag(env.BACKEND_USES_TURNSTILE, true),
    allowHttp: flag(env.ALLOW_HTTP, false),
    originUrl: String(env.ORIGIN_URL || "").trim().replace(/\/+$/, ""),
    allowed: new Set(
      String(env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    ),
    cacheOn,
    blocked: countrySet(env.BLOCK_COUNTRIES),
  };
}

// ---------------------------------------------------------------- helpers

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Disposition, X-Flx-Cache",
  "Timing-Allow-Origin": "*",
};

function withCors(headers) {
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return headers;
}

function jsonError(status, message) {
  const h = withCors(new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }));
  return new Response(JSON.stringify({ error: message }), { status, headers: h });
}

function cancelBody(resp) {
  try {
    resp?.body?.cancel().catch(() => {});
  } catch (_) {
    /* ignore */
  }
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch (_) {
    return s;
  }
}

const TEXT = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Same algorithm as Backend/server/main.py::_sign_download_token */
async function verifyDownloadToken(secret, fileId, token) {
  const text = String(token || "");
  const expText = text.split(".")[0];
  if (!/^\d+$/.test(expText)) return false;
  const expires = Number(expText);
  if (expires < Math.floor(Date.now() / 1000)) return false;
  const idHash = hex(await crypto.subtle.digest("SHA-256", TEXT.encode(fileId))).slice(0, 24);
  const key = await crypto.subtle.importKey("raw", TEXT.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", key, TEXT.encode(`${expires}:${idHash}`))).slice(0, 32);
  return timingSafeEqual(`${expires}.${mac}`, text);
}

// ---------------------------------------------------------------- activity log helpers

const statsOffset = (env) => (Number.isFinite(Number(env.STATS_TZ_MIN)) && env.STATS_TZ_MIN !== "" && env.STATS_TZ_MIN != null ? Number(env.STATS_TZ_MIN) : 330);

async function clientHash(request) {
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (!ip) return "local";
  try {
    return hex(await crypto.subtle.digest("SHA-256", TEXT.encode(ip))).slice(0, 6);
  } catch (_) {
    return "anon";
  }
}

async function makeLogCtx(request, parsed, client) {
  const kind = parsed.isDownload ? "download" : "play";
  return {
    kind,
    sid: `${parsed.id}|${kind}|${client}`,
    meta: {
      client,
      country: request.cf?.country || request.headers.get("cf-ipcountry") || "",
      dev: uaLabel(request.headers.get("user-agent")),
    },
  };
}

// ---------------------------------------------------------------- target parsing

/**
 * Accepted incoming shapes (all end up as a backend /dl or /dld URL):
 *   plain     : https://proxy/https://api.example.com/dl/<id>/<name>
 *   mediaflow : https://proxy/proxy/stream?d=<encoded dl url>[&api_password=..][&r_content-disposition=..]
 *   short     : https://proxy/dl/<id>/<name>   (only when ORIGIN_URL is set)
 */
function parseTarget(url, c) {
  const p = url.pathname;
  let target = "";
  let overrideCD = "";

  if (p === "/proxy/stream") {
    target = url.searchParams.get("d") || "";
    overrideCD = url.searchParams.get("r_content-disposition") || "";
    if (!target) throw new HttpError(400, "Missing d parameter");
  } else if (/^\/https?:\/+/i.test(p)) {
    // some CDNs collapse "//" into "/" - accept both
    target = p.slice(1).replace(/^(https?):\/+/i, "$1://") + url.search;
  } else if (c.originUrl && /^\/(dl|dld)\//.test(p)) {
    target = c.originUrl + p + url.search;
  } else {
    return null;
  }

  let t;
  try {
    t = new URL(target);
  } catch (_) {
    throw new HttpError(400, "Bad target URL");
  }
  if (t.username || t.password) throw new HttpError(400, "Bad target URL");
  if (!(t.protocol === "https:" || (c.allowHttp && t.protocol === "http:"))) throw new HttpError(400, "Only https targets are allowed");
  if (!c.allowed.has(t.host.toLowerCase())) throw new HttpError(403, "Origin not allowed");

  const segs = t.pathname.split("/"); // ["", "dl", id, name]
  let kind, dt = "", id, name;
  if (segs[1] === "dl" && segs.length === 4) {
    kind = "dl";
    [, , id, name] = segs;
  } else if (segs[1] === "dld" && segs.length === 5) {
    kind = "dld";
    [, , dt, id, name] = segs;
  } else {
    throw new HttpError(403, "Only /dl and /dld links are proxied");
  }
  if (!id) throw new HttpError(400, "Missing file id");

  const params = t.searchParams;
  const truthy = (k) => /^(1|true|yes|on)$/i.test(params.get(k) || "");
  const isDownload = kind === "dld" || truthy("download") || truthy("dl") || truthy("attachment");
  const token = kind === "dld" ? safeDecode(dt) : params.get("dt") || "";
  const decodedName = safeDecode(name);
  const dot = decodedName.lastIndexOf(".");
  const ext = dot >= 0 ? decodedName.slice(dot).toLowerCase() : "";

  return {
    targetUrl: t.toString(),
    // stream URL without download flags / token - what the worker itself fetches chunks from
    streamUrl: `${t.origin}/dl/${id}/${name}`,
    kind,
    id,
    fileId: safeDecode(id),
    name: decodedName,
    isDownload,
    token,
    isSubtitle: SUBTITLE_EXT.has(ext),
    overrideCD,
  };
}

// ---------------------------------------------------------------- range handling

function parseRangeSpec(header) {
  if (!header) return { kind: "none" };
  if (header.includes(",")) return { kind: "bad" };
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m || (m[1] === "" && m[2] === "")) return { kind: "bad" };
  if (m[1] === "") return { kind: "suffix", n: Number(m[2]) };
  return { kind: "range", a: Number(m[1]), b: m[2] === "" ? null : Number(m[2]) };
}

/** -> {start, end} | null (unsatisfiable) */
function resolveRange(spec, size) {
  if (spec.kind === "none") return { start: 0, end: size - 1 };
  if (spec.kind === "suffix") {
    if (spec.n <= 0) return null;
    return { start: Math.max(size - spec.n, 0), end: size - 1 };
  }
  if (spec.a >= size) return null;
  const end = spec.b === null ? size - 1 : Math.min(spec.b, size - 1);
  if (end < spec.a) return null;
  return { start: spec.a, end };
}

function sliceStream(body, skip, take) {
  const reader = body.getReader();
  let seen = 0;
  let sent = 0;
  return new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return ctrl.close();
        let chunk = value;
        if (seen < skip) {
          const drop = Math.min(skip - seen, chunk.length);
          seen += drop;
          chunk = chunk.subarray(drop);
          if (!chunk.length) continue;
        }
        if (sent + chunk.length > take) chunk = chunk.subarray(0, take - sent);
        sent += chunk.length;
        ctrl.enqueue(chunk);
        if (sent >= take) {
          reader.cancel().catch(() => {});
          ctrl.close();
        }
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

// ---------------------------------------------------------------- origin access

async function fetchOrigin(url, headers, budget, tries = 2) {
  for (let i = 0; i <= tries; i++) {
    if (budget.left < 1) throw new HttpError(503, "Subrequest budget exhausted");
    budget.left--;
    let r;
    try {
      r = await fetch(url, { headers });
    } catch (_) {
      if (i < tries) {
        await sleep(300 * (i + 1));
        continue;
      }
      throw new HttpError(502, "Origin unreachable");
    }
    if (RETRY_STATUS.has(r.status) && i < tries) {
      const ra = Number(r.headers.get("retry-after"));
      cancelBody(r);
      await sleep(Math.min(3000, ra > 0 ? ra * 1000 : 400 * (i + 1)));
      continue;
    }
    return r;
  }
  throw new HttpError(502, "Origin unreachable");
}

function passthroughResponse(resp) {
  const h = new Headers(resp.headers);
  h.delete("content-encoding");
  withCors(h);
  h.set("X-Flx-Cache", "BYPASS");
  return new Response(resp.body, { status: resp.status, headers: h });
}

async function passthrough(request, targetUrl) {
  const headers = {};
  const range = request.headers.get("range");
  if (range) headers.Range = range;
  const r = await fetch(targetUrl, { method: request.method, headers });
  return passthroughResponse(r);
}

function downloadDisposition(meta, parsed) {
  if (parsed.overrideCD) return parsed.overrideCD;
  if (meta.cd) return meta.cd.replace(/^\s*inline/i, "attachment");
  const safe = (parsed.name || "video.mkv").replace(/["\r\n\\/]/g, "_");
  return `attachment; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

// ---------------------------------------------------------------- main serve

async function serve(request, ctx, c, parsed, reqUrl, env, client) {
  const cache = caches.default;
  const base = reqUrl.origin;
  const budget = { left: SUBREQUEST_BUDGET - (env.LOGS ? LOG_RESERVE : 0), logLeft: LOG_RESERVE };
  const C = c.chunk;
  const chunkKey = (i) => `${base}/__flx/c/${parsed.id}/${c.chunkMB}/${i}`;
  const metaKey = `${base}/__flx/m/${parsed.id}`;

  const metaFromHeaders = (h) => {
    const size = Number(h.get("x-flx-size"));
    if (!Number.isFinite(size) || size <= 0) return null;
    return { size, type: h.get("x-flx-type") || "application/octet-stream", cd: safeDecode(h.get("x-flx-cd") || "") };
  };

  function storeChunk(key, body, len, meta) {
    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "Content-Length": String(len),
      "Cache-Control": `public, max-age=${c.ttl}`,
      "X-Flx-Len": String(len),
      "X-Flx-Size": String(meta.size),
      "X-Flx-Type": meta.type,
      "X-Flx-CD": encodeURIComponent(meta.cd),
    });
    const p = (async () => {
      try {
        await cache.put(key, new Response(body, { status: 200, headers }));
      } catch (_) {
        /* cache is best effort */
      }
    })();
    pending.set(key, p);
    p.finally(() => pending.delete(key));
    ctx.waitUntil(p);
  }

  function storeMeta(meta) {
    if (!c.cacheOn || budget.left < 1) return;
    budget.left--;
    const h = new Headers({ "Content-Type": "application/json", "Cache-Control": `public, max-age=${c.ttl}` });
    ctx.waitUntil(cache.put(metaKey, new Response(JSON.stringify(meta), { status: 200, headers: h })).catch(() => {}));
  }

  async function getMeta() {
    if (!c.cacheOn || budget.left < 1) return null;
    budget.left--;
    try {
      const r = await cache.match(metaKey);
      if (r) return await r.json();
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  /** Learn size/type with a 1-byte origin range (only for HEAD and suffix ranges). */
  async function probeMeta() {
    const r = await fetchOrigin(parsed.streamUrl, { Range: "bytes=0-0" }, budget);
    if (r.status === 200) return { passthrough: r };
    if (r.status !== 206) {
      cancelBody(r);
      throw new HttpError(r.status === 404 || r.status === 403 ? r.status : 502, `Origin returned ${r.status}`);
    }
    const cr = /bytes \d+-\d+\/(\d+)/i.exec(r.headers.get("content-range") || "");
    cancelBody(r);
    if (!cr) throw new HttpError(502, "Origin sent no Content-Range");
    const meta = {
      size: Number(cr[1]),
      type: r.headers.get("content-type") || "application/octet-stream",
      cd: r.headers.get("content-disposition") || "",
    };
    storeMeta(meta);
    return meta;
  }

  async function openChunk(idx) {
    const key = chunkKey(idx);
    if (c.cacheOn) {
      const inflight = pending.get(key);
      if (inflight) await Promise.race([inflight, sleep(15000)]); // another viewer is already pulling it
      if (budget.left >= 1) {
        budget.left--;
        let hit = null;
        try {
          hit = await cache.match(key);
        } catch (_) {
          /* treat as miss */
        }
        if (hit && hit.body) {
          const len = Number(hit.headers.get("x-flx-len"));
          const meta = metaFromHeaders(hit.headers);
          if (len > 0 && meta) {
            return { hit: true, len, meta, getBody: () => hit.body, cancel: () => cancelBody(hit) };
          }
          cancelBody(hit);
        }
      }
    }

    const s = idx * C;
    const r = await fetchOrigin(parsed.streamUrl, { Range: `bytes=${s}-${s + C - 1}` }, budget);
    if (r.status === 416) {
      const m = /\*\/(\d+)/.exec(r.headers.get("content-range") || "");
      cancelBody(r);
      return { unsatisfiable: true, size: m ? Number(m[1]) : null };
    }
    if (r.status === 200) return { passthrough: r };
    if (r.status !== 206) {
      cancelBody(r);
      throw new HttpError(r.status === 404 || r.status === 403 ? r.status : 502, `Origin returned ${r.status}`);
    }
    const cr = /bytes (\d+)-(\d+)\/(\d+)/i.exec(r.headers.get("content-range") || "");
    if (!cr || Number(cr[1]) !== s) {
      cancelBody(r);
      throw new HttpError(502, "Origin sent an unexpected Content-Range");
    }
    const len = Number(cr[2]) - Number(cr[1]) + 1;
    const meta = {
      size: Number(cr[3]),
      type: r.headers.get("content-type") || "application/octet-stream",
      cd: r.headers.get("content-disposition") || "",
    };
    let body = null;
    return {
      hit: false,
      len,
      meta,
      getBody() {
        if (body) return body;
        if (c.cacheOn && budget.left >= 1) {
          budget.left--;
          const [client, store] = r.body.tee();
          body = client;
          storeChunk(key, store, len, meta);
        } else {
          body = r.body;
        }
        return body;
      },
      cancel() {
        (body || r.body).cancel().catch(() => {});
      },
    };
  }

  function buildHeaders(m, r, isPartial, cacheTag) {
    const h = new Headers();
    h.set("Content-Type", parsed.isDownload ? "application/octet-stream" : m.type);
    h.set("Accept-Ranges", "bytes");
    h.set("Content-Length", String(r.end - r.start + 1));
    if (isPartial) h.set("Content-Range", `bytes ${r.start}-${r.end}/${m.size}`);
    if (parsed.isDownload) {
      h.set("Content-Disposition", downloadDisposition(m, parsed));
      h.set("Cache-Control", "private, no-store");
    } else {
      if (m.cd) h.set("Content-Disposition", m.cd);
      h.set("Cache-Control", "private, max-age=3600");
    }
    h.set("X-Flx-Cache", cacheTag);
    return withCors(h);
  }

  function rangeNotSatisfiable(size) {
    const h = withCors(new Headers({ "Content-Range": `bytes */${size}`, "Cache-Control": "no-store" }));
    return new Response(null, { status: 416, headers: h });
  }

  const spec = parseRangeSpec(request.headers.get("range"));
  if (spec.kind === "bad") return passthrough(request, parsed.targetUrl);

  // ---- HEAD: answer from metadata only, never start a Telegram download
  if (request.method === "HEAD") {
    let meta = await getMeta();
    if (!meta) {
      meta = await probeMeta();
      if (meta.passthrough) return passthroughResponse(meta.passthrough);
    }
    const rng = resolveRange(spec, meta.size);
    if (!rng) return rangeNotSatisfiable(meta.size);
    return new Response(null, {
      status: spec.kind === "none" ? 200 : 206,
      headers: buildHeaders(meta, rng, spec.kind !== "none", "META"),
    });
  }

  // ---- GET
  let meta = null;
  let startByte;
  if (spec.kind === "suffix") {
    meta = (await getMeta()) || (await probeMeta());
    if (meta.passthrough) return passthroughResponse(meta.passthrough);
    startByte = Math.max(meta.size - spec.n, 0);
  } else {
    startByte = spec.kind === "none" ? 0 : spec.a;
  }
  const startIdx = Math.floor(startByte / C);

  const first = await openChunk(startIdx);
  if (first.passthrough) return passthroughResponse(first.passthrough);
  if (first.unsatisfiable) return rangeNotSatisfiable(first.size ?? meta?.size ?? 0);
  if (!meta || meta.size !== first.meta.size) {
    meta = first.meta;
    if (!first.hit) storeMeta(meta);
  }

  const rng = resolveRange(spec, meta.size);
  if (!rng) {
    first.cancel();
    return rangeNotSatisfiable(meta.size);
  }
  const { start } = rng;
  let { end } = rng;
  const partial = spec.kind !== "none";
  // players re-request the next range themselves; this keeps every request cacheable & under the subrequest limit
  if (c.capOpenRanges && !parsed.isDownload && spec.kind === "range" && spec.b === null) {
    end = Math.min(end, (startIdx + c.maxChunks) * C - 1);
  }

  const headers = buildHeaders(meta, { start, end }, partial, first.hit ? "HIT" : "MISS");

  // FixedLengthStream makes Cloudflare send a real Content-Length (otherwise it falls back to chunked -> "size ?")
  const { readable, writable } =
    typeof FixedLengthStream !== "undefined" ? new FixedLengthStream(end - start + 1) : new TransformStream();

  // ---- activity log (best effort - never blocks or breaks the stream)
  const t0 = Date.now();
  const logCtx = await makeLogCtx(request, parsed, client);
  const rid = Math.random().toString(36).slice(2, 8);
  const send = (ev, final) => {
    ev.sid = logCtx.sid;
    ev.rid = rid;
    try {
      if (!env.LOGS) {
        const now = Date.now();
        applyEvent(memEntries, ev, now);
        addDaily(memDays, ev, now, statsOffset(env));
        noteError(memErrs, ev, now);
        const warn = noteUsage(memUsage, ev, now, abuseLimitBytes(env));
        if (warn) ctx.waitUntil(sendTelegram(env, warn));
        return;
      }
      if (budget.logLeft < (final ? 1 : 2)) return; // always keep one call for the final event
      budget.logLeft--;
      const stub = env.LOGS.get(env.LOGS.idFromName("main"));
      ctx.waitUntil(
        stub
          .fetch("https://log/event", { method: "POST", body: JSON.stringify(ev) })
          .then((r) => cancelBody(r))
          .catch(() => {})
      );
    } catch (_) {
      /* logging must never affect streaming */
    }
  };
  send({ type: "start", ...logCtx.meta, kind: logCtx.kind, name: parsed.name, total: meta.size, range: `${start}-${end}` });

  async function pump() {
    let pos = start;
    let idx = startIdx;
    let src = first;
    let nextP = null;
    let hits = 0;
    let misses = 0;
    let hitBytes = 0;
    let missBytes = 0;
    let nextReportAt = 3000; // progress events at ~3s, 6.6s, 14s, 32s ... (few subrequests)
    const report = (type, state, err) => {
      const ms = Date.now() - t0;
      const sent = Math.max(0, pos - start);
      send({ type, state, err, sent, ms, h: hits, m: misses, hb: hitBytes, mb: missBytes, name: parsed.name, bps: ms > 0 ? Math.round((sent * 1000) / ms) : 0 }, type === "end");
    };
    try {
      while (pos <= end) {
        if (!src) {
          if (budget.left < MIN_BUDGET_FOR_CACHED_CHUNK) {
            // out of subrequests: stream the remainder straight from the origin in one request
            const r = await fetchOrigin(parsed.streamUrl, { Range: `bytes=${pos}-${end}` }, budget, 1);
            if (r.status !== 206) {
              cancelBody(r);
              throw new HttpError(502, `Origin returned ${r.status}`);
            }
            await r.body.pipeTo(writable, { preventClose: true });
            pos = end + 1;
            break;
          }
          src = nextP ? await nextP : await openChunk(idx);
          nextP = null;
          if (src.error) throw src.error;
          if (src.passthrough || src.unsatisfiable) {
            cancelBody(src.passthrough);
            throw new HttpError(502, "Origin ignored the chunk range");
          }
        }
        const chunkStart = idx * C;
        const skip = pos - chunkStart;
        const take = Math.min(end, chunkStart + src.len - 1) - pos + 1;
        if (take <= 0) throw new HttpError(502, "Origin chunk shorter than expected");

        // look up / start the next chunk while this one streams
        if (c.prefetchNext && (idx + 1) * C <= end && budget.left >= MIN_BUDGET_FOR_CACHED_CHUNK + 2) {
          nextP = openChunk(idx + 1).catch((error) => ({ error }));
        }

        let body = src.getBody();
        if (skip > 0 || take < src.len) body = sliceStream(body, skip, take);
        await body.pipeTo(writable, { preventClose: true });
        pos += take;
        idx++;
        if (src.hit) {
          hits++;
          hitBytes += take;
        } else {
          misses++;
          missBytes += take;
        }
        src = null;
        if (Date.now() - t0 >= nextReportAt) {
          report("progress");
          nextReportAt *= 2.2;
        }
      }
      await writable.getWriter().close();
      report("end", "done");
    } catch (e) {
      report("end", e instanceof HttpError ? "error" : "aborted", e instanceof HttpError ? e.message : "");
      try {
        await writable.abort(e);
      } catch (_) {
        /* client already gone */
      }
      try {
        src?.cancel?.();
      } catch (_) {
        /* ignore */
      }
      if (nextP) nextP.then((s) => s?.cancel?.()).catch(() => {});
    }
  }

  ctx.waitUntil(pump());
  return new Response(readable, { status: partial ? 206 : 200, headers });
}

// ---------------------------------------------------------------- Cloudflare request counter (Free plan: 100,000 / day)

const meter = { n: 0, last: 0 };
const FLUSH_N = 25; // send the count to the Durable Object every 25 requests ...
const FLUSH_MS = 20000; // ... or after 20 s, whichever comes first (one tiny call instead of one per request)

function noteRequest(env, ctx) {
  const now = Date.now();
  if (!env.LOGS) {
    bumpCf(memCf, now, { q: 1 });
    return;
  }
  meter.n++;
  if (meter.n < FLUSH_N && now - meter.last < FLUSH_MS) return;
  const n = meter.n;
  meter.n = 0;
  meter.last = now;
  try {
    const stub = env.LOGS.get(env.LOGS.idFromName("main"));
    ctx.waitUntil(
      stub
        .fetch("https://log/count", { method: "POST", body: JSON.stringify({ n }) })
        .then((r) => cancelBody(r))
        .catch(() => {})
    );
  } catch (_) {
    /* counting must never affect a request */
  }
}

// ---------------------------------------------------------------- per-client limits

const intVar = (v, d) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? d : Math.max(0, Math.floor(Number(v))));
const limitsOf = (env) => ({ maxReqs: intVar(env.MAX_CLIENT_REQS, 24), maxFiles: intVar(env.MAX_CLIENT_FILES, 6) });

/** 429 Response when this client is over its limits, else null. Fails open (never blocks on a DO problem). */
async function clientGate(env, c, parsed, client) {
  const { maxReqs, maxFiles } = limitsOf(env);
  if (!maxReqs && !maxFiles) return null;
  const kind = parsed.isDownload ? "download" : "play";
  const body = { client, sid: `${parsed.id}|${kind}|${client}`, maxReqs, maxFiles };
  let r;
  try {
    if (env.LOGS) {
      const stub = env.LOGS.get(env.LOGS.idFromName("main"));
      const resp = await Promise.race([stub.fetch("https://log/gate", { method: "POST", body: JSON.stringify(body) }), sleep(1500).then(() => null)]);
      r = resp ? await resp.json() : { ok: true };
    } else {
      const now = Date.now();
      r = gateDecision(memEntries, body, now);
      if (!r.ok) addDenied(memDays, now, statsOffset(env));
    }
  } catch (_) {
    return null;
  }
  if (r.ok) return null;
  const h = withCors(new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "5" }));
  return new Response(JSON.stringify({ error: r.reason }), { status: 429, headers: h });
}

// ---------------------------------------------------------------- login lockout (DO when bound, else per-isolate memory)

async function lockOp(env, op, key) {
  try {
    if (env.LOGS) {
      const stub = env.LOGS.get(env.LOGS.idFromName("main"));
      return await (await stub.fetch("https://log/lock", { method: "POST", body: JSON.stringify({ op, key }) })).json();
    }
  } catch (_) {
    return { locked: false, retry: 0 };
  }
  const now = Date.now();
  if (op === "check") return lockStatus(memLocks, key, now);
  if (op === "clear") return void lockClear(memLocks, key) || { ok: true };
  return lockFail(memLocks, key, now);
}

// ---------------------------------------------------------------- scheduled alert check

async function runChecks(env) {
  const ping = await pingBackends(env);
  if (!env.LOGS) return; // alert state needs the Durable Object
  try {
    const stub = env.LOGS.get(env.LOGS.idFromName("main"));
    const r = await stub.fetch("https://log/alerts", { method: "POST", body: JSON.stringify({ ping, cfg: alertConfig(env) }) });
    const d = await r.json();
    for (const m of d.messages || []) await sendTelegram(env, m);
  } catch (_) {
    /* next run will try again */
  }
}

// ---------------------------------------------------------------- entry

async function handle(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    const h = withCors(new Headers());
    h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Range, Content-Type, If-Range");
    h.set("Access-Control-Max-Age", "86400");
    return new Response(null, { status: 204, headers: h });
  }
  const c = readConfig(env, url.hostname);
  const isPostRoute = request.method === "POST" && ["/logs/clear", "/login", "/logout", "/alerts/test"].includes(url.pathname);
  if (request.method !== "GET" && request.method !== "HEAD" && !isPostRoute) return jsonError(405, "Method not allowed");
  const secure = url.protocol === "https:";

  if (url.pathname === "/login") {
    if (request.method !== "POST") return jsonError(405, "Use POST");
    if (!authConfigured(env)) return jsonError(403, "UI_USER / UI_PASS are not set on the worker");
    if (!(request.headers.get("content-type") || "").includes("application/json")) return jsonError(400, "Send JSON");
    let body;
    try {
      const text = await request.text();
      if (text.length > 2048) throw new Error("too big");
      body = JSON.parse(text);
    } catch (_) {
      return jsonError(400, "Bad request");
    }
    const who = "login:" + (await clientHash(request));
    const lock = await lockOp(env, "check", who);
    if (lock.locked) {
      const h = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Retry-After": String(lock.retry) });
      return new Response(JSON.stringify({ error: `Too many wrong passwords. Try again in ${Math.max(1, Math.ceil(lock.retry / 60))} min.` }), { status: 429, headers: h });
    }
    if (!(await checkLogin(env, String(body?.user ?? ""), String(body?.pass ?? "")))) {
      await new Promise((r) => setTimeout(r, 700)); // slow down guessing
      const f = await lockOp(env, "fail", who);
      if (f.justLocked) {
        const where = String(request.cf?.country || request.headers.get("cf-ipcountry") || "?");
        ctx.waitUntil(sendTelegram(env, `🔒 Flixora UI: 5 wrong passwords from client #${who.slice(6)} (${where}). Login locked for 15 minutes.`));
      }
      return jsonError(401, "Wrong username or password");
    }
    await lockOp(env, "clear", who);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": await sessionCookie(env, secure) },
    });
  }
  if (url.pathname === "/logout") {
    if (request.method !== "POST") return jsonError(405, "Use POST");
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": clearCookie(secure) },
    });
  }

  const wantsHtml = (request.headers.get("accept") || "").includes("text/html");
  if (url.pathname === "/ui" || (url.pathname === "/" && wantsHtml)) {
    const authed = await isAuthed(request, env);
    return new Response(request.method === "HEAD" ? null : authed ? UI_HTML : loginHtml(authConfigured(env)), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src https://fonts.gstatic.com https://cdnjs.cloudflare.com; script-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      },
    });
  }

  if (url.pathname === "/" || url.pathname === "/health") {
    return new Response(
      JSON.stringify({
        name: "flixora-proxy",
        ok: c.allowed.size > 0,
        chunk_mb: c.chunkMB,
        max_chunks: c.maxChunks,
        edge_cache: c.cacheOn,
        prefetch_next: c.prefetchNext,
        cap_open_ranges: c.capOpenRanges,
        backend_turnstile: c.backendTurnstile,
        download_token_check: Boolean(env.TURNSTILE_SECRET),
        origins: c.allowed.size,
        blocked_countries: c.blocked.size,
        note: c.allowed.size ? undefined : "ALLOWED_ORIGINS is not configured",
      }),
      { headers: withCors(new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" })) }
    );
  }

  if (url.pathname === "/logs.json" || url.pathname === "/logs/clear") {
    if (!authConfigured(env)) return jsonError(403, "UI_USER / UI_PASS are not set on the worker");
    if (!(await isAuthed(request, env))) return jsonError(401, "Sign in required");
    const plain = (obj) =>
      new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    try {
      const stub = env.LOGS ? env.LOGS.get(env.LOGS.idFromName("main")) : null;
      if (url.pathname === "/logs/clear") {
        if (request.method !== "POST") return jsonError(405, "Use POST");
        if (stub) await stub.fetch("https://log/clear", { method: "POST" });
        else memEntries.length = 0;
        return plain({ ok: true });
      }
      if (stub) {
        const d = await (await stub.fetch("https://log/list")).json();
        return plain({ mode: "durable", now: Date.now(), entries: d.entries || [] });
      }
      return plain({ mode: "memory", now: Date.now(), entries: snapshot(memEntries, Date.now()) });
    } catch (_) {
      return jsonError(502, "Log store unavailable");
    }
  }

  if (["/status.json", "/stats.json", "/usage.json", "/alerts/test"].includes(url.pathname)) {
    if (!authConfigured(env)) return jsonError(403, "UI_USER / UI_PASS are not set on the worker");
    if (!(await isAuthed(request, env))) return jsonError(401, "Sign in required");
    const plain = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    const stub = env.LOGS ? env.LOGS.get(env.LOGS.idFromName("main")) : null;

    if (url.pathname === "/status.json") {
      const cfg = alertConfig(env);
      return plain({
        backend: await pingBackends(env),
        telegram: telegramReady(env),
        alerts_need_do: !env.LOGS,
        alert_errors: cfg.errCount,
        alert_min_hit: cfg.minHit,
        blocked_countries: [...countrySet(env.BLOCK_COUNTRIES)],
        abuse_gb: abuseLimitBytes(env) / 1073741824,
        ...(() => {
          const l = limitsOf(env);
          return { max_reqs: l.maxReqs, max_files: l.maxFiles };
        })(),
      });
    }
    if (url.pathname === "/stats.json") {
      try {
        if (stub) return plain({ mode: "durable", ...(await (await stub.fetch("https://log/stats")).json()) });
        return plain({
          mode: "memory",
          ...statsView(memDays, Date.now(), statsOffset(env)),
          heavy: heavyClients(memUsage, memEntries, Date.now()),
          abuse_gb: abuseLimitBytes(env) / 1073741824,
        });
      } catch (_) {
        return jsonError(502, "Stats store unavailable");
      }
    }
    if (url.pathname === "/usage.json") {
      const now = Date.now();
      let u;
      let mode = "memory";
      if (stub) {
        try {
          u = await (await stub.fetch("https://log/usage")).json();
          u.q += meter.n; // requests of this instance not sent to the Durable Object yet
          mode = "durable";
        } catch (_) {
          return jsonError(502, "Usage store unavailable");
        }
      } else {
        u = cfView(memCf, now);
      }
      const cfg = alertConfig(env);
      const dayStart = Date.parse(u.day + "T00:00:00Z");
      const elapsed = now - dayStart;
      return plain({
        mode,
        now,
        day: u.day,
        reset_at: dayStart + 86400000,
        warn_pct: cfg.cfWarn,
        meters: {
          req: { used: u.q, limit: cfg.cfLimit },
          do: { used: u.dr, limit: FREE.doRequestsDay },
          rows: { used: u.dw, limit: FREE.doRowsWrittenDay },
        },
        projected: elapsed > 3600000 ? Math.round((u.q * 86400000) / elapsed) : null,
        free: FREE,
        chunk_mb: c.chunkMB,
        sub_budget: SUBREQUEST_BUDGET - (env.LOGS ? LOG_RESERVE : 0),
        sub_reserved: env.LOGS ? LOG_RESERVE : 0,
      });
    }
    if (request.method !== "POST") return jsonError(405, "Use POST");
    if (url.pathname === "/alerts/test") {
      if (!telegramReady(env)) return jsonError(400, "TG_BOT_TOKEN / TG_CHAT_ID are not set on the worker");
      const ok = await sendTelegram(env, "✅ Flixora proxy: test alert. Telegram alerts are working.");
      return ok ? plain({ ok: true }) : jsonError(502, "Telegram rejected the message (check token and chat id)");
    }
    return jsonError(404, "Not found");
  }

  if (c.blocked.size) {
    const country = String(request.cf?.country || request.headers.get("cf-ipcountry") || "").toUpperCase();
    if (country && c.blocked.has(country)) return jsonError(403, "Not available in your region");
  }

  if (!c.allowed.size) return jsonError(500, "ALLOWED_ORIGINS is not configured");

  let parsed;
  try {
    parsed = parseTarget(url, c);
  } catch (e) {
    if (e instanceof HttpError) return jsonError(e.status, e.message);
    throw e;
  }
  if (!parsed) return jsonError(404, "Not found");

  // subtitles are tiny and the backend serves them with its own rules
  if (parsed.isSubtitle) return passthrough(request, parsed.targetUrl);

  if (parsed.isDownload && c.backendTurnstile) {
    if (!env.TURNSTILE_SECRET) {
      // can not verify here -> let the backend enforce its gate, and do not cache
      return passthrough(request, parsed.targetUrl);
    }
    if (!(await verifyDownloadToken(String(env.TURNSTILE_SECRET), parsed.fileId, parsed.token))) {
      return jsonError(403, "Verification required before downloading");
    }
  }

  const client = await clientHash(request);
  if (request.method === "GET") {
    const denied = await clientGate(env, c, parsed, client);
    if (denied) return denied;
  }
  return serve(request, ctx, c, parsed, url, env, client);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runChecks(env));
  },
  async fetch(request, env, ctx) {
    noteRequest(env, ctx);
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return jsonError(e.status, e.message);
      return jsonError(502, "Proxy error");
    }
  },
};

export { parseRangeSpec, resolveRange, verifyDownloadToken };
