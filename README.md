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

## දැනගන්න ඕන limits (honest notes)

- **Cache එක colo එකකට (data center එකකට) වෙනම.** Cloudflare Cache API contents replicate වෙන්නේ නෑ. ඒ නිසා VPS bandwidth save වෙන්නේ එකම region එකේ ඊළඟ viewers ලා ඒ chunk එකම ඉල්ලද්දී. Region එකේ පළවෙනි viewer ට chunk එක තාම VPS එකෙන්ම එනවා.
- **Free plan: Worker requests 100,000/day**, burst 1,000/min. 1 viewer hour එකකට requests ~ 30-60 ක් යනවා (open ranges cap වෙන නිසා), ඒ නිසා ලොකු traffic එකකට Paid plan ($5) ඕන වෙයි.
- Full-file download (Range නැති 200) එකේ, පළවෙනි chunks කීපය විතරක් cache path එකෙන් යනවා, ඉතුරු කොටස එක origin request එකකින් stream වෙනවා (Free subrequest limit නිසා). Stream/seek වලට (Range requests) full benefit එක තියෙනවා. Download manager (IDM වගේ) ranges දාලා ඉල්ලුවොත් ඒවටත් cache benefit එක ලැබෙනවා.
- Telegram limit/flood wait අඩු වෙන්නේ repeat chunk requests cache එකෙන් serve වෙන නිසා සහ එකම isolate එකේ එකම chunk එක එකපාර ඉල්ලුවොත් එකම download එකට wait කරන නිසා. Backend එක 429/502/503/504 දුන්නොත් Worker එක 2 පාරක් retry කරනවා. ඒත් හැම viewer ම අලුත් file එකක් පළවෙනි පාරට ඉල්ලුවොත් Telegram එකට යන requests ඒකම තමයි.
- Cloudflare Free plan එකෙන් video වගේ ලොකු non-HTML content ගොඩක් cache කරලා serve කිරීම ගැන Cloudflare ගේ Terms of Service එකේ කොටසක් තියෙනවා. Traffic එක ලොකු වුණොත් ඒක ඔයාම check කරගන්න.

## Dashboard UI

Worker URL එක browser එකෙන් open කරාම (`/` හෝ `/ui`) Vps-Dashboard එකේ වගේම Dracula dashboard එකක් එනවා:
sidebar + topbar, පිටු 4ක් (`#overview`, `#log`, `#test`, `#setup`).

- **Overview**: status / edge cache / chunk size / token check / origins / latency cards, throughput chart, cache hit donut
- **Live log**: ඊළඟ section එක බලන්න (phone එකේ table එක card list එකක් විදියට පෙනෙනවා)
- **Link tester**: backend link එක paste කරලා HEAD / Range 0-0 test (checks + headers)
- **Setup**: endpoint examples (copy), `X-Flx-Cache` අර්ථ, current configuration

`/health` තාමත් JSON. Fonts (Inter, IBM Plex Mono) සහ Font Awesome load වෙන්නේ Google Fonts / cdnjs වලින්,
CSP එකේ ඒ hosts දෙක විතරක් allow කරලා තියෙනවා.

## Live log

UI එකේ **Live log** panel එක: play / download වෙන හැම file එකකම නම, size, progress, speed (now / avg / peak),
cache hit/miss, device + country (IP එක save කරන්නේ නෑ, hash එකක් විතරයි), requests ගණන. Player එකක Range requests
ඔක්කොම එක entry එකකට merge වෙනවා.

- **LOG_TOKEN secret එකක් දාන්න** (නැත්නම් log එක lock): Cloudflare dashboard -> Workers -> flixora-proxy -> Settings -> Variables and Secrets -> Add -> type *Secret*, name `LOG_TOKEN`.
  ඒ value එකම UI එකේ Live log එකේ ගහලා Unlock කරන්න.
- `wrangler.toml` එකේ `LOGS` Durable Object binding එක තියෙනවා නම් log එක persist වෙනවා (අන්තිම session 60).
  ඒක අයින් කරොත් memory mode (worker restart වුණාම මැකෙනවා).
- Bytes count වෙන්නේ chunk එකක් ඉවර වුණාම. ඒ නිසා ගොඩක් ලොකු download එකක් අතරමග නතර කළොත් අන්තිම partial chunk එක ගණන් ගන්නේ නෑ.
- Free plan එකේ subrequest limit එකට log එකට 10ක් reserve වෙනවා (LOGS bound නම් විතරක්).

