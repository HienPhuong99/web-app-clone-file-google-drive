/**
 * Drive Clone – copy tệp/thư mục được chia sẻ trên Google Drive vào Drive của bạn.
 * Deploy dạng Web app với "Execute as: User accessing the web app".
 */
const TIME_BUDGET_MS = 4.5 * 60 * 1000; // Apps Script giới hạn 6 phút/lần chạy; phần còn lại sẽ chạy tiếp ở lần gọi sau

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Drive Clone')
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
    try {
      const copy = src.item.makeCopy(src.item.getName(), dst);
      return { done: true, copied: 1, failed: [], url: copy.getUrl(), name: copy.getName() };
    } catch (e) {
      throw new Error(`Không copy được "${src.item.getName()}": ${e.message} (chủ sở hữu có thể đã tắt quyền tải xuống/sao chép).`);
    }
  }
  const root = dst.createFolder(src.item.getName());
  return { done: false, copied: 0, failed: [], url: root.getUrl(), name: root.getName(), queue: [{ src: src.item.getId(), dst: root.getId(), token: null, subDone: false }] };
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
        job.queue.push({ src: sub.getId(), dst: dstFolder.createFolder(sub.getName()).getId(), token: null, subDone: false });
      }
      task.subDone = true;
    }
    const files = task.token ? DriveApp.continueFileIterator(task.token) : DriveApp.getFolderById(task.src).getFiles();
    while (files.hasNext()) {
      if (outOfTime()) { task.token = files.getContinuationToken(); return job; }
      let f = files.next();
      try {
        if (f.getMimeType() === MimeType.SHORTCUT) f = DriveApp.getFileById(f.getTargetId());
        f.makeCopy(f.getName(), dstFolder);
        job.copied++;
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
