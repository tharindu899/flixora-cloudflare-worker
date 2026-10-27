const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Range, Content-Type, If-Range, If-None-Match",
  "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range, Content-Disposition, Content-Type, ETag, Last-Modified",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: CORS });
    if (url.pathname !== "/proxy/stream") return new Response("Not found", { status: 404, headers: CORS });

    // Require a shared secret so the Worker cannot be abused as an open proxy.
    const supplied = url.searchParams.get("key") || "";
    if (!env.PROXY_KEY || supplied.length !== env.PROXY_KEY.length || !timingSafeEqual(supplied, env.PROXY_KEY)) {
      return new Response("Unauthorized", { status: 401, headers: CORS });
    }

    const target = url.searchParams.get("d");
    if (!target) return new Response("Missing d URL", { status: 400, headers: CORS });
    let upstream;
    try { upstream = new URL(target); } catch { return new Response("Invalid upstream URL", { status: 400, headers: CORS }); }
    const allowed = (env.BACKEND_ORIGIN || "").replace(/\/$/, "");
    if (!allowed || upstream.origin !== allowed || upstream.protocol !== "https:") {
      return new Response("Upstream host not allowed", { status: 403, headers: CORS });
    }

    const headers = new Headers();
    for (const name of ["range", "if-range", "if-none-match", "if-modified-since"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const upstreamResponse = await fetch(new Request(upstream.toString(), {
      method: request.method,
      headers,
      redirect: "manual",
    }));

    // Do not cache private/tokenized media responses. Stream the body without buffering it in JS.
    const out = new Headers(CORS);
    for (const name of ["accept-ranges", "content-length", "content-range", "content-disposition", "content-type", "etag", "last-modified", "expires"]) {
      const value = upstreamResponse.headers.get(name);
      if (value) out.set(name, value);
    }
    if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
      return new Response("Upstream redirect refused", { status: 502, headers: out });
    }
    return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: out,
    });
  },
};

function timingSafeEqual(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
