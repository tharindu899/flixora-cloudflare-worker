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
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--text);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;font-size:14px}
button,input{font-family:inherit}
::selection{background:var(--link);color:#0F1720}
a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--link);outline-offset:2px}
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
.term-block{background:#14151C;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
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
.hide{display:none!important}
.toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom,0px));transform:translate(-50%,30px);background:var(--accent-purple);color:#1a1b26;
  font-weight:600;padding:8px 16px;border-radius:10px;opacity:0;transition:.25s;pointer-events:none;z-index:99;font-size:13px}
.toast.show{opacity:1;transform:translate(-50%,0)}

@media (max-width:720px){
  .hamburger-btn{display:flex}
  .sidebar{position:fixed;top:0;left:0;height:100dvh;z-index:50;width:250px;transform:translateX(-100%);transition:transform .25s ease;box-shadow:8px 0 24px rgba(0,0,0,.4)}
  .sidebar.open{transform:translateX(0)}
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
        <span class="pill-clock" id="clock"></span><span class="pill-sep faint">&middot;</span><span class="pill-host" id="pillHost"></span></div>
    </div>

    <div class="content-pad">

      <!-- ================= Overview ================= -->
      <div class="page" id="p-overview">
        <div class="stat-grid" id="cards"></div>
        <div class="mig-warn hide" id="healthNote"></div>
        <div class="chart-grid">
          <div class="chart-card">
            <div class="chart-card-title">Throughput</div>
            <div class="chart-card-sub" id="chartSub">Total speed of all active streams (polled every 3s)</div>
            <div id="chart"></div>
          </div>
          <div class="chart-card">
            <div class="chart-card-title">Cache hit rate</div>
            <div class="chart-card-sub" id="donutSub">Chunks served from the edge vs the VPS</div>
            <div style="display:flex;justify-content:center" id="donut"></div>
          </div>
        </div>
        <div class="stat-grid" id="logCards"></div>
      </div>

      <!-- ================= Live log ================= -->
      <div class="page hide" id="p-log">
        <div class="toolbar">
          <button class="act-btn on" data-f="all">All</button>
          <button class="act-btn" data-f="play"><i class="fa-solid fa-play" style="color:var(--state-success)"></i>Play</button>
          <button class="act-btn" data-f="download"><i class="fa-solid fa-download" style="color:var(--link)"></i>Download</button>
          <span class="grow"></span>
          <button class="act-btn" id="logAuto"><span class="dot running" style="background:var(--state-success)"></span>live</button>
          <button class="act-btn danger" id="logClr"><i class="fa-solid fa-trash"></i>clear</button>
        </div>
        <div class="card" id="logCard"><div class="empty">loading&hellip;</div></div>
        <div class="hint" id="logMode"></div>
      </div>

      <!-- ================= Link tester ================= -->
      <div class="page hide" id="p-test">
        <div class="card pad" style="margin-bottom:14px">
          <div class="mig-title"><i class="fa-solid fa-link" style="color:var(--accent-pink)"></i>backend link</div>
          <div class="toolbar" style="margin-bottom:0">
            <input class="field" id="src" type="url" inputmode="url" autocomplete="off" spellcheck="false"
              placeholder="https://api.example.com/dl/FILE_ID/name.mkv  or  .../dld/TOKEN/FILE_ID/name.mkv">
            <button class="act-btn" id="clr" title="Clear"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="hint">Paste a backend <span class="mono">/dl</span> or <span class="mono">/dld</span> link. Requests go only to this worker.</div>
        </div>
        <div id="out" class="hide">
          <div class="term-block" style="margin-bottom:14px">
            <div class="term-block-header"><span>PROXY URL</span>
              <span><button class="term-block-btn" id="cpy"><i class="fa-regular fa-copy"></i>copy</button></span></div>
            <div class="term-body mono" id="pxy" style="color:var(--link);word-break:break-all"></div>
          </div>
          <div class="toolbar">
            <button class="mig-primary" id="tHead"><i class="fa-solid fa-satellite-dish"></i>HEAD test</button>
            <button class="run-btn" id="tRange"><i class="fa-solid fa-arrows-left-right"></i>Range 0-0</button>
            <button class="act-btn" id="tOpen"><i class="fa-solid fa-arrow-up-right-from-square"></i>open</button>
          </div>
          <div id="res"></div>
          <div class="hint mono" id="hist"></div>
        </div>
      </div>

      <!-- ================= Setup ================= -->
      <div class="page hide" id="p-setup">
        <div class="chart-card" style="margin-bottom:14px">
          <div class="chart-card-title">How it flows</div>
          <div class="chart-card-sub">Every Range request is split into aligned chunks. A cached chunk never touches your VPS or Telegram.</div>
          <div class="flow">
            <span class="node">App / Browser</span><i class="fa-solid fa-arrow-right" style="color:var(--accent-pink)"></i>
            <span class="node" style="color:var(--link)">This worker</span><i class="fa-solid fa-arrow-right" style="color:var(--accent-pink)"></i>
            <span class="node" style="color:var(--accent-purple)">Edge cache</span><i class="fa-solid fa-arrow-right" style="color:var(--accent-pink)"></i>
            <span class="node" style="color:var(--state-running)">Flixora backend</span><i class="fa-solid fa-arrow-right" style="color:var(--accent-pink)"></i>
            <span class="node">Telegram</span>
          </div>
        </div>
        <div class="term-block" style="margin-bottom:14px">
          <div class="term-block-header"><span>PLAIN</span><span><button class="term-block-btn" data-copy="e1"><i class="fa-regular fa-copy"></i>copy</button></span></div>
          <div class="term-body" id="e1" style="color:var(--link);word-break:break-all"></div>
        </div>
        <div class="term-block" style="margin-bottom:14px">
          <div class="term-block-header"><span>MEDIAFLOW STYLE</span><span><button class="term-block-btn" data-copy="e2"><i class="fa-regular fa-copy"></i>copy</button></span></div>
          <div class="term-body" id="e2" style="color:var(--link);word-break:break-all"></div>
        </div>
        <div class="card" style="margin-bottom:14px">
          <table class="data-table"><thead><tr><th>X-Flx-Cache</th><th>Meaning</th></tr></thead><tbody>
            <tr><td data-label="header"><span class="tag-pill" style="background:rgba(80,250,123,.15);color:var(--state-success)">HIT</span></td><td data-label="meaning">chunk served from the edge cache</td></tr>
            <tr><td data-label="header"><span class="tag-pill" style="background:rgba(255,184,108,.15);color:var(--state-running)">MISS</span></td><td data-label="meaning">fetched from the backend, now cached</td></tr>
            <tr><td data-label="header"><span class="tag-pill" style="background:rgba(189,147,249,.15);color:var(--accent-purple)">META</span></td><td data-label="meaning">HEAD answered from stored metadata</td></tr>
            <tr><td data-label="header"><span class="tag-pill" style="background:rgba(255,85,85,.15);color:var(--state-error)">BYPASS</span></td><td data-label="meaning">passed straight through (subtitles, odd ranges)</td></tr>
          </tbody></table>
        </div>
        <div class="card"><div class="pad" style="padding-bottom:4px"><div class="mig-title"><i class="fa-solid fa-sliders" style="color:var(--accent-yellow)"></i>configuration</div></div>
          <table class="data-table"><tbody id="cfg"></tbody></table></div>
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
    { id: "overview", label: "Overview", sub: "Live snapshot of the proxy", icon: "fa-solid fa-gauge-high", color: "link" },
    { id: "log", label: "Live log", sub: "Who plays and downloads what, and how fast", icon: "fa-solid fa-list-ul", color: "green" },
    { id: "test", label: "Link tester", sub: "Check a backend link through this worker", icon: "fa-solid fa-flask", color: "pink" },
    { id: "setup", label: "Setup", sub: "Endpoints, cache headers and configuration", icon: "fa-solid fa-gear", color: "orange" }
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
  }
  Array.prototype.forEach.call(document.querySelectorAll(".nav-item"), function (b) {
    b.onclick = function () { go(b.getAttribute("data-page")); };
  });
  window.addEventListener("hashchange", function () { go(location.hash.slice(1), false); });
  function tick() { $("clock").textContent = new Date().toLocaleTimeString("en-GB", { hour12: false }); }
  tick(); setInterval(tick, 1000);

  /* ---------------- health / overview ---------------- */
  var health = null;
  function setOnline(state) {
    var col = state === "ok" ? "var(--state-success)" : state === "bad" ? "var(--state-error)" : "var(--state-idle)";
    var txt = state === "ok" ? "online" : state === "bad" ? "needs attention" : "checking";
    $("pillDot").style.background = col;
    $("sideState").innerHTML = '<span class="dot running" style="background:' + col + '"></span><span style="color:' + col + '">' + txt + "</span>";
  }
  function loadHealth() {
    var t0 = performance.now();
    fetch("/health", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (h) {
      health = h;
      var ms = Math.round(performance.now() - t0);
      setOnline(h.ok ? "ok" : "bad");
      var onoff = function (v) { return v ? "on" : "off"; };
      $("cards").innerHTML =
        statCard("fa-solid fa-circle-check", h.ok ? "green" : "red", "Status", h.ok ? "online" : "setup needed", null, "flixora-proxy") +
        statCard("fa-solid fa-bolt", h.edge_cache ? "yellow" : "orange", "Edge cache", onoff(h.edge_cache), null, h.edge_cache ? "chunks cached at the edge" : "custom domain needed") +
        statCard("fa-solid fa-cubes", "purple", "Chunk size", h.chunk_mb + " MB", null, "max " + h.max_chunks + " chunks / req") +
        statCard("fa-solid fa-key", h.download_token_check ? "green" : "orange", "Token check", onoff(h.download_token_check), null, "download gate") +
        statCard("fa-solid fa-server", h.origins ? "link" : "red", "Origins", String(h.origins), null, "allowed backends") +
        statCard("fa-solid fa-gauge-high", ms < 300 ? "green" : "orange", "Latency", ms + " ms", Math.min(100, Math.round(ms / 8)));
      var notes = [];
      if (!h.ok) notes.push("ALLOWED_ORIGINS is not configured.");
      if (!h.edge_cache) notes.push("Edge cache is off - it only works on a custom domain, not *.workers.dev.");
      if (h.backend_turnstile && !h.download_token_check) notes.push("Backend uses Turnstile but TURNSTILE_SECRET is missing here; downloads are passed through uncached.");
      $("healthNote").textContent = notes.join(" ");
      $("healthNote").className = "mig-warn" + (notes.length ? "" : " hide");
      var rows = [
        ["edge_cache", onoff(h.edge_cache)], ["chunk_mb", h.chunk_mb], ["max_chunks", h.max_chunks],
        ["prefetch_next", onoff(h.prefetch_next)], ["cap_open_ranges", onoff(h.cap_open_ranges)],
        ["backend_turnstile", onoff(h.backend_turnstile)], ["download_token_check", onoff(h.download_token_check)], ["origins", h.origins]
      ];
      $("cfg").innerHTML = rows.map(function (r) { return '<tr><td data-label="setting">' + r[0] + '</td><td data-label="value" style="color:var(--text)">' + esc(r[1]) + "</td></tr>"; }).join("");
    }).catch(function () { setOnline("bad"); $("cards").innerHTML = '<div class="mig-err" style="grid-column:1/-1">Cannot reach /health</div>'; });
  }
  loadHealth(); setInterval(loadHealth, 30000);

  /* mini charts (same idea as the dashboard's dependency-free SVG charts) */
  var samples = [];
  function drawChart() {
    var W = 600, H = 180, P = 8;
    var vals = samples.length ? samples : [0];
    var max = Math.max.apply(null, vals.concat([256 * 1024])) * 1.2;
    var step = (W - P * 2) / (vals.length - 1 || 1);
    var pts = vals.map(function (v, i) { return (P + i * step) + "," + (P + (1 - v / max) * (H - P * 2)); });
    var area = "M " + P + "," + (H - P) + " " + vals.map(function (v, i) { return "L " + (P + i * step) + "," + (P + (1 - v / max) * (H - P * 2)); }).join(" ") + " L " + (P + (vals.length - 1) * step) + "," + (H - P) + " Z";
    var grid = [0, 0.25, 0.5, 0.75, 1].map(function (f) {
      var y = P + (1 - f) * (H - P * 2);
      return '<line x1="' + P + '" y1="' + y + '" x2="' + (W - P) + '" y2="' + y + '" stroke="var(--border)"/>' +
        '<text x="2" y="' + (y - 2) + '" font-size="9" fill="var(--text-faint)" font-family="IBM Plex Mono,monospace">' + spd(f * max) + "</text>";
    }).join("");
    $("chart").innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;height:' + H + 'px" preserveAspectRatio="none">' + grid +
      '<path d="' + area + '" fill="#50FA7B" opacity="0.12"/><polyline points="' + pts.join(" ") + '" fill="none" stroke="#50FA7B" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>' +
      '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;font-size:11px;color:var(--text-dim)"><span style="width:9px;height:9px;border-radius:2px;background:#50FA7B;display:inline-block"></span>speed now &middot; last ' + vals.length + " samples</div>";
  }
  function drawDonut(hit, miss) {
    var tot = hit + miss, pct = tot ? Math.round(hit * 100 / tot) : 0, r = 52, c = 2 * Math.PI * r;
    $("donut").innerHTML = '<svg viewBox="0 0 140 140" width="150" height="150"><circle cx="70" cy="70" r="' + r + '" fill="none" stroke="var(--panel-raised)" stroke-width="14"/>' +
      '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="#BD93F9" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + (c * pct / 100) + " " + c + '" transform="rotate(-90 70 70)"/>' +
      '<text x="70" y="68" text-anchor="middle" fill="#F8F8F2" font-size="24" font-weight="600" font-family="IBM Plex Mono,monospace">' + (tot ? pct + "%" : "-") + "</text>" +
      '<text x="70" y="86" text-anchor="middle" fill="#6272A4" font-size="10" font-family="IBM Plex Mono,monospace">' + hit + " hit / " + miss + " miss</text></svg>";
  }
  drawChart(); drawDonut(0, 0);

  /* ---------------- live log ---------------- */
  var logFilter = "all", logAuto = true, logData = null, logBusy = false, askClear = 0;

  function stateBadge(st) {
    var map = { active: ["var(--state-success)", "live", 1], done: ["var(--accent-purple)", "done", 0], aborted: ["var(--state-running)", "stopped", 0], error: ["var(--state-error)", "error", 0], lost: ["var(--state-idle)", "lost", 0] };
    var m = map[st] || ["var(--state-idle)", st, 0];
    return '<span class="badge" style="color:' + m[0] + '"><span class="dot' + (m[2] ? " running" : "") + '" style="background:' + m[0] + '"></span>' + esc(m[1]) + "</span>";
  }
  function renderLog() {
    if (!logData) return;
    var now = logData.now, all = logData.entries || [];
    var act = 0, tot = 0, hit = 0, miss = 0, nowBps = 0;
    all.forEach(function (e) { if (e.state === "active") { act++; nowBps += e.bps || 0; } tot += e.sent; hit += e.hit; miss += e.miss; });
    samples.push(nowBps); samples = samples.slice(-40);
    drawChart(); drawDonut(hit, miss);
    $("chartSub").textContent = act ? act + " active stream" + (act > 1 ? "s" : "") + " - " + spd(nowBps) : "No active streams";
    $("logCards").innerHTML =
      statCard("fa-solid fa-tower-broadcast", act ? "green" : "link", "Active now", String(act), null, all.length + " sessions logged") +
      statCard("fa-solid fa-gauge-high", nowBps ? "green" : "purple", "Speed now", spd(nowBps), null, "all streams together") +
      statCard("fa-solid fa-database", "pink", "Transferred", fmtBytes(tot), null, "since the log started") +
      statCard("fa-solid fa-bolt", "yellow", "Cache hit rate", hit + miss ? Math.round(hit * 100 / (hit + miss)) + "%" : "-", hit + miss ? Math.round(hit * 100 / (hit + miss)) : null);
    $("logMode").textContent = logData.mode === "durable"
      ? "Stored in a Durable Object - last 60 sessions. Bytes are counted per finished chunk."
      : "Memory mode (no Durable Object bound) - the log resets when the worker restarts and may split across instances.";

    var list = all.filter(function (e) { return logFilter === "all" || e.kind === logFilter; });
    if (!list.length) { $("logCard").innerHTML = '<div class="empty">No activity yet. Play or download something.</div>'; return; }
    var rows = list.map(function (e) {
      var pct = e.total > 0 ? Math.min(100, Math.round(e.sent * 100 / e.total)) : 0;
      var isDl = e.kind === "download", isAct = e.state === "active";
      var chip = '<span class="icon-chip" style="background:color-mix(in srgb,' + (isDl ? C.link : C.green) + ' 15%,transparent);color:' + (isDl ? C.link : C.green) + '"><i class="fa-solid ' + (isDl ? "fa-download" : "fa-play") + '"></i></span>';
      return "<tr>" +
        '<td class="nolabel"><div class="fcell">' + chip + '<div style="min-width:0"><div class="fname">' + esc(e.name) + '</div><div class="fsub">' + (isDl ? "download" : "play") + " &middot; " + e.reqs + " req &middot; " + dur(e.busy_ms) + " active</div></div></div></td>" +
        '<td data-label="state">' + stateBadge(e.state) + (e.err ? '<div class="fsub" style="color:var(--state-error)">' + esc(e.err) + "</div>" : "") + "</td>" +
        '<td data-label="progress"><div class="pbar"><span style="color:var(--text)">' + fmtBytes(e.sent) + "</span>" + (e.total ? " / " + fmtBytes(e.total) + " (" + pct + "%)" : "") +
          '<div class="bar-track"><div class="bar-fill" style="width:' + pct + "%;background:" + (isAct ? C.green : C.purple) + '"></div></div></div></td>' +
        '<td data-label="speed">' + (isAct ? '<span style="color:var(--state-success)">' + spd(e.bps) + "</span> &middot; " : "") + "avg " + spd(e.avg) + (e.peak ? '<div class="fsub">peak ' + spd(e.peak) + "</div>" : "") + "</td>" +
        '<td data-label="cache">' + (e.hit + e.miss ? e.hit + " hit / " + e.miss + " miss" : "-") + "</td>" +
        '<td data-label="client">' + esc([e.dev, e.country].filter(Boolean).join(" · ") || "unknown") + (e.client ? '<div class="fsub">#' + esc(e.client) + "</div>" : "") + "</td>" +
        '<td data-label="when">' + ago(now, isAct ? e.t0 : e.upd) + "</td></tr>";
    }).join("");
    $("logCard").innerHTML = '<table class="data-table"><thead><tr><th>File</th><th>State</th><th>Progress</th><th>Speed</th><th>Cache</th><th>Client</th><th>When</th></tr></thead><tbody>' + rows + "</tbody></table>";
  }
  function pollLog() {
    if (logBusy) return;
    logBusy = true;
    fetch("/logs.json", { cache: "no-store" }).then(function (r) {
      if (r.status === 401) { location.reload(); return null; }
      if (r.status === 403) { $("logCard").innerHTML = '<div class="empty">UI_USER / UI_PASS are not set on the worker</div>'; return null; }
      return r.json();
    }).then(function (d) {
      if (!d) return;
      logData = d; renderLog();
    }).catch(function () {}).then(function () { logBusy = false; });
  }
  $("signOut").onclick = function () {
    fetch("/logout", { method: "POST" }).then(function () { location.reload(); });
  };
  $("logAuto").onclick = function () {
    logAuto = !logAuto;
    $("logAuto").className = "act-btn" + (logAuto ? "" : " on");
    $("logAuto").innerHTML = logAuto ? '<span class="dot running" style="background:var(--state-success)"></span>live' : '<i class="fa-solid fa-pause"></i>paused';
    if (logAuto) pollLog();
  };
  $("logClr").onclick = function () {
    var b = $("logClr");
    if (!askClear) {
      askClear = setTimeout(function () { askClear = 0; b.className = "act-btn danger"; b.innerHTML = '<i class="fa-solid fa-trash"></i>clear'; }, 2500);
      b.className = "act-btn asking"; b.innerHTML = '<i class="fa-solid fa-trash"></i>tap again';
      return;
    }
    clearTimeout(askClear); askClear = 0; b.className = "act-btn danger"; b.innerHTML = '<i class="fa-solid fa-trash"></i>clear';
    fetch("/logs/clear", { method: "POST" }).then(function () { logData = null; samples = []; pollLog(); toast("Log cleared"); });
  };
  Array.prototype.forEach.call(document.querySelectorAll("[data-f]"), function (b) {
    b.onclick = function () {
      logFilter = b.getAttribute("data-f");
      Array.prototype.forEach.call(document.querySelectorAll("[data-f]"), function (x) { x.className = "act-btn" + (x === b ? " on" : ""); });
      renderLog();
    };
  });
  pollLog();
  setInterval(function () { if (logAuto && !document.hidden) pollLog(); }, 3000);

  /* ---------------- setup page ---------------- */
  $("e1").textContent = origin + "/https://api.example.com/dl/FILE_ID/name.mkv";
  $("e2").textContent = origin + "/proxy/stream?d=" + encodeURIComponent("https://api.example.com/dl/FILE_ID/name.mkv");
  Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (b) {
    b.onclick = function () { copy($(b.getAttribute("data-copy")).textContent); };
  });

  /* ---------------- link tester ---------------- */
  var proxyUrl = "", hist = [];
  function buildProxy(v) {
    v = v.trim();
    if (!v) return "";
    if (v.indexOf(origin + "/") === 0) return v;
    if (/^https?:\/\//i.test(v)) return origin + "/" + v;
    return "";
  }
  function refresh() {
    proxyUrl = buildProxy($("src").value);
    $("out").className = proxyUrl ? "" : "hide";
    $("pxy").textContent = proxyUrl;
    if (!proxyUrl) $("res").innerHTML = "";
  }
  $("src").addEventListener("input", refresh);
  $("clr").onclick = function () { $("src").value = ""; refresh(); };
  $("cpy").onclick = function () { copy(proxyUrl); };
  $("tOpen").onclick = function () { if (proxyUrl) window.open(proxyUrl, "_blank", "noopener"); };
  function run(mode) {
    if (!proxyUrl) return;
    var btns = [$("tHead"), $("tRange")];
    btns.forEach(function (b) { b.disabled = true; });
    $("res").innerHTML = '<div class="hint mono">testing&hellip;</div>';
    var opt = mode === "head" ? { method: "HEAD" } : { method: "GET", headers: { Range: "bytes=0-0" } };
    var t0 = performance.now();
    fetch(proxyUrl, opt).then(function (r) {
      var ms = Math.round(performance.now() - t0);
      var H = function (k) { return r.headers.get(k); };
      if (r.body && mode !== "head") { try { r.body.cancel(); } catch (e) {} }
      var cl = H("content-length"), cr = H("content-range"), cd = H("content-disposition");
      var isDld = /\/dld\//.test(proxyUrl);
      var m = cr ? /\/(\d+)$/.exec(cr) : null;
      var total = m ? m[1] : (mode === "head" ? cl : null);
      var checks = [];
      function ck(ok, text, warn) {
        var ic = ok ? "fa-circle-check" : warn ? "fa-triangle-exclamation" : "fa-circle-xmark";
        var col = ok ? C.green : warn ? C.orange : C.red;
        checks.push('<li><i class="fa-solid ' + ic + '" style="color:' + col + '"></i><span>' + text + "</span></li>");
      }
      ck(r.ok, "Worker answered " + r.status + " in " + ms + " ms");
      ck(H("accept-ranges") === "bytes", "Accept-Ranges: bytes (seek and resume work)");
      ck(!!cl, "Content-Length present - the download size will show", true);
      if (mode === "range") ck(r.status === 206 && !!cr, "206 with Content-Range" + (total ? " (file = " + fmtBytes(total) + ")" : ""));
      if (isDld) ck(/attachment/i.test(cd || ""), "Content-Disposition is attachment (forces download)");
      if (isDld) ck((H("content-type") || "") === "application/octet-stream", "Content-Type is octet-stream (players will not grab it)", true);
      var rows = [["status", r.status + " " + (r.statusText || "")], ["x-flx-cache", H("x-flx-cache") || "-"], ["file size", total ? fmtBytes(total) : "?"],
        ["content-length", cl || "-"], ["content-range", cr || "-"], ["content-type", H("content-type") || "-"],
        ["disposition", cd || "-"], ["accept-ranges", H("accept-ranges") || "-"]];
      $("res").innerHTML = '<ul class="checks">' + checks.join("") + "</ul>" +
        '<div class="term-block"><div class="term-block-header"><span>RESPONSE HEADERS</span><span>' + (mode === "head" ? "HEAD" : "GET bytes=0-0") + " &middot; " + ms + ' ms</span></div><div class="term-body">' +
        rows.map(function (x) { return '<div class="term-line"><span class="k">' + x[0] + '</span><span class="v">' + esc(x[1]) + "</span></div>"; }).join("") + "</div></div>";
      hist.unshift((mode === "head" ? "HEAD " : "RANGE ") + r.status + " · " + ms + " ms · " + (H("x-flx-cache") || "-"));
      hist = hist.slice(0, 5);
      $("hist").innerHTML = hist.map(esc).join("<br>");
    }).catch(function (e) {
      $("res").innerHTML = '<div class="mig-err">Request failed: ' + esc(e && e.message || e) + "</div>";
    }).then(function () { btns.forEach(function (b) { b.disabled = false; }); });
  }
  $("tHead").onclick = function () { run("head"); };
  $("tRange").onclick = function () { run("range"); };

  go(location.hash.slice(1) || "overview", false);
})();
</script>
</body>
</html>`;
