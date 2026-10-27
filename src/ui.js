/**
 * Flixora Proxy - Dracula status & link-tester page (served at "/" for browsers and at "/ui").
 * Pure static HTML: live data comes from /health and from the tester hitting this same worker.
 * NOTE: String.raw template - keep backticks and dollar-brace sequences out of the page code.
 */
export const UI_HTML = String.raw`<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#282a36">
<title>Flixora Proxy</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%A7%9B%3C/text%3E%3C/svg%3E">
<style>
:root{
  --bg:#282a36;--bg2:#21222c;--line:#44475a;--fg:#f8f8f2;--mute:#6272a4;
  --cyan:#8be9fd;--green:#50fa7b;--orange:#ffb86c;--pink:#ff79c6;--purple:#bd93f9;--red:#ff5555;--yellow:#f1fa8c;
  --glow:rgba(189,147,249,.18);
}
:root[data-theme="light"]{
  --bg:#fffbeb;--bg2:#f4efd8;--line:#cfcfde;--fg:#1f1f1f;--mute:#6c664b;
  --cyan:#036a96;--green:#14710a;--orange:#a34d14;--pink:#a3144d;--purple:#644ac9;--red:#cb3a2a;--yellow:#846e15;
  --glow:rgba(100,74,201,.12);
}
*{box-sizing:border-box;margin:0}
html{scroll-padding-top:env(safe-area-inset-top,0px)}
body{
  background:radial-gradient(900px 400px at 85% -10%,var(--glow),transparent 60%),var(--bg);
  color:var(--fg);min-height:100vh;line-height:1.5;
  font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  padding:calc(18px + env(safe-area-inset-top,0px)) 16px calc(28px + env(safe-area-inset-bottom,0px));
}
.mono,code,pre,input{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wrap{max-width:880px;margin:0 auto}
header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:22px}
.logo{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:22px;
  background:linear-gradient(135deg,var(--purple),var(--pink));box-shadow:0 6px 22px var(--glow)}
h1{font-size:22px;letter-spacing:.2px}
h1 span{color:var(--pink)}
.sub{color:var(--mute);font-size:13px}
.grow{flex:1}
.pill{display:inline-flex;align-items:center;gap:7px;padding:5px 12px;border-radius:999px;font-size:13px;
  border:1px solid var(--line);background:var(--bg2)}
.dot{width:9px;height:9px;border-radius:50%;background:var(--mute)}
.ok .dot{background:var(--green);box-shadow:0 0 8px var(--green)}
.bad .dot{background:var(--red);box-shadow:0 0 8px var(--red)}
button{font:inherit;color:var(--fg);cursor:pointer;border:1px solid var(--line);background:var(--bg2);
  padding:8px 14px;border-radius:10px;transition:.15s}
button:hover{border-color:var(--purple);color:var(--purple)}
button.primary{background:var(--purple);border-color:var(--purple);color:#282a36;font-weight:600}
button.primary:hover{background:var(--pink);border-color:var(--pink);color:#282a36}
button:disabled{opacity:.5;cursor:wait}
.icon{padding:6px 11px}
section{background:var(--bg2);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:16px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:1.2px;color:var(--purple);margin-bottom:14px;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.stat{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.stat small{display:block;color:var(--mute);font-size:12px;margin-bottom:3px}
.stat b{font-size:18px;font-weight:700}
.c-g{color:var(--green)}.c-r{color:var(--red)}.c-o{color:var(--orange)}.c-c{color:var(--cyan)}.c-p{color:var(--pink)}.c-y{color:var(--yellow)}.c-m{color:var(--mute)}
.row{display:flex;gap:8px;flex-wrap:wrap}
input{flex:1;min-width:0;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:10px;
  padding:10px 12px;font-size:13px;outline:none}
input:focus{border-color:var(--cyan);box-shadow:0 0 0 3px var(--glow)}
.hint{color:var(--mute);font-size:12.5px;margin-top:8px}
.out{margin-top:14px;display:none}
.proxyurl{background:var(--bg);border:1px dashed var(--line);border-radius:10px;padding:10px 12px;font-size:12.5px;
  color:var(--cyan);word-break:break-all;display:flex;gap:10px;align-items:flex-start}
.proxyurl span{flex:1}
.badge{display:inline-block;padding:2px 9px;border-radius:6px;font-size:12px;font-weight:700;margin-right:6px}
.b-g{background:rgba(80,250,123,.15);color:var(--green)}.b-r{background:rgba(255,85,85,.15);color:var(--red)}
.b-o{background:rgba(255,184,108,.15);color:var(--orange)}.b-p{background:rgba(255,121,198,.15);color:var(--pink)}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
td{padding:7px 4px;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-all}
td:first-child{color:var(--mute);white-space:nowrap;padding-right:14px}
tr:last-child td{border-bottom:0}
ul.checks{list-style:none;padding:0;margin-top:12px;display:grid;gap:6px;font-size:13.5px}
ul.checks li::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:9px}
.ck-ok::before{background:var(--green)}.ck-no::before{background:var(--red)}.ck-wa::before{background:var(--orange)}
.hist{font-size:12.5px;color:var(--mute);margin-top:12px;display:grid;gap:4px}
pre{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:11px 12px;font-size:12.5px;
  overflow-x:auto;color:var(--fg);margin-top:8px}
.ep{margin-bottom:14px}
.ep:last-child{margin-bottom:0}
.ep h3{font-size:14px;color:var(--cyan);font-weight:600}
.ep p{color:var(--mute);font-size:13px}
.flow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px}
.node{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:7px 12px}
.arrow{color:var(--pink)}
footer{text-align:center;color:var(--mute);font-size:12.5px;margin-top:22px}
footer a{color:var(--purple)}
.toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom,0px));transform:translate(-50%,30px);
  background:var(--purple);color:#282a36;font-weight:600;padding:8px 16px;border-radius:10px;opacity:0;
  transition:.25s;pointer-events:none}
.toast.show{opacity:1;transform:translate(-50%,0)}
.chip{padding:5px 12px;border-radius:999px;font-size:13px}
.chip.on{background:var(--purple);border-color:var(--purple);color:#282a36;font-weight:600}
.loglist{display:grid;gap:10px;margin-top:14px}
.le{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.le.act{border-color:var(--green);box-shadow:0 0 0 3px rgba(80,250,123,.08)}
.le-top{display:flex;align-items:center;gap:9px}
.ico{font-size:15px;width:22px;text-align:center}
.fname{flex:1;min-width:0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{height:6px;border-radius:99px;background:var(--line);margin:10px 0 8px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--cyan),var(--purple))}
.le.act .bar i{background:linear-gradient(90deg,var(--green),var(--cyan))}
.le-meta{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px;color:var(--mute)}
.le-meta b{color:var(--fg);font-weight:600}
.pulse{animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{50%{opacity:.35}}
.lock{margin-top:12px;background:var(--bg);border:1px dashed var(--orange);border-radius:12px;padding:12px}
.lock .hint{margin:0 0 10px;color:var(--orange)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">&#129499;</div>
    <div>
      <h1>Flixora <span>Proxy</span></h1>
      <div class="sub">Cloudflare edge stream &amp; download proxy</div>
    </div>
    <div class="grow"></div>
    <div class="pill" id="statusPill"><span class="dot"></span><span id="statusTxt">checking&hellip;</span></div>
    <button class="icon" id="themeBtn" title="Toggle Dracula / Alucard">&#9680;</button>
  </header>

  <section>
    <h2>Status</h2>
    <div class="grid" id="cards"></div>
    <div class="hint" id="healthNote"></div>
  </section>

  <section>
    <h2>Live log</h2>
    <div class="grid" id="logSum"></div>
    <div class="row" style="margin-top:12px;align-items:center">
      <button class="chip on" data-f="all">All</button>
      <button class="chip" data-f="play">Play</button>
      <button class="chip" data-f="download">Download</button>
      <span class="grow"></span>
      <button class="icon" id="logAuto">Live: on</button>
      <button class="icon" id="logClr">Clear</button>
    </div>
    <div class="lock" id="logLock" style="display:none">
      <div class="hint" id="logLockMsg"></div>
      <div class="row">
        <input id="logKey" type="password" autocomplete="off" placeholder="LOG_TOKEN">
        <button class="primary" id="logSave">Unlock</button>
      </div>
    </div>
    <div class="loglist" id="logList"></div>
    <div class="hint" id="logMode"></div>
  </section>

  <section>
    <h2>Link tester</h2>
    <div class="row">
      <input id="src" type="url" inputmode="url" autocomplete="off" spellcheck="false"
             placeholder="https://api.example.com/dl/FILE_ID/name.mkv  or  /dld/TOKEN/FILE_ID/name.mkv">
      <button id="clr" class="icon" title="Clear">&#10005;</button>
    </div>
    <div class="hint">Paste a backend <code>/dl</code> or <code>/dld</code> link. Nothing is sent anywhere except to this worker.</div>

    <div class="out" id="out">
      <div class="proxyurl"><span id="pxy" class="mono"></span><button class="icon" id="cpy">Copy</button></div>
      <div class="row" style="margin-top:12px">
        <button class="primary" id="tHead">HEAD test</button>
        <button id="tRange">Range 0-0 test</button>
        <button id="tOpen">Open</button>
      </div>
      <div id="res"></div>
      <div class="hist" id="hist"></div>
    </div>
  </section>

  <section>
    <h2>How it flows</h2>
    <div class="flow">
      <span class="node">App / Browser</span><span class="arrow">&rarr;</span>
      <span class="node c-c">This worker</span><span class="arrow">&rarr;</span>
      <span class="node c-p">Edge cache</span><span class="arrow">&rarr;</span>
      <span class="node c-o">Flixora backend</span><span class="arrow">&rarr;</span>
      <span class="node">Telegram</span>
    </div>
    <div class="hint">Every Range request is split into aligned chunks. A chunk already in the edge cache never touches your VPS or Telegram.</div>
  </section>

  <section>
    <h2>Endpoints</h2>
    <div class="ep"><h3>Plain</h3><p>Put the backend URL right after the worker host.</p>
      <pre class="mono" id="e1"></pre></div>
    <div class="ep"><h3>MediaFlow style</h3><p>Same thing, as a query string.</p>
      <pre class="mono" id="e2"></pre></div>
    <div class="ep"><h3>Status</h3><p><code>GET /health</code> &middot; JSON, no auth, no secrets.</p></div>
    <div class="ep"><h3>Cache header</h3><p>
      <span class="badge b-g">HIT</span>from edge
      <span class="badge b-o">MISS</span>from origin, now cached
      <span class="badge b-p">META</span>HEAD answered from metadata
      <span class="badge b-r">BYPASS</span>passed straight through</p></div>
  </section>

  <footer>Flixora &middot; powered by Cloudflare Workers</footer>
</div>
<div class="toast" id="toast"></div>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var origin = location.origin;
  var proxyUrl = "";
  var history = [];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function fmtBytes(n) {
    n = Number(n);
    if (!isFinite(n) || n < 0) return "?";
    var u = ["B", "KB", "MB", "GB", "TB"], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(2) : n) + " " + u[i];
  }
  var toastT;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.className = "toast show";
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.className = "toast"; }, 1600);
  }
  function copy(text) {
    function done() { toast("Copied"); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Copy failed"); }
      document.body.removeChild(ta);
    }
  }

  /* ---------------- theme ---------------- */
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem("flx-theme"); } catch (e) {}
  if (!saved && window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches) saved = "light";
  function setTheme(t) {
    root.setAttribute("data-theme", t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", t === "light" ? "#fffbeb" : "#282a36");
  }
  setTheme(saved === "light" ? "light" : "dark");
  $("themeBtn").onclick = function () {
    var n = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    setTheme(n);
    try { localStorage.setItem("flx-theme", n); } catch (e) {}
  };

  /* ---------------- status ---------------- */
  function card(label, value, cls) {
    return '<div class="stat"><small>' + esc(label) + '</small><b class="' + (cls || "") + '">' + esc(value) + "</b></div>";
  }
  function loadHealth() {
    var t0 = performance.now();
    fetch("/health", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (h) {
      var ms = Math.round(performance.now() - t0);
      var pill = $("statusPill");
      pill.className = "pill " + (h.ok ? "ok" : "bad");
      $("statusTxt").textContent = h.ok ? "online" : "needs setup";
      var on = function (v) { return v ? "on" : "off"; };
      $("cards").innerHTML =
        card("Edge cache", on(h.edge_cache), h.edge_cache ? "c-g" : "c-o") +
        card("Chunk size", h.chunk_mb + " MB", "c-c") +
        card("Max chunks / req", h.max_chunks != null ? h.max_chunks : "-", "c-c") +
        card("Download token check", on(h.download_token_check), h.download_token_check ? "c-g" : "c-o") +
        card("Prefetch next chunk", on(h.prefetch_next), h.prefetch_next ? "c-g" : "c-m") +
        card("Cap open ranges", on(h.cap_open_ranges), "c-p") +
        card("Allowed origins", h.origins != null ? h.origins : "-", h.origins ? "c-g" : "c-r") +
        card("Latency", ms + " ms", ms < 300 ? "c-g" : "c-o");
      var notes = [];
      if (!h.ok) notes.push("ALLOWED_ORIGINS is not configured.");
      if (!h.edge_cache) notes.push("Edge cache is off - it only works on a custom domain, not *.workers.dev.");
      if (h.backend_turnstile && !h.download_token_check) notes.push("Backend uses Turnstile but TURNSTILE_SECRET is missing here; downloads are passed through uncached.");
      $("healthNote").textContent = notes.join(" ");
    }).catch(function () {
      $("statusPill").className = "pill bad";
      $("statusTxt").textContent = "unreachable";
    });
  }
  loadHealth();

  /* ---------------- endpoints cheat-sheet ---------------- */
  $("e1").textContent = origin + "/https://api.example.com/dl/FILE_ID/name.mkv";
  $("e2").textContent = origin + "/proxy/stream?d=" + encodeURIComponent("https://api.example.com/dl/FILE_ID/name.mkv");

  /* ---------------- link tester ---------------- */
  function buildProxy(v) {
    v = v.trim();
    if (!v) return "";
    if (v.indexOf(origin + "/") === 0) return v;
    if (/^https?:\/\//i.test(v)) return origin + "/" + v;
    return "";
  }
  function refresh() {
    proxyUrl = buildProxy($("src").value);
    $("out").style.display = proxyUrl ? "block" : "none";
    $("pxy").textContent = proxyUrl;
    if (!proxyUrl) { $("res").innerHTML = ""; }
  }
  $("src").addEventListener("input", refresh);
  $("clr").onclick = function () { $("src").value = ""; refresh(); };
  $("cpy").onclick = function () { copy(proxyUrl); };
  $("tOpen").onclick = function () { if (proxyUrl) window.open(proxyUrl, "_blank", "noopener"); };

  function badge(status) {
    var cls = status >= 200 && status < 300 ? "b-g" : status >= 400 ? "b-r" : "b-o";
    return '<span class="badge ' + cls + '">' + status + "</span>";
  }
  function run(mode) {
    if (!proxyUrl) return;
    var btns = [$("tHead"), $("tRange")];
    btns.forEach(function (b) { b.disabled = true; });
    $("res").innerHTML = '<div class="hint">Testing&hellip;</div>';
    var opt = mode === "head" ? { method: "HEAD" } : { method: "GET", headers: { Range: "bytes=0-0" } };
    var t0 = performance.now();
    fetch(proxyUrl, opt).then(function (r) {
      var ms = Math.round(performance.now() - t0);
      var H = function (k) { return r.headers.get(k); };
      if (r.body && mode !== "head") { try { r.body.cancel(); } catch (e) {} }
      var cl = H("content-length"), cr = H("content-range"), cd = H("content-disposition");
      var isDld = /\/dld\//.test(proxyUrl);
      var total = cr && /\/(\d+)$/.exec(cr) ? RegExp.$1 : (mode === "head" ? cl : null);
      var checks = [];
      function ck(ok, text, warn) { checks.push('<li class="' + (ok ? "ck-ok" : warn ? "ck-wa" : "ck-no") + '">' + text + "</li>"); }
      ck(r.ok, "Worker answered " + r.status + " in " + ms + " ms");
      ck(H("accept-ranges") === "bytes", "Accept-Ranges: bytes (seek + resume work)");
      ck(!!cl, "Content-Length present - download size will show", true);
      if (mode === "range") ck(r.status === 206 && !!cr, "206 with Content-Range" + (total ? " (file = " + fmtBytes(total) + ")" : ""));
      if (isDld) ck(/attachment/i.test(cd || ""), "Content-Disposition is attachment (forces download)");
      if (isDld) ck((H("content-type") || "") === "application/octet-stream", "Content-Type is octet-stream (players won't grab it)", true);
      var rows = [
        ["Status", badge(r.status) + esc(r.statusText || "")],
        ["Cache", esc(H("x-flx-cache") || "-")],
        ["Size", esc(total ? fmtBytes(total) : "?")],
        ["Content-Length", esc(cl || "-")],
        ["Content-Range", esc(cr || "-")],
        ["Content-Type", esc(H("content-type") || "-")],
        ["Disposition", esc(cd || "-")],
        ["Accept-Ranges", esc(H("accept-ranges") || "-")]
      ].map(function (x) { return "<tr><td>" + x[0] + "</td><td>" + x[1] + "</td></tr>"; }).join("");
      $("res").innerHTML = '<ul class="checks">' + checks.join("") + "</ul><table>" + rows + "</table>";
      history.unshift((mode === "head" ? "HEAD " : "RANGE ") + r.status + " &middot; " + ms + " ms &middot; " + esc(H("x-flx-cache") || "-"));
      history = history.slice(0, 5);
      $("hist").innerHTML = history.map(function (h) { return "<div>" + h + "</div>"; }).join("");
    }).catch(function (e) {
      $("res").innerHTML = '<ul class="checks"><li class="ck-no">Request failed: ' + esc(e && e.message || e) + "</li></ul>";
    }).then(function () {
      btns.forEach(function (b) { b.disabled = false; });
    });
  }
  $("tHead").onclick = function () { run("head"); };
  $("tRange").onclick = function () { run("range"); };

  /* ---------------- live log ---------------- */
  var logKey = "", logFilter = "all", logAuto = true, logData = null, logBusy = false;
  try { logKey = localStorage.getItem("flx-key") || ""; } catch (e) {}
  $("logKey").value = logKey;

  function spd(n) { return n > 0 ? fmtBytes(n) + "/s" : "-"; }
  function dur(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    return m < 60 ? m + "m " + (s % 60) + "s" : Math.floor(m / 60) + "h " + (m % 60) + "m";
  }
  function ago(now, t) {
    var s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 5) return "just now";
    if (s < 90) return s + "s ago";
    var m = Math.round(s / 60);
    return m < 90 ? m + "m ago" : Math.round(m / 60) + "h ago";
  }
  function stateBadge(st) {
    var map = { active: ["b-g", "live"], done: ["b-p", "done"], aborted: ["b-o", "stopped"], error: ["b-r", "error"], lost: ["b-o", "lost"] };
    var m = map[st] || ["b-o", st];
    return '<span class="badge ' + m[0] + (st === "active" ? " pulse" : "") + '">' + m[1] + "</span>";
  }
  function showLock(msg) {
    $("logLock").style.display = "block";
    $("logLockMsg").textContent = msg;
    $("logList").innerHTML = "";
    $("logSum").innerHTML = "";
    $("logMode").textContent = "";
  }
  function renderLog() {
    if (!logData) return;
    var now = logData.now, all = logData.entries || [];
    var list = all.filter(function (e) { return logFilter === "all" || e.kind === logFilter; });
    var act = 0, tot = 0, hit = 0, miss = 0, nowBps = 0;
    all.forEach(function (e) {
      if (e.state === "active") { act++; nowBps += e.bps || 0; }
      tot += e.sent; hit += e.hit; miss += e.miss;
    });
    $("logSum").innerHTML =
      card("Active now", act, act ? "c-g" : "c-m") +
      card("Speed now", spd(nowBps), nowBps ? "c-g" : "c-m") +
      card("Transferred", fmtBytes(tot), "c-c") +
      card("Cache hit rate", hit + miss ? Math.round((hit * 100) / (hit + miss)) + "%" : "-", "c-p");
    $("logMode").textContent = logData.mode === "durable"
      ? "Stored in Durable Object - last 60 sessions. Bytes are counted per finished chunk."
      : "Memory mode (no Durable Object bound) - log resets when the worker restarts and may split across instances.";
    if (!list.length) { $("logList").innerHTML = '<div class="hint">No activity yet. Play or download something.</div>'; return; }
    $("logList").innerHTML = list.map(function (e) {
      var pct = e.total > 0 ? Math.min(100, Math.round((e.sent * 100) / e.total)) : 0;
      var isAct = e.state === "active";
      var parts = [];
      parts.push("<span><b>" + fmtBytes(e.sent) + "</b>" + (e.total ? " of " + fmtBytes(e.total) + " (" + pct + "%)" : "") + "</span>");
      if (isAct) parts.push("<span>now <b>" + spd(e.bps) + "</b></span>");
      parts.push("<span>avg <b>" + spd(e.avg) + "</b></span>");
      if (e.peak) parts.push("<span>peak " + spd(e.peak) + "</span>");
      parts.push("<span>" + e.reqs + " req &middot; " + dur(e.busy_ms) + " active</span>");
      if (e.hit + e.miss) parts.push("<span>cache " + e.hit + " hit / " + e.miss + " miss</span>");
      var who = [e.dev, e.country].filter(Boolean).join(" &middot; ");
      parts.push("<span>" + esc(who || "unknown") + (e.client ? " &middot; #" + esc(e.client) : "") + "</span>");
      parts.push("<span>" + ago(now, isAct ? e.t0 : e.upd) + "</span>");
      if (e.err) parts.push('<span class="c-r">' + esc(e.err) + "</span>");
      return '<div class="le' + (isAct ? " act" : "") + '"><div class="le-top"><span class="ico">' +
        (e.kind === "download" ? "&#11015;" : "&#9654;") + '</span><b class="fname" title="' + esc(e.name) + '">' + esc(e.name) +
        "</b>" + stateBadge(e.state) + '</div><div class="bar"><i style="width:' + pct + '%"></i></div><div class="le-meta">' +
        parts.join("") + "</div></div>";
    }).join("");
  }
  function pollLog() {
    if (logBusy) return;
    logBusy = true;
    fetch("/logs.json", { cache: "no-store", headers: { "x-log-key": logKey } }).then(function (r) {
      if (r.status === 403) { showLock("LOG_TOKEN is not set on the worker. Add it as a secret in the Cloudflare dashboard (Worker > Settings > Variables and Secrets), then enter the same value here."); return null; }
      if (r.status === 401) { showLock(logKey ? "Wrong key - try again." : "Enter your LOG_TOKEN to see the log."); return null; }
      return r.json();
    }).then(function (d) {
      if (!d) return;
      $("logLock").style.display = "none";
      logData = d; renderLog();
    }).catch(function () {}).then(function () { logBusy = false; });
  }
  $("logSave").onclick = function () {
    logKey = $("logKey").value.trim();
    try { localStorage.setItem("flx-key", logKey); } catch (e) {}
    pollLog();
  };
  $("logKey").addEventListener("keydown", function (e) { if (e.key === "Enter") $("logSave").onclick(); });
  $("logAuto").onclick = function () {
    logAuto = !logAuto;
    $("logAuto").textContent = "Live: " + (logAuto ? "on" : "off");
    if (logAuto) pollLog();
  };
  $("logClr").onclick = function () {
    fetch("/logs/clear", { method: "POST", headers: { "x-log-key": logKey } }).then(function () { logData = null; pollLog(); toast("Log cleared"); });
  };
  Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (b) {
    b.onclick = function () {
      logFilter = b.getAttribute("data-f");
      Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (x) { x.className = "chip" + (x === b ? " on" : ""); });
      renderLog();
    };
  });
  pollLog();
  setInterval(function () { if (logAuto && !document.hidden) pollLog(); }, 3000);
})();
</script>
</body>
</html>`;
