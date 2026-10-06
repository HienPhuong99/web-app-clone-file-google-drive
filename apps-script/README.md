# Mini Drive – bản Google Apps Script (miễn phí, không cần thẻ)

Chạy trên hạ tầng Google, **không cần billing**, link dạng `https://script.google.com/macros/s/…/exec`.
Mỗi người đăng nhập bằng tài khoản Google của mình và dùng **Google Drive thật** của họ làm kho lưu trữ (15 GB miễn phí).

## Deploy (~3 phút)
1. Mở <https://script.google.com> → **New project** (Dự án mới). Đặt tên `Mini Drive`.
2. **Project Settings** (⚙) → tick **Show "appsscript.json" manifest file in editor**.
3. Quay lại **Editor** (‹ ›), dán nội dung 3 tệp (xoá nội dung cũ trước):
   - `appsscript.json` ← [appsscript.json](appsscript.json)
   - `Code.gs` ← [Code.gs](Code.gs)
   - Bấm **＋ → HTML**, đặt tên `Index` (không có .html) ← [Index.html](Index.html)
   Bấm 💾 Lưu.
4. **Deploy → New deployment** → ⚙ chọn **Web app**:
   - Execute as: **User accessing the web app** (bắt buộc)
   - Who has access: **Anyone with Google account**
   → **Deploy** → **Authorize access** → chọn tài khoản → *Advanced* → *Go to Mini Drive (unsafe)* → **Allow**.
   (Cảnh báo "unverified" là bình thường với app tự viết.)
5. Copy **Web app URL** – đó là link để dùng/gửi người khác.

Sửa code sau này: dán lại → **Deploy → Manage deployments → ✏ → Version: New version → Deploy** (giữ nguyên link).

## Khác bản Node
| | Node (`/server.js`) | Apps Script |
|---|---|---|
| Chi phí | cần server (Cloud Run cần billing) | miễn phí |
| Lưu trữ | đĩa server | Google Drive của từng người |
| Lịch sử phiên bản | tự quản lý | Drive tự giữ (Tải lên phiên bản mới) |
| Xem trước | ảnh/PDF/video/text | mọi loại Drive xem được (cả Docs/Sheets/Office) |
| Chia sẻ | link riêng + mật khẩu/hạn dùng | quyền Drive: theo email (xem/sửa) hoặc "bất kỳ ai có link" |
| Tải thư mục zip | có | mở trong Google Drive |

## Phát triển
Sửa `src/client.js`, `src/template.html` hoặc `../public/style.css`, rồi `node apps-script/build.js` để sinh lại `Index.html`.
`ROOT` trong `Code.gs` có thể đổi từ `'root'` sang ID một thư mục để giới hạn app trong thư mục đó.
