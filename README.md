# Drive Clone

Web app miễn phí (Google Apps Script) để **copy tệp/thư mục được chia sẻ trên Google Drive vào Drive của bạn**:
dán link được share → (tuỳ chọn) dán link thư mục đích → bấm **Clone**.

**Link dùng app:** <https://hienphuong99.github.io/web-app-clone-file-google-drive/> (hoặc <https://tinyurl.com/driveclone-vn>; link gốc: <https://script.google.com/macros/s/AKfycbxy4A09uQ-kycGGfKQIlbmmvGTR3Fp7QSxKsYgImAwFvDNiM3mqBUDJIunLEE6WnFXeGA/exec>)

## Khi nào nên dùng app này?
| Bạn cần | Cách đơn giản nhất |
|---|---|
| Copy **1 tệp** hoặc vài tệp lẻ | Không cần app: mở link → **⋮ / chuột phải → Tạo bản sao (Make a copy)** |
| Copy **cả thư mục** (kèm thư mục con) | **Dùng app này**. Google Drive không có nút copy thư mục |
| Copy thẳng vào **một thư mục đích** chọn sẵn | **Dùng app này** |
| Copy **nhiều link** một lần | **Dùng app này** (mỗi dòng một link) |

## Hướng dẫn sử dụng
1. Mở link ở trên, đăng nhập Google.
2. Lần đầu sẽ hiện *"Google chưa xác minh ứng dụng này"* → **Nâng cao (Advanced)** → **Đi tới Drive Clone (không an toàn)** → **Cho phép (Allow)**.
   App chạy bằng tài khoản của chính bạn và chỉ copy vào Drive của bạn.
3. Dán link tệp/thư mục được chia sẻ (mỗi dòng một link), tuỳ chọn dán link thư mục đích → bấm **Clone**.

- Hỗ trợ tệp, Google Docs/Sheets/Slides, shortcut, và **cả thư mục** (copy đệ quy, tự chạy tiếp khi vượt giới hạn 6 phút của Apps Script).
- Nhiều link cùng lúc (mỗi dòng một link).
- Kiểm tra trước khi copy: thư mục/tệp cùng tên đã có ở đích được dùng lại/bỏ qua, nên chạy lại cùng link + cùng thư mục đích sẽ chỉ copy phần còn thiếu.
- Không cần server, không cần thẻ thanh toán. Mỗi người dùng copy vào Drive của chính họ.

## Dùng trên iPhone (Phím tắt)
App tự điền link khi mở bằng `…/web-app-clone-file-google-drive/?src=<link đã mã hoá>` (hoặc `…/exec?src=…`) (thêm `&dst=<link thư mục đích>` nếu muốn); bạn chỉ cần bấm **Clone**.
Tạo một lần trong app **Phím tắt** (khoảng 2 phút):
1. **＋** → đặt tên `Drive Clone` → **ⓘ Chi tiết** → bật **Trong Bảng chia sẻ** → **Xong**.
2. Ở dòng nhận đầu vào trên cùng: chỉ chọn **URL** và **Văn bản**; mục *nếu không có đầu vào* chọn **Lấy bảng tạm**.
3. Thêm tác vụ **Lấy URL từ đầu vào** → **Mã hoá URL** (chế độ *Mã hoá*) → **URL** với nội dung
   `https://hienphuong99.github.io/web-app-clone-file-google-drive/?src=` rồi chèn biến *URL đã mã hoá* ở cuối → **Mở URL**.
   (Không dùng tinyurl vì nó bỏ mất `?src=`. Muốn mở bằng Chrome: thay `https://` bằng `googlechromes://`.)
4. Tuỳ chọn: **Chi tiết → Thêm vào Màn hình chính**, chọn ảnh [icon](assets/icon-512.png) làm biểu tượng.

Cách dùng: trong Safari bấm **Chia sẻ → Drive Clone**; trong app Google Drive bấm **Sao chép đường liên kết** rồi chạm biểu tượng Drive Clone (phím tắt tự lấy link từ bảng tạm).
Không nên dùng Safari *Thêm vào MH chính* với **Mở dưới dạng ứng dụng web** bật: chế độ đó có cookie riêng nên hay bị lỗi đăng nhập Google. Đăng nhập nhiều tài khoản Google cùng lúc có thể làm Apps Script lỗi → dùng 1 tài khoản hoặc tab riêng tư.

## Deploy (~2 phút, miễn phí)
1. Mở <https://script.google.com> → **New project**.
2. Dán nội dung [`apps-script/Code.gs`](apps-script/Code.gs) vào tệp `Code.gs` (xoá nội dung mẫu).
3. Bấm **＋ → HTML**, đặt tên `Index`, dán nội dung [`apps-script/Index.html`](apps-script/Index.html). Bấm 💾.
4. **Deploy → New deployment** → ⚙ **Web app**:
   - Execute as: **User accessing the web app** (bắt buộc)
   - Who has access: **Anyone with Google account**
   → **Deploy** → **Authorize access** → *Advanced* → *Go to … (unsafe)* → **Allow**.
5. Copy **Web app URL** – đó là link dùng app.
6. Tuỳ chọn: thay `APP` trong [`index.html`](index.html) bằng Web app URL của bạn, bật GitHub Pages cho repo để có link `github.io` tự chuyển sang app.

## Giới hạn
- Chỉ copy được khi tài khoản của bạn **xem được** link đó và chủ sở hữu **không tắt** quyền tải xuống/sao chép.
- Bản copy tính vào dung lượng Drive của bạn. Google giới hạn ~750 GB copy/ngày/tài khoản.
