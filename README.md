# Drive Clone

Web app miễn phí (Google Apps Script) để **copy tệp/thư mục được chia sẻ trên Google Drive vào Drive của bạn**:
dán link được share → (tuỳ chọn) dán link thư mục đích → bấm **Clone**.

- Hỗ trợ tệp, Google Docs/Sheets/Slides, shortcut, và **cả thư mục** (copy đệ quy, tự chạy tiếp khi vượt giới hạn 6 phút của Apps Script).
- Nhiều link cùng lúc (mỗi dòng một link).
- Không cần server, không cần thẻ thanh toán. Mỗi người dùng copy vào Drive của chính họ.

## Deploy (~2 phút, miễn phí)
1. Mở <https://script.google.com> → **New project**.
2. Dán nội dung [`apps-script/Code.gs`](apps-script/Code.gs) vào tệp `Code.gs` (xoá nội dung mẫu).
3. Bấm **＋ → HTML**, đặt tên `Index`, dán nội dung [`apps-script/Index.html`](apps-script/Index.html). Bấm 💾.
4. **Deploy → New deployment** → ⚙ **Web app**:
   - Execute as: **User accessing the web app** (bắt buộc)
   - Who has access: **Anyone with Google account**
   → **Deploy** → **Authorize access** → *Advanced* → *Go to … (unsafe)* → **Allow**.
5. Copy **Web app URL** – đó là link dùng app.

## Giới hạn
- Chỉ copy được khi tài khoản của bạn **xem được** link đó và chủ sở hữu **không tắt** quyền tải xuống/sao chép.
- Bản copy tính vào dung lượng Drive của bạn. Google giới hạn ~750 GB copy/ngày/tài khoản.
