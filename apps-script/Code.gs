/**
 * Drive Clone – copy tệp/thư mục được chia sẻ trên Google Drive vào Drive của bạn.
 * Deploy dạng Web app với "Execute as: User accessing the web app".
 */
// Mỗi lần gọi chạy tối đa ~20 giây rồi trả về để giao diện cập nhật tiến độ (giới hạn cứng của Apps Script là 6 phút/lần).
const TIME_BUDGET_MS = 20 * 1000;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Drive Clone')
    .setFaviconUrl('https://raw.githubusercontent.com/HienPhuong99/web-app-clone-file-google-drive/claude/cool-cannon-ken5nn/assets/icon-180.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Chặn deploy nhầm "Execute as: Me" (khi đó mọi người sẽ copy vào Drive của chủ app).
function guard_() {
  const active = Session.getActiveUser().getEmail();
  if (!active || active !== Session.getEffectiveUser().getEmail()) {
    throw new Error('Web app phải được deploy với "Execute as: User accessing the web app".');
  }
}

/** Lấy ID từ link Drive/Docs hoặc ID trần. */
function parseId_(text) {
  const s = String(text || '').trim();
  const m = s.match(/\/(?:d|folders)\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/^([\w-]{10,})$/);
  if (!m) throw new Error('Không nhận ra link Google Drive: ' + s);
  return m[1];
}

/** Trả về {type:'file'|'folder', item} – tự giải shortcut. */
function open_(id) {
  try {
    const f = DriveApp.getFileById(id);
    if (f.getMimeType() === MimeType.SHORTCUT) return open_(f.getTargetId());
    if (f.getMimeType() !== MimeType.FOLDER) return { type: 'file', item: f };
  } catch (e) { /* có thể là thư mục */ }
  try {
    return { type: 'folder', item: DriveApp.getFolderById(id) };
  } catch (e) {
    throw new Error('Không mở được (link sai, chưa được chia sẻ với tài khoản này, hoặc đã bị xoá).');
  }
}

const q_ = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Dùng lại thư mục con cùng tên nếu đã có (để chạy tiếp lần copy dở), chưa có thì tạo. */
function subfolder_(parent, name) {
  const it = parent.searchFolders(`title = '${q_(name)}' and trashed = false`);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Đếm tệp đã có trong thư mục đích theo tên: {tên: số lượng} – tệp trùng tên sẽ được bỏ qua. */
function have_(folder) {
  const m = {};
  const it = folder.searchFiles('trashed = false');
  while (it.hasNext()) { const n = it.next().getName(); m[n] = (m[n] || 0) + 1; }
  return m;
}

function me() {
  guard_();
  return Session.getActiveUser().getEmail();
}

/**
 * Bắt đầu clone. source: link tệp/thư mục; dest: link thư mục đích (trống = My Drive).
 * Trả về job; client gọi cloneStep(job) lặp lại cho đến khi job.done.
 */
function cloneStart(source, dest) {
  guard_();
  const src = open_(parseId_(source));
  const dst = String(dest || '').trim() ? DriveApp.getFolderById(parseId_(dest)) : DriveApp.getRootFolder();
  if (src.type === 'file') {
    const name = src.item.getName();
    const existing = dst.searchFiles(`title = '${q_(name)}' and trashed = false`);
    if (existing.hasNext()) {
      return { done: true, copied: 0, skipped: 1, failed: [], url: existing.next().getUrl(), name: name };
    }
    try {
      const copy = src.item.makeCopy(name, dst);
      return { done: true, copied: 1, skipped: 0, failed: [], url: copy.getUrl(), name: copy.getName() };
    } catch (e) {
      throw new Error(`Không copy được "${name}": ${e.message} (chủ sở hữu có thể đã tắt quyền tải xuống/sao chép).`);
    }
  }
  const root = subfolder_(dst, src.item.getName());
  return { done: false, copied: 0, skipped: 0, failed: [], url: root.getUrl(), name: root.getName(), queue: [{ src: src.item.getId(), dst: root.getId(), token: null, subDone: false }] };
}

/** Copy tiếp các tệp của thư mục cho đến khi hết giờ hoặc xong. */
function cloneStep(job) {
  guard_();
  const t0 = Date.now();
  const outOfTime = () => Date.now() - t0 > TIME_BUDGET_MS;
  while (job.queue.length) {
    const task = job.queue[0];
    const dstFolder = DriveApp.getFolderById(task.dst);
    if (!task.subDone) {
      const subs = DriveApp.getFolderById(task.src).getFolders();
      while (subs.hasNext()) {
        const sub = subs.next();
        job.queue.push({ src: sub.getId(), dst: subfolder_(dstFolder, sub.getName()).getId(), token: null, subDone: false });
      }
      task.have = have_(dstFolder);
      task.subDone = true;
    }
    const files = task.token ? DriveApp.continueFileIterator(task.token) : DriveApp.getFolderById(task.src).getFiles();
    while (files.hasNext()) {
      if (outOfTime()) { task.token = files.getContinuationToken(); return job; }
      let f = files.next();
      try {
        if (f.getMimeType() === MimeType.SHORTCUT) f = DriveApp.getFileById(f.getTargetId());
        const name = f.getName();
        if (task.have[name]) { task.have[name]--; job.skipped++; continue; } // đã có ở đích → bỏ qua
        f.makeCopy(name, dstFolder);
        job.copied++;
        job.last = name;
      } catch (e) {
        if (job.failed.length < 100) job.failed.push(`${f.getName()}: ${e.message}`);
      }
    }
    job.queue.shift();
    if (outOfTime()) return job;
  }
  job.done = true;
  return job;
}
