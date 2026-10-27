# Flixora Cloudflare Worker stream proxy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tharindu899/flixora-cloudflare-worker)

**One-click setup:** First upload this folder's contents to a GitHub repository named `flixora-cloudflare-worker` under `tharindu899` (or edit the button URL below to match your own public repository). Then click **Deploy to Cloudflare** above and follow Cloudflare's prompts. The button cannot work until that GitHub repository exists and is accessible to Cloudflare.

> **Before using it:** Set `BACKEND_ORIGIN` to your real backend origin and configure the `PROXY_KEY` secret in Cloudflare. Never commit secrets to GitHub. See the deployment steps below.

A small Cloudflare Worker compatible with Flixora-back's `MEDIAFLOW_PROXY` URL shape. It forwards GET/HEAD and Range headers and streams the upstream response body without buffering it in JavaScript. It intentionally disables caching because Flixora links may be short-lived or user-specific.

## Important bandwidth limitation

This Worker does **not** remove origin/VPS bandwidth usage when `d=` points to your Flixora backend: the VPS still sends the entire video to Cloudflare, then Cloudflare sends it to the viewer. It may help with edge routing/CORS, but it is not a bandwidth-reduction solution. To materially reduce VPS egress, the media bytes must be fetched from a source that does not route through your VPS (for example, a permitted direct Telegram CDN URL), or use a proper media CDN/object storage. Do not expose Telegram bot tokens or internal file-location URLs to the browser.

Cloudflare Workers Free is not an unlimited video CDN, and Telegram/Cloudflare limits still apply. This cannot promise unlimited file sizes or bypass Telegram restrictions.

## Deploy

1. Install Node.js and run `npm install` in this folder.
2. Edit `wrangler.toml`: set `BACKEND_ORIGIN` to your public HTTPS backend origin, e.g. `https://api.example.com` (no path).
3. Set a strong secret:

   `npx wrangler secret put PROXY_KEY`

   Enter a random secret of at least 32 characters. Do not commit it to Git.
4. Deploy: `npm run deploy`.
5. In Flixora backend environment/config, set:

   ```env
   API_BASE_URL=https://YOUR-BACKEND-DOMAIN.example
   HTTP_PROXY_URL=https://YOUR-WORKER.workers.dev
   MEDIAFLOW_PROXY=true
   MEDIAFLOW_PASSWORD=YOUR_SAME_RANDOM_SECRET
   ```

   `MEDIAFLOW_PASSWORD` must match the Worker `PROXY_KEY`. Restart/redeploy the backend. Flixora's current code appends `/proxy/stream?d=...&api_password=...`; this Worker expects `key=...`, so **the current backend needs a tiny compatibility change**: change `url += "&api_password=" + quote(Config.MEDIAFLOW_PASSWORD, safe="")` in `Backend/server/main.py` to `url += "&key=" + quote(Config.MEDIAFLOW_PASSWORD, safe="")`. Find the same `api_password` construction for download links and change it there too.

## Test

Open a generated proxy URL. Test playback seeking and downloads; the upstream should return `Accept-Ranges: bytes` and `206 Partial Content` for Range requests. If your backend redirects `/dl` to Telegram, this Worker intentionally refuses redirects; use a dedicated endpoint that streams bytes or extend the implementation to allow only validated Telegram CDN hosts. Never make the Worker an unrestricted open proxy.

## Deploy button URL

If you use a different GitHub account or repository name, change the button link to:

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_USERNAME/YOUR_REPOSITORY
```

The badge opens Cloudflare's deployment flow; it does not automatically configure your backend domain, secrets, or Flixora environment variables. Complete those settings after deployment.
