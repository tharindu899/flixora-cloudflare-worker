/**
 * Flixora Proxy - dashboard UI (served at "/" for browsers and at "/ui").
 * Same look & feel as Vps-Dashboard: Dracula palette, sidebar + topbar shell, stat cards,
 * tables that turn into cards on phones. Pure static HTML/JS - live data comes from /health and /logs.json.
 * NOTE: String.raw template - keep backticks and dollar-brace sequences out of the page code.
 */
export const UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#282A36">
<title>Flixora Proxy</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='64' y2='64' gradientUnits='userSpaceOnUse'%3E%3Cstop stop-color='%23BD93F9'/%3E%3Cstop offset='1' stop-color='%23FF79C6'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='14' fill='url(%23g)'/%3E%3Cpath d='M22 18 L46 32 L22 46 Z' fill='%231E1F29'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<style>
:root{
  --bg:#282A36;--panel:#21222C;--panel-raised:#343746;--border:#44475A;--text:#F8F8F2;--text-dim:#BFBFDA;--text-faint:#6272A4;
  --state-idle:#6272A4;--state-running:#FFB86C;--state-success:#50FA7B;--state-error:#FF5555;
  --link:#8BE9FD;--accent-purple:#BD93F9;--accent-pink:#FF79C6;--accent-yellow:#F1FA8C;
  --font-mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --font-sans:'Inter',system-ui,-apple-system,sans-serif;--radius:8px;
}
html[data-theme=light]{
  --bg:#F4F5FA;--panel:#FFFFFF;--panel-raised:#ECEEF6;--border:#D6D9E6;--text:#1F2030;--text-dim:#474A63;--text-faint:#767B99;
  --state-idle:#8A8FAA;--state-running:#B96300;--state-success:#17913F;--state-error:#D0342C;
  --link:#0B7597;--accent-purple:#7342D1;--accent-pink:#BE2E8A;--accent-yellow:#7D6F00;--term-bg:#F0F2F9;
}
html[data-theme=light] .nav-item.active .nav-icon{background:rgba(0,0,0,.06)}
html[data-theme=light] .term-block-header{background:rgba(0,0,0,.03)}
html[data-theme=light] .topbar{box-shadow:0 2px 10px rgba(0,0,0,.06)}
html[data-theme=light] .act-btn.on{background:rgba(11,117,151,.08)}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--text);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;font-size:14px}
button,input,select{font-family:inherit}
::selection{background:var(--link);color:#0F1720}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--link);outline-offset:2px}
.dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex-shrink:0}
.dot.running{animation:pulse 1.1s ease-in-out infinite;box-shadow:0 0 6px currentColor}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}}

/* shell */
.app-shell{display:flex;min-height:100dvh}
.sidebar{width:230px;flex-shrink:0;background:var(--panel);border-right:1px solid var(--border);
  padding:calc(20px + env(safe-area-inset-top,0px)) 14px calc(20px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:3px;
  position:sticky;top:0;height:100dvh;overflow-y:auto}
.main-area{flex:1;min-width:0}
.content-pad{padding:22px 24px 60px;overflow-x:hidden;max-width:1100px}
.nav-item{display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:7px;cursor:pointer;font-size:13.5px;color:var(--text-dim);
  border:none;border-left:2px solid transparent;background:transparent;width:100%;text-align:left;transition:background .15s,color .15s}
.nav-item:hover{background:var(--panel-raised);color:var(--text)}
.nav-item.active{background:var(--panel-raised);color:var(--text);border-left-color:var(--link)}
.nav-icon{width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}
.nav-item.active .nav-icon{background:rgba(255,255,255,.06)}
.nav-section{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-faint);padding:4px 10px 8px}
.brand{display:flex;align-items:center;gap:10px;padding:0 6px 20px}
.brand img{border-radius:8px;flex-shrink:0}
.brand b{font-family:var(--font-mono);font-size:13px;font-weight:600;letter-spacing:.04em;display:block}
.brand small{font-size:10px;color:var(--text-faint)}
.sidebar-close-btn{display:none}
.side-foot{margin-top:auto;padding-top:14px;border-top:1px solid var(--border)}
.side-me{display:flex;align-items:center;gap:9px;padding:0 6px;margin-bottom:12px}
.avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--accent-purple),var(--link));
  display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#1a1b26;flex-shrink:0}
.side-me .t{font-family:var(--font-mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.side-me .s{display:flex;align-items:center;gap:5px;font-size:10.5px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:calc(13px + env(safe-area-inset-top,0px)) 20px 13px;
  border-bottom:1px solid var(--border);background:var(--panel);position:sticky;top:0;z-index:30;box-shadow:0 2px 10px rgba(0,0,0,.25)}
.topbar-left{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.topbar-text{min-width:0;flex:1}
.topbar-title{font-size:16.5px;font-weight:600;line-height:1.2}
.topbar-subtitle{font-size:12px;color:var(--text-dim);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.topbar-pill{display:flex;align-items:center;gap:7px;font-family:var(--font-mono);font-size:12px;color:var(--text-dim);
  background:var(--panel-raised);padding:6px 12px;border-radius:20px;border:1px solid var(--border);flex-shrink:0;white-space:nowrap}
.hamburger-btn{display:none;align-items:center;justify-content:center;width:37px;height:37px;border-radius:8px;border:1px solid var(--border);
  background:var(--panel-raised);color:var(--text);cursor:pointer;flex-shrink:0;font-size:15px}
.sidebar-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:40}
.sidebar-backdrop.show{display:block}

/* cards */
.card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:22px}
.stat-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;min-width:0}
.stat-icon-badge{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;margin-bottom:10px}
.stat-label{font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.stat-value{font-family:var(--font-mono);font-size:19px;font-weight:600;margin-bottom:8px;overflow-wrap:anywhere}
.stat-sub{font-size:11px;color:var(--text-faint);font-family:var(--font-mono)}
.bar-track{height:4px;background:var(--panel-raised);border-radius:2px;overflow:hidden}
.bar-fill{height:100%;border-radius:2px;transition:width .4s}
.chart-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-bottom:22px}
.chart-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:16px;min-width:0}
.chart-card-title{font-size:13px;font-weight:600;margin-bottom:4px}
.chart-card-sub{font-size:11.5px;color:var(--text-faint);margin-bottom:14px}
.pad{padding:14px 16px}
.mono{font-family:var(--font-mono)}
.dim{color:var(--text-dim)}.faint{color:var(--text-faint)}
.hint{font-size:12px;color:var(--text-faint);line-height:1.6;margin-top:10px}
.mig-title{display:flex;align-items:center;gap:8px;font-family:var(--font-mono);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim);margin-bottom:10px}

/* buttons / inputs */
.act-btn{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:11.5px;padding:7px 11px;border-radius:6px;border:1px solid var(--border);
  background:transparent;color:var(--text-dim);cursor:pointer;white-space:nowrap}
.act-btn:hover:not(:disabled){border-color:var(--link);color:var(--link)}
.act-btn.on{border-color:var(--link);color:var(--link);background:rgba(139,233,253,.08)}
.act-btn.asking{border-color:var(--state-error);color:var(--state-error)}
.act-btn:disabled{opacity:.55;cursor:default}
.run-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font-family:var(--font-mono);font-size:12px;padding:8px 16px;border-radius:6px;
  border:1px solid var(--link);color:var(--link);background:transparent;cursor:pointer;white-space:nowrap}
.run-btn:hover:not(:disabled){background:rgba(139,233,253,.1)}
.run-btn:disabled{opacity:.55;cursor:default}
.mig-primary{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 18px;border-radius:7px;border:none;background:var(--link);
  color:#0F1720;font-weight:600;font-size:13px;cursor:pointer}
.mig-primary:disabled{background:var(--panel-raised);color:var(--text-faint);cursor:default}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
.grow{flex:1}
.field{flex:1;min-width:0;background:var(--panel-raised);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:10px 12px;
  font-family:var(--font-mono);font-size:13px;outline:none}
.field:focus{border-color:var(--link)}
.mig-warn{border-left:3px solid var(--state-running);background:rgba(255,184,108,.08);padding:10px 12px;border-radius:6px;font-size:12.5px;color:var(--text-dim);line-height:1.6;margin-bottom:14px}
.mig-err{border-left:3px solid var(--state-error);background:rgba(255,85,85,.08);padding:10px 12px;border-radius:6px;font-size:12.5px;color:var(--state-error);line-height:1.6;font-family:var(--font-mono);overflow-wrap:anywhere}

/* tables */
table.data-table{width:100%;border-collapse:collapse;font-size:12.5px}
table.data-table th{text-align:left;color:var(--text-faint);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:10px 12px;border-bottom:1px solid var(--border)}
table.data-table td{padding:10px 12px;border-bottom:1px solid var(--border);font-family:var(--font-mono);color:var(--text-dim);vertical-align:middle}
table.data-table tr:hover td{background:var(--panel-raised)}
table.data-table tr:last-child td{border-bottom:none}
.empty{padding:26px 16px;text-align:center;color:var(--text-faint);font-family:var(--font-mono);font-size:12.5px}
.icon-chip{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}
.fcell{display:flex;align-items:center;gap:10px;min-width:0}
.fname{font-size:13px;color:var(--text);overflow-wrap:anywhere;line-height:1.35}
.fsub{font-size:11px;color:var(--text-faint);margin-top:2px}
.pbar{min-width:120px}
.pbar .bar-track{margin-top:6px}
.badge{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;
  background:var(--panel-raised);padding:4px 9px;border-radius:20px;white-space:nowrap}
.tag-pill{display:inline-flex;align-items:center;padding:2px 9px;border-radius:20px;font-size:11px;font-family:var(--font-mono)}

/* terminal blocks */
.term-block{background:var(--term-bg,#14151C);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.term-block-header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 12px;background:rgba(255,255,255,.02);
  border-bottom:1px solid var(--border);font-family:var(--font-mono);font-size:10.5px;letter-spacing:.04em;color:var(--text-faint)}
.term-block-btn{display:inline-flex;align-items:center;gap:5px;background:transparent;border:none;color:var(--text-faint);font-family:var(--font-mono);font-size:10.5px;cursor:pointer;padding:2px}
.term-block-btn:hover{color:var(--link)}
.term-body{padding:10px 12px;font-family:var(--font-mono);font-size:12px;line-height:1.7;color:var(--text-dim);overflow-x:auto}
.term-line{display:flex;gap:9px;padding:1.5px 0}
.term-line span.k{color:var(--text-faint);min-width:112px;flex-shrink:0}
.term-line span.v{white-space:pre-wrap;word-break:break-all}
.checks{list-style:none;padding:0;margin:0 0 14px;display:grid;gap:7px;font-size:13px;color:var(--text-dim)}
.checks li{display:flex;align-items:flex-start;gap:9px}
.checks i{margin-top:3px;font-size:12px}
.flow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-family:var(--font-mono);font-size:12px}
.node{background:var(--panel-raised);border:1px solid var(--border);border-radius:8px;padding:8px 12px}
.lock{margin-bottom:14px}
.dbars{display:flex;align-items:flex-end;gap:5px;height:130px;margin:6px 0 4px}
.dbar{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;position:relative}
.dbar i{display:block;width:100%}
.dbar .e{background:var(--accent-purple);border-radius:3px 3px 0 0}
.dbar .v{background:var(--state-running)}
.dlabels{display:flex;gap:5px;font-family:var(--font-mono);font-size:9.5px;color:var(--text-faint)}
.dlabels span{flex:1;min-width:0;text-align:center;overflow:visible;white-space:nowrap}
.leg{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:11px;color:var(--text-dim)}
.leg b{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px}
.hide{display:none!important}
.toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom,0px));transform:translate(-50%,30px);background:var(--accent-purple);color:#1a1b26;
  font-weight:600;padding:8px 16px;border-radius:10px;opacity:0;transition:.25s;pointer-events:none;z-index:99;font-size:13px}
.toast.show{opacity:1;transform:translate(-50%,0)}

@media (max-width:720px){
  .hamburger-btn{display:flex}
  .sidebar{position:fixed;top:0;left:0;height:100dvh;z-index:50;width:250px;transform:translateX(-100%);transition:transform .25s ease}
  .sidebar.open{transform:translateX(0);box-shadow:8px 0 24px rgba(0,0,0,.4)}
  .sidebar-close-btn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;border:1px solid var(--border);
    background:transparent;color:var(--text-dim);cursor:pointer;margin-left:auto}
  .content-pad{padding:16px 14px 50px}
  .topbar{padding:calc(11px + env(safe-area-inset-top,0px)) 14px 11px;gap:10px}
  .topbar-pill{padding:6px 11px;max-width:46%}
  .topbar-pill .pill-clock,.topbar-pill .pill-sep{display:none}
  .topbar-pill .pill-host{overflow:hidden;text-overflow:ellipsis}
  .stat-card{padding:12px 13px}.stat-value{font-size:16px;line-height:1.25}
  .chart-grid{grid-template-columns:1fr}
  table.data-table thead{display:none}
  table.data-table,table.data-table tbody,table.data-table tr,table.data-table td{display:block;width:100%}
  table.data-table tr{padding:10px 12px;border-bottom:1px solid var(--border)}
  table.data-table tr:last-child{border-bottom:none}
  table.data-table td{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:none;text-align:right;overflow-wrap:anywhere}
  table.data-table td::before{content:attr(data-label);color:var(--text-faint);font-family:var(--font-sans);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;text-align:left;flex-shrink:0}
  table.data-table td.nolabel::before{display:none}
  table.data-table td.nolabel{justify-content:flex-start;text-align:left}
  .pbar{min-width:0;flex:1;text-align:right}
  .term-line span.k{min-width:92px}
}
</style>
</head>
<body>
<div class="app-shell">
  <div class="sidebar-backdrop" id="bk"></div>
  <aside class="sidebar" id="sb">
    <div class="brand">
      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='64' y2='64' gradientUnits='userSpaceOnUse'%3E%3Cstop stop-color='%23BD93F9'/%3E%3Cstop offset='1' stop-color='%23FF79C6'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='14' fill='url(%23g)'/%3E%3Cpath d='M22 18 L46 32 L22 46 Z' fill='%231E1F29'/%3E%3C/svg%3E" width="30" height="30" alt="">
      <div style="flex:1"><b>FLIXORA PROXY</b><small>edge stream worker</small></div>
      <button class="sidebar-close-btn" id="sbClose"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="nav-section">Menu</div>
    <div id="nav" style="display:flex;flex-direction:column;gap:3px"></div>
    <div class="side-foot">
      <div class="side-me">
        <div class="avatar"><i class="fa-solid fa-bolt"></i></div>
        <div style="min-width:0"><div class="t" id="sideHost"></div>
          <div class="s" id="sideState"><span class="dot" style="background:var(--state-idle)"></span>checking</div></div>
      </div>
      <button class="act-btn" id="theme" style="width:100%;justify-content:center;margin-bottom:8px"><i class="fa-solid fa-circle-half-stroke"></i><span id="themeTxt">light mode</span></button>
      <button class="act-btn" id="signOut" style="width:100%;justify-content:center"><i class="fa-solid fa-right-from-bracket"></i>sign out</button>
    </div>
  </aside>

  <div class="main-area">
    <div class="topbar">
      <div class="topbar-left">
        <button class="hamburger-btn" id="burger"><i class="fa-solid fa-bars"></i></button>
        <div class="topbar-text"><div class="topbar-title" id="tTitle"></div><div class="topbar-subtitle" id="tSub"></div></div>
      </div>
      <div class="topbar-pill"><span class="dot running" id="pillDot" style="background:var(--state-idle)"></span>
        <span class="pill-host" id="pillHost"></span></div>
    </div>

    <div class="content-pad">
      <!-- ================= Overview ================= -->
      <div class="page" id="p-overview">
        <div class="toolbar"><span class="grow"></span><span class="faint mono" id="ovAge" style="font-size:11.5px"></span><button class="act-btn" id="ovRefresh"><i class="fa-solid fa-rotate"></i>refresh</button></div>
        <div class="stat-grid" id="cards"></div>
        <div class="mig-warn hide" id="healthNote"></div>
        <div class="mig-title"><i class="fa-solid fa-cloud" style="color:var(--link)"></i>Cloudflare Free plan today</div>
        <div class="stat-grid" id="cards2"></div>
        <div class="mig-warn hide" id="limNote"></div>
        <div class="stat-grid" id="cards3"></div>
        <div class="mig-title"><i class="fa-solid fa-triangle-exclamation" style="color:var(--state-running)"></i>Recent errors</div>
        <div class="card" style="margin-bottom:6px" id="errCard"><div class="empty">loading&hellip;</div></div>
        <div class="hint" id="errHint" style="margin-bottom:22px"></div>
        <div class="card" style="margin-bottom:10px" id="limTable"><div class="empty">loading&hellip;</div></div>
        <div class="hint" id="limHint"></div>
      </div>

    </div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var origin = location.origin;
  var C = { purple: "var(--accent-purple)", pink: "var(--accent-pink)", link: "var(--link)", yellow: "var(--accent-yellow)", green: "var(--state-success)", orange: "var(--state-running)", red: "var(--state-error)" };

  var NAV = [
    { id: "overview", label: "Overview", sub: "Status and Cloudflare Free plan usage", icon: "fa-solid fa-gauge-high", color: "link" }
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function fmtBytes(n) {
    n = Number(n);
    if (!isFinite(n) || n < 0) return "?";
    var u = ["B", "KB", "MB", "GB", "TB"], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(i > 2 ? 2 : 1) : n) + " " + u[i];
  }
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
  function barColor(p) { return p < 50 ? C.green : p < 80 ? C.orange : C.red; }
  var toastT;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.className = "toast show";
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = "toast"; }, 1600);
  }
  function copy(text) {
    function done() { toast("Copied"); }
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Copy failed"); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }
  function statCard(icon, color, label, value, pct, sub) {
    return '<div class="stat-card"><div class="stat-icon-badge" style="background:color-mix(in srgb,' + C[color] + ' 15%,transparent);color:' + C[color] + '"><i class="' + icon + '"></i></div>' +
      '<div class="stat-label">' + esc(label) + '</div><div class="stat-value" style="color:' + C[color] + '">' + esc(value) + "</div>" +
      (pct != null ? '<div class="bar-track"><div class="bar-fill" style="width:' + pct + "%;background:" + barColor(pct) + '"></div></div>' :
        sub ? '<div class="stat-sub">' + esc(sub) + "</div>" : "") + "</div>";
  }

  /* ---------------- theme ---------------- */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    $("themeTxt").textContent = t === "light" ? "dark mode" : "light mode";
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute("content", t === "light" ? "#F4F5FA" : "#282A36");
  }
  var theme = "dark";
  try { theme = localStorage.getItem("flx-theme") === "light" ? "light" : "dark"; } catch (e) {}
  applyTheme(theme);
  $("theme").onclick = function () {
    theme = theme === "light" ? "dark" : "light"; applyTheme(theme);
    try { localStorage.setItem("flx-theme", theme); } catch (e) {}
  };

  /* ---------------- shell: nav, routing, clock ---------------- */
  $("sideHost").textContent = location.host;
  $("pillHost").textContent = location.host;
  $("nav").innerHTML = NAV.map(function (n) {
    return '<button class="nav-item" data-page="' + n.id + '"><span class="nav-icon" style="color:' + C[n.color] + '"><i class="' + n.icon + '"></i></span><span>' + n.label + "</span></button>";
  }).join("");
  function openSide(o) { $("sb").className = "sidebar" + (o ? " open" : ""); $("bk").className = "sidebar-backdrop" + (o ? " show" : ""); }
  $("burger").onclick = function () { openSide(true); };
  $("sbClose").onclick = $("bk").onclick = function () { openSide(false); };
  var page = "overview";
  function go(id, push) {
    if (!NAV.some(function (n) { return n.id === id; })) id = "overview";
    page = id;
    NAV.forEach(function (n) {
      $("p-" + n.id).className = "page" + (n.id === id ? "" : " hide");
      if (n.id === id) { $("tTitle").textContent = n.label; $("tSub").textContent = n.sub; }
    });
    Array.prototype.forEach.call(document.querySelectorAll(".nav-item"), function (b) {
      b.className = "nav-item" + (b.getAttribute("data-page") === id ? " active" : "");
    });
    if (push !== false) { try { history.replaceState(null, "", "#" + id); } catch (e) {} }
    openSide(false);
    window.scrollTo(0, 0);
    if (id === "overview" && typeof loadOverview === "function") loadOverview();
  }
  Array.prototype.forEach.call(document.querySelectorAll(".nav-item"), function (b) {
    b.onclick = function () { go(b.getAttribute("data-page")); };
  });
  window.addEventListener("hashchange", function () { go(location.hash.slice(1), false); });

  function api(path, opt) {
    return fetch(path, Object.assign({ cache: "no-store" }, opt || {})).then(function (r) {
      if (r.status === 401) { location.reload(); return null; }
      return r.json().then(function (d) { d.__status = r.status; return d; }, function () { return { __status: r.status }; });
    });
  }
  $("signOut").onclick = function () {
    fetch("/logout", { method: "POST" }).then(function () { location.reload(); });
  };
  function fmtN(n) { return Math.round(Number(n) || 0).toLocaleString("en-US"); }
  function pctOf(m) { return m.limit > 0 ? Math.min(100, Math.round(m.used * 100 / m.limit)) : 0; }

  /* ---------------- overview: loaded when opened and on refresh, never polled (every request counts against the Free plan) ---------------- */
  function loadOverview() {
    $("ovRefresh").disabled = true;
    Promise.all([api("/health"), api("/status.json"), api("/stats.json"), api("/usage.json"), api("/errors.json")]).then(function (r) {
      var h = r[0] || {}, st = r[1] && r[1].backend ? r[1] : null, stats = r[2] && r[2].days ? r[2] : null, u = r[3] && r[3].meters ? r[3] : null;
      var onoff = function (v) { return v ? "on" : "off"; };
      var col = h.ok ? "var(--state-success)" : "var(--state-error)";
      $("pillDot").style.background = col;
      $("sideState").innerHTML = '<span class="dot" style="background:' + col + '"></span><span style="color:' + col + '">' + (h.ok ? "online" : "needs attention") + "</span>";
      var c1 = statCard("fa-solid fa-circle-check", h.ok ? "green" : "red", "Status", h.ok ? "online" : "setup needed", null, h.origins + " allowed backend" + (h.origins === 1 ? "" : "s"));
      if (st) {
        var b = st.backend;
        c1 += statCard("fa-solid fa-hard-drive", b.up ? "green" : "red", "Backend (VPS)", b.up ? "up" : "DOWN", null, b.up ? b.ms + " ms" : (b.host || "") + " " + (b.error || ""));
      }
      c1 += statCard("fa-solid fa-bolt", h.edge_cache ? "yellow" : "orange", "Edge cache", onoff(h.edge_cache), null, h.edge_cache ? "chunk " + h.chunk_mb + " MB" : "custom domain needed");
      c1 += statCard("fa-solid fa-key", h.download_token_check ? "green" : "orange", "Token check", onoff(h.download_token_check), null, "download gate");
      $("cards").innerHTML = c1;
      var notes = [];
      if (!h.ok) notes.push("ALLOWED_ORIGINS is not configured.");
      if (h.edge_cache === false) notes.push("Edge cache is off - it only works on a custom domain, not *.workers.dev.");
      if (h.backend_turnstile && !h.download_token_check) notes.push("Backend uses Turnstile but TURNSTILE_SECRET is missing here; downloads are passed through uncached.");
      $("healthNote").textContent = notes.join(" ");
      $("healthNote").className = "mig-warn" + (notes.length ? "" : " hide");

      if (stats) {
        var t = stats.days.filter(function (x) { return x.d === stats.today; })[0] || { r: 0, b: 0, hb: 0, mb: 0, e: 0 };
        $("cards3").innerHTML =
          statCard("fa-solid fa-piggy-bank", "green", "Saved today", fmtBytes(t.hb), null, t.b ? Math.round(t.hb * 100 / t.b) + "% of " + fmtBytes(t.b) + " from the edge" : "no traffic yet") +
          statCard("fa-solid fa-server", "orange", "From VPS today", fmtBytes(t.mb), null, "fetched from your backend") +
          statCard("fa-solid fa-film", t.e ? "red" : "link", "Streams today", String(t.r), null, t.e ? t.e + " failed" : "none failed");
      }
      if (u) renderLimits(u);
      renderErrors(r[4] && r[4].errors ? r[4] : null);
      $("ovAge").textContent = "updated " + new Date().toLocaleTimeString("en-GB", { hour12: false });
    }).catch(function () {
      $("cards").innerHTML = '<div class="mig-err" style="grid-column:1/-1">Cannot reach the worker</div>';
    }).then(function () { $("ovRefresh").disabled = false; });
  }
  $("ovRefresh").onclick = loadOverview;
  function renderErrors(d) {
    if (!d) { $("errCard").innerHTML = '<div class="empty">Error log unavailable</div>'; return; }
    var list = d.errors;
    $("errCard").innerHTML = list.length ? '<table class="data-table"><thead><tr><th>When</th><th>Status</th><th>What happened</th><th>File</th><th>From</th></tr></thead><tbody>' + list.slice(0, 20).map(function (x) {
      return '<tr><td class="nolabel">' + ago(d.now, x.t) + '</td><td data-label="status"><span style="color:' + (x.s >= 500 ? "var(--state-error)" : "var(--state-running)") + '">' + esc(x.s) + '</span></td>' +
        '<td data-label="what">' + esc(x.m) + (x.n > 1 ? ' <span class="faint">x' + x.n + "</span>" : "") + '</td><td data-label="file">' + esc(x.f || "-") + '</td><td data-label="from">' + esc(x.c || "-") + "</td></tr>";
    }).join("") + "</tbody></table>" : '<div class="empty">No errors recorded.</div>';
    $("errHint").textContent = "Every failed stream or download is listed here (last 40, newest first). The same lines are in the Cloudflare dashboard: Workers -> your worker -> Logs." + (d.mode === "memory" ? " Memory mode: this list is per worker instance and resets on restart." : "");
  }
  function renderLimits(u) {
    var req = u.meters.req, dob = u.meters["do"], rows = u.meters.rows, F = u.free;
    var reset = new Date(u.reset_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    $("cards2").innerHTML =
      statCard("fa-solid fa-cloud", "link", "Worker requests", fmtN(req.used) + " / " + fmtN(req.limit), pctOf(req)) +
      statCard("fa-solid fa-cubes-stacked", "purple", "Durable Object requests", fmtN(dob.used) + " / " + fmtN(dob.limit), pctOf(dob)) +
      statCard("fa-solid fa-pen-to-square", "pink", "DO rows written (est.)", fmtN(rows.used) + " / " + fmtN(rows.limit), pctOf(rows)) +
      statCard("fa-solid fa-hourglass-half", "orange", "Resets in", dur(Math.max(0, u.reset_at - u.now)), null, "00:00 UTC = " + reset + " your time");
    var worst = Math.max(pctOf(req), pctOf(dob), pctOf(rows)), notes = [];
    if (u.warn_pct > 0 && worst >= u.warn_pct) notes.push("A Cloudflare Free limit is at " + worst + "% for today. When a limit is reached Cloudflare stops answering until 00:00 UTC.");
    if (u.projected && u.projected > req.limit) notes.push("At this pace about " + fmtN(u.projected) + " requests will be used by the end of the day.");
    $("limNote").textContent = notes.join(" ");
    $("limNote").className = "mig-warn" + (notes.length ? "" : " hide");
    var row = function (k, free, mine) { return '<tr><td data-label="limit" style="color:var(--text)">' + k + '</td><td data-label="Free plan">' + free + '</td><td data-label="this worker">' + mine + "</td></tr>"; };
    $("limTable").innerHTML = '<table class="data-table"><thead><tr><th>Limit</th><th>Free plan</th><th>This worker</th></tr></thead><tbody>' +
      row("Worker requests", fmtN(F.workerRequestsDay) + " / day", fmtN(req.used) + " (" + pctOf(req) + "%)") +
      row("Burst rate", fmtN(F.burstPerMinute) + " requests / minute", "over it: Cloudflare error 1015") +
      row("CPU time", F.cpuMs + " ms / request", "bodies are piped natively") +
      row("Subrequests", F.subrequests + " external / request", "budget " + u.sub_budget) +
      row("DO requests", fmtN(F.doRequestsDay) + " / day", fmtN(dob.used) + " (" + pctOf(dob) + "%)") +
      row("DO rows written", fmtN(F.doRowsWrittenDay) + " / day", fmtN(rows.used) + " (" + pctOf(rows) + "%)") + "</tbody></table>";
    $("limHint").textContent = "Counted by this worker (every request it receives, including this page), so it can differ a little from the Cloudflare dashboard. Nothing on this page refreshes by itself. The limit and alert level are CF_REQ_LIMIT and CF_WARN_PCT in wrangler.toml.";
  }

  go(location.hash.slice(1) || "overview", false);
})();
</script>
</body>
</html>`;
