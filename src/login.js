/** Sign-in page shown by /ui until the visitor has a valid session cookie. */
export function loginHtml(configured) {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Flixora Proxy - sign in</title>
<style>
:root{--bg:#282A36;--panel:#21222C;--raised:#343746;--border:#44475A;--text:#F8F8F2;--dim:#BFBFDA;--faint:#6272A4;--err:#FF5555;--purple:#BD93F9;--pink:#FF79C6}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--text);font:14px system-ui,-apple-system,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;padding:16px}
.box{width:100%;max-width:340px;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:26px 22px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:20px}
.logo{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,var(--purple),var(--pink));display:flex;align-items:center;justify-content:center}
.logo:after{content:"";border-left:11px solid #1E1F29;border-top:7px solid transparent;border-bottom:7px solid transparent;margin-left:3px}
b{display:block;letter-spacing:.04em}small{color:var(--faint);font-size:12px}
label{display:block;font-size:12px;color:var(--dim);margin:14px 0 6px}
input{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:10px 11px;font:inherit;font-size:15px;outline:none}
input:focus{border-color:var(--purple)}
button{width:100%;margin-top:20px;padding:11px;border:0;border-radius:6px;background:var(--purple);color:#1E1F29;font:inherit;font-weight:600;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
.err{min-height:18px;margin-top:12px;color:var(--err);font-size:12.5px}
</style>
</head>
<body>
<form class="box" id="f" autocomplete="on">
  <div class="brand"><div class="logo"></div><div><b>FLIXORA PROXY</b><small>sign in</small></div></div>
  <label for="u">Username</label>
  <input id="u" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus>
  <label for="p">Password</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required>
  <button id="b" type="submit">Sign in</button>
  <div class="err" id="e">${configured ? "" : "UI_USER and UI_PASS are not set on the worker. Add them as secrets, then reload."}</div>
</form>
<script>
(function () {
  var f = document.getElementById("f"), e = document.getElementById("e"), b = document.getElementById("b");
  f.addEventListener("submit", function (ev) {
    ev.preventDefault();
    b.disabled = true; e.textContent = "";
    fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: document.getElementById("u").value, pass: document.getElementById("p").value })
    }).then(function (r) {
      if (r.ok) { location.reload(); return; }
      return r.json().then(function (d) { e.textContent = d.error || "Sign in failed"; }, function () { e.textContent = "Sign in failed"; });
    }).catch(function () { e.textContent = "Network error"; }).then(function () { b.disabled = false; });
  });
})();
</script>
</body>
</html>`;
}
