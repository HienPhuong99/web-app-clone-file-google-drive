'use strict';
const box = document.getElementById('box');
const token = location.pathname.split('/')[2];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = (n) => { const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`; };
const api = async (u, o) => { const r = await fetch(u, o); const d = await r.json().catch(() => null); if (!r.ok) throw new Error(d?.error || `Lỗi ${r.status}`); return d; };
const base = `/api/s/${encodeURIComponent(token)}`;
const kindOf = (m = '') => (/^image\/(png|jpe?g|gif|webp|bmp|avif)$/.test(m) ? 'image' : m === 'application/pdf' ? 'pdf' : /^video\/(mp4|webm|ogg)$/.test(m) ? 'video' : m.startsWith('audio/') ? 'audio' : m === 'text/plain' ? 'text' : 'other');

async function init() {
  try {
    const m = await api(base);
    if (m.locked) return lock();
    document.title = `${m.root.name} – Mini Drive`;
    if (m.root.is_folder) return folder(m, null);
    const id = encodeURIComponent(m.root.id); const src = `${base}/content?id=${id}&inline=1`; const k = kindOf(m.root.mime);
    const view = { image: `<img alt="" style="max-width:100%" src="${src}">`, pdf: `<iframe title="preview" style="width:100%;height:70vh;border:0" src="${src}"></iframe>`, video: `<video controls style="max-width:100%" src="${src}"></video>`, audio: `<audio controls src="${src}"></audio>`, text: `<iframe title="preview" style="width:100%;height:50vh;border:1px solid var(--line);background:#fff" src="${src}"></iframe>`, other: '<p class="muted">Không có bản xem trước cho loại tệp này.</p>' }[k];
    box.innerHTML = `<h2 style="margin:0">${esc(m.root.name)}</h2><p class="muted">${fmtSize(m.root.size)}</p><div style="text-align:center">${view}</div>
      ${m.allow_download ? `<div><a class="btn primary" style="text-decoration:none;display:inline-block" href="${base}/content?id=${id}">⬇ Tải xuống</a></div>` : ''}`;
  } catch (e) { box.innerHTML = `<h2>😕 ${esc(e.message)}</h2><a href="/">Về Mini Drive</a>`; }
}
function lock() {
  box.innerHTML = `<h2 style="margin:0">🔒 Liên kết được bảo vệ</h2><form id="f" style="display:flex;gap:8px"><input id="pw" type="password" placeholder="Mật khẩu" required style="flex:1" autocomplete="off"><button class="btn primary">Mở</button></form><p class="error" id="e"></p>`;
  document.getElementById('f').onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api(`${base}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: document.getElementById('pw').value }) }); init(); }
    catch (e) { document.getElementById('e').textContent = e.message; }
  };
}
async function folder(m, id) {
  const r = await api(`${base}/list${id ? `?folder=${id}` : ''}`);
  box.innerHTML = `<div class="crumbs">${r.crumbs.map((c, i) => `${i ? '<span class="sep">›</span>' : ''}<a href="#" data-f="${i ? c.id : ''}">${esc(c.name)}</a>`).join('')}</div>
    ${m.allow_download ? `<div><a class="btn" style="text-decoration:none" href="${base}/content?id=${id || m.root.id}">⬇ Tải cả thư mục (.zip)</a></div>` : ''}
    <div class="sharelist">${r.files.map((f) => `<div class="item" style="display:flex;gap:10px;padding:10px 14px;margin:6px 0;cursor:pointer" data-id="${f.id}" data-dir="${f.is_folder ? 1 : ''}"><span>${f.is_folder ? '📁' : '📄'}</span><span class="name">${esc(f.name)}</span><span class="sub">${f.is_folder ? '' : fmtSize(f.size)}</span></div>`).join('') || '<p class="muted">Thư mục trống</p>'}</div>`;
  box.onclick = (e) => {
    const a = e.target.closest('[data-f]'); if (a) { e.preventDefault(); return folder(m, a.dataset.f || null); }
    const it = e.target.closest('.item'); if (!it) return;
    if (it.dataset.dir) folder(m, it.dataset.id); else window.open(`${base}/content?id=${it.dataset.id}&inline=1`, '_blank', 'noopener');
  };
}
init();
