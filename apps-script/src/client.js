'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = (n) => { if (n == null) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`; };
const fmtDate = (t) => t ? new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
const FOLDER = 'application/vnd.google-apps.folder';

// google.script.run as promises
const run = (fn, ...args) => new Promise((res, rej) => google.script.run.withSuccessHandler(res).withFailureHandler((e) => rej(new Error(e && e.message ? e.message : String(e))))[fn](...args));
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3500); }
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message); } };

const state = { me: null, view: 'drive', folder: null, search: '', files: [], crumbs: [], next: null, sel: new Set(), mode: store.get('mode') || 'grid', sort: store.get('sort') || 'name', anchor: null, seq: 0 };

function icon(f) {
  if (f.isFolder) return '📁';
  const m = f.mime || '';
  if (m === 'application/vnd.google-apps.document') return '📘'; if (m === 'application/vnd.google-apps.spreadsheet') return '📗';
  if (m === 'application/vnd.google-apps.presentation') return '📙'; if (m.startsWith('image/')) return '🖼'; if (m.startsWith('video/')) return '🎬';
  if (m.startsWith('audio/')) return '🎵'; if (m === 'application/pdf') return '📕'; if (/zip|rar|7z|tar|gzip/.test(m)) return '🗜';
  if (m.startsWith('text/')) return '📄'; return '📎';
}
const isGoogleType = (f) => (f.mime || '').startsWith('application/vnd.google-apps.');

// ---------- boot / navigation ----------
async function boot() {
  try { state.me = await run('info'); } catch (e) { $('#main').innerHTML = `<div class="empty"><b>⚠️</b>${esc(e.message)}</div>`; return; }
  $('#userBtn').textContent = (state.me.name || state.me.email || '?')[0].toUpperCase();
  $('#userInfo').textContent = `${state.me.name} · ${state.me.email}`;
  $('#sort').value = state.sort; quota(); go('drive', null);
}
function quota() {
  const { used, limit } = state.me;
  $('#quotaBar').style.width = limit ? `${Math.min(100, (used / limit) * 100)}%` : '0';
  $('#quotaText').textContent = limit ? `Đã dùng ${fmtSize(used)} / ${fmtSize(limit)}` : `Đã dùng ${fmtSize(used)}`;
}
function go(view, folder) { state.view = view; state.folder = folder; state.search = ''; $('#search').value = ''; load(); }
$('#nav').onclick = (e) => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); $('#side').classList.remove('open'); go(a.dataset.view, null); };

const load = guard(async function load(append = false) {
  const seq = ++state.seq; $('#main').classList.add('loading');
  try {
    const r = await run('list', { view: state.view, folder: state.folder, search: state.search, sort: state.sort, pageToken: append ? state.next : null });
    if (seq !== state.seq) return; // a newer request superseded this one
    state.files = append ? state.files.concat(r.files) : r.files; state.next = r.next;
    if (!append) { state.crumbs = r.crumbs; state.sel.clear(); }
    render();
  } finally { if (seq === state.seq) $('#main').classList.remove('loading'); }
});
$('#moreBtn').onclick = () => load(true);

// ---------- render ----------
const TITLES = { shared: 'Được chia sẻ với tôi', recent: 'Gần đây', starred: 'Có gắn dấu sao', trash: 'Thùng rác' };
function render() {
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === state.view && !state.search));
  const c = $('#crumbs');
  if (state.search) c.innerHTML = `<span>Kết quả cho “${esc(state.search)}”</span>`;
  else if (state.view === 'drive') c.innerHTML = `<a href="#" target="_self" data-go="" data-drop="">Drive của tôi</a>` + state.crumbs.map((x) => `<span class="sep">›</span><a href="#" target="_self" data-go="${esc(x.id)}" data-drop="${esc(x.id)}">${esc(x.name)}</a>`).join('');
  else c.innerHTML = `<span>${TITLES[state.view]}</span>`;
  $('#emptyTrash').hidden = !(state.view === 'trash' && state.files.length);
  $('#viewBtn').textContent = state.mode === 'grid' ? '☰' : '▦';
  $('#sort').hidden = !(state.view === 'drive' && !state.search);
  const L = $('#list'); L.className = state.mode === 'grid' ? 'grid' : 'rows';
  L.innerHTML = state.files.map((f) => `
    <div class="item${state.sel.has(f.id) ? ' sel' : ''}" data-id="${esc(f.id)}" draggable="${state.view !== 'trash'}">
      <div class="thumb">${f.thumb ? `<img loading="lazy" alt="" referrerpolicy="no-referrer" src="${esc(f.thumb)}" onerror="this.replaceWith('${icon(f)}')">` : icon(f)}</div>
      <div class="meta"><span class="name" title="${esc(f.name)}">${f.starred ? '<span class="star">★</span> ' : ''}${f.shared ? '👥 ' : ''}${esc(f.name)}</span>
      <span class="sub d">${fmtDate(f.updated)}</span><span class="sub s">${f.isFolder ? '' : fmtSize(f.size)}</span>
      <button class="more" aria-label="Thêm" data-more>⋮</button></div>
    </div>`).join('');
  $('#more').hidden = !state.next;
  const E = $('#empty'); E.hidden = !!state.files.length; L.hidden = !state.files.length;
  const msgs = { drive: ['📂', 'Thư mục trống', 'Kéo thả tệp vào đây hoặc bấm “＋ Mới”'], trash: ['🗑', 'Thùng rác trống', 'Google tự xoá vĩnh viễn mục trong thùng rác sau 30 ngày'], starred: ['⭐', 'Chưa có mục gắn sao', ''], recent: ['🕑', 'Chưa có tệp nào', ''], shared: ['👥', 'Chưa ai chia sẻ gì với bạn', ''] };
  const m = state.search ? ['🔍', 'Không tìm thấy kết quả', ''] : msgs[state.view];
  E.innerHTML = `<b>${m[0]}</b>${m[1]}<br><small>${m[2]}</small>`;
  renderSel();
}
$('#crumbs').onclick = (e) => { const a = e.target.closest('[data-go]'); if (!a) return; e.preventDefault(); go('drive', a.dataset.go || null); };
function renderSel() {
  document.querySelectorAll('.item').forEach((el) => el.classList.toggle('sel', state.sel.has(el.dataset.id)));
  const bar = $('#selbar'); const n = state.sel.size; bar.hidden = !n; if (!n) return;
  bar.innerHTML = `<b>${n} đã chọn</b>` + (state.view === 'trash'
    ? '<button data-a="restore">↩ Khôi phục</button><button data-a="purge">❌ Xoá vĩnh viễn</button>'
    : '<button data-a="download">⬇ Tải xuống</button><button data-a="star">⭐ Gắn sao</button><button data-a="move">📂 Di chuyển</button><button data-a="trash">🗑 Xoá</button>') + '<button data-a="clear">✕</button>';
}
const selFiles = () => state.files.filter((f) => state.sel.has(f.id));
const byId = (id) => state.files.find((f) => f.id === id);
$('#selbar').onclick = (e) => { const a = e.target.dataset.a; if (!a) return; if (a === 'clear') { state.sel.clear(); return renderSel(); } bulk(a, selFiles()); };

// ---------- selection ----------
$('#list').addEventListener('click', (e) => {
  const el = e.target.closest('.item'); if (!el) return; const id = el.dataset.id;
  if (e.target.closest('[data-more]')) { e.stopPropagation(); if (!state.sel.has(id)) { state.sel = new Set([id]); renderSel(); } return openCtx(e.clientX, e.clientY, [byId(id)]); }
  if (e.shiftKey && state.anchor != null) {
    const ids = state.files.map((f) => f.id); const [a, b] = [ids.indexOf(state.anchor), ids.indexOf(id)].sort((x, y) => x - y);
    state.sel = new Set(ids.slice(a, b + 1));
  } else if (e.ctrlKey || e.metaKey) { state.sel.has(id) ? state.sel.delete(id) : state.sel.add(id); state.anchor = id; }
  else { state.sel = new Set([id]); state.anchor = id; }
  renderSel();
});
$('#list').addEventListener('dblclick', (e) => { const el = e.target.closest('.item'); if (el && !e.target.closest('[data-more]')) open(byId(el.dataset.id)); });
$('#list').addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.item'); if (!el) return; e.preventDefault();
  if (!state.sel.has(el.dataset.id)) { state.sel = new Set([el.dataset.id]); renderSel(); }
  openCtx(e.clientX, e.clientY, selFiles());
});
$('#main').addEventListener('click', (e) => { if (['main', 'list', 'empty'].includes(e.target.id)) { state.sel.clear(); renderSel(); } });
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
  if (f.isFolder) return go('drive', f.id);
  preview(f);
}

// ---------- context menu ----------
function openCtx(x, y, files) {
  const m = $('#ctx'); const one = files.length === 1 ? files[0] : null;
  const B = (a, t, cls = '') => `<button data-a="${a}" class="${cls}">${t}</button>`;
  m.innerHTML = state.view === 'trash' ? B('restore', '↩ Khôi phục') + B('purge', '❌ Xoá vĩnh viễn', 'danger') : [
    one && B('open', one.isFolder ? '📂 Mở' : '👁 Xem trước'), one && !one.isFolder && B('drive', '↗ Mở trong Google Drive'),
    B('download', '⬇ Tải xuống'), one && B('rename', '✏ Đổi tên'), '<hr>', one && one.canShare && B('share', '🔗 Chia sẻ'),
    B('star', files.every((f) => f.starred) ? '☆ Bỏ dấu sao' : '⭐ Gắn dấu sao'), B('move', '📂 Di chuyển tới…'),
    one && !one.isFolder && !isGoogleType(one) && one.canEdit && B('version', '⬆ Tải lên phiên bản mới'),
    '<hr>', B('trash', '🗑 Chuyển vào thùng rác', 'danger')].filter(Boolean).join('');
  m.hidden = false; const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 8))}px`; m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 8))}px`;
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
    case 'drive': return window.open(one.link, '_blank', 'noopener');
    case 'rename': return rename(one);
    case 'share': return shareDlg(one);
    case 'move': return moveDlg(files);
    case 'version': { state.verTarget = one; return $('#verIn').click(); }
    case 'download': return download(files);
    case 'star': { await run('star', ids, !files.every((f) => f.starred)); return load(); }
    case 'trash': { await run('trash', ids); toast(`Đã chuyển ${ids.length} mục vào thùng rác`); return load(); }
    case 'restore': { await run('restore', ids); toast('Đã khôi phục'); return load(); }
    case 'purge': { if (!confirm(`Xoá vĩnh viễn ${ids.length} mục? Không thể hoàn tác.`)) return; await run('purge', ids); refreshQuota(); return load(); }
  }
});
$('#emptyTrash').onclick = guard(async () => { if (confirm('Dọn sạch toàn bộ thùng rác Google Drive? Không thể hoàn tác.')) { await run('emptyTrash'); refreshQuota(); load(); } });
const refreshQuota = guard(async () => { state.me = await run('info'); quota(); });
function download(files) {
  const folders = files.filter((f) => f.isFolder);
  if (folders.length) toast('Thư mục: mở trong Google Drive để tải dạng zip');
  files.filter((f) => !f.isFolder).forEach((f, i) => setTimeout(() => {
    window.open(isGoogleType(f) ? f.link : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(f.id)}`, '_blank', 'noopener');
  }, i * 400));
}

// ---------- dialogs ----------
const dlg = $('#dlg');
function showDlg(html, { big = false } = {}) { dlg.className = big ? 'big' : ''; dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); return dlg; }
dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.dataset.close !== undefined) dlg.close(); });
dlg.addEventListener('close', () => { dlg.innerHTML = ''; dlg.onclick = null; });
function ask(title, value = '', ok = 'OK') {
  return new Promise((res) => {
    showDlg(`<form method="dialog"><h2>${esc(title)}</h2><input id="pIn" value="${esc(value)}" autocomplete="off"><div class="actions"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary" value="ok">${esc(ok)}</button></div></form>`);
    const i = $('#pIn'); i.focus(); i.select();
    dlg.onclose = () => { dlg.onclose = null; res(dlg.returnValue === 'ok' ? i.value : null); dlg.returnValue = ''; };
  });
}
const rename = guard(async (f) => { const n = await ask('Đổi tên', f.name, 'Lưu'); if (!n || !n.trim() || n === f.name) return; await run('rename', f.id, n); load(); });
const newFolder = guard(async () => {
  const n = await ask('Thư mục mới', 'Thư mục chưa có tên', 'Tạo'); if (!n || !n.trim()) return;
  await run('createFolder', state.folder, n.trim()); load();
});

function moveDlg(files) {
  const ids = new Set(files.map((f) => f.id)); let cur = null;
  const draw = guard(async () => {
    const r = await run('list', { view: 'drive', folder: cur, sort: 'name' });
    const path = ['Drive của tôi', ...r.crumbs.map((c) => c.name)].join(' › ');
    showDlg(`<h2>Di chuyển ${files.length} mục</h2><p class="muted">${esc(path)}</p>
      <div style="max-height:280px;overflow:auto">${cur ? '<button class="btn" data-up style="margin:2px 0">⬆ Lên trên</button>' : ''}
      ${r.files.filter((f) => f.isFolder && !ids.has(f.id)).map((f) => `<button class="btn" data-go="${esc(f.id)}" style="display:block;width:100%;text-align:left;border-radius:8px;margin:2px 0">📁 ${esc(f.name)}</button>`).join('') || '<p class="muted">Không có thư mục con</p>'}</div>
      <div class="actions"><button class="btn" data-close>Huỷ</button><button class="btn primary" data-here>Di chuyển vào đây</button></div>`);
    dlg.onclick = guard(async (e) => {
      const t = e.target.closest('button') || e.target;
      if (t === dlg || t.dataset.close !== undefined) return dlg.close();
      if (t.dataset.go) { cur = t.dataset.go; return draw(); }
      if (t.dataset.up !== undefined) { cur = r.crumbs.length > 1 ? r.crumbs[r.crumbs.length - 2].id : null; return draw(); }
      if (t.dataset.here !== undefined) { dlg.close(); await moveTo(files, cur); }
    });
  });
  draw();
}
const moveTo = guard(async (files, target) => { await run('move', files.map((f) => f.id), target); toast('Đã di chuyển'); load(); });

const shareDlg = guard(async (f) => {
  let s = await run('getShare', f.id);
  const ROLES = { reader: 'Người xem', commenter: 'Người nhận xét', writer: 'Người chỉnh sửa', owner: 'Chủ sở hữu' };
  const draw = () => {
    showDlg(`<h2>Chia sẻ “${esc(f.name)}”</h2>
      <div class="row"><input id="em" type="email" placeholder="Thêm email người dùng" style="flex:1"><select id="rl"><option value="reader">Xem</option><option value="writer">Chỉnh sửa</option></select><button class="btn primary" id="add">Mời</button></div>
      <div style="max-height:160px;overflow:auto">${s.people.map((p) => `<div class="ver"><div class="grow">${esc(p.name || p.email)}<br><small class="muted">${esc(p.email || '')}</small></div><span class="tag">${ROLES[p.role] || p.role}</span>${p.role === 'owner' ? '' : `<button class="btn danger" data-rm="${esc(p.id)}">✕</button>`}</div>`).join('')}</div>
      <h3 style="font-size:15px;margin:18px 0 6px">Quyền truy cập chung</h3>
      <div class="row"><select id="any" style="flex:1"><option value="">🔒 Hạn chế – chỉ người được thêm</option><option value="reader">🌐 Bất kỳ ai có liên kết – Xem</option><option value="commenter">🌐 Bất kỳ ai có liên kết – Nhận xét</option><option value="writer">🌐 Bất kỳ ai có liên kết – Chỉnh sửa</option></select></div>
      <div class="row"><input id="lnk" readonly value="${esc(s.link)}"><button class="btn" id="cp">Sao chép</button></div>
      <div class="actions"><button class="btn primary" data-close>Xong</button></div>`);
    $('#any').value = s.anyone || '';
    $('#any').onchange = guard(async (e) => { s = await run('setLinkAccess', f.id, e.target.value || null); toast('Đã cập nhật quyền'); draw(); load(); });
    $('#add').onclick = guard(async () => { s = await run('addPerson', f.id, $('#em').value, $('#rl').value); toast('Đã gửi lời mời'); draw(); });
    $('#cp').onclick = async () => { try { await navigator.clipboard.writeText(s.link); toast('Đã sao chép liên kết'); } catch { $('#lnk').select(); document.execCommand('copy'); toast('Đã sao chép liên kết'); } };
    dlg.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = guard(async () => { s = await run('removePerson', f.id, b.dataset.rm); draw(); }); });
  };
  draw();
});

function preview(f) {
  const idx = state.files.filter((x) => !x.isFolder); const i = idx.findIndex((x) => x.id === f.id);
  showDlg(`<div class="viewer-head"><b class="name">${esc(f.name)}</b><span class="sub">${f.size != null ? fmtSize(f.size) : ''}</span>
    <button class="icon" data-p="-1" ${i < 1 ? 'disabled' : ''} aria-label="Trước">‹</button><button class="icon" data-p="1" ${i >= idx.length - 1 ? 'disabled' : ''} aria-label="Sau">›</button>
    <a class="icon" style="display:grid;place-items:center;text-decoration:none" href="${esc(f.link)}" aria-label="Mở trong Drive">↗</a><button class="icon" data-close aria-label="Đóng">✕</button></div>
    <div class="viewer-body"><iframe title="${esc(f.name)}" src="https://drive.google.com/file/d/${encodeURIComponent(f.id)}/preview" allow="autoplay"></iframe></div>`, { big: true });
  dlg.onclick = (e) => { if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close(); const p = e.target.closest('[data-p]'); if (p && !p.disabled) preview(idx[i + Number(p.dataset.p)]); };
}
dlg.addEventListener('keydown', (e) => { if (!dlg.classList.contains('big')) return; const k = e.key === 'ArrowLeft' ? '-1' : e.key === 'ArrowRight' ? '1' : null; const b = k && dlg.querySelector(`[data-p="${k}"]`); if (b && !b.disabled) b.click(); });

// ---------- upload: browser -> Drive API directly with the user's own token ----------
let tok = null; let tokAt = 0;
async function getToken() { if (!tok || Date.now() - tokAt > 30 * 60e3) { tok = await run('token'); tokAt = Date.now(); } return tok; }
function xhrUpload(method, url, body, headers, onProgress) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open(method, url);
    Object.entries(headers).forEach(([k, v]) => x.setRequestHeader(k, v));
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? res(JSON.parse(x.responseText || '{}')) : rej(Object.assign(new Error(`Drive API ${x.status}`), { status: x.status })));
    x.onerror = () => rej(Object.assign(new Error('network'), { status: 0 })); x.send(body);
  });
}
async function uploadOne(file, parentId, onProgress) {
  const t = await getToken();
  const boundary = `minidrive${Math.random().toString(36).slice(2)}`; const mime = file.type || 'application/octet-stream';
  const meta = { name: file.name, parents: [parentId || state.me.root] };
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, file, `\r\n--${boundary}--`]);
  try {
    return await xhrUpload('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', body, { Authorization: `Bearer ${t}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, onProgress);
  } catch (e) {
    if (e.status === 401) tok = null;
    if (e.status !== 0 || file.size > 35 * 1024 * 1024) throw e;
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
    onProgress(0.5); return run('uploadSmall', parentId || state.me.root, file.name, mime, b64);
  }
}
let upQueue = []; let upRunning = 0; let upDone = 0; let upTotal = 0; const dirCache = new Map();
function uploadFiles(items) {
  const parent = state.view === 'drive' && !state.search ? state.folder : null;
  dirCache.clear();
  items.forEach((it) => { upQueue.push({ ...it, parent }); upTotal++; }); pump();
}
async function resolveDir(parent, rel) {
  const dir = rel.split('/').slice(0, -1).join('/'); if (!dir) return parent;
  const key = `${parent}|${dir}`;
  if (!dirCache.has(key)) dirCache.set(key, run('ensurePath', parent, dir)); // shared promise: siblings wait for one creation
  return dirCache.get(key);
}
function pump() {
  while (upRunning < 3 && upQueue.length) {
    const job = upQueue.shift(); upRunning++;
    const row = document.createElement('div'); row.className = 'up';
    row.innerHTML = `<div class="name">${esc(job.rel || job.file.name)}</div><div class="bar"><i></i></div>`; $('#uploads').append(row); $('#uploads').hidden = false; headUp();
    const bar = row.querySelector('i');
    (async () => {
      const parent = job.rel ? await resolveDir(job.parent, job.rel) : job.parent;
      await uploadOne(job.file, parent, (p) => { bar.style.width = `${p * 100}%`; });
      bar.style.width = '100%';
    })().catch((e) => { row.classList.add('err'); row.append(` ✕ ${e.message}`); }).finally(() => {
      upRunning--; upDone++; headUp(); pump();
      if (!upQueue.length && !upRunning) { upDone = upTotal = 0; load(); refreshQuota(); setTimeout(() => { if (!upRunning && !upQueue.length && !$('#uploads .err')) { $('#uploads').hidden = true; $('#uploads').innerHTML = ''; } }, 3000); }
    });
  }
}
function headUp() {
  let h = $('#uploads h4'); if (!h) { h = document.createElement('h4'); $('#uploads').prepend(h); }
  h.innerHTML = `<span>Đang tải lên ${upDone}/${upTotal}</span><button class="icon" style="width:24px;height:24px" aria-label="Đóng" id="upX">✕</button>`;
  $('#upX').onclick = () => { $('#uploads').hidden = true; $('#uploads').innerHTML = ''; };
}
$('#fileIn').onchange = (e) => { uploadFiles([...e.target.files].map((file) => ({ file, rel: '' }))); e.target.value = ''; };
$('#dirIn').onchange = (e) => { uploadFiles([...e.target.files].map((file) => ({ file, rel: file.webkitRelativePath }))); e.target.value = ''; };
$('#verIn').onchange = guard(async (e) => {
  const file = e.target.files[0]; const f = state.verTarget; e.target.value = ''; if (!file || !f) return;
  toast('Đang tải lên phiên bản mới…');
  await xhrUpload('PATCH', `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(f.id)}?uploadType=media&fields=id`, file, { Authorization: `Bearer ${await getToken()}`, 'Content-Type': file.type || 'application/octet-stream' }, () => {});
  toast('Đã cập nhật – Google Drive giữ lịch sử phiên bản cũ'); load(); refreshQuota();
});

async function readEntries(entry, prefix = '') {
  if (entry.isFile) return new Promise((r) => entry.file((file) => r([{ file, rel: prefix ? prefix + file.name : '' }]), () => r([])));
  const reader = entry.createReader(); const out = []; let batch;
  do { batch = await new Promise((r) => reader.readEntries(r, () => r([]))); for (const en of batch) out.push(...await readEntries(en, `${prefix}${entry.name}/`)); } while (batch.length);
  return out;
}
let dragDepth = 0; let internalDrag = null;
document.addEventListener('dragenter', (e) => { if (!internalDrag && e.dataTransfer && e.dataTransfer.types.includes('Files')) { dragDepth++; $('#drop').hidden = false; } });
document.addEventListener('dragleave', () => { if (!internalDrag && dragDepth > 0 && --dragDepth === 0) $('#drop').hidden = true; });
document.addEventListener('dragover', (e) => {
  if ((e.dataTransfer && e.dataTransfer.types.includes('Files')) || internalDrag) e.preventDefault();
  document.querySelectorAll('.dragover').forEach((x) => x.classList.remove('dragover'));
  const t = dropTarget(e); if (t) t.el.classList.add('dragover');
});
function dropTarget(e) {
  const el = e.target.closest && e.target.closest('.item[data-id], [data-drop]'); if (!el || !internalDrag) return null;
  if (el.dataset.drop !== undefined) return { el, id: el.dataset.drop || null };
  const f = byId(el.dataset.id); return f && f.isFolder && !internalDrag.some((x) => x.id === f.id) ? { el, id: f.id } : null;
}
document.addEventListener('drop', guard(async (e) => {
  e.preventDefault(); dragDepth = 0; $('#drop').hidden = true;
  if (internalDrag) { const t = dropTarget(e); const files = internalDrag; internalDrag = null; if (t) moveTo(files, t.id); return; }
  const entries = [...(e.dataTransfer.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return uploadFiles([...e.dataTransfer.files].map((file) => ({ file, rel: '' })));
  const all = (await Promise.all(entries.map((en) => readEntries(en)))).flat(); if (all.length) uploadFiles(all);
}));
$('#list').addEventListener('dragstart', (e) => {
  const el = e.target.closest('.item'); if (!el) return;
  if (!state.sel.has(el.dataset.id)) { state.sel = new Set([el.dataset.id]); renderSel(); }
  internalDrag = selFiles(); e.dataTransfer.setData('text/plain', 'move'); e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragend', () => { internalDrag = null; document.querySelectorAll('.dragover').forEach((x) => x.classList.remove('dragover')); });

// ---------- misc ----------
$('#newBtn').onclick = () => { $('#newMenu').hidden = !$('#newMenu').hidden; };
$('#newMenu').onclick = (e) => {
  const a = e.target.dataset.act; if (!a) return; $('#newMenu').hidden = true;
  if (state.view !== 'drive' || state.search) go('drive', null);
  ({ newFolder, uploadFile: () => $('#fileIn').click(), uploadFolder: () => $('#dirIn').click() })[a]();
};
$('#viewBtn').onclick = () => { state.mode = state.mode === 'grid' ? 'rows' : 'grid'; store.set('mode', state.mode); render(); };
$('#sort').onchange = (e) => { state.sort = e.target.value; store.set('sort', state.sort); load(); };
let st; $('#search').oninput = (e) => { clearTimeout(st); st = setTimeout(() => { state.search = e.target.value.trim(); load(); }, 350); };
const applyTheme = (t) => { document.documentElement.dataset.theme = t; store.set('theme', t); };
applyTheme(store.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
boot();
