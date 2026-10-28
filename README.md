# Flixora Proxy (Cloudflare Free Worker)

Flixora backend (`/dl` සහ `/dld`) ඉස්සරහින් තියන stream/download proxy එකක්.

## මොකද කරන්නේ

- හැම Range request එකක්ම **aligned chunks** (default 4 MB) වලට කඩලා, chunk එකක් Cloudflare edge cache එකේ save කරනවා.
  ඊට පස්සේ ඒ chunk එක ඉල්ලන ඕනෑම user කෙනෙක්ට (replay, seek, වෙන viewer) **VPS එකටවත් Telegram එකටවත් නොගිහින්** edge එකෙන්ම යනවා.
- Chunk එක cache එකට යන ගමන්ම user ට stream වෙනවා (buffer කරන්නේ නෑ), ඒ නිසා first byte ඉක්මනින් එනවා. ඊළඟ chunk එක කලින්ම lookup කරනවා.
- Backend එකේ Turnstile download token (`dt`) එක Worker එකම verify කරනවා (same HMAC), ඒ නිසා cache එකෙන් download gate එක bypass කරන්න බෑ.
- Open proxy එකක් නෙවෙයි: `ALLOWED_ORIGINS` වල තියන host එකේ `/dl` සහ `/dld` විතරයි යන්නේ.
- Subrequest limit (Free: 50) අහම්බෙන්වත් පැන්නොත් ඉතුරු කොටස එක origin request එකකින් stream කරනවා, response එක කැඩෙන්නේ නෑ.

## Setup

```bash
unzip flixora-worker.zip && cd flixora-worker
npm install
npm test                      # mock backend එකට against tests
```

1. `wrangler.toml` එකේ `ALLOWED_ORIGINS` = ඔයාගේ backend host (`API_BASE_URL` එකේ host එකම, උදා `api.example.com`).
2. Login + secret:
   ```bash
   npx wrangler login
   npx wrangler secret put TURNSTILE_SECRET     # backend config.env එකේ TURNSTILE_SECRET එකම value එක
   ```
   Backend එකේ Turnstile off නම් secret එක දාන්න එපා, `BACKEND_USES_TURNSTILE = "false"` කරන්න.
3. Deploy: `npx wrangler deploy`
4. **Custom domain එකක් attach කරන්න** (Cloudflare එකේ තියන domain එකක subdomain එකක්, උදා `stream.yourdomain.com`):
   `wrangler.toml` එකේ `routes = [...]` line එක uncomment කරලා ආයෙ deploy කරන්න.
   Edge cache (Cache API) වැඩ කරන්නේ custom domain එකේ විතරයි. `*.workers.dev` එකේ Worker එක වැඩ කරනවා, ඒත් cache නැතුව pass-through විතරයි (`ENABLE_CACHE=auto` එකෙන් ඒක automatically handle වෙනවා).

## Backend එකේ proxy link එක දාන්න

Backend එකේ `HTTP_PROXY_URL` support එක දැනටමත් තියෙනවා, code වෙනස් කරන්න ඕනේ නෑ. `config.env` එකට:

```env
API_BASE_URL="https://api.example.com"
HTTP_PROXY_URL="https://stream.yourdomain.com"
MEDIAFLOW_PROXY="true"
MEDIAFLOW_PASSWORD=""
```

`MEDIAFLOW_PROXY="true"` දාන්නේ URL එක `https://stream.yourdomain.com/proxy/stream?d=<encoded dl url>` විදිහට හැදෙන නිසා (Cloudflare path එකේ `//` එකතු කරන්න පුළුවන් නිසා මේක safe). Download වලට `r_content-disposition` එකත් backend එක එකතු කරනවා, Worker එක ඒක use කරනවා. Password එක ඕනේ නෑ.

Plain mode ත් වැඩ කරනවා: `MEDIAFLOW_PROXY="false"` සහ `HTTP_PROXY_URL="https://stream.yourdomain.com/"` (**අන්තිමට `/` ඕනේ**, backend එක `base + url` කෙලින්ම ඒකතු කරන නිසා).

ඊට පස්සේ backend restart කරන්න. API response වල `proxy_url` සහ `/api/download-link` ඔයාගේ frontend එක දැනටමත් use කරනවා.

## Check කරන හැටි

```bash
# status
curl https://stream.yourdomain.com/health

# 1st request = MISS, 2nd = HIT  (X-Flx-Cache header)
URL="https://stream.yourdomain.com/proxy/stream?d=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("https://api.example.com/dl/<id>/<name>",safe=""))')"
curl -s -D- -o /dev/null -H "Range: bytes=0-1048575" "$URL" | grep -i "x-flx-cache\|content-range"
curl -s -D- -o /dev/null -H "Range: bytes=0-1048575" "$URL" | grep -i "x-flx-cache"
```

`X-Flx-Cache`: `HIT` (edge එකෙන්), `MISS` (VPS එකෙන් ගත්තා, දැන් cache වුණා), `BYPASS` (subtitle, හෝ Worker එකට token verify කරන්න බැරි download).

## Settings (`wrangler.toml` `[vars]`)

| Var | Default | |
|---|---|---|
| `ALLOWED_ORIGINS` | (required) | backend host(s) |
| `CHUNK_MB` | 4 | chunk size, 1-32 |
| `MAX_CHUNKS` | 12 | open-ended `bytes=N-` එකකට දෙන max chunks |
| `CACHE_TTL` | 604800 | seconds |
| `ENABLE_CACHE` | auto | auto / true / false |
| `CAP_OPEN_RANGES` | true | player එක short 206 එකක් පස්සේ ඊළඟ range එක ඉල්ලන්නේ නැත්නම් false |
| `PREFETCH_NEXT` | true | ඊළඟ chunk එක කලින් lookup |
| `BACKEND_USES_TURNSTILE` | true | backend Turnstile off නම් false |
| `ORIGIN_URL` | - | optional short mode (`https://proxy/dl/<id>/<name>`) |
| `CF_REQ_LIMIT` | 100000 | Worker requests per day for the Limits meter (Free plan = 100000) |
| `CF_WARN_PCT` | 80 | Telegram alert at this % of a Cloudflare Free daily limit (0 = off) |

## දැනගන්න ඕන limits (honest notes)

- **Cache එක colo එකකට (data center එකකට) වෙනම.** Cloudflare Cache API contents replicate වෙන්නේ නෑ. ඒ නිසා VPS bandwidth save වෙන්නේ එකම region එකේ ඊළඟ viewers ලා ඒ chunk එකම ඉල්ලද්දී. Region එකේ පළවෙනි viewer ට chunk එක තාම VPS එකෙන්ම එනවා.
- **Free plan: Worker requests 100,000/day**, burst 1,000/min. 1 viewer hour එකකට requests ~ 30-60 ක් යනවා (open ranges cap වෙන නිසා), ඒ නිසා ලොකු traffic එකකට Paid plan ($5) ඕන වෙයි.
- Full-file download (Range නැති 200) එකේ, පළවෙනි chunks කීපය විතරක් cache path එකෙන් යනවා, ඉතුරු කොටස එක origin request එකකින් stream වෙනවා (Free subrequest limit නිසා). Stream/seek වලට (Range requests) full benefit එක තියෙනවා. Download manager (IDM වගේ) ranges දාලා ඉල්ලුවොත් ඒවටත් cache benefit එක ලැබෙනවා.
- Telegram limit/flood wait අඩු වෙන්නේ repeat chunk requests cache එකෙන් serve වෙන නිසා සහ එකම isolate එකේ එකම chunk එක එකපාර ඉල්ලුවොත් එකම download එකට wait කරන නිසා. Backend එක 429/502/503/504 දුන්නොත් Worker එක 2 පාරක් retry කරනවා. ඒත් හැම viewer ම අලුත් file එකක් පළවෙනි පාරට ඉල්ලුවොත් Telegram එකට යන requests ඒකම තමයි.
- Cloudflare Free plan එකෙන් video වගේ ලොකු non-HTML content ගොඩක් cache කරලා serve කිරීම ගැන Cloudflare ගේ Terms of Service එකේ කොටසක් තියෙනවා. Traffic එක ලොකු වුණොත් ඒක ඔයාම check කරගන්න.

## Dashboard UI

Worker URL එක browser එකෙන් open කරාම (`/` හෝ `/ui`, login ඕන) එක පිටුවක් (**Overview**) එනවා: status, backend (VPS) up/down, edge cache, token check,
Cloudflare Free plan usage (Worker requests, Durable Object requests, DO rows written, reset වෙන වෙලාව, limits table) සහ අද saved / VPS bytes.

**කිසිම දෙයක් auto-refresh වෙන්නේ නෑ**: Free plan එකේ හැම request එකක්ම ගණන් ගන්න නිසා page එක open කරද්දී සහ `refresh` ඔබද්දී විතරයි data ගන්නේ (requests 4ක්).
Settings වෙනස් කරන්නේ `wrangler.toml` `[vars]` එකෙන් (redeploy). Live log, Stats, Link tester, Config, Setup පිටු අයින් කළා.
(පහත Live log / Stats / Purge UI ගැන තියෙන කොටස් දැන් අදාළ නෑ; alerts, limits, protection backend එකේ ඒ විදියටම වැඩ කරනවා.)

## Stats, alerts, protection

- **Overview** cards: Backend (VPS) up/down + ms, **Saved today** (bytes served from the edge instead of the VPS), From VPS today, Requests today.
- **Stats** page: 7-day totals, 14-day chart (edge vs VPS), daily table, top files. Totals are kept 31 days in the Durable Object
  (memory mode resets on restart). Day boundary = `STATS_TZ_MIN` (default 330 = Sri Lanka).
- **Telegram alerts**: secrets `TG_BOT_TOKEN` (from @BotFather) + `TG_CHAT_ID` (GitHub Actions secrets, same way as `UI_USER`; optional - deploy works without them).
  A cron trigger (`[triggers]` in `wrangler.toml`, every 5 min) pings every host in `ALLOWED_ORIGINS` and sends a message when the backend is
  down (2 failed checks in a row) and when it is back, when `ALERT_ERRORS` (default 5) streams/downloads fail within 10 min, and, if
  `ALERT_MIN_HIT_PCT` > 0, when today's chunk hit rate is below that. Needs the `LOGS` Durable Object. Setup page -> "send test alert" checks the bot.
- **Country block**: `BLOCK_COUNTRIES = "CN,RU"` in `wrangler.toml` (or as a variable). Only proxy traffic is blocked, never the UI login.
- **Login lock**: 5 wrong passwords from one client within 15 min lock the login for 15 min (HTTP 429, even the right password is refused), and Telegram gets one notice.
- **Heavy client alert**: a client (IP hash) that pulls more than `ABUSE_GB_PER_HOUR` (default 30) in one hour triggers a Telegram message (once per 6 h). The Stats page lists the heaviest clients of the last hour.
- **Per-client limits**: `MAX_CLIENT_REQS` (parallel connections, default 24) and `MAX_CLIENT_FILES` (different files at once, default 6). Over the limit -> 429 with `Retry-After: 5`, nothing is fetched from the VPS,
  and the Stats page counts it under "Limited". Set `0` to turn a limit off. Note: on mobile networks (CGNAT) many people share one IP, so do not set these too low.
- **Light / dark** toggle in the sidebar (remembered in the browser).

## Cloudflare Free plan limits (UI -> Overview)

Worker එක Cloudflare **Free plan** එකේ limits වලට කිට්ටු වෙනවද කියලා UI එකේ **Overview** පිටුවෙන් බලන්න පුළුවන්:

- **Cards**: Worker requests today (`/ 100,000`), Durable Object requests (`/ 100,000`), DO rows written (estimate, `/ 100,000`), limit reset වෙන්න තියෙන වෙලාව.
  Overview පිටුවෙත් "CF requests today" card එකක් තියෙනවා.
- **Table**: Free plan limits (requests/day, 1,000 requests/min burst, 10 ms CPU, 50 subrequests, 128 MB memory, 3 MB worker size, DO limits) සහ මේ Worker එක ඒවාට කොච්චර use කරනවද.
- **Telegram alert**: ඕනෑම daily limit එකක් `CF_WARN_PCT` (default 80%) වුණාම, ආයෙත් 95% සහ 100% වුණාම, දවසකට එක පාරක් බැගින්. Cron check එකෙන් (5 min) යවනවා.
- Daily limits **00:00 UTC** වලට reset වෙනවා (Sri Lanka 05:30). Stats වල day boundary (`STATS_TZ_MIN`) වෙනස් වුණත් මේක හැමවිටම UTC.
- Requests ගණන් කරන්නේ Worker එක තනියම (හැම request එකක්ම, UI poll වලත් එක්ක; 5-min cron check එක නැතුව). ඒ නිසා Cloudflare dashboard එකේ අගයට වඩා පොඩ්ඩක් වෙනස් වෙන්න පුළුවන්.
  DO "rows written" එක estimate එකක් (Durable Object storage `put` එකක් = row එකක්). Memory mode (LOGS නැතුව) එකේ ගණන් per-instance, restart වුණාම reset.
- `CF_REQ_LIMIT` සහ `CF_WARN_PCT` `wrangler.toml` එකේ. ඒවා meter එකටයි alert එකටයි විතරයි, Cloudflare ගේ real limit එක වෙනස් වෙන්නේ නෑ.

## Live log

UI එකේ **Live log** panel එක: play / download වෙන හැම file එකකම නම, size, progress, speed (now / avg / peak),
cache hit/miss, device + country (IP එක save කරන්නේ නෑ, hash එකක් විතරයි), requests ගණන. Player එකක Range requests
ඔක්කොම එක entry එකකට merge වෙනවා.

- **UI login**: `/ui` එකට username + password ඕනේ. Secrets දෙකක් දාන්න (නැත්නම් login එක වැඩ කරන්නේ නෑ, UI එක lock):
  `UI_USER` සහ `UI_PASS`. GitHub repo -> Settings -> Secrets and variables -> Actions එකේ ඒ නම් දෙකෙන්ම secrets හදන්න, deploy workflow එක Worker එකට push කරනවා.
  (නැත්නම් Cloudflare dashboard -> Workers -> flixora-proxy -> Settings -> Variables and Secrets, නැත්නම් `npx wrangler secret put UI_USER` / `UI_PASS`.)
  Login වුණාම 7 දවසක් cookie එකක් (HttpOnly) තියෙනවා, sidebar එකේ **sign out** එකෙන් අයින් කරන්න. Password මාරු කළාම ඔක්කොම sessions logout වෙනවා.
  `LOG_TOKEN` දැන් අයින් කළා.
- `wrangler.toml` එකේ `LOGS` Durable Object binding එක තියෙනවා නම් log එක persist වෙනවා (අන්තිම session 60).
  ඒක අයින් කරොත් memory mode (worker restart වුණාම මැකෙනවා).
- Bytes count වෙන්නේ chunk එකක් ඉවර වුණාම. ඒ නිසා ගොඩක් ලොකු download එකක් අතරමග නතර කළොත් අන්තිම partial chunk එක ගණන් ගන්නේ නෑ.
- Free plan එකේ subrequest limit එකට log එකට 10ක් reserve වෙනවා (LOGS bound නම් විතරක්).

