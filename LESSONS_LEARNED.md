# MatchCut — Lessons Learned

File này là nhật ký lỗi và quy tắc kỹ thuật bắt buộc của dự án MatchCut. Trước khi sửa, nâng cấp, chạy thử hoặc bàn giao ở bất kỳ cửa sổ làm việc nào, phải đọc file này. Sau mỗi lỗi mới hoặc bài học quan trọng, phải cập nhật lại file.

## Quy trình bắt buộc

1. Trước mọi yêu cầu triển khai hoặc thay đổi, phải phỏng vấn người dùng bằng câu hỏi mở để thống nhất mục tiêu, ưu tiên, giới hạn, đầu ra mong muốn và góc nhìn chung; áp dụng cả khi mở cửa sổ mới. Chỉ bắt đầu thực hiện sau khi hai bên đã hiểu giống nhau.
2. Đọc `LESSONS_LEARNED.md` trước khi thay đổi MatchCut.
3. Không chỉ thêm điều khiển trên giao diện; phải nối đến backend/FFmpeg và kiểm thử đầu-cuối.
4. Không bàn giao tính năng render nếu chưa tạo được ít nhất một MP4 hợp lệ và kiểm tra khả năng giải mã.
5. Sau khi gặp lỗi, ghi rõ triệu chứng, nguyên nhân, cách sửa và kiểm thử chống tái diễn.
6. Không khởi động lại backend khi người dùng đang chạy Whisper hoặc FFmpeg. Trước khi restart phải kiểm tra tiến trình đang hoạt động.

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

### 6. Điều khiển chia phụ đề phải được áp dụng ở backend

- Triệu chứng: thay “Số từ/cụm” hoặc “Số dòng tối đa” trên giao diện nhưng video xuất ra không thay đổi; câu dài có thể tràn khung.
- Nguyên nhân: hai giá trị đã được gửi trong `settings` nhưng `createAss` từng ghi nguyên văn mỗi scene thành một dòng ASS.
- Cách phòng tránh: luôn tách scene thành cue theo `wordsPerCaption`, cân dòng theo `maxLines`, rồi phân bổ lại timestamp liên tục trong khoảng thời gian scene gốc; hỗ trợ cả ngôn ngữ không dùng khoảng trắng bằng `Intl.Segmenter`.
- Kiểm thử: unit test câu Latin, giới hạn một dòng, tiếng Nhật, timestamp lỗi; sau đó render MP4 thật, giải mã toàn bộ và kiểm tra hình tại cue đầu/cuối.

### 7. Tạo timestamp dài phải dùng Faster-Whisper với VAD

- Triệu chứng: Whisper JavaScript xử lý voice dài rất chậm, tốn RAM và đôi khi đứng ở trạng thái nhận dạng.
- Nguyên nhân: pipeline Transformers/ONNX trong Node phải tự chia WAV và không tối ưu tốt cho hàng đợi voice dài trên máy này.
- Cách phòng tránh: ưu tiên Faster-Whisper model `small`, `beam_size=1`, VAD bỏ khoảng lặng và `condition_on_previous_text=False`; thử CUDA trước rồi tự hạ xuống CPU `int8`. Giữ pipeline JavaScript chỉ làm dự phòng.
- Ngôn ngữ cấu hình kênh phải được gửi thẳng vào engine. Nếu chọn `Tự động`, phải trả về ngôn ngữ phát hiện cùng độ tin cậy để kiểm tra.
- Kiểm thử: voice tiếng Anh 25 giây hoàn thành qua API trong 6,85 giây trên CPU, tạo 5 timestamp liên tục; chế độ tự động nhận đúng `en` với xác suất 0,9902.

### 8. CUDA cho Faster-Whisper trên Windows phải đăng ký thư mục DLL

- Chỉ có driver NVIDIA không đủ để CTranslate2 dùng GPU; cần cuBLAS CUDA 12 và cuDNN 9.
- MatchCut cài các wheel NVIDIA Windows chính thức ngay trong `.venv-whisper` để không phụ thuộc CUDA Toolkit toàn hệ thống.
- Trước khi import Faster-Whisper, phải thêm `nvidia/cublas/bin` và `nvidia/cudnn/bin` bằng `os.add_dll_directory`; chỉ sửa `PATH` sau khi Python đã chạy là chưa đủ trên Windows.
- Luôn xác nhận kết quả API trả về `device: cuda` và đo thời gian trên voice thật, không suy luận GPU đang chạy chỉ từ việc máy có card NVIDIA.
- Kiểm thử đã xác nhận RTX 3060 xử lý voice 25 giây qua API trong 2,86 giây và trả về `engine: faster-whisper`, `device: cuda`, `model: small`.

### 9. Phải thử mã hóa NVENC thật ở kích thước hợp lệ

- Việc FFmpeg liệt kê `h264_nvenc` chưa chứng minh encoder hoạt động. Phải mã hóa thử một frame và kiểm tra exit code.
- RTX 3060/driver hiện tại từ chối frame kiểm tra 64×64 với lỗi `Frame Dimension less than the minimum supported value`; probe phải dùng ít nhất 256×256.
- Cả bước tạo scene và bước gắn phụ đề/lớp phủ cuối phải dùng `h264_nvenc`; khi GPU lỗi mới tự hạ xuống `libx264`.
- Dùng NVENC VBR, preset `p4`, CQ 23, bitrate mục tiêu 4 Mbps và trần 8 Mbps để cân bằng tốc độ, chất lượng và dung lượng.
- Kiểm thử: video 1080p dài 60 giây có phụ đề/chuyển cảnh hoàn thành trong 12,61 giây, file 4,80 MB; giải mã đủ 60 giây với exit code 0 và API trả `renderEncoder: h264_nvenc`.

### 10. Video dài phải ưu tiên single-pass

- Pipeline cũ mã hóa từng cảnh rồi mã hóa lại khi gắn phụ đề/lớp phủ, làm video dài tốn gần gấp đôi thời gian và tạo nhiều file trung gian.
- Pipeline mới gom các nguồn footage duy nhất, dùng `split`, `trim`, `setpts` và `concat` trong một filter graph; voice, nhạc, waveform, overlay, watermark và phụ đề được ghép trong cùng một tiến trình FFmpeg rồi NVENC mã hóa đúng một lần.
- Nếu graph quá dài hoặc gặp định dạng lạ, backend tự rơi về pipeline hai lượt để không làm hỏng hàng đợi.
- Kiểm thử bắt buộc cả video lặp cùng nguồn, ảnh lặp cùng nguồn, chuyển cảnh random/zoom, phụ đề, nhạc, hai waveform, overlay và watermark xoay.
- So sánh cùng bài 1080p 60 giây: hai lượt mất 12,61 giây; single-pass mất 6,62 giây. File single-pass 4,86 MB, giải mã đủ 60 giây với exit code 0 và API trả `renderPipeline: single-pass`, `renderEncoder: h264_nvenc`.

### 11. Job dài phải được lưu bền vững và tiếp tục từ checkpoint

- Project, hàng đợi, file đầu vào, timestamp, trạng thái, công đoạn, log lỗi và kết quả phải nằm trên ổ đĩa; không chỉ giữ trong bộ nhớ trình duyệt hoặc Node.
- Khi backend khởi động lại, job đang chờ/đang chạy phải tự xếp hàng lại. Nếu đã có timestamp thì bỏ qua nhận dạng và tiếp tục từ render.
- Kết quả hoàn thành được giữ 24 giờ để người dùng kiểm tra; video xuất ở `C:\MatchCut\Exports` không bị bộ dọn job xóa.

### 12. Kết nối nội bộ render dài cần heartbeat đúng giao thức

- `fetch` nội bộ có thể hết thời gian chờ nếu API render không gửi dữ liệu trong khoảng 5 phút, dù FFmpeg vẫn chạy.
- API job dài phải flush header sớm và gửi heartbeat định kỳ. Sau khi đã gửi header, không được gọi `res.json()` vì sẽ gây `Cannot set headers after they are sent to the client`; phải kết thúc body bằng JSON qua `res.end()`.
- Kiểm thử bắt buộc kéo dài quá 5 phút và xác nhận job vẫn chuyển sang `completed`.

### 13. Timeline phải phủ toàn bộ thời lượng file voice

- Thời lượng Faster-Whisper có thể dừng ở lời nói cuối và bỏ phần im lặng cuối tệp.
- Luôn probe thời lượng vật lý bằng FFmpeg và lấy giá trị lớn nhất giữa kết quả probe và engine nhận dạng; cảnh cuối phải kéo dài đến mốc đó.
- Không được cộng riêng `chunk.end - chunk.start` vì cách đó xóa mọi khoảng nghỉ giữa các câu. Cảnh đầu bắt đầu tại 0, mỗi cảnh kết thúc tại thời điểm bắt đầu của chunk kế tiếp, cảnh cuối kết thúc theo thời lượng voice thực.
- Không coi file đạt chỉ vì giải mã được: Duration của MP4 cũng phải khớp voice trong sai số codec hợp lý.

### 14. Filter graph và lỗi encoder phải được phân loại chính xác

- Timeline hàng trăm nguồn trong một tiến trình single-pass có thể làm FFmpeg dùng hơn 20 GB RAM. Không mở toàn bộ nguồn cùng lúc và không quay lại pipeline hai lượt vốn chậm.
- Tách timeline hình xuống tối đa 96 cảnh, rồi render single-pass theo từng khối 24 cảnh. Cuối cùng concat bằng stream-copy để mỗi frame chỉ được mã hóa đúng một lần.
- Mọi nhánh hiệu ứng/chuyển cảnh phải chuẩn hóa `setsar=1` trước khi ghép để tránh lỗi SAR không đồng nhất.
- Chỉ vô hiệu NVENC khi stderr thực sự báo lỗi NVENC/CUDA. Lỗi filter, nguồn hoặc SAR phải được báo đúng nguyên nhân, không âm thầm chuyển CPU.

### 15. Không được cho nhiều lượt lưu job dùng chung một file tạm

- Triệu chứng: render gần hoàn tất thì Node crash với `ENOENT rename job.json.tmp`, FFmpeg bị kết thúc và MP4 nhiều GB không có `moov atom` nên không thể phát.
- Nguyên nhân: heartbeat và bước cập nhật trạng thái gọi `savePersistentJob` đồng thời, cùng ghi/đổi tên một đường dẫn `job.json.tmp`.
- Cách phòng tránh: tuần tự hóa ghi theo từng job hoặc dùng tên file tạm duy nhất cho mỗi lượt ghi, sau đó atomic rename; lỗi lưu trạng thái nền không được làm chết tiến trình Node.
- Kiểm thử: cố ý gọi nhiều lần lưu song song trong khi render dài, xác nhận backend không crash và MP4 cuối có `moov atom`, đúng Duration, giải mã toàn bộ với exit code 0.

### 16. Hiệu ứng ASS không được tách đôi mã điều khiển

- `\\N` là mã xuống dòng nguyên tử của ASS. Typewriter/Karaoke không được chèn `\\k` giữa dấu gạch chéo và chữ `N`, nếu không video sẽ hiện lệnh kỹ thuật thành chữ.
- Tách nội dung thành token, giữ nguyên `\\N`, chỉ gắn thời lượng karaoke vào ký tự hoặc từ hiển thị.
- Kiểm thử cả chuỗi ASS sinh ra và khung hình thật đúng vị trí từng xảy ra lỗi.

### 17. Benchmark render phải dùng voice dài và toàn bộ hiệu ứng thật

- Không suy ra tốc độ 40 phút từ clip thử vài giây. Phải dùng voice dài, kho tư liệu trên ổ thực tế, phụ đề, overlay, waveform và cấu hình kênh thật.
- Mốc kiểm chứng 11/09/2026: voice 44:42, 560 timestamp, 94 cảnh hình, 238 cue phụ đề, bốn khối single-pass NVENC. Render và xuất mất 16:55; cộng 57 giây Faster-Whisper là 17:52. Quy đổi video 40 phút là khoảng 15:59.
- MP4 đầu ra 1920x1080, SAR 1:1, dài 44:42.20; giải mã đủ 80.463 frame với exit code 0.

### 18. Khôi phục job phải khôi phục cả quyền dùng đường dẫn tư liệu

- Job đã lưu `localPath` nhưng backend mới khởi động có `allowedLocalMedia` rỗng sẽ báo không tìm thấy tư liệu dù file vẫn tồn tại.
- Khi nạp `job.json`, đăng ký lại mọi `asset.localPath` vào danh sách đường dẫn hợp lệ trước khi tự tiếp tục render.

### 19. Mỗi loại sóng âm phải có độ đậm riêng

- Sóng nhạc nền và sóng voice phải có thanh phần trăm độ đậm/độ trong suốt riêng, mặc định 100% để không tự thay đổi cấu hình cũ.
- Giá trị phải được xem trước ngay trên giao diện, lưu theo cấu hình kênh và áp dụng vào alpha của lớp sóng trong cả pipeline single-pass lẫn pipeline dự phòng.

### 20. Typewriter và Karaoke phải có hành vi khác nhau thật sự

- Typewriter không được dùng `\\k` thông thường vì cách đó hiển thị toàn bộ câu rồi đổi màu, tức là Karaoke giả dạng Typewriter.
- Typewriter phải làm ký tự chưa tới lượt hoàn toàn vắng mặt khỏi event hiện tại, sau đó dùng các event tích lũy để hé lộ lần lượt; chỉ đổi alpha hoặc dùng `\\ko` vẫn có thể làm nền lộ trước.
- Karaoke phải hiển thị toàn bộ câu ngay từ đầu bằng màu chữ thường và đổi từng từ đã đọc sang màu nhấn.
- Không chỉ kiểm tra chuỗi ASS: phải render MP4 thật và đối chiếu khung hình ở đầu, giữa, cuối cue cho cả hai hiệu ứng.

### 21. Nền phụ đề phải theo phạm vi chữ thực sự đang hiển thị

- Với Typewriter, hộp nền phải lớn dần theo phần chữ đã xuất hiện; không được lộ sẵn chiều rộng của toàn câu.
- Với Karaoke, Fade, Pop và các hiệu ứng hiển thị sẵn câu, nền phải phủ toàn bộ cụm chữ ngay từ đầu.
- Mỗi preset nền phải có bản xem trước trước khi chọn, lưu theo cấu hình kênh, và render bằng đúng thông số ASS/FFmpeg tương ứng với preview.
- Ưu tiên các nhóm thực dụng đang phổ biến: tương phản bằng box, bán trong suốt, highlight màu nhấn, thẻ sáng, viền/neon và shadow; không đặt tên hiệu ứng mà backend không tái tạo được.
- Chuỗi màu ASS phải được chuẩn hóa đủ tám ký tự alpha-BGR viết hoa; kiểm thử trực tiếp các mức 0%, 50% và 100% để tránh màu/độ trong sai giữa preset.
- `\\ko` có thể ẩn glyph nhưng `BorderStyle=3` vẫn vẽ BackColour trên toàn vùng chữ chưa hiện. Typewriter có nền phải được tạo bằng các event tích lũy nối tiếp (`A` → `AB` → `ABC`), để mỗi event chỉ chứa đúng phần chữ và nền được phép nhìn thấy.
- Với libass, `BorderStyle=3` lấy `OutlineColour` làm màu hộp và `BackColour` chủ yếu làm bóng. Ánh xạ màu preset phải theo hành vi render thật này; không được suy luận từ tên trường ASS.
- Với `BorderStyle=3`, không đặt `Outline=0`: libass có thể vẽ hộp đen mặc định thay vì màu `OutlineColour`. Preset dạng thẻ phải giữ padding tối thiểu 1.

### 22. Vận hành như kỹ sư chịu trách nhiệm toàn bộ pipeline

- Trước mỗi thay đổi hoặc lần chạy sản xuất, phải chủ động kiểm tra toàn chuỗi: đầu vào voice/SRT, ngôn ngữ, timestamp, kho tư liệu, dung lượng ổ đĩa, encoder GPU/CPU, FFmpeg, tiến trình hàng đợi, khả năng tiếp tục sau lỗi và khả năng giải mã MP4 đầu ra.
- Không chỉ sửa lỗi người dùng vừa nhìn thấy. Phải dự đoán lỗi có khả năng xuất hiện ở video dài, chạy hàng loạt, nhiều hiệu ứng, đường dẫn ổ mạng, thiếu file, mất kết nối giao diện và backend khởi động lại.
- Mọi ước lượng tốc độ phải dựa trên bài test gần với cấu hình sản xuất thực tế. Chỉ báo hoàn thành sau khi MP4 render xong, tồn tại đúng nơi, có thời lượng đúng và giải mã toàn bộ với exit code 0.
- Khi có lỗi, phải chỉ rõ công đoạn, nguyên nhân đọc được từ log, phần có thể tiếp tục và phần cần chạy lại; ưu tiên tiếp tục từ checkpoint thay vì làm lại toàn bộ video.

### 23. Xóa hàng đợi phải xóa cả trạng thái bền vững

- Triệu chứng: bấm “Xóa hết” làm danh sách trống, nhưng job/voice cũ xuất hiện lại sau lần đồng bộ backend kế tiếp.
- Nguyên nhân: giao diện chỉ xóa mảng trong trình duyệt, còn `data/runtime-jobs` và bộ nhớ backend vẫn giữ job.
- Cách phòng tránh: nút xóa phải gọi API xóa job, file voice/SRT và checkpoint timestamp trên backend; đồng thời xóa voice đang chọn và giá trị file input trên giao diện.
- Không xóa MP4 đã xuất trong `C:\MatchCut\Exports`. Phải từ chối xóa nếu có job đang nhận dạng hoặc render để tránh phá hỏng tiến trình.

### 24. Preview sóng âm phải tương ứng với FFmpeg thật

- Sóng cỡ lớn cần điều chỉnh độc lập chiều rộng, chiều cao, vị trí, độ đậm và độ dày; cấu hình phải lưu theo kênh.
- Kiểu cầu vồng phải được tạo trong filter graph bằng waveform mask và gradient thật, không chỉ tô CSS ở preview.
- Dùng `showwaves` chế độ `p2p`, thang `sqrt` và `draw=full` để biên độ rõ hơn; dùng dilation có giới hạn để tăng độ dày mà không làm nặng render quá mức.

### 25. Chọn Intro/Outro phải đưa chúng vào file cuối

- Triệu chứng: giao diện nhận file Intro/Outro và persistent job lưu file, nhưng MP4 đầu ra chỉ có phần nội dung.
- Nguyên nhân: cả pipeline single-pass và dự phòng chỉ chuyển file qua request, chưa đưa chúng vào concat cuối.
- Intro phải giữ hình và âm thanh gốc; voice/content chỉ bắt đầu sau khi Intro kết thúc. Outro nối sau khi content kết thúc và giữ âm thanh gốc.
- Để không mã hóa lại video 40 phút, chỉ chuẩn hóa Intro/Outro về cùng kích thước, 30 fps, H.264/AAC 48 kHz stereo rồi nối với content bằng stream-copy. Nếu Intro/Outro không có audio, thêm silence để cấu trúc stream vẫn đồng nhất.

### 26. Kho tư liệu phải tự lưu và tự nạp riêng theo từng kênh

- Chỉ đưa `folderPaths` vào danh sách field của profile là chưa đủ; thao tác chọn/quét folder phải tự snapshot và lưu profile ngay, không phụ thuộc người dùng bấm “Lưu”.
- Khi mở tool hoặc đổi kênh, phải xóa kho đang hiển thị, nạp đường dẫn của đúng kênh rồi tự quét lại trực tiếp từ ổ đĩa.
- Mỗi lượt tự quét mang generation và profile id; kết quả trả chậm của kênh cũ không được ghi đè kho của kênh mới.

### 27. Hàng đợi rỗng không được báo hoàn tất

- Triệu chứng: bấm Chạy khi chưa chọn file hoặc không có item hợp lệ, vòng lặp không chạy nhưng giao diện vẫn ghi “Đã xử lý xong hàng đợi”.
- Trước khi bật trạng thái chạy, phải lọc và xác nhận có ít nhất một item gồm job chưa hoàn tất hoặc voice mới kèm kho tư liệu sẵn sàng. Job đã `completed` không được coi là có thể chạy lại chỉ vì còn `jobId`.
- Chỉ ghi “Đã xử lý xong” khi bộ đếm file thực sự xử lý lớn hơn 0; hàng đợi rỗng và toàn bộ file lỗi phải có thông báo riêng, không được tạo tín hiệu hoàn tất giả.

### 28. File cấu hình kênh phải được lưu bền vững trên máy

- Trình duyệt không được phép tự khôi phục giá trị của `<input type="file">` sau khi tải lại; lưu tên file trong localStorage không làm file khả dụng cho FFmpeg.
- Khi bấm Lưu kênh, Intro, Outro, Overlay/Subscribe, Watermark và nhạc nền phải được chép vào `data/profile-assets/<profileId>` cùng manifest. Giao diện lưu metadata trong profile và hiển thị rõ tên tệp đã lưu.
- Khi tạo job hoặc render thủ công mà người dùng không chọn tệp mới, backend phải tự nạp tài sản đã lưu theo `profileId`. Mỗi job vẫn sao chép tài sản vào thư mục input riêng để job không hỏng nếu cấu hình kênh được thay đổi về sau.
- Khi đổi kênh phải xóa giá trị file input đang tạm chọn để không mang nhầm tệp chưa lưu từ kênh cũ sang kênh mới.

### 29. Chạy hàng loạt phải có tiến độ trực quan theo video hiện tại

- Không chỉ ghi log hoặc phần trăm nhỏ trong danh sách. Bảng tiến độ phải có tên video đang xử lý, vị trí `Video X/Y`, công đoạn hiện tại, phần trăm lớn và thanh tiến độ.
- Dữ liệu hiển thị phải lấy từ `job.progress` và `job.stage` của backend, cập nhật cùng nhịp polling; không dùng thanh chạy giả theo thời gian.
- Khi lỗi, giữ nguyên tên video, phần trăm cuối và công đoạn lỗi. Khi hoàn tất, chỉ hiển thị 100% sau khi backend đã render và kiểm tra MP4.

### 30. Thời gian xử lý phải tính từ lúc người dùng bấm Chạy

- Mốc bắt đầu của từng video là thời điểm người dùng bấm `Chạy 1 file` hoặc `Chạy hàng loạt`, không phải lúc FFmpeg bắt đầu. Với hàng loạt, thời gian chờ của các video sau trong hàng đợi cũng được tính.
- Phải lưu bền vững `startedAt`, `completedAt` và `failedAt` trong job để tải lại giao diện hoặc khởi động lại backend vẫn giữ đúng số liệu.
- Khi đang chạy, thời gian đã chạy phải cập nhật theo đồng hồ thật. Khi hoàn tất hoặc lỗi, đóng băng số liệu và hiển thị giờ kết thúc cùng tổng phút/giây.
- Chỉ ghi nhận hoàn thành sau khi MP4 đã render và vượt qua bước kiểm tra giải mã, không lấy thời điểm FFmpeg mới dừng làm kết quả giả.

### 31. NVENC không có nghĩa toàn bộ pipeline đang chạy trên GPU

- `h264_nvenc` chỉ tăng tốc mã hóa; nếu vẫn dùng `scale`, giải mã mặc định và các filter phần mềm thì CPU vẫn là nút thắt.
- Với footage video, ưu tiên NVDEC/CUDA để giải mã, `scale_cuda` để resize, chỉ `hwdownload` một lần tại ranh giới bắt buộc bởi ASS, waveform hoặc hiệu ứng chưa có CUDA, sau đó mã hóa bằng NVENC.
- Không được bỏ intro/outro, phụ đề, overlay, watermark, waveform hoặc đổi hình thức hiệu ứng để báo tốc độ đẹp. Codec/driver không hỗ trợ CUDA phải tự fallback sang pipeline CPU hiện có và ghi rõ acceleration thực tế vào kết quả.
- Kiểm tra tăng tốc bằng workload thật: GPU decoder/encoder phải hoạt động, file đầu ra phải tăng, thời lượng đúng và giải mã MP4 hoàn chỉnh.

### 32. Nguồn lặp vô hạn phải được chặn thời lượng ngay tại input

- `trim` trong filter graph không bảo đảm FFmpeg ngừng đọc một input dùng `-stream_loop -1`; với nhiều nguồn, scheduler có thể tiếp tục giải mã dù timeline đã đủ hình.
- Mọi video/ảnh lặp trong một khối phải có `-t <thời lượng khối>` đặt trước `-i`. Không chỉ dựa vào `trim`, `concat` hoặc `-shortest` ở output.
- Đồng thời đặt `-t <thời lượng khối>` ở output làm giới hạn cứng; waveform/overlay hoặc nguồn loop có thể khiến `-shortest` không nhận được EOF như mong đợi.
- Với đầu ra 30 fps, thêm giới hạn frame `ceil(duration × 30)`; mốc `-t` có thể chờ frame tiếp theo khi frame cuối nằm ngay trước thời lượng đích.
- Không dùng `-stream_loop -1` cho footage video qua filter graph phức tạp. Probe thời lượng nguồn và đặt số vòng hữu hạn `ceil(thời lượng khối / thời lượng nguồn) - 1` để vẫn lặp đủ hình nhưng bảo đảm input phát EOF.
- Không lặp từng nguồn theo toàn bộ thời lượng khối. Mỗi nguồn chỉ cần lặp tới cảnh dài nhất sử dụng nguồn đó; scale một lần ở nhánh gốc rồi mới `split`, tránh giải mã và resize dư hàng chục lần.
- Probe metadata từ ổ mạng phải chạy song song có giới hạn và cache Promise theo đường dẫn cho toàn bộ phiên backend; không probe tuần tự lại cùng footage ở từng khối.
- Dùng bài test 3 giây để chặn hồi quy: tiến trình phải tự thoát, encoder phải tạo trailer MP4 và toàn bộ file phải giải mã được.
- Với waveform, nguồn `color`/`gradients` là vô hạn. `alphamerge` bắt buộc dùng `shortest=1`; nếu không nó giữ frame mask cuối và khiến render không bao giờ nhận EOF.

### 33. Lời thoại phải tự lưu theo kênh và có lịch sử trước khi Whisper ghi đè

- Nội dung ô lời thoại là dữ liệu người dùng, không được chỉ giữ trong DOM vì tải lại trang, đóng tool hoặc đổi cấu hình sẽ làm mất.
- Mỗi cấu hình kênh phải có bản nháp riêng, lưu ngay ở `localStorage` và đồng bộ vào `data/project-state.json`; khi hai bản khác nhau phải giữ bản có `updatedAt` mới hơn.
- Trước khi áp dụng kết quả Whisper, phải chụp bản hiện tại vào lịch sử khôi phục. Nút khôi phục phải đổi chỗ an toàn giữa bản hiện tại và bản trước để người dùng có thể hoàn tác cả thao tác khôi phục.
- Kiểm thử bắt buộc: tải lại trang, đổi qua lại hai kênh, đóng/mở tool, và xác nhận bản trước Whisper vẫn khôi phục được.
