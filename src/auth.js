/**
 * Username + password login for the web UI (/ui, Live log).
 * Secrets: UI_USER, UI_PASS  (optional: SESSION_SECRET to sign the cookie with something else).
 * Session = stateless signed cookie "<expires>.<hmac>", HttpOnly + SameSite=Strict.
 * Changing UI_USER / UI_PASS / SESSION_SECRET signs everybody out.
 */

const ENC = new TextEncoder();
const COOKIE = "flx_sess";
const TTL = 7 * 24 * 3600; // seconds

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha(s) {
  return hex(await crypto.subtle.digest("SHA-256", ENC.encode(String(s))));
}

async function mac(env, expires) {
  const secret = env.SESSION_SECRET ? String(env.SESSION_SECRET) : `${env.UI_USER}\n${env.UI_PASS}`;
  const key = await crypto.subtle.importKey("raw", ENC.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, ENC.encode(`flx-ui:${env.UI_USER}:${expires}`)));
}

export const authConfigured = (env) => Boolean(env.UI_USER && env.UI_PASS);

/** Compares hashes, so length and content do not leak through timing. Both checks always run. */
export async function checkLogin(env, user, pass) {
  const [a, b, c, d] = await Promise.all([sha(user), sha(env.UI_USER), sha(pass), sha(env.UI_PASS)]);
  const u = same(a, b);
  const p = same(c, d);
  return u && p;
}

export async function isAuthed(request, env) {
  if (!authConfigured(env)) return false;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(request.headers.get("cookie") || "");
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!/^\d+$/.test(exp || "") || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return same(await mac(env, exp), sig);
}

export async function sessionCookie(env, secure) {
  const exp = Math.floor(Date.now() / 1000) + TTL;
  return `${COOKIE}=${exp}.${await mac(env, exp)}; Path=/; Max-Age=${TTL}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export const clearCookie = (secure) => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
