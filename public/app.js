'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = (n) => { if (n == null) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`; };
const fmtDate = (t) => t ? new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

async function api(url, opts = {}) {
  const o = { credentials: 'same-origin', ...opts };
  if (o.json !== undefined) { o.method ||= 'POST'; o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(o.json); }
  const r = await fetch(url, o);
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) { if (r.status === 401 && state.user && !url.startsWith('/api/login')) { location.reload(); } throw new Error(data?.error || `Lỗi ${r.status}`); }
  return data;
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message); } };

const state = { user: null, view: 'drive', parent: null, search: '', files: [], crumbs: [], sel: new Set(), mode: store.get('mode') || 'grid', sort: store.get('sort') || 'name:asc', anchor: null };

// ---------- file icons ----------
function icon(f) {
  if (f.is_folder) return '📁';
  const m = f.mime || '';
  if (m.startsWith('image/')) return '🖼'; if (m.startsWith('video/')) return '🎬'; if (m.startsWith('audio/')) return '🎵';
  if (m === 'application/pdf') return '📕'; if (/zip|rar|7z|tar|gzip/.test(m)) return '🗜';
  if (m.startsWith('text/') || m === 'application/json') return '📄'; return '📎';
}
const kind = (f) => { const m = f.mime || ''; if (f.is_folder) return 'folder'; if (/^image\/(png|jpe?g|gif|webp|bmp|avif)$/.test(m)) return 'image'; if (m === 'application/pdf') return 'pdf'; if (/^video\/(mp4|webm|ogg)$/.test(m)) return 'video'; if (/^audio\//.test(m)) return 'audio'; if (m.startsWith('text/') || /\.(txt|md|csv|json|xml|log|js|ts|py|css|html?|yml|yaml|sh|sql)$/i.test(f.name)) return 'text'; return 'other'; };

// ---------- auth ----------
let registering = false;
function showAuth() {
  $('#app').hidden = true; $('#auth').hidden = false;
  $('#authName').hidden = !registering; $('#authBtn').textContent = registering ? 'Đăng ký' : 'Đăng nhập';
  $('#authSub').textContent = registering ? 'Tạo tài khoản mới' : 'Đăng nhập để tiếp tục';
  $('#authSwitch').textContent = registering ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký';
}
$('#authSwitch').onclick = (e) => { e.preventDefault(); registering = !registering; showAuth(); };
$('#authForm').onsubmit = async (e) => {
  e.preventDefault(); $('#authErr').textContent = '';
  const f = Object.fromEntries(new FormData(e.target));
  try { await api(registering ? '/api/register' : '/api/login', { json: f }); await boot(); } catch (err) { $('#authErr').textContent = err.message; }
};
$('#logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload(); };

async function boot() {
  try { state.user = await api('/api/me'); } catch { state.user = null; return showAuth(); }
  $('#auth').hidden = true; $('#app').hidden = false;
  $('#userBtn').textContent = state.user.name[0]?.toUpperCase() || '?';
  $('#userInfo').textContent = `${state.user.name} · ${state.user.email}`;
  $('#sort').value = state.sort; route();
}

// ---------- routing ----------
function route() {
  const [, view = 'drive', id] = location.hash.split('/');
  state.view = ['drive', 'recent', 'starred', 'shared', 'trash'].includes(view) ? view : 'drive';
  state.parent = state.view === 'drive' && id ? Number(id) : null;
  state.search = ''; $('#search').value = '';
  load();
}
addEventListener('hashchange', () => state.user && route());

const load = guard(async function load() {
  const [sort, dir] = state.sort.split(':');
  const p = new URLSearchParams({ view: state.view, sort, dir });
  if (state.search) p.set('search', state.search); else if (state.parent) p.set('parent', state.parent);
  let r;
  try { r = await api(`/api/files?${p}`); } catch (e) { if (state.parent) { location.hash = '#/drive'; return; } throw e; }
  state.files = r.files; state.crumbs = r.crumbs; state.sel.clear(); render();
  refreshQuota();
});
async function refreshQuota() {
  const me = await api('/api/me'); state.user = me;
  $('#quotaBar').style.width = `${Math.min(100, (me.used / me.quota) * 100)}%`;
  $('#quotaText').textContent = `Đã dùng ${fmtSize(me.used)} / ${fmtSize(me.quota)}`;
}

// ---------- render ----------
const TITLES = { drive: 'Drive của tôi', recent: 'Gần đây', starred: 'Có gắn dấu sao', shared: 'Đã chia sẻ', trash: 'Thùng rác' };
function render() {
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === state.view && !state.search));
  const c = $('#crumbs');
  if (state.search) c.innerHTML = `<span>Kết quả cho “${esc(state.search)}”</span>`;
  else if (state.view === 'drive') {
    c.innerHTML = `<a href="#/drive" data-drop="">Drive của tôi</a>` + state.crumbs.map((x) => `<span class="sep">›</span><a href="#/drive/${x.id}" data-drop="${x.id}">${esc(x.name)}</a>`).join('');
  } else c.innerHTML = `<span>${TITLES[state.view]}</span>`;
  $('#emptyTrash').hidden = !(state.view === 'trash' && state.files.length);
  $('#viewBtn').textContent = state.mode === 'grid' ? '☰' : '▦';
  const L = $('#list'); L.className = state.mode === 'grid' ? 'grid' : 'rows';
  const thumbs = (f) => kind(f) === 'image' ? `<img loading="lazy" alt="" src="/api/files/${f.id}/content?inline=1">` : icon(f);
  L.innerHTML = state.files.map((f) => `
    <div class="item${state.sel.has(f.id) ? ' sel' : ''}" data-id="${f.id}" draggable="${state.view !== 'trash'}">
      <div class="thumb">${thumbs(f)}</div>
      <div class="meta"><span class="name" title="${esc(f.name)}">${f.starred ? '<span class="star">★</span> ' : ''}${f.shared ? '🔗 ' : ''}${esc(f.name)}</span>
      <span class="sub d">${fmtDate(f.updated)}</span><span class="sub s">${f.is_folder ? '' : fmtSize(f.size)}</span>
      <button class="more" aria-label="Thêm" data-more>⋮</button></div>
    </div>`).join('');
  const E = $('#empty'); E.hidden = !!state.files.length; L.hidden = !state.files.length;
  const msgs = { drive: ['📂', 'Thư mục trống', 'Kéo thả tệp vào đây hoặc bấm “＋ Mới”'], trash: ['🗑', 'Thùng rác trống', `Mục trong thùng rác sẽ bị xoá vĩnh viễn sau 30 ngày`], starred: ['⭐', 'Chưa có mục gắn sao', ''], recent: ['🕑', 'Chưa có tệp nào', ''], shared: ['🔗', 'Chưa chia sẻ mục nào', ''] };
  const m = state.search ? ['🔍', 'Không tìm thấy kết quả', ''] : msgs[state.view];
  E.innerHTML = `<b>${m[0]}</b>${m[1]}<br><small>${m[2]}</small>`;
  renderSel();
}
function renderSel() {
  document.querySelectorAll('.item').forEach((el) => el.classList.toggle('sel', state.sel.has(Number(el.dataset.id))));
  const bar = $('#selbar'); const n = state.sel.size; bar.hidden = !n; if (!n) return;
  const trash = state.view === 'trash';
  bar.innerHTML = `<b>${n} đã chọn</b>` + (trash
    ? `<button data-a="restore">↩ Khôi phục</button><button data-a="purge">❌ Xoá vĩnh viễn</button>`
    : `<button data-a="download">⬇ Tải xuống</button><button data-a="star">⭐ Gắn sao</button><button data-a="move">📂 Di chuyển</button><button data-a="trash">🗑 Xoá</button>`) + `<button data-a="clear">✕</button>`;
}
const selFiles = () => state.files.filter((f) => state.sel.has(f.id));
$('#selbar').onclick = (e) => { const a = e.target.dataset.a; if (!a) return; if (a === 'clear') { state.sel.clear(); return renderSel(); } bulk(a, selFiles()); };

// ---------- selection & open ----------
$('#list').addEventListener('click', (e) => {
  const el = e.target.closest('.item'); if (!el) return;
  const id = Number(el.dataset.id);
  if (e.target.closest('[data-more]')) { e.stopPropagation(); if (!state.sel.has(id)) { state.sel = new Set([id]); renderSel(); } return openCtx(e.clientX, e.clientY, [state.files.find((f) => f.id === id)]); }
  if (e.shiftKey && state.anchor != null) {
    const ids = state.files.map((f) => f.id); const [a, b] = [ids.indexOf(state.anchor), ids.indexOf(id)].sort((x, y) => x - y);
    state.sel = new Set(ids.slice(a, b + 1));
  } else if (e.ctrlKey || e.metaKey) { state.sel.has(id) ? state.sel.delete(id) : state.sel.add(id); state.anchor = id; }
  else { state.sel = new Set([id]); state.anchor = id; }
  renderSel();
});
$('#list').addEventListener('dblclick', (e) => { const el = e.target.closest('.item'); if (el && !e.target.closest('[data-more]')) open(state.files.find((f) => f.id === Number(el.dataset.id))); });
$('#list').addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.item'); if (!el) return; e.preventDefault();
  const id = Number(el.dataset.id); if (!state.sel.has(id)) { state.sel = new Set([id]); renderSel(); }
  openCtx(e.clientX, e.clientY, selFiles());
});
$('#main').addEventListener('click', (e) => { if (e.target.id === 'main' || e.target.id === 'list' || e.target.id === 'empty') { state.sel.clear(); renderSel(); } });
$('#list').addEventListener('keydown', (e) => {
  const sel = selFiles();
  if (e.key === 'Enter' && sel.length === 1) open(sel[0]);
  else if (e.key === 'Delete' && sel.length) bulk(state.view === 'trash' ? 'purge' : 'trash', sel);
  else if (e.key === 'F2' && sel.length === 1) rename(sel[0]);
  else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); state.sel = new Set(state.files.map((f) => f.id)); renderSel(); }
  else if (e.key === 'Escape') { state.sel.clear(); renderSel(); }
});

function open(f) {
  if (!f || state.view === 'trash') return;
  if (f.is_folder) { location.hash = `#/drive/${f.id}`; return; }
  preview(f);
}

// ---------- context menu ----------
function openCtx(x, y, files) {
  const m = $('#ctx'); const one = files.length === 1 ? files[0] : null; const trash = state.view === 'trash';
  const B = (a, t, cls = '') => `<button data-a="${a}" class="${cls}">${t}</button>`;
  m.innerHTML = trash ? B('restore', '↩ Khôi phục') + B('purge', '❌ Xoá vĩnh viễn', 'danger') : [
    one && B('open', one.is_folder ? '📂 Mở' : '👁 Xem trước'), B('download', '⬇ Tải xuống'),
    one && B('rename', '✏ Đổi tên'), '<hr>', one && B('share', '🔗 Chia sẻ / lấy liên kết'),
    B('star', files.every((f) => f.starred) ? '☆ Bỏ dấu sao' : '⭐ Gắn dấu sao'), B('move', '📂 Di chuyển tới…'),
    one && !one.is_folder && B('versions', '🕘 Lịch sử phiên bản'), '<hr>', B('trash', '🗑 Chuyển vào thùng rác', 'danger')].filter(Boolean).join('');
  m.hidden = false; const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`; m.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  m.onclick = (e) => { const a = e.target.dataset.a; if (!a) return; m.hidden = true; bulk(a, files); };
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('#ctx')) $('#ctx').hidden = true;
  if (!e.target.closest('.newwrap')) $('#newMenu').hidden = true;
  if (!e.target.closest('#userMenu,#userBtn')) $('#userMenu').hidden = true;
  if (!e.target.closest('aside,#menuBtn')) $('#side').classList.remove('open');
});
$('#userBtn').onclick = () => { $('#userMenu').hidden = !$('#userMenu').hidden; };
$('#menuBtn').onclick = () => $('#side').classList.toggle('open');

const bulk = guard(async (a, files) => {
  const one = files[0]; const ids = files.map((f) => f.id);
  switch (a) {
    case 'open': return open(one);
    case 'rename': return rename(one);
    case 'share': return shareDlg(one);
    case 'versions': return versionsDlg(one);
    case 'download': return download(files);
    case 'move': return moveDlg(files);
    case 'star': { const v = !files.every((f) => f.starred); await Promise.all(ids.map((id) => api(`/api/files/${id}`, { method: 'PATCH', json: { starred: v } }))); return load(); }
    case 'trash': { await Promise.all(ids.map((id) => api(`/api/files/${id}/trash`, { method: 'POST' }))); toast(`Đã chuyển ${ids.length} mục vào thùng rác`); return load(); }
    case 'restore': { await Promise.all(ids.map((id) => api(`/api/files/${id}/restore`, { method: 'POST' }))); toast('Đã khôi phục'); return load(); }
    case 'purge': { if (!confirm(`Xoá vĩnh viễn ${ids.length} mục? Không thể hoàn tác.`)) return; await Promise.all(ids.map((id) => api(`/api/files/${id}`, { method: 'DELETE' }))); return load(); }
  }
});
$('#emptyTrash').onclick = guard(async () => { if (confirm('Dọn sạch thùng rác? Không thể hoàn tác.')) { await api('/api/trash', { method: 'DELETE' }); load(); } });
function download(files) {
  const a = document.createElement('a');
  a.href = files.length === 1 && !files[0].is_folder ? `/api/files/${files[0].id}/content` : `/api/zip?ids=${files.map((f) => f.id).join(',')}`;
  document.body.append(a); a.click(); a.remove();
}

// ---------- dialogs ----------
const dlg = $('#dlg');
function showDlg(html, { big = false } = {}) { dlg.className = big ? 'big' : ''; dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); return dlg; }
dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.dataset.close !== undefined) dlg.close(); });
dlg.addEventListener('close', () => { dlg.innerHTML = ''; });
function prompt2(title, value = '', ok = 'OK') {
  return new Promise((res) => {
    showDlg(`<form method="dialog"><h2>${esc(title)}</h2><input id="pIn" value="${esc(value)}" autocomplete="off"><div class="actions"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary" value="ok">${esc(ok)}</button></div></form>`);
    const i = $('#pIn'); i.focus(); i.select();
    dlg.onclose = () => { dlg.onclose = null; res(dlg.returnValue === 'ok' ? i.value : null); dlg.returnValue = ''; };
  });
}
const rename = guard(async (f) => {
  const n = await prompt2('Đổi tên', f.name, 'Lưu'); if (!n?.trim()) return;
  await api(`/api/files/${f.id}`, { method: 'PATCH', json: { name: n } }); load();
});
const newFolder = guard(async () => {
  const n = await prompt2('Thư mục mới', 'Thư mục chưa có tên', 'Tạo'); if (!n?.trim()) return;
  await api('/api/folders', { json: { name: n, parent_id: state.parent } }); load();
});
const newText = guard(async () => {
  const n = await prompt2('Tệp văn bản mới', 'ghi-chu.txt', 'Tạo'); if (!n?.trim()) return;
  uploadFiles([{ file: new File([''], n.trim(), { type: 'text/plain' }), rel: '' }]);
});

async function moveDlg(files) {
  const ids = new Set(files.map((f) => f.id)); let cur = null;
  const draw = async () => {
    const r = await api(`/api/files?view=drive${cur ? `&parent=${cur}` : ''}`);
    const path = ['Drive của tôi', ...r.crumbs.map((c) => c.name)].join(' › ');
    showDlg(`<h2>Di chuyển ${files.length} mục</h2><p class="muted">${esc(path)}</p>
      <div style="max-height:280px;overflow:auto">${cur ? '<button class="btn" data-up style="margin:2px 0">⬆ Lên trên</button>' : ''}
      ${r.files.filter((f) => f.is_folder && !ids.has(f.id)).map((f) => `<button class="btn" data-go="${f.id}" style="display:block;width:100%;text-align:left;border-radius:8px;margin:2px 0">📁 ${esc(f.name)}</button>`).join('') || '<p class="muted">Không có thư mục con</p>'}</div>
      <div class="actions"><button class="btn" data-close>Huỷ</button><button class="btn primary" data-here>Di chuyển vào đây</button></div>`);
    dlg.onclick = guard(async (e) => {
      if (e.target === dlg || e.target.dataset.close !== undefined) return dlg.close();
      if (e.target.dataset.go) { cur = Number(e.target.dataset.go); return draw(); }
      if (e.target.dataset.up !== undefined) { cur = r.crumbs.length > 1 ? r.crumbs[r.crumbs.length - 2].id : null; return draw(); }
      if (e.target.dataset.here !== undefined) { await moveTo(files, cur); dlg.close(); }
    });
  };
  draw();
}
const moveTo = guard(async (files, parent) => {
  const res = await Promise.allSettled(files.map((f) => api(`/api/files/${f.id}`, { method: 'PATCH', json: { parent_id: parent } })));
  const bad = res.find((r) => r.status === 'rejected'); if (bad) toast(bad.reason.message); else toast('Đã di chuyển');
  load();
});

const shareDlg = guard(async (f) => {
  let s = await api(`/api/files/${f.id}/share`);
  const draw = () => {
    const link = s ? `${location.origin}${s.url}` : '';
    showDlg(`<h2>Chia sẻ “${esc(f.name)}”</h2>` + (!s ? `<p class="muted">Chưa có liên kết công khai. Bất kỳ ai có liên kết sẽ xem được.</p><div class="actions"><button class="btn" data-close>Đóng</button><button class="btn primary" id="mk">Tạo liên kết</button></div>` : `
      <div class="row"><input id="lnk" readonly value="${esc(link)}"><button class="btn" id="cp">Sao chép</button></div>
      <div class="row"><label>Mật khẩu <input id="pw" type="password" placeholder="${s.password ? '•••••• (đã đặt)' : 'Không có'}" autocomplete="new-password"></label>
        ${s.password ? '<button class="btn" id="pwx">Gỡ mật khẩu</button>' : ''}</div>
      <div class="row"><label>Hết hạn <input id="exp" type="datetime-local" value="${s.expires_at ? new Date(s.expires_at - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : ''}"></label></div>
      <div class="row"><label><input id="dl" type="checkbox" ${s.allow_download ? 'checked' : ''}> Cho phép tải xuống</label></div>
      <p class="muted">${s.views} lượt xem</p>
      <div class="actions"><button class="btn danger" id="rm">Ngừng chia sẻ</button><button class="btn" data-close>Đóng</button><button class="btn primary" id="sv">Lưu</button></div>`));
    const on = (id, fn) => { const el = $(id, dlg); if (el) el.onclick = guard(fn); };
    on('#mk', async () => { s = await api(`/api/files/${f.id}/share`, { method: 'PUT', json: {} }); draw(); load(); });
    on('#cp', async () => { try { await navigator.clipboard.writeText(link); toast('Đã sao chép liên kết'); } catch { $('#lnk').select(); toast('Nhấn Ctrl+C để sao chép'); } });
    on('#pwx', async () => { s = await api(`/api/files/${f.id}/share`, { method: 'PUT', json: { password: '' } }); draw(); });
    on('#rm', async () => { await api(`/api/files/${f.id}/share`, { method: 'DELETE' }); s = null; draw(); load(); });
    on('#sv', async () => {
      const exp = $('#exp').value ? new Date($('#exp').value).getTime() : null; const body = { expires_at: exp, allow_download: $('#dl').checked };
      if ($('#pw').value) body.password = $('#pw').value;
      s = await api(`/api/files/${f.id}/share`, { method: 'PUT', json: body }); toast('Đã lưu'); draw();
    });
  };
  draw();
});

const versionsDlg = guard(async (f) => {
  const draw = async () => {
    const r = await api(`/api/files/${f.id}/versions`);
    showDlg(`<h2>Phiên bản của “${esc(f.name)}”</h2><div style="max-height:320px;overflow:auto">${r.versions.map((v, i) => `
      <div class="ver"><div class="grow">${new Date(v.created).toLocaleString('vi-VN')} · ${fmtSize(v.size)} ${v.current ? '<span class="tag">Hiện tại</span>' : ''}</div>
      <a class="btn" href="/api/files/${f.id}/content?version=${v.id}">⬇</a>
      ${v.current ? '' : `<button class="btn" data-rs="${v.id}">Khôi phục</button><button class="btn danger" data-dl="${v.id}">✕</button>`}</div>`).join('')}</div>
      <div class="actions"><button class="btn" data-close>Đóng</button><button class="btn primary" id="nv">⬆ Tải phiên bản mới</button></div>`);
    $('#nv', dlg).onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.onchange = guard(async () => { const fd = new FormData(); fd.append('file', i.files[0]); await api(`/api/files/${f.id}/versions`, { method: 'POST', body: fd }); toast('Đã tải phiên bản mới'); await draw(); load(); }); i.click(); };
    dlg.querySelectorAll('[data-rs]').forEach((b) => { b.onclick = guard(async () => { await api(`/api/files/${f.id}/versions/${b.dataset.rs}/restore`, { method: 'POST' }); toast('Đã khôi phục phiên bản'); await draw(); load(); }); });
    dlg.querySelectorAll('[data-dl]').forEach((b) => { b.onclick = guard(async () => { await api(`/api/files/${f.id}/versions/${b.dataset.dl}`, { method: 'DELETE' }); await draw(); refreshQuota(); }); });
  };
  draw();
});

function preview(f) {
  const k = kind(f); const src = `/api/files/${f.id}/content?inline=1`;
  const idx = state.files.filter((x) => !x.is_folder); let i = idx.findIndex((x) => x.id === f.id);
  const body = { image: `<img alt="${esc(f.name)}" src="${src}">`, pdf: `<iframe title="${esc(f.name)}" src="${src}"></iframe>`, video: `<video controls autoplay src="${src}"></video>`, audio: `<audio controls autoplay src="${src}"></audio>`, text: '<pre id="txt">Đang tải…</pre>', other: `<div class="empty"><b>${icon(f)}</b>Không có bản xem trước cho loại tệp này<br><br><a class="btn" href="/api/files/${f.id}/content">⬇ Tải xuống</a></div>` }[k];
  showDlg(`<div class="viewer-head"><b class="name">${esc(f.name)}</b><span class="sub">${fmtSize(f.size)}</span>
    <button class="icon" data-p="-1" ${i < 1 ? 'disabled' : ''} aria-label="Trước">‹</button><button class="icon" data-p="1" ${i >= idx.length - 1 ? 'disabled' : ''} aria-label="Sau">›</button>
    <a class="icon" style="display:grid;place-items:center;text-decoration:none" href="/api/files/${f.id}/content" aria-label="Tải xuống">⬇</a><button class="icon" data-close aria-label="Đóng">✕</button></div>
    <div class="viewer-body">${body}</div>`, { big: true });
  if (k === 'text') fetch(`/api/files/${f.id}/text`, { credentials: 'same-origin' }).then((r) => r.text()).then((t) => { $('#txt').textContent = t || '(Tệp trống)'; });
  dlg.onclick = (e) => { if (e.target.dataset.close !== undefined) dlg.close(); const p = e.target.closest('[data-p]'); if (p) preview(idx[i + Number(p.dataset.p)]); };
}
dlg.addEventListener('keydown', (e) => { if (dlg.classList.contains('big')) { const b = dlg.querySelector(e.key === 'ArrowLeft' ? '[data-p="-1"]' : e.key === 'ArrowRight' ? '[data-p="1"]' : null); if (b && !b.disabled) b.click(); } });

// ---------- upload ----------
let upQueue = [], upRunning = 0, upDone = 0, upTotal = 0;
function uploadFiles(items) {
  const parent = state.view === 'drive' ? state.parent : null;
  for (const it of items) { upQueue.push({ ...it, parent }); upTotal++; }
  pump();
}
function pump() {
  while (upRunning < 3 && upQueue.length) {
    const job = upQueue.shift(); upRunning++;
    const row = document.createElement('div'); row.className = 'up';
    row.innerHTML = `<div class="name">${esc(job.rel || job.file.name)}</div><div class="bar"><i></i></div>`; $('#uploads').append(row); $('#uploads').hidden = false; headUp();
    const fd = new FormData(); if (job.parent) fd.append('parent_id', job.parent); if (job.rel) fd.append('rel_path', job.rel); fd.append('file', job.file);
    const x = new XMLHttpRequest(); x.open('POST', '/api/upload');
    x.upload.onprogress = (e) => { if (e.lengthComputable) row.querySelector('i').style.width = `${(e.loaded / e.total) * 100}%`; };
    x.onloadend = () => {
      upRunning--; upDone++;
      if (x.status === 200) row.querySelector('i').style.width = '100%'; else { row.classList.add('err'); row.append(` ✕ ${(() => { try { return JSON.parse(x.responseText).error; } catch { return 'Lỗi tải lên'; } })()}`); }
      headUp(); pump();
      if (!upQueue.length && !upRunning) { upDone = upTotal = 0; load(); setTimeout(() => { if (!upRunning && !upQueue.length && !$('#uploads .err')) { $('#uploads').hidden = true; $('#uploads').innerHTML = ''; } }, 3000); }
    };
    x.send(fd);
  }
}
function headUp() {
  let h = $('#uploads h4'); if (!h) { h = document.createElement('h4'); $('#uploads').prepend(h); }
  h.innerHTML = `<span>Đang tải lên ${upDone}/${upTotal}</span><button class="icon" style="width:24px;height:24px" aria-label="Đóng" onclick="this.closest('#uploads').hidden=true;this.closest('#uploads').innerHTML=''">✕</button>`;
}
$('#fileIn').onchange = (e) => { uploadFiles([...e.target.files].map((file) => ({ file, rel: '' }))); e.target.value = ''; };
$('#dirIn').onchange = (e) => { uploadFiles([...e.target.files].map((file) => ({ file, rel: file.webkitRelativePath }))); e.target.value = ''; };

async function readEntries(entry, prefix = '') {
  if (entry.isFile) return new Promise((r) => entry.file((file) => r([{ file, rel: prefix ? prefix + file.name : '' }]), () => r([])));
  const reader = entry.createReader(); const out = []; let batch;
  do { batch = await new Promise((r) => reader.readEntries(r, () => r([]))); for (const e of batch) out.push(...await readEntries(e, `${prefix || ''}${entry.name}/`)); } while (batch.length);
  return out;
}
// drag & drop: external files upload, internal drags move
let dragDepth = 0; let internalDrag = null;
document.addEventListener('dragenter', (e) => { if (!internalDrag && e.dataTransfer?.types.includes('Files') && state.user) { dragDepth++; $('#drop').hidden = false; } });
document.addEventListener('dragleave', () => { if (!internalDrag && dragDepth > 0 && --dragDepth === 0) $('#drop').hidden = true; });
document.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files') || internalDrag) e.preventDefault(); });
document.addEventListener('drop', guard(async (e) => {
  e.preventDefault(); dragDepth = 0; $('#drop').hidden = true;
  if (internalDrag) return;
  const items = [...(e.dataTransfer?.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!items.length) return uploadFiles([...e.dataTransfer.files].map((file) => ({ file, rel: '' })));
  const all = (await Promise.all(items.map((en) => readEntries(en)))).flat(); if (all.length) uploadFiles(all);
}));
$('#list').addEventListener('dragstart', (e) => {
  const el = e.target.closest('.item'); if (!el) return; const id = Number(el.dataset.id);
  if (!state.sel.has(id)) { state.sel = new Set([id]); renderSel(); }
  internalDrag = selFiles(); e.dataTransfer.setData('text/plain', 'move'); e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragend', () => { internalDrag = null; document.querySelectorAll('.dragover').forEach((x) => x.classList.remove('dragover')); });
function dropTarget(e) {
  const el = e.target.closest('.item[data-id], [data-drop]'); if (!el || !internalDrag) return null;
  if (el.dataset.drop !== undefined) return { el, id: el.dataset.drop ? Number(el.dataset.drop) : null };
  const f = state.files.find((x) => x.id === Number(el.dataset.id)); return f?.is_folder && !internalDrag.some((x) => x.id === f.id) ? { el, id: f.id } : null;
}
document.addEventListener('dragover', (e) => { document.querySelectorAll('.dragover').forEach((x) => x.classList.remove('dragover')); dropTarget(e)?.el.classList.add('dragover'); });
document.addEventListener('drop', (e) => { const t = dropTarget(e); if (t) { const files = internalDrag; internalDrag = null; moveTo(files, t.id); } });

// ---------- misc UI ----------
$('#newBtn').onclick = () => { $('#newMenu').hidden = !$('#newMenu').hidden; };
$('#newMenu').onclick = (e) => {
  const a = e.target.dataset.act; if (!a) return; $('#newMenu').hidden = true;
  if (state.view !== 'drive') location.hash = '#/drive';
  ({ newFolder, newText, uploadFile: () => $('#fileIn').click(), uploadFolder: () => $('#dirIn').click() })[a]();
};
$('#viewBtn').onclick = () => { state.mode = state.mode === 'grid' ? 'rows' : 'grid'; store.set('mode', state.mode); render(); };
$('#sort').onchange = (e) => { state.sort = e.target.value; store.set('sort', state.sort); load(); };
let st; $('#search').oninput = (e) => { clearTimeout(st); st = setTimeout(() => { state.search = e.target.value.trim(); load(); }, 250); };
const applyTheme = (t) => { document.documentElement.dataset.theme = t; store.set('theme', t); };
applyTheme(store.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
boot();
