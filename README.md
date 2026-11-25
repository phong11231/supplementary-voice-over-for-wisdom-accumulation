# Drive Video Downloader

Extension Chrome: đọc cấu trúc thư mục Google Drive → tạo lại y hệt thư mục trên máy →
tải toàn bộ video về đúng vị trí, giữ nguyên tên và cách sắp xếp.

Dùng **OAuth** bằng chính tài khoản Google của bạn (tài khoản được chia sẻ thư mục),
nên **không cần** thư mục ở chế độ "Bất kỳ ai có link".

## Cài đặt (unpacked extension)

1. Mở Chrome / Chromium → vào `chrome://extensions`
2. Bật **Developer mode** (góc trên bên phải)
3. Bấm **Load unpacked** → chọn thư mục `drive-video-downloader` này (trên USB)
4. Icon extension xuất hiện trên thanh công cụ. Bấm vào icon → mở trang ứng dụng.

> Extension đã gắn **ID cố định** khớp với OAuth Client ID. Không được đổi `key`
> trong `manifest.json`, nếu đổi thì đăng nhập Google sẽ lỗi.

## Cách dùng (3 bước)

- **Bước 1 — Nhập link + Đăng nhập:** dán link thư mục Drive, bấm **Đăng nhập Google**
  và chọn đúng tài khoản được chia sẻ thư mục. Lần đầu sẽ hiện màn hình xin quyền
  "chỉ đọc Google Drive" → bấm **Allow/Cho phép**. (Có thể thấy cảnh báo "app chưa được
  xác minh" vì đây là app cá nhân → bấm *Advanced → Go to ... (unsafe)* để tiếp tục.)
- **Bước 2 — Chọn nơi lưu:** bấm "Chọn thư mục lưu..." rồi chọn thư mục đích.
  Extension sẽ tự tạo các thư mục con trong đó.
- **Bước 3 — Chạy:** bấm "Bắt đầu tải". Có thanh tiến trình + log, nút **Dừng**,
  và **resume** (chạy lại bỏ qua file đã tải đúng dung lượng).

### Tùy chọn
- **Tạo thư mục gốc theo tên khóa học:** gói toàn bộ vào 1 thư mục tên = tên khóa học.
- **Chỉ tải video:** bỏ qua file không phải video.
- **Tải cả phụ đề (.srt):** tải thêm file phụ đề.
- **Bỏ qua file đã tải (resume):** tiếp tục được khi bị gián đoạn.

## Thông tin kỹ thuật (đã cấu hình sẵn)

- Google Cloud project: `sieu-chien-binh-toan`
- OAuth Client ID (Chrome Extension): `909922477358-lu6bdsfd4c8pcuvnmrfc981gg6puan4q.apps.googleusercontent.com`
- Extension ID cố định: `kgachkaafpoiinomoihccdmmdkmekhma`
- Scope: `https://www.googleapis.com/auth/drive.readonly` (chỉ đọc)
- Dùng **File System Access API** để ghi file vào thư mục bạn chọn (cần Chrome/Chromium mới).
- `key.pem` là khóa ký để giữ ID cố định — **giữ bí mật, đừng chia sẻ**. Chrome bỏ qua
  file này khi chạy; nó chỉ cần khi muốn đóng gói lại (.crt) sau này.
