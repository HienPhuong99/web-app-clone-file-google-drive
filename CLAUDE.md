# Drive Clone – ngữ cảnh cho Claude Code

Người dùng nói tiếng Việt; trả lời bằng tiếng Việt. Họ muốn **đơn giản, miễn phí**, và **chỉ phải duyệt** – Claude tự thao tác (CLI + trình duyệt), chỉ dừng ở bước cần người dùng: đăng nhập Google, màn hình cấp quyền OAuth.

## Sản phẩm
Web app Google Apps Script: dán link tệp/thư mục được chia sẻ + (tuỳ chọn) link thư mục đích → copy vào Drive của người dùng.
Chỉ có 2 tệp: `apps-script/Code.gs`, `apps-script/Index.html`. Không thêm tính năng ngoài phạm vi này nếu người dùng không yêu cầu.
(Bản "clone giao diện Google Drive" bằng Node trước đó đã bị gỡ theo yêu cầu – đừng khôi phục.)

## Việc tiếp theo: deploy, đưa link `…/exec` cho người dùng
Làm theo mục "Deploy" trong README trên https://script.google.com bằng trình duyệt (Claude in Chrome):
tạo project, dán 2 tệp, Deploy → Web app, **Execute as: User accessing the web app**, **Who has access: Anyone with Google account**.
Người dùng tự bấm Authorize/Allow. Sau đó mở link, test copy 1 tệp và 1 thư mục được chia sẻ, báo link cho người dùng.
Lỗi → sửa code trong repo, dán lại, **Deploy → Manage deployments → ✏ → New version** (giữ nguyên link), commit + push nhánh `claude/cool-cannon-ken5nn`.
**Không bao giờ** chọn "Execute as: Me".
