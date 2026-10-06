# Mini Drive – bản clone Google Drive

Web app lưu trữ tệp theo kiểu Google Drive. Node.js ≥ 22.13 (dùng `node:sqlite` có sẵn), Express, frontend JS thuần – không cần build.

```bash
npm install
npm start            # http://localhost:3000
npm test             # test tích hợp backend
```
Biến môi trường: `PORT`, `DATA_DIR` (mặc định `./data`), `QUOTA_BYTES` (mặc định 15 GB/người), `MAX_UPLOAD_BYTES` (2 GB/tệp).

## Tính năng đã có
**Lõi (giống Drive):** đăng ký/đăng nhập · thư mục lồng nhau + breadcrumb · tải lên nhiều tệp/cả thư mục, kéo thả, thanh tiến trình · xem dạng lưới/danh sách, sắp xếp · đổi tên, di chuyển (kéo thả hoặc hộp thoại) · gắn sao · Gần đây · thùng rác (tự xoá sau 30 ngày) · tải xuống tệp/thư mục (zip) · xem trước ảnh/PDF/video/audio/văn bản có điều hướng ←/→ · hạn mức dung lượng · phím tắt (Enter, F2, Delete, Ctrl+A) · menu chuột phải · chế độ tối.

**Bổ sung theo khảo sát thị trường:**
| Tính năng | Lý do |
|---|---|
| Lịch sử phiên bản (tải bản mới, khôi phục, tối đa 25 bản) | "File versioning" nằm trong nhóm must-have của mọi dịch vụ 2026 |
| Liên kết chia sẻ có mật khẩu, hạn dùng, tắt tải xuống, đếm lượt xem; chia sẻ cả thư mục | Dropbox/pCloud/Proton đều có; Drive gốc thiếu đặt mật khẩu ở bản miễn phí |
| Tìm kiếm cả nội dung tệp văn bản | Hướng đi chung của Drive/Dropbox (AI search) ở dạng đơn giản |
| Bảo mật: CSP sandbox + chỉ inline kiểu an toàn, scrypt, rate-limit đăng nhập | Bảo mật là tiêu chí chọn số 1 |

## Gợi ý tính năng tiếp theo (từ khảo sát)
Xếp theo giá trị/công sức:
1. **Hỏi đáp & tóm tắt bằng AI** (Gemini "AI Overviews"/"Ask Gemini in Drive" ra mắt 2026): tóm tắt tệp, hỏi đáp trên thư mục – dùng Claude API + embedding.
2. **Mã hoá đầu cuối / zero-knowledge** (Proton Drive, Nextcloud): điểm khác biệt lớn nhất cho nhóm quan tâm riêng tư.
3. **Chia sẻ theo người dùng** với quyền xem/bình luận/sửa, và "Được chia sẻ với tôi".
4. **Đồng bộ nền + ứng dụng desktop/mobile, tải lên tự động ảnh** (sync/backup là "expected", không còn là tuỳ chọn).
5. **Soạn thảo cộng tác thời gian thực** (Docs/Sheets) và bình luận trên tệp.
6. **OCR + tìm kiếm trong PDF/ảnh**, tìm kiếm ngữ nghĩa.
7. **Đồng bộ chọn lọc / chỉ-trực-tuyến** (smart storage), tải lên có thể tiếp tục (chunk/tus), dedup theo hash.
8. **Quản trị**: SSO/OIDC, nhật ký truy cập, quota theo người dùng, tích hợp S3/MinIO làm kho lưu trữ.

## Khảo sát nguồn
Zapier, Cloudwards, Toolradar, Peony… (so sánh Dropbox/OneDrive/Proton/pCloud/Nextcloud 2026) và Google Workspace Updates (AI Overviews, Ask Gemini in Drive, 2026).

## Ghi chú kỹ thuật
Dữ liệu: SQLite (`data/drive.db`) + blob trên đĩa (`data/blobs`). Mỗi lần upload sinh một `version`. Chưa có CSRF token (dựa vào cookie `SameSite=Lax` + API JSON); nên đặt sau HTTPS và thêm cờ `Secure` cho cookie khi triển khai thật.

## Deploy miễn phí bằng Google Apps Script
Xem [apps-script/README.md](apps-script/README.md) – không cần billing, link `script.google.com/…/exec`.

## Deploy lên Google Cloud Run (cần billing)
```bash
gcloud auth login && gcloud config set project <PROJECT_ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud run deploy mini-drive --source . --region asia-southeast1 \
  --allow-unauthenticated --max-instances 1 --memory 512Mi
```
Lệnh in ra link dạng `https://mini-drive-xxxx.asia-southeast1.run.app`.

⚠️ Cloud Run có ổ đĩa tạm: **dữ liệu (SQLite + tệp) mất khi instance khởi động lại**, và `--max-instances 1` là bắt buộc (SQLite không chạy đa instance). Đủ để demo/test. Muốn lưu lâu dài: chạy trên Compute Engine VM (e2-micro) với persistent disk, hoặc mount bucket GCS vào `/data` cho phần tệp và chuyển DB sang Cloud SQL.
