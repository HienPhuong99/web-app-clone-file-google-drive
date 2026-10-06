# Mini Drive – ngữ cảnh cho Claude Code

Người dùng nói tiếng Việt; trả lời bằng tiếng Việt. Họ muốn **chỉ phải duyệt** – Claude tự thao tác (CLI + trình duyệt), chỉ dừng lại ở bước cần người dùng: đăng nhập Google, màn hình cấp quyền OAuth, thanh toán.

## Đã làm (nhánh `claude/cool-cannon-ken5nn`)
- `server.js`, `public/`, `test.js`: bản Node (Express + `node:sqlite`) clone Google Drive. `npm test` phải pass.
- `Dockerfile` + mục Cloud Run trong README – **bỏ**, vì Google Cloud đòi trả trước 800.000₫. Người dùng muốn **miễn phí**.
- `apps-script/`: bản **Google Apps Script** miễn phí, lưu tệp vào Google Drive thật của người dùng.
  - Tệp deploy: `Code.gs`, `Index.html` (sinh từ `src/` bằng `node apps-script/build.js`), `appsscript.json` (bật Drive API v3 advanced service, `executeAs: USER_ACCESSING`, `access: ANYONE`).
  - Mới chỉ test UI với backend giả; **chưa chạy với Google thật** → lỗi Drive API có thể xuất hiện, cần sửa khi gặp.

## Việc tiếp theo: deploy bản Apps Script, đưa link `…/exec` cho người dùng
Ưu tiên CLI `clasp`, trình duyệt chỉ cho bước bắt buộc:
1. Trình duyệt: mở https://script.google.com/home/usersettings → bật **Google Apps Script API** (người dùng có thể phải đăng nhập).
2. `cd apps-script && npx -y @google/clasp login` → mở trình duyệt, người dùng bấm Allow.
3. `npx -y @google/clasp create --type webapp --title "Mini Drive" --rootDir .` (nếu nó tạo `appsscript.json` mới thì khôi phục bằng `git checkout apps-script/appsscript.json`).
4. `npx -y @google/clasp push -f` rồi `npx -y @google/clasp deploy --description "v1"`.
5. Link = `https://script.google.com/macros/s/<deploymentId>/exec` (lấy deploymentId từ output `clasp deploy` / `clasp deployments`).
6. Mở link trong trình duyệt → màn hình "Google hasn't verified this app" → *Advanced* → *Go to Mini Drive (unsafe)* → **Allow** (người dùng duyệt).
7. Test thật: tạo thư mục, upload tệp, gắn sao, chia sẻ, xoá/khôi phục. Lỗi → sửa `Code.gs`/`src/*`, `node apps-script/build.js`, `clasp push -f`, `clasp deploy -i <deploymentId>` (giữ nguyên link).
8. Commit + push lên nhánh `claude/cool-cannon-ken5nn`, báo link cho người dùng.

Không dùng clasp được → làm thủ công trên script.google.com theo `apps-script/README.md`.
**Không bao giờ** chọn "Execute as: Me" (sẽ lộ Drive của chủ app cho người khác; code cũng chặn trường hợp này).
