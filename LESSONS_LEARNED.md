# MatchCut — Lessons Learned

File này là nhật ký lỗi và quy tắc kỹ thuật bắt buộc của dự án MatchCut. Trước khi sửa, nâng cấp, chạy thử hoặc bàn giao ở bất kỳ cửa sổ làm việc nào, phải đọc file này. Sau mỗi lỗi mới hoặc bài học quan trọng, phải cập nhật lại file.

## Quy trình bắt buộc

1. Đọc `LESSONS_LEARNED.md` trước khi thay đổi MatchCut.
2. Không chỉ thêm điều khiển trên giao diện; phải nối đến backend/FFmpeg và kiểm thử đầu-cuối.
3. Không bàn giao tính năng render nếu chưa tạo được ít nhất một MP4 hợp lệ và kiểm tra khả năng giải mã.
4. Sau khi gặp lỗi, ghi rõ triệu chứng, nguyên nhân, cách sửa và kiểm thử chống tái diễn.
5. Không khởi động lại backend khi người dùng đang chạy Whisper hoặc FFmpeg. Trước khi restart phải kiểm tra tiến trình đang hoạt động.

## Các bài học đã xác nhận

### 1. Whisper bị treo với voice dài

- Triệu chứng: giao diện dừng ở “Đang nhận dạng”, Node dùng nhiều RAM rồi CPU về gần 0.
- Nguyên nhân: đưa toàn bộ voice dài vào Whisper JavaScript trong một lần.
- Cách phòng tránh: chia voice thành khối nhỏ, xử lý tuần tự, giới hạn một tác vụ Whisper cùng lúc; ưu tiên Faster-Whisper CUDA và VAD.
- Kiểm thử: voice ngắn, voice dài, hai yêu cầu đồng thời và timestamp qua ranh giới các khối.

### 2. `Failed to fetch` giữa hàng đợi

- Triệu chứng: hàng đợi kết thúc nhưng file chưa render.
- Nguyên nhân: backend bị dừng hoặc restart trong lúc trình duyệt đang chờ Whisper/render.
- Cách phòng tránh: kiểm tra tiến trình trước khi restart; phía giao diện tự thử kết nối lại và ghi rõ trạng thái.
- Kiểm thử: cố ý ngắt kết nối, khởi động lại backend và xác nhận tác vụ báo lỗi rõ hoặc tiếp tục an toàn.

### 3. MP4 đang render dở không phải file bàn giao

- Triệu chứng: file tạm tăng dung lượng nhưng có thể không mở được sau khi ép dừng.
- Nguyên nhân: MP4 chưa được ghi trailer/chỉ mục cuối.
- Cách phòng tránh: muốn xuất một phần phải giữ nguồn trung gian rồi render lại đoạn có thời lượng xác định thành MP4 hoàn chỉnh.
- Kiểm thử: xác nhận Duration và giải mã ít nhất một đoạn bằng FFmpeg.

### 4. Render CPU quá chậm và file quá lớn

- Triệu chứng: video 11 phút cần nhiều phút render và tạo file khoảng 628 MB.
- Nguyên nhân: dùng `libx264`, mã hóa nhiều lượt và bitrate đầu ra cao.
- Cách phòng tránh: dùng RTX 3060 qua `h264_nvenc`, giảm số lượt mã hóa, đặt bitrate/CQ hợp lý và giữ CPU làm phương án dự phòng.
- Kiểm thử: đo thời gian, dung lượng, chất lượng và khả năng phát của cùng một video mẫu.

### 5. Mọi cấu hình phải lưu theo kênh

- Các đường dẫn kho tư liệu, font, phụ đề, lớp phủ, watermark, sóng âm, hiệu ứng và chế độ render phải được lưu/nạp theo đúng cấu hình kênh.
- Khi thay đổi schema cấu hình phải có bước chuyển đổi dữ liệu cũ.

