'use strict';
const express = require('express');
const multer = require('multer');
const { ZipArchive } = require('archiver');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const BLOB_DIR = path.join(DATA_DIR, 'blobs');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const DEFAULT_QUOTA = Number(process.env.QUOTA_BYTES) || 15 * 1024 ** 3;
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES) || 2 * 1024 ** 3;
const TRASH_DAYS = 30;
for (const d of [BLOB_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });

// ---------- DB ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'drive.db'));
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  pass_hash TEXT NOT NULL, salt TEXT NOT NULL, quota INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES files(id) ON DELETE CASCADE, name TEXT NOT NULL,
  is_folder INTEGER NOT NULL DEFAULT 0, mime TEXT, size INTEGER NOT NULL DEFAULT 0,
  storage_key TEXT, starred INTEGER NOT NULL DEFAULT 0, trashed_at INTEGER,
  text_content TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL, accessed INTEGER);
CREATE INDEX IF NOT EXISTS idx_files_parent ON files(user_id, parent_id);
CREATE TABLE IF NOT EXISTS versions(
  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shares(
  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL, pass_hash TEXT, pass_salt TEXT, expires_at INTEGER,
  allow_download INTEGER NOT NULL DEFAULT 1, views INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
`);

const now = () => Date.now();
const q = (sql) => db.prepare(sql);
const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

// ---------- helpers ----------
const SECRET = crypto.randomBytes(32); // share-unlock cookies die on restart; fine
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const rid = (n = 24) => crypto.randomBytes(n).toString('base64url');
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const cleanName = (n) => String(n ?? '').replace(/[\\/\0]/g, '_').trim().slice(0, 255);
const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));
const TEXT_EXT = /\.(txt|md|csv|json|xml|html?|css|js|ts|py|java|c|cpp|h|go|rs|sh|yml|yaml|log|ini|sql|tsx|jsx)$/i;
const INLINE_OK = /^(image\/(png|jpe?g|gif|webp|bmp|avif)|application\/pdf|video\/(mp4|webm|ogg)|audio\/(mpeg|mp3|ogg|wav|webm|mp4|aac|flac)|text\/plain)$/;

function uniqueName(userId, parentId, name, excludeId = 0) {
  const taken = new Set(q('SELECT name FROM files WHERE user_id=? AND parent_id IS ? AND trashed_at IS NULL AND id<>?')
    .all(userId, parentId, excludeId).map((r) => r.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const ext = path.extname(name); const base = ext ? name.slice(0, -ext.length) : name;
  for (let i = 1; ; i++) { const c = `${base} (${i})${ext}`; if (!taken.has(c.toLowerCase())) return c; }
}

function ownFile(userId, id) {
  const f = q('SELECT * FROM files WHERE id=? AND user_id=?').get(Number(id), userId);
  if (!f) throw httpErr(404, 'Not found');
  return f;
}
function ownFolderOrRoot(userId, id) {
  if (id == null || id === '' || id === 'root' || id === 'null') return null;
  const f = ownFile(userId, id);
  if (!f.is_folder) throw httpErr(400, 'Target is not a folder');
  if (f.trashed_at) throw httpErr(400, 'Target is in trash');
  return f.id;
}
const subtreeIds = (id) => q(`WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT f.id FROM files f JOIN t ON f.parent_id=t.id) SELECT id FROM t`).all(id).map((r) => r.id);
const isDescendant = (ancestor, id) => subtreeIds(ancestor).includes(id);
const usage = (userId) => q(`SELECT COALESCE(SUM(v.size),0) s FROM versions v JOIN files f ON f.id=v.file_id WHERE f.user_id=?`).get(userId).s;
const rmBlob = (key) => { if (key) fs.rm(path.join(BLOB_DIR, key), { force: true }, () => {}); };

function purge(userId, ids) {
  const keys = [];
  for (const id of ids) for (const v of q('SELECT storage_key FROM versions WHERE file_id=?').all(id)) keys.push(v.storage_key);
  tx(() => { for (const id of ids) q('DELETE FROM files WHERE id=? AND user_id=?').run(id, userId); });
  keys.forEach(rmBlob);
}
function purgeExpiredTrash() {
  const cutoff = now() - TRASH_DAYS * 864e5;
  for (const r of q('SELECT id,user_id FROM files WHERE trashed_at IS NOT NULL AND trashed_at<?').all(cutoff)) {
    try { purge(r.user_id, subtreeIds(r.id)); } catch { /* already gone */ }
  }
  q('DELETE FROM sessions WHERE expires<?').run(now());
}

function extractText(file, mime, name) {
  if (!(mime?.startsWith('text/') || TEXT_EXT.test(name))) return null;
  try {
    const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(200 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
    const s = buf.subarray(0, n);
    return s.includes(0) ? null : s.toString('utf8');
  } catch { return null; }
}
function guessMime(name, given) {
  const ext = path.extname(name).toLowerCase();
  const map = { '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.txt': 'text/plain', '.mp3': 'audio/mpeg' };
  return (given && given !== 'application/octet-stream' && given) || map[ext] || 'application/octet-stream';
}
const publicFile = (f) => ({
  id: f.id, parent_id: f.parent_id, name: f.name, is_folder: !!f.is_folder, mime: f.mime, size: f.size,
  starred: !!f.starred, trashed_at: f.trashed_at, created: f.created, updated: f.updated,
  shared: !!q('SELECT 1 FROM shares WHERE file_id=?').get(f.id),
});

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Cloud Run / any HTTPS proxy: correct req.ip and req.secure
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// auth
const SESSION_MS = 30 * 864e5;
const setSession = (req, res, userId) => {
  const token = rid(32); q('INSERT INTO sessions VALUES(?,?,?)').run(token, userId, now() + SESSION_MS);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${req.secure ? '; Secure' : ''}`);
};
function auth(req, res, next) {
  const sid = parseCookies(req.headers.cookie).sid;
  const s = sid && q('SELECT user_id FROM sessions WHERE token=? AND expires>?').get(sid, now());
  if (!s) return res.status(401).json({ error: 'Not signed in' });
  req.user = q('SELECT id,email,name,quota FROM users WHERE id=?').get(s.user_id);
  req.sid = sid; next();
}
const loginAttempts = new Map();
function throttle(key) {
  const a = (loginAttempts.get(key) || []).filter((t) => t > now() - 15 * 60e3);
  if (a.length >= 10) throw httpErr(429, 'Too many attempts, try again later');
  a.push(now()); loginAttempts.set(key, a);
}

app.post('/api/register', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); const name = String(req.body.name || '').trim() || email.split('@')[0];
  const pw = String(req.body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpErr(400, 'Invalid email');
  if (pw.length < 8) throw httpErr(400, 'Password must be at least 8 characters');
  if (q('SELECT 1 FROM users WHERE email=?').get(email)) throw httpErr(409, 'Email already registered');
  const salt = rid(16);
  const { lastInsertRowid } = q('INSERT INTO users(email,name,pass_hash,salt,quota,created) VALUES(?,?,?,?,?,?)').run(email, name.slice(0, 80), hashPw(pw, salt), salt, DEFAULT_QUOTA, now());
  setSession(req, res, Number(lastInsertRowid));
  res.json({ ok: true });
});
app.post('/api/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  throttle(`${req.ip}|${email}`);
  const u = q('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !safeEq(u.pass_hash, hashPw(String(req.body.password || ''), u.salt))) throw httpErr(401, 'Wrong email or password');
  setSession(req, res, u.id); res.json({ ok: true });
});
app.post('/api/logout', auth, (req, res) => {
  q('DELETE FROM sessions WHERE token=?').run(req.sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true });
});
app.get('/api/me', auth, (req, res) => res.json({ ...req.user, used: usage(req.user.id) }));

// listing
const SORTS = { name: 'name COLLATE NOCASE', updated: 'updated', size: 'size', created: 'created' };
app.get('/api/files', auth, (req, res) => {
  const { view = 'drive', search = '' } = req.query; const uid = req.user.id;
  const order = `is_folder DESC, ${SORTS[req.query.sort] || SORTS.name} ${req.query.dir === 'desc' ? 'DESC' : 'ASC'}`;
  let rows; let crumbs = [];
  if (search) {
    const like = `%${String(search).replace(/[%_\\]/g, '\\$&')}%`;
    rows = q(`SELECT * FROM files WHERE user_id=? AND trashed_at IS NULL AND (name LIKE ? ESCAPE '\\' OR text_content LIKE ? ESCAPE '\\') ORDER BY ${order} LIMIT 200`).all(uid, like, like);
  } else if (view === 'starred') rows = q(`SELECT * FROM files WHERE user_id=? AND starred=1 AND trashed_at IS NULL ORDER BY ${order}`).all(uid);
  else if (view === 'recent') rows = q('SELECT * FROM files WHERE user_id=? AND is_folder=0 AND trashed_at IS NULL ORDER BY COALESCE(accessed,updated) DESC LIMIT 50').all(uid);
  else if (view === 'shared') rows = q(`SELECT * FROM files WHERE user_id=? AND trashed_at IS NULL AND id IN (SELECT file_id FROM shares) ORDER BY ${order}`).all(uid);
  else if (view === 'trash') rows = q(`SELECT * FROM files f WHERE user_id=? AND trashed_at IS NOT NULL AND (parent_id IS NULL OR parent_id NOT IN (SELECT id FROM files WHERE trashed_at IS NOT NULL)) ORDER BY ${order}`).all(uid);
  else {
    const parent = ownFolderOrRoot(uid, req.query.parent);
    rows = q(`SELECT * FROM files WHERE user_id=? AND parent_id IS ? AND trashed_at IS NULL ORDER BY ${order}`).all(uid, parent);
    for (let id = parent; id;) { const f = q('SELECT id,name,parent_id FROM files WHERE id=?').get(id); crumbs.unshift({ id: f.id, name: f.name }); id = f.parent_id; }
  }
  res.json({ files: rows.map(publicFile), crumbs });
});

app.post('/api/folders', auth, (req, res) => {
  const parent = ownFolderOrRoot(req.user.id, req.body.parent_id);
  const name = cleanName(req.body.name) || 'Untitled folder';
  const t = now();
  const { lastInsertRowid } = q('INSERT INTO files(user_id,parent_id,name,is_folder,created,updated) VALUES(?,?,?,?,?,?)').run(req.user.id, parent, uniqueName(req.user.id, parent, name), 1, t, t);
  res.json(publicFile(q('SELECT * FROM files WHERE id=?').get(lastInsertRowid)));
});

// upload (one file per request; rel_path creates intermediate folders for folder uploads)
const upload = multer({ dest: TMP_DIR, limits: { fileSize: MAX_UPLOAD, files: 1 } });
function ensureFolderPath(uid, parent, relPath) {
  const parts = String(relPath || '').split('/').map(cleanName).filter((p) => p && p !== '.' && p !== '..');
  parts.pop(); // file name
  for (const part of parts) {
    let f = q('SELECT id FROM files WHERE user_id=? AND parent_id IS ? AND name=? COLLATE NOCASE AND is_folder=1 AND trashed_at IS NULL').get(uid, parent, part);
    if (!f) { const t = now(); f = { id: Number(q('INSERT INTO files(user_id,parent_id,name,is_folder,created,updated) VALUES(?,?,?,?,?,?)').run(uid, parent, part, 1, t, t).lastInsertRowid) }; }
    parent = f.id;
  }
  return parent;
}
function storeBlob(tmpPath, file, name) {
  const key = rid(24);
  fs.renameSync(tmpPath, path.join(BLOB_DIR, key));
  return { key, mime: guessMime(name, file.mimetype), text: extractText(path.join(BLOB_DIR, key), file.mimetype, name) };
}
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  const f = req.file; if (!f) throw httpErr(400, 'No file');
  try {
    const uid = req.user.id;
    if (usage(uid) + f.size > req.user.quota) throw httpErr(413, 'Storage quota exceeded');
    const name = cleanName(req.body.rel_path?.split('/').pop() || Buffer.from(f.originalname, 'latin1').toString('utf8')) || 'file';
    const out = tx(() => {
      const parent = ensureFolderPath(uid, ownFolderOrRoot(uid, req.body.parent_id), req.body.rel_path);
      const { key, mime, text } = storeBlob(f.path, f, name); const t = now();
      const id = Number(q('INSERT INTO files(user_id,parent_id,name,mime,size,storage_key,text_content,created,updated) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(uid, parent, uniqueName(uid, parent, name), mime, f.size, key, text, t, t).lastInsertRowid);
      q('INSERT INTO versions(file_id,storage_key,size,mime,created) VALUES(?,?,?,?,?)').run(id, key, f.size, mime, t);
      return q('SELECT * FROM files WHERE id=?').get(id);
    });
    res.json(publicFile(out));
  } finally { fs.rm(f.path, { force: true }, () => {}); }
});

// file ops
app.patch('/api/files/:id', auth, (req, res) => {
  const f = ownFile(req.user.id, req.params.id); const b = req.body; const uid = req.user.id;
  if (f.trashed_at) throw httpErr(400, 'Restore the item first');
  tx(() => {
    if (typeof b.name === 'string') {
      const n = cleanName(b.name); if (!n) throw httpErr(400, 'Name required');
      q('UPDATE files SET name=?, updated=? WHERE id=?').run(uniqueName(uid, f.parent_id, n, f.id), now(), f.id);
    }
    if ('parent_id' in b) {
      const target = ownFolderOrRoot(uid, b.parent_id);
      if (target != null && (target === f.id || (f.is_folder && isDescendant(f.id, target)))) throw httpErr(400, 'Cannot move a folder into itself');
      q('UPDATE files SET parent_id=?, name=?, updated=? WHERE id=?').run(target, uniqueName(uid, target, f.name, f.id), now(), f.id);
    }
    if ('starred' in b) q('UPDATE files SET starred=? WHERE id=?').run(b.starred ? 1 : 0, f.id);
  });
  res.json(publicFile(q('SELECT * FROM files WHERE id=?').get(f.id)));
});
app.post('/api/files/:id/trash', auth, (req, res) => {
  const f = ownFile(req.user.id, req.params.id); const t = now();
  tx(() => { for (const id of subtreeIds(f.id)) q('UPDATE files SET trashed_at=? WHERE id=? AND trashed_at IS NULL').run(t, id); });
  res.json({ ok: true });
});
app.post('/api/files/:id/restore', auth, (req, res) => {
  const f = ownFile(req.user.id, req.params.id); const uid = req.user.id;
  tx(() => {
    let parent = f.parent_id;
    if (parent && q('SELECT trashed_at FROM files WHERE id=?').get(parent)?.trashed_at) parent = null; // parent still trashed -> My Drive
    for (const id of subtreeIds(f.id)) q('UPDATE files SET trashed_at=NULL WHERE id=?').run(id);
    q('UPDATE files SET parent_id=?, name=? WHERE id=?').run(parent, uniqueName(uid, parent, f.name, f.id), f.id);
  });
  res.json({ ok: true });
});
app.delete('/api/files/:id', auth, (req, res) => {
  const f = ownFile(req.user.id, req.params.id);
  if (!f.trashed_at) throw httpErr(400, 'Move to trash first');
  purge(req.user.id, subtreeIds(f.id)); res.json({ ok: true });
});
app.delete('/api/trash', auth, (req, res) => {
  for (const r of q(`SELECT id FROM files WHERE user_id=? AND trashed_at IS NOT NULL AND (parent_id IS NULL OR parent_id NOT IN (SELECT id FROM files WHERE trashed_at IS NOT NULL))`).all(req.user.id)) purge(req.user.id, subtreeIds(r.id));
  res.json({ ok: true });
});

// content
function sendBlob(res, { key, name, mime, inline, size }) {
  const file = path.join(BLOB_DIR, key);
  if (!fs.existsSync(file)) throw httpErr(410, 'File data missing');
  const canInline = inline && INLINE_OK.test(mime || '');
  res.setHeader('Content-Type', canInline ? mime : (mime || 'application/octet-stream'));
  res.setHeader('Content-Disposition', `${canInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self'");
  res.sendFile(file, { headers: {} });
}
app.get('/api/files/:id/content', auth, (req, res) => {
  const f = ownFile(req.user.id, req.params.id);
  if (f.is_folder) throw httpErr(400, 'Is a folder');
  q('UPDATE files SET accessed=? WHERE id=?').run(now(), f.id);
  const v = req.query.version && q('SELECT * FROM versions WHERE id=? AND file_id=?').get(Number(req.query.version), f.id);
  sendBlob(res, { key: v?.storage_key || f.storage_key, name: f.name, mime: v?.mime || f.mime, inline: req.query.inline === '1' });
});
app.get('/api/files/:id/text', auth, (req, res) => {
  const f = ownFile(req.user.id, req.params.id);
  res.type('text/plain').send((f.text_content ?? '').slice(0, 200 * 1024));
});
function zipTo(res, uid, rootIds, zipName) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);
  const z = new ZipArchive({ zlib: { level: 6 } }); z.on('error', () => res.destroy()); z.pipe(res);
  const walk = (f, prefix) => {
    if (f.is_folder) {
      z.append(null, { name: `${prefix}${f.name}/` });
      for (const c of q('SELECT * FROM files WHERE parent_id=? AND trashed_at IS NULL').all(f.id)) walk(c, `${prefix}${f.name}/`);
    } else if (f.storage_key && fs.existsSync(path.join(BLOB_DIR, f.storage_key))) z.file(path.join(BLOB_DIR, f.storage_key), { name: prefix + f.name });
  };
  for (const id of rootIds) walk(q('SELECT * FROM files WHERE id=?').get(id), '');
  z.finalize();
}
app.get('/api/zip', auth, (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
  if (!ids.length) throw httpErr(400, 'No ids');
  ids.forEach((id) => { if (ownFile(req.user.id, id).trashed_at) throw httpErr(400, 'Item is in trash'); });
  zipTo(res, req.user.id, ids, ids.length === 1 ? `${ownFile(req.user.id, ids[0]).name}.zip` : 'download.zip');
});

// versions
app.get('/api/files/:id/versions', auth, (req, res) => {
  const f = ownFile(req.user.id, req.params.id);
  res.json({ current: f.storage_key, versions: q('SELECT id,storage_key,size,created FROM versions WHERE file_id=? ORDER BY id DESC').all(f.id).map((v) => ({ id: v.id, size: v.size, created: v.created, current: v.storage_key === f.storage_key })) });
});
app.post('/api/files/:id/versions', auth, upload.single('file'), (req, res) => {
  const nf = req.file; if (!nf) throw httpErr(400, 'No file');
  try {
    const f = ownFile(req.user.id, req.params.id);
    if (f.is_folder) throw httpErr(400, 'Is a folder');
    if (usage(req.user.id) + nf.size > req.user.quota) throw httpErr(413, 'Storage quota exceeded');
    tx(() => {
      const { key, mime, text } = storeBlob(nf.path, nf, f.name); const t = now();
      q('INSERT INTO versions(file_id,storage_key,size,mime,created) VALUES(?,?,?,?,?)').run(f.id, key, nf.size, mime, t);
      q('UPDATE files SET storage_key=?, size=?, mime=?, text_content=?, updated=? WHERE id=?').run(key, nf.size, mime, text, t, f.id);
      const old = q('SELECT id,storage_key FROM versions WHERE file_id=? ORDER BY id DESC').all(f.id).slice(25); // keep last 25
      for (const o of old) { q('DELETE FROM versions WHERE id=?').run(o.id); rmBlob(o.storage_key); }
    });
    res.json(publicFile(q('SELECT * FROM files WHERE id=?').get(f.id)));
  } finally { fs.rm(nf.path, { force: true }, () => {}); }
});
app.post('/api/files/:id/versions/:vid/restore', auth, (req, res) => {
  const f = ownFile(req.user.id, req.params.id);
  const v = q('SELECT * FROM versions WHERE id=? AND file_id=?').get(Number(req.params.vid), f.id);
  if (!v) throw httpErr(404, 'Version not found');
  q('UPDATE files SET storage_key=?, size=?, mime=?, text_content=?, updated=? WHERE id=?').run(v.storage_key, v.size, v.mime, extractText(path.join(BLOB_DIR, v.storage_key), v.mime, f.name), now(), f.id);
  res.json(publicFile(q('SELECT * FROM files WHERE id=?').get(f.id)));
});
app.delete('/api/files/:id/versions/:vid', auth, (req, res) => {
  const f = ownFile(req.user.id, req.params.id);
  const v = q('SELECT * FROM versions WHERE id=? AND file_id=?').get(Number(req.params.vid), f.id);
  if (!v) throw httpErr(404, 'Version not found');
  if (v.storage_key === f.storage_key) throw httpErr(400, 'Cannot delete the current version');
  q('DELETE FROM versions WHERE id=?').run(v.id); rmBlob(v.storage_key); res.json({ ok: true });
});

// sharing (owner side)
const shareView = (s) => s && { id: s.id, token: s.token, url: `/s/${s.token}`, password: !!s.pass_hash, expires_at: s.expires_at, allow_download: !!s.allow_download, views: s.views };
app.get('/api/files/:id/share', auth, (req, res) => res.json(shareView(q('SELECT * FROM shares WHERE file_id=?').get(ownFile(req.user.id, req.params.id).id)) || null));
app.put('/api/files/:id/share', auth, (req, res) => {
  const f = ownFile(req.user.id, req.params.id); const b = req.body;
  const cur = q('SELECT * FROM shares WHERE file_id=?').get(f.id);
  let passHash = cur?.pass_hash ?? null; let passSalt = cur?.pass_salt ?? null;
  if (typeof b.password === 'string') { if (b.password) { passSalt = rid(16); passHash = hashPw(b.password, passSalt); } else { passHash = passSalt = null; } }
  const exp = b.expires_at ? Number(b.expires_at) : null;
  if (exp && exp < now()) throw httpErr(400, 'Expiry must be in the future');
  if (cur) q('UPDATE shares SET pass_hash=?, pass_salt=?, expires_at=?, allow_download=? WHERE id=?').run(passHash, passSalt, exp, b.allow_download === false ? 0 : 1, cur.id);
  else q('INSERT INTO shares(file_id,token,pass_hash,pass_salt,expires_at,allow_download,created) VALUES(?,?,?,?,?,?,?)').run(f.id, rid(18), passHash, passSalt, exp, b.allow_download === false ? 0 : 1, now());
  res.json(shareView(q('SELECT * FROM shares WHERE file_id=?').get(f.id)));
});
app.delete('/api/files/:id/share', auth, (req, res) => { q('DELETE FROM shares WHERE file_id=?').run(ownFile(req.user.id, req.params.id).id); res.json({ ok: true }); });

// sharing (public side)
const unlockSig = (s) => crypto.createHmac('sha256', SECRET).update(`${s.token}|${s.pass_hash}`).digest('base64url');
function loadShare(req, { needUnlocked = true } = {}) {
  const s = q('SELECT * FROM shares WHERE token=?').get(req.params.token);
  const root = s && q('SELECT * FROM files WHERE id=? AND trashed_at IS NULL').get(s.file_id);
  if (!s || !root) throw httpErr(404, 'This link does not exist or was removed');
  if (s.expires_at && s.expires_at < now()) throw httpErr(410, 'This link has expired');
  const unlocked = !s.pass_hash || (parseCookies(req.headers.cookie)[`sh_${s.token}`] || '') === unlockSig(s);
  if (needUnlocked && !unlocked) throw httpErr(401, 'Password required');
  return { s, root, unlocked };
}
function shareTarget(req, root, id) {
  if (id == null) return root;
  const f = q('SELECT * FROM files WHERE id=? AND trashed_at IS NULL').get(Number(id));
  if (!f || !root.is_folder || !isDescendant(root.id, f.id)) throw httpErr(404, 'Not found');
  return f;
}
app.get('/api/s/:token', (req, res) => {
  const { s, root, unlocked } = loadShare(req, { needUnlocked: false });
  if (!unlocked) return res.json({ locked: true, name: null });
  q('UPDATE shares SET views=views+1 WHERE id=?').run(s.id);
  res.json({ locked: false, root: { id: root.id, name: root.name, is_folder: !!root.is_folder, mime: root.mime, size: root.size }, allow_download: !!s.allow_download });
});
app.post('/api/s/:token/unlock', (req, res) => {
  const { s } = loadShare(req, { needUnlocked: false });
  throttle(`${req.ip}|share|${s.token}`);
  if (s.pass_hash && !safeEq(s.pass_hash, hashPw(String(req.body.password || ''), s.pass_salt))) throw httpErr(401, 'Wrong password');
  res.setHeader('Set-Cookie', `sh_${s.token}=${unlockSig(s)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${req.secure ? '; Secure' : ''}`); res.json({ ok: true });
});
app.get('/api/s/:token/list', (req, res) => {
  const { root } = loadShare(req); const dir = shareTarget(req, root, req.query.folder);
  if (!dir.is_folder) return res.json({ files: [], crumbs: [] });
  const crumbs = []; for (let f = dir; f; f = f.id === root.id ? null : q('SELECT * FROM files WHERE id=?').get(f.parent_id)) crumbs.unshift({ id: f.id, name: f.name });
  res.json({ crumbs, files: q('SELECT * FROM files WHERE parent_id=? AND trashed_at IS NULL ORDER BY is_folder DESC, name COLLATE NOCASE').all(dir.id).map((f) => ({ id: f.id, name: f.name, is_folder: !!f.is_folder, mime: f.mime, size: f.size, updated: f.updated })) });
});
app.get('/api/s/:token/content', (req, res) => {
  const { s, root } = loadShare(req); const f = shareTarget(req, root, req.query.id);
  const inline = req.query.inline === '1';
  if (!s.allow_download && !(inline && INLINE_OK.test(f.mime || ''))) throw httpErr(403, 'Downloads disabled for this link');
  if (f.is_folder) { if (!s.allow_download) throw httpErr(403, 'Downloads disabled'); return zipTo(res, null, [f.id], `${f.name}.zip`); }
  sendBlob(res, { key: f.storage_key, name: f.name, mime: f.mime, inline });
});

// static + errors
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/s/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'share.html')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.code === 'LIMIT_FILE_SIZE') err = httpErr(413, 'File too large');
  if (res.headersSent) return res.destroy();
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
});

if (require.main === module) {
  purgeExpiredTrash(); setInterval(purgeExpiredTrash, 6 * 3600e3).unref();
  app.listen(PORT, () => console.log(`Mini Drive running on http://localhost:${PORT}`));
}
module.exports = { app, db };
