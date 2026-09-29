import { FACE_HIDE_REPORTS } from './store';

/**
 * The moderator page at /admin: every face scan and decal (including ones hidden by reports) with remove,
 * ban and restore buttons, plus recent player reports. Everything it loads needs the admin token
 * (BUBBA_ADMIN_TOKEN), which the moderator types in once per tab.
 */
export const ADMIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Blubba moderation</title>
<style>
  :root { --ink: #1d1b3a; --bg: #f4f1ff; --card: #fff; --pink: #ff3b8a; --green: #2fae4f; --muted: #6b6890; }
  @media (prefers-color-scheme: dark) { :root { --ink: #eeeaff; --bg: #16142b; --card: #221f3d; --muted: #a49fd0; } }
  body { margin: 0; font: 15px/1.4 system-ui, sans-serif; background: var(--bg); color: var(--ink); }
  main { max-width: 1100px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 22px; margin: 8px 0 16px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
  input { font: inherit; padding: 8px 10px; border-radius: 8px; border: 2px solid var(--muted); background: var(--card); color: var(--ink); min-width: 0; flex: 1 1 220px; }
  button { font: inherit; padding: 7px 12px; border-radius: 8px; border: 0; cursor: pointer; background: var(--ink); color: var(--bg); }
  button.warn { background: var(--pink); color: #fff; } button.ok { background: var(--green); color: #fff; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
  .card { background: var(--card); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
  .card img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 50%; background: var(--bg); }
  .meta { font-size: 13px; color: var(--muted); } .tag { font-weight: 700; color: var(--pink); }
  .btns { display: flex; gap: 6px; flex-wrap: wrap; }
  table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 12px; overflow: hidden; font-size: 13px; }
  td, th { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--bg); overflow-wrap: anywhere; }
  .note { color: var(--muted); }
</style></head>
<body><main>
<h1>Blubba moderation</h1>
<div class="row"><input id="tok" type="password" placeholder="Admin token" autocomplete="off"><button id="go">Load</button></div>
<div id="msg" class="note">Enter the admin token (BUBBA_ADMIN_TOKEN on the server).</div>
<h2>Face scans</h2><div id="faces" class="grid"></div>
<h2>Custom decals</h2><div class="note">Pictures players put on the front of their tube man.</div><div id="decals" class="grid"></div>
<h2>Recent reports</h2><div style="overflow-x:auto"><table id="reports"></table></div>
</main>
<script>
const $ = (id) => document.getElementById(id);
let token = '';
try { token = sessionStorage.getItem('blubba-admin') || ''; } catch {}
$('tok').value = token;
const headers = () => ({ 'x-admin-token': token, 'content-type': 'application/json' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
async function load() {
  token = $('tok').value.trim();
  try { sessionStorage.setItem('blubba-admin', token); } catch {}
  const r = await fetch('/api/admin/faces', { headers: headers() });
  if (!r.ok) { $('msg').textContent = 'Wrong token, or admin is off (set BUBBA_ADMIN_TOKEN, 12+ characters).'; return; }
  const d = await r.json();
  $('msg').textContent = d.faces.length + ' face scan(s), ' + (d.decals || []).length + ' decal(s). Hidden ones were reported by ${FACE_HIDE_REPORTS}+ players.';
  render(d.faces, 'face');
  render(d.decals || [], 'decal');
  $('reports').innerHTML = '<tr><th>When</th><th>Reported</th><th>Reason</th><th>Room</th><th>By</th></tr>' + d.reports.map((x) =>
    '<tr><td>' + new Date(x.at).toLocaleString() + '</td><td>' + esc(x.target_name) + ' <span class="note">' + esc(x.target) + '</span></td><td>' + esc(x.reason) + '</td><td>' + esc(x.room) + '</td><td class="note">' + esc(x.reporter) + '</td></tr>').join('');
}
function render(faces, kind) {
  const box = $(kind + 's');
  box.innerHTML = '';
  for (const f of faces) {
    const c = document.createElement('div');
    c.className = 'card';
    const status = f.banned ? '<span class="tag">BANNED</span>' : f.hidden ? '<span class="tag">HIDDEN</span>' : 'showing';
    c.innerHTML = '<img alt=""><div><b>' + esc(f.name) + '</b> <span class="meta">#' + f.id + '</span></div><div class="meta">' + status + ' · ' + f.reports + ' report(s) · ' + new Date(f.updatedAt).toLocaleDateString() + '</div><div class="btns"></div>';
    if (!f.banned) fetch('/api/admin/' + kind + '/' + f.id, { headers: headers() }).then((r) => r.ok ? r.blob() : null).then((b) => { if (b) c.querySelector('img').src = URL.createObjectURL(b); });
    const btns = c.querySelector('.btns');
    const act = (label, action, cls) => { const b = document.createElement('button'); b.textContent = label; b.className = cls; b.onclick = async () => {
      if (action !== 'restore' && !confirm(label + ' the ' + kind + ' of ' + f.name + '?')) return;
      const r = await fetch('/api/admin/' + kind, { method: 'POST', headers: headers(), body: JSON.stringify({ id: f.id, action }) });
      if (r.ok) render((await r.json())[kind + 's'], kind); }; btns.append(b); };
    if (!f.banned) act('Remove', 'remove', 'warn');
    if (!f.banned) act('Remove + ban', 'ban', 'warn');
    if (f.hidden || f.banned) act('Restore', 'restore', 'ok');
    box.append(c);
  }
}
$('go').onclick = load;
$('tok').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
if (token) load();
</script></body></html>`;
