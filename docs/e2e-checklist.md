# Checklist kiểm thử end-to-end (Fuji)

Chuẩn bị: contract đã deploy, env đã điền, `pnpm db:migrate` đã chạy, ví relayer có AVAX Fuji, app chạy (`pnpm dev` hoặc URL Vercel). Chuẩn bị thêm một ví thứ hai (MetaMask/Core) làm freelancer, có kết nối mạng Fuji; ví này không cần AVAX (gas do relayer trả).

Snowtrace: https://testnet.snowtrace.io (tìm theo hash giao dịch hoặc địa chỉ).

## Về cửa sổ thời gian ngắn

- Contract yêu cầu `reviewWindow` và `revisionWindow` tối thiểu 60 giây (`MIN_WINDOW = 60`), và hạn nộp phải nằm trong tương lai.
- Form `/jobs/new` có `Số ngày duyệt` / `Số ngày sửa` với `type="number" min="1" step="1"`, nên trình duyệt chỉ cho số nguyên (tối thiểu 1 ngày). Phía server thì nhận số ngày thập phân dương và quy ra giây, miễn là >= 60 giây.
- Cách có cửa sổ ngắn trên Fuji: mở DevTools, trong tab Elements xoá thuộc tính `min` và `step` của hai ô số ngày, rồi nhập `0.001` (= 86,4 giây). Hạn nộp (`datetime-local`) chọn khoảng 2-3 phút sau thời điểm hiện tại (nhớ cho kịp bước khoá tiền).
- Không thể tua thời gian trên Fuji. Nếu không muốn sửa DOM, chạy các kịch bản thời gian trên anvil bằng `cast rpc evm_increaseTime` (xem README, mục "Chạy local"), còn trên Fuji chỉ test nhánh duyệt (không cần chờ) với số ngày mặc định.

## 1. Đăng ký và nạp USDC

- [ ] Vào `/signup`, tạo tài khoản (username/password), đăng nhập.
- [ ] Vào trang Ví (`/wallet`), copy địa chỉ ví người thuê.
- [ ] Xin USDC Fuji ở https://faucet.circle.com/ (Avalanche Fuji) về địa chỉ đó.
- Kỳ vọng: số dư USDC trên trang Ví tăng; số dư AVAX = 0 vẫn bình thường; relayer không bị cảnh báo thiếu AVAX.
- Kiểm tra: trang Ví, và địa chỉ ví trên Snowtrace (token transfer USDC).

## 2. Tìm kiếm có trả tiền x402

- [ ] Vào `/search`, nhập mô tả (ví dụ "freelance copywriter viết bài về crypto") và tìm.
- Kỳ vọng: có danh sách ứng viên kèm link hồ sơ; hiển thị số USDC đã tiêu (không vượt `X402_MAX_PER_SEARCH_USDC`); có link tx.
- Kiểm tra: mở tx trên Snowtrace, thấy chuyển USDC từ ví người thuê tới `X402_PAY_TO`; số dư USDC trên trang Ví giảm đúng bằng số đã tiêu.

## 3. Job 1: duyệt và trả tiền (nhánh vui)

- [ ] Từ một ứng viên bấm tạo job, hoặc vào `/jobs/new`. Nhập địa chỉ ví freelancer (ví thứ hai), số tiền (ví dụ 1 USDC), hạn nộp ở tương lai, số ngày duyệt/sửa mặc định, số lần sửa 2. Bấm "Khoá tiền".
- Kỳ vọng: người thuê không tốn AVAX; job ở trạng thái đã khoá tiền; có "Giao dịch tạo job" link Snowtrace; số dư USDC của người thuê giảm đúng số tiền khoá.
- Kiểm tra: trang `/jobs/<id>` và tx trên Snowtrace (USDC chuyển vào contract escrow, gas trả bởi relayer, `from` là relayer).
- [ ] Mở "Link công khai" (`/j/<jobId>`) bằng ví freelancer (kết nối ví, đúng mạng Fuji). Điền link bài và bấm "Nộp bài" (ký tin nhắn, không tốn gas).
- Kỳ vọng: trạng thái chuyển sang Submitted; trang job của người thuê hiện "Nộp bài lúc" và link bài.
- [ ] Người thuê bấm "Duyệt".
- Kỳ vọng: trạng thái Released; ví freelancer nhận 100% số tiền.
- Kiểm tra: số dư USDC của ví freelancer trên Snowtrace; trạng thái job trên trang.

## 4. Job 2: quá hạn mà không nộp, hoàn tiền

- [ ] Tạo job nhỏ (ví dụ 0,5 USDC) với hạn nộp khoảng 2 phút sau. Freelancer không làm gì.
- [ ] Sau khi quá hạn, người thuê bấm "Hoàn tiền".
- Kỳ vọng: trạng thái Refunded; 100% USDC quay lại ví người thuê.
- Kiểm tra: trang job, số dư ví, tx trên Snowtrace. Bấm trước hạn thì phải bị từ chối.

## 5. Job 3: yêu cầu sửa, freelancer không nộp lại, chia 50/50

- [ ] Tạo job (hạn nộp xa hơn một chút, số ngày duyệt/sửa nhỏ như mục "cửa sổ ngắn", ví dụ 0,001 ngày). Freelancer nộp bài.
- [ ] Trong cửa sổ duyệt, người thuê bấm "Yêu cầu sửa".
- Kỳ vọng: trạng thái RevisionRequested; trang hiện "Hạn sửa" và số lần sửa 1/N.
- [ ] Freelancer không nộp lại. Chờ hết "Hạn sửa", rồi bấm "Hoàn tất".
- Kỳ vọng: trạng thái Settled; tiền chia 50/50 giữa người thuê và freelancer.
- Kiểm tra: số dư hai ví trên Snowtrace.

## 6. Job 4: nộp bài, người thuê im lặng, freelancer bấm "Hoàn tất"

- [ ] Tạo job với số ngày duyệt nhỏ (0,001 ngày). Freelancer nộp bài. Người thuê không làm gì.
- [ ] Sau khi hết "Hạn duyệt", freelancer (ở `/j/<jobId>`) bấm "Hoàn tất".
- Kỳ vọng: trạng thái Released; freelancer nhận 100%. Bấm trước hạn duyệt thì bị từ chối.
- Kiểm tra: số dư ví freelancer, tx trên Snowtrace.

## Kiểm tra chéo cuối buổi

- [ ] Số dư relayer giảm do gas; người thuê và freelancer không bị trừ AVAX.
- [ ] Ghi lại các tx hash vào ghi chú kết quả test (không ghi secret).

## Chạy lại trên URL Vercel

- [ ] Đã chạy `pnpm db:migrate` lên Turso với `DATABASE_URL` / `DATABASE_AUTH_TOKEN` của Turso.
- [ ] Mọi env đã có trên Vercel (Sensitive cho secret); `APP_URL` là URL Vercel; deploy lại sau khi sửa env.
- [ ] Lặp lại mục 1 (đăng ký) và 2 (tìm kiếm). Nếu tìm kiếm bị cắt giữa chừng, kiểm tra giới hạn thời lượng hàm của gói Vercel (`/search` đặt 300 giây).
- [ ] Lặp lại mục 3 (job nhánh vui) và ít nhất một nhánh thời gian (mục 4 hoặc 6).
- [ ] Xác nhận dữ liệu còn sau khi redeploy (đang ở Turso, không phải file local).
