/**
 * Mini Drive – bản Google Apps Script (miễn phí, không cần billing).
 * Dữ liệu nằm trong Google Drive thật của người đang dùng app.
 * Deploy: Execute as = "User accessing the web app" (bắt buộc).
 */
const ROOT = 'root'; // 'root' = My Drive; có thể thay bằng ID một thư mục để giới hạn app trong thư mục đó
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,modifiedTime,starred,shared,trashed,explicitlyTrashed,parents,thumbnailLink,webViewLink,capabilities(canEdit,canShare,canTrash,canDelete)';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Mini Drive')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Chặn trường hợp deploy nhầm "Execute as: Me" – khi đó người lạ sẽ dùng Drive của chủ app.
function guard_() {
  const active = Session.getActiveUser().getEmail();
  if (!active || active !== Session.getEffectiveUser().getEmail()) {
    throw new Error('App phải được deploy với "Execute as: User accessing the web app".');
  }
}
const q_ = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const map_ = (f) => ({
  id: f.id, name: f.name, mime: f.mimeType, isFolder: f.mimeType === FOLDER,
  size: f.size != null ? Number(f.size) : null, updated: f.modifiedTime, starred: !!f.starred, shared: !!f.shared,
  thumb: f.thumbnailLink || '', link: f.webViewLink || '', canEdit: !!(f.capabilities && f.capabilities.canEdit),
  canShare: !!(f.capabilities && f.capabilities.canShare),
});
function rootId_() {
  const c = CacheService.getUserCache(); let id = c.get('rootId');
  if (!id) { id = Drive.Files.get(ROOT, { fields: 'id' }).id; c.put('rootId', id, 21600); }
  return id;
}
function crumbs_(id) {
  const root = rootId_(); const out = [];
  for (let i = 0; id && id !== root && i < 25; i++) {
    const f = Drive.Files.get(id, { fields: 'id,name,parents' });
    out.unshift({ id: f.id, name: f.name });
    id = f.parents && f.parents[0];
  }
  return out;
}
const ORDER = { name: 'folder,name_natural', 'name-desc': 'folder,name_natural desc', updated: 'folder,modifiedTime desc', size: 'folder,quotaBytesUsed desc' };

function info() {
  guard_();
  const a = Drive.About.get({ fields: 'user(displayName,emailAddress),storageQuota(limit,usage)' });
  return { name: a.user.displayName, email: a.user.emailAddress, used: Number(a.storageQuota.usage || 0), limit: Number(a.storageQuota.limit || 0), root: rootId_() };
}

function list(o) {
  guard_();
  o = o || {};
  let q; let orderBy = ORDER[o.sort] || ORDER.name; let pageSize = 100; let crumbs = [];
  if (o.search) {
    const s = q_(o.search);
    q = `trashed=false and (name contains '${s}' or fullText contains '${s}')`; orderBy = undefined; // Drive không cho sort khi tìm fullText
  } else if (o.view === 'starred') q = 'starred=true and trashed=false';
  else if (o.view === 'recent') { q = `trashed=false and mimeType!='${FOLDER}'`; orderBy = 'recency desc'; pageSize = 50; }
  else if (o.view === 'shared') { q = 'sharedWithMe=true and trashed=false'; orderBy = 'sharedWithMeTime desc'; }
  else if (o.view === 'trash') { q = "trashed=true and 'me' in owners"; orderBy = 'modifiedTime desc'; }
  else {
    const id = o.folder || rootId_();
    q = `'${q_(id)}' in parents and trashed=false`; crumbs = crumbs_(id);
  }
  const args = { q, pageSize, fields: `nextPageToken,files(${FIELDS})`, spaces: 'drive' };
  if (orderBy) args.orderBy = orderBy;
  if (o.pageToken) args.pageToken = o.pageToken;
  const r = Drive.Files.list(args);
  let files = r.files || [];
  if (o.view === 'trash' && !o.search) files = files.filter((f) => f.explicitlyTrashed); // chỉ hiện mục bị xoá trực tiếp
  return { files: files.map(map_), next: (o.view === 'recent' ? null : r.nextPageToken) || null, crumbs };
}

function createFolder(parentId, name) {
  guard_();
  return Drive.Files.create({ name: String(name || 'Thư mục chưa có tên').slice(0, 255), mimeType: FOLDER, parents: [parentId || rootId_()] }).id;
}
function ensurePath(parentId, relDir) {
  guard_();
  let parent = parentId || rootId_();
  String(relDir || '').split('/').filter((p) => p && p !== '.' && p !== '..').forEach((part) => {
    const r = Drive.Files.list({ q: `'${q_(parent)}' in parents and name='${q_(part)}' and mimeType='${FOLDER}' and trashed=false`, fields: 'files(id)', pageSize: 1 });
    parent = (r.files && r.files[0]) ? r.files[0].id : Drive.Files.create({ name: part, mimeType: FOLDER, parents: [parent] }).id;
  });
  return parent;
}
function rename(id, name) { guard_(); if (!String(name).trim()) throw new Error('Tên không được trống'); Drive.Files.update({ name: String(name).trim().slice(0, 255) }, id); }
function move(ids, targetId) {
  guard_();
  const target = targetId || rootId_();
  ids.forEach((id) => {
    if (id === target) throw new Error('Không thể chuyển thư mục vào chính nó');
    const f = Drive.Files.get(id, { fields: 'parents' });
    Drive.Files.update({}, id, null, { addParents: target, removeParents: (f.parents || []).join(',') });
  });
}
function star(ids, v) { guard_(); ids.forEach((id) => Drive.Files.update({ starred: !!v }, id)); }
function trash(ids) { guard_(); ids.forEach((id) => Drive.Files.update({ trashed: true }, id)); }
function restore(ids) { guard_(); ids.forEach((id) => Drive.Files.update({ trashed: false }, id)); }
function purge(ids) {
  guard_();
  ids.forEach((id) => {
    if (!Drive.Files.get(id, { fields: 'trashed' }).trashed) throw new Error('Chỉ xoá vĩnh viễn được mục trong thùng rác');
    Drive.Files.remove(id);
  });
}
function emptyTrash() { guard_(); Drive.Files.emptyTrash(); }

// Upload: trình duyệt tải thẳng lên Drive API bằng token của chính người dùng (không giới hạn 50MB của Apps Script).
function token() { guard_(); return ScriptApp.getOAuthToken(); }
// Dự phòng khi trình duyệt không gọi được Drive API trực tiếp (tệp nhỏ, < ~35MB).
function uploadSmall(parentId, name, mime, b64) {
  guard_();
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), mime || 'application/octet-stream', name);
  return Drive.Files.create({ name, parents: [parentId || rootId_()] }, blob).id;
}

// Chia sẻ
function getShare(id) {
  guard_();
  const f = Drive.Files.get(id, { fields: 'name,webViewLink,capabilities(canShare)' });
  const p = Drive.Permissions.list(id, { fields: 'permissions(id,type,role,emailAddress,displayName)' }).permissions || [];
  const anyone = p.find((x) => x.type === 'anyone');
  return {
    link: f.webViewLink, canShare: !!f.capabilities.canShare, anyone: anyone ? anyone.role : null,
    people: p.filter((x) => x.type === 'user' || x.type === 'group').map((x) => ({ id: x.id, email: x.emailAddress, name: x.displayName, role: x.role })),
  };
}
function setLinkAccess(id, role) {
  guard_();
  const p = (Drive.Permissions.list(id, { fields: 'permissions(id,type)' }).permissions || []).find((x) => x.type === 'anyone');
  if (p) Drive.Permissions.remove(id, p.id);
  if (role) Drive.Permissions.create({ type: 'anyone', role }, id);
  return getShare(id);
}
function addPerson(id, email, role) {
  guard_();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) throw new Error('Email không hợp lệ');
  Drive.Permissions.create({ type: 'user', role: role === 'writer' ? 'writer' : 'reader', emailAddress: String(email).trim() }, id, { sendNotificationEmail: true });
  return getShare(id);
}
function removePerson(id, permId) { guard_(); Drive.Permissions.remove(id, permId); return getShare(id); }
