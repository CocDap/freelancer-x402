# Thiết kế: Công cụ thuê freelancer viết content — AI search + x402 + escrow trên Avalanche

Ngày: 2026-11-03 · Trạng thái: bản nháp chờ duyệt

## 1. Mục đích và lý do

Người dùng (chủ dự án) thường thuê freelancer viết content qua mạng xã hội. Hai nỗi đau:

1. **Tìm người tốn thời gian** — quá nhiều freelancer, lọc tay chậm.
2. **Mất cọc** — trả cọc trước, một số freelancer nhận tiền rồi không làm, không đòi lại được.

Giải pháp:

- **Agent AI** tìm freelancer trên X, LinkedIn, Threads; trả phí cho các tool search theo từng lần gọi bằng **x402** (USDC), không cần đăng ký hay giữ API key cho từng nhà cung cấp.
- **Escrow on-chain** trên Avalanche thay cho cọc: tiền bị khoá trong smart contract. Freelancer thấy được tiền thật, nhưng chỉ nhận khi giao bài. Không giao thì tiền về lại người thuê.

**Thành công nghĩa là:** tìm được danh sách ứng viên phù hợp trong vài phút thay vì vài giờ, và không bao giờ mất tiền cọc cho người bỏ việc.

## 2. Mục tiêu, ngoài phạm vi, điều không được xảy ra

**Mục tiêu (v1)**
- Một người dùng duy nhất (chủ dự án). Đăng nhập bằng username + mật khẩu.
- Agent AI tìm freelancer viết content từ X, LinkedIn, Threads và trả về danh sách ngắn có lý do.
- Escrow USDC trên Avalanche **Fuji testnet**. Người thuê **không** cần kết nối ví và **không** trả gas.
- Người thuê tự duyệt bài.

**Ngoài phạm vi (v1)**
- Nhiều người thuê, freelancer tự đăng ký, hồ sơ freelancer, chấm điểm uy tín.
- AI chấm bài, AI viết thay.
- Trọng tài hoặc giải quyết tranh chấp, thanh toán theo nhiều mốc (milestone).
- Mainnet và tiền thật.
- Nhắn tin với freelancer bên trong app. Liên hệ vẫn qua mạng xã hội.

**Điều không được xảy ra (sai dù vẫn "chạy được")**
- Người thuê mất tiền khi freelancer không nộp bài trước hạn.
- Freelancer đã nộp bài mà người thuê có thể rút tiền về. Nếu vậy escrow vô nghĩa với freelancer.
- Agent tiêu USDC vượt giới hạn chi tiêu, hoặc trả tiền cho một network hay token không được phép.
- Private key nằm dạng plaintext trong DB, log, hoặc gửi xuống client.
- Hardcode nhà cung cấp LLM hoặc search. Mọi thứ cấu hình qua `.env`.

## 3. Ràng buộc (người dùng đã quyết)

- **Ngôn ngữ / framework:** TypeScript, Next.js (App Router).
- **LLM:** API bên thứ 3, không chính thức, theo chuẩn OpenAI-compatible. Phải đổi được giữa DeepSeek, Claude, Gemini chỉ qua cấu hình. Người dùng tự điền `baseURL`, key, tên model vào `.env`. Không gắn với nhà cung cấp cụ thể nào.
- **Nguồn tìm freelancer:** X, LinkedIn, Threads.
- **Đăng nhập:** username + mật khẩu, không kết nối ví. Phải gasless.
- **Duyệt bài:** người thuê tự duyệt.
- **Mọi secret** để trong `.env.example` cho người dùng tự điền.

## 4. Luồng sử dụng

1. **Đăng nhập** bằng username + mật khẩu.
2. **Mô tả việc cần viết:** chủ đề hoặc lĩnh vực, loại content, ngôn ngữ, giọng văn, ngân sách, hạn nộp.
3. **Agent tìm kiếm:** sinh truy vấn, gọi các tool search (trả phí qua x402 nếu tool yêu cầu), gom kết quả từ X / LinkedIn / Threads, loại trùng, xếp hạng. Trả về khoảng 5–10 ứng viên, mỗi người có: tên hoặc handle, link hồ sơ, link bài mẫu nếu có, lý do phù hợp, dấu hiệu rủi ro. Hiển thị số USDC đã tiêu cho lần tìm này.
4. **Người thuê liên hệ** ứng viên ngoài app, chốt giá, hạn nộp, và xin địa chỉ ví của freelancer.
5. **Tạo job escrow:** nhập địa chỉ ví freelancer, số USDC, hạn nộp, link tới ứng viên đã chọn (không bắt buộc). Server khoá USDC vào contract. App sinh một **link công khai của job** để gửi cho freelancer.
6. **Freelancer** mở link: thấy số tiền đã khoá (kèm link Snowtrace), và nộp bài bằng cách dán link bài + ký xác nhận bằng ví của họ.
7. **Người thuê duyệt:** bấm **Duyệt** (tiền chuyển cho freelancer) hoặc **Yêu cầu sửa** (kèm ghi chú).
8. **Các nhánh thời gian** (quá hạn nộp, quá hạn duyệt, không nộp lại bản sửa): xem bảng trạng thái ở mục 5.5.

## 5. Kiến trúc

### 5.1 Web app (Next.js)
- Các trang: đăng nhập; tìm kiếm (form mô tả + kết quả); danh sách job; chi tiết job (tạo escrow, trạng thái, duyệt / yêu cầu sửa / hoàn tiền); ví (địa chỉ, số dư USDC và AVAX, link faucet Fuji); trang công khai `/j/[jobId]` cho freelancer.
- Toàn bộ thao tác ký và gửi giao dịch của người thuê chạy **phía server**. Client không bao giờ nhận private key.

### 5.2 Agent AI
- Dùng Vercel AI SDK + `@ai-sdk/openai-compatible`. Đọc `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` từ `.env`.
- Vòng lặp agent có tool-calling. Các tool:
  - `search_x`, `search_linkedin`, `search_threads`: gọi tới nhà cung cấp search đã cấu hình.
  - `fetch_profile`: đọc một trang công khai để xác minh portfolio (không bắt buộc).
- Đầu ra cuối có cấu trúc rõ ràng (schema JSON) để render danh sách ứng viên.

### 5.3 Lớp search + x402 (người dùng đã quyết: tự dựng proxy x402 trên Fuji)
Bối cảnh: các dịch vụ search X thu phí qua x402 hiện chạy trên Base mainnet bằng tiền thật. Chưa có dịch vụ x402 cho LinkedIn hoặc Threads. Vì v1 chỉ chạy testnet, app **tự dựng một search proxy thu phí x402 trên Avalanche Fuji**.

- **Phía bán (proxy):** các route `/api/x402/search/[source]` với `source` là `x` | `linkedin` | `threads`, chạy ngay trong cùng app Next.js.
  - Route được bảo vệ bằng middleware x402 (`x402-next` hoặc tương đương). Network `avalanche-fuji`, token USDC Fuji, giá mỗi lần gọi lấy từ `X402_PRICE_PER_CALL_USDC`, địa chỉ nhận tiền `X402_PAY_TO`.
  - Facilitator cấu hình qua `X402_FACILITATOR_URL`. Ứng viên đã kiểm tra là có hỗ trợ Fuji: thirdweb, PayAI, hoặc tự host x402-rs.
  - Sau khi nhận được thanh toán, proxy gọi provider search thật bằng **API key** (`SEARCH_*`). Với LinkedIn và Threads có thể dùng web search kèm `site:linkedin.com/in`, `site:threads.net`.
- **Phía mua (agent):** các tool `search_*` gọi proxy qua client x402 (`x402-fetch` hoặc tương đương). Client tự xử lý `402 Payment Required`, ký EIP-3009 bằng ví người thuê, rồi gửi lại request. Facilitator trả gas, nên agent gasless.
- Client x402 **chỉ chấp nhận** network `avalanche-fuji` và đúng địa chỉ USDC đã cấu hình.
- **Giới hạn chi tiêu bắt buộc:** `X402_MAX_PER_CALL_USDC` và `X402_MAX_PER_SEARCH_USDC`. Vượt giới hạn thì dừng, không trả. Mọi lần trả đều ghi log: endpoint, số tiền, tx hash.
- Thêm một nhà cung cấp x402 bên ngoài sau này chỉ cần trỏ `search_*` sang URL khác, không cần sửa agent.

### 5.4 Ví và gasless
- **Ví người thuê:** một EOA do server tạo khi đăng ký. Private key mã hoá bằng AES-256-GCM với master key `WALLET_ENCRYPTION_KEY` lấy từ `.env`, rồi lưu trong DB.
- **Ví agent (x402):** dùng chính ví người thuê, vì v1 chỉ có một người dùng. Ví chỉ cần USDC trên Fuji.
- **Gasless, cách v1 làm:** dùng **relayer** thay vì ERC-4337.
  - Một ví relayer (`RELAYER_PRIVATE_KEY`, có sẵn AVAX Fuji) gửi mọi giao dịch và trả gas.
  - Ví người thuê chỉ **ký** các thông điệp EIP-712 (EIP-3009 `receiveWithAuthorization` để nạp USDC, cùng các lệnh duyệt / yêu cầu sửa / hoàn tiền). Contract tự kiểm tra chữ ký.
  - Bản thân x402 đã gasless sẵn cho bên trả tiền (EIP-3009, facilitator trả gas).
  - Lý do chọn relayer: không phụ thuộc nhà cung cấp bundler/paymaster. Chưa xác nhận được paymaster nào hỗ trợ Fuji một cách chắc chắn.
- **Freelancer cũng gasless:** trên trang `/j/[jobId]`, freelancer kết nối ví của họ (bằng `wagmi`) và ký EIP-712 "đã nộp bài" (kèm hash của link bài). Relayer gửi giao dịch hộ.

### 5.5 Smart contract escrow (Solidity, Foundry)
Một contract quản lý nhiều job. Token: USDC trên Fuji `0x5425890298aed601595a70AB815c96711a31Bc65` (cấu hình được).

Dữ liệu mỗi job: `buyer`, `freelancer`, `amount`, `deliverDeadline`, `reviewWindow` (mặc định 7 ngày), `revisionWindow` (mặc định 3 ngày), `maxRevisions` (mặc định 2), `submittedAt`, `revisionDeadline`, `revisionCount`, `state`, `contentHash`. Ba tham số thời gian và số lần sửa được **cố định lúc tạo job** và hiển thị trên trang công khai, để freelancer biết luật chơi trước khi nhận việc.

| Trạng thái | Hành động | Ai | Kết quả |
|---|---|---|---|
| — | `createJob` (nạp USDC qua EIP-3009) | người thuê (ký) | `Funded` |
| `Funded` | `submit(contentHash)` trước `deliverDeadline` | freelancer (ký) | `Submitted`, ghi `submittedAt` |
| `Funded` | `refund` sau `deliverDeadline` | người thuê (ký) | `Refunded`: 100% về người thuê |
| `Funded` | `decline` (từ chối nhận việc) | freelancer (ký) | `Refunded`: 100% về người thuê |
| `Submitted` | `approve` | người thuê (ký) | `Released`: 100% về freelancer |
| `Submitted` | `requestRevision`, khi `revisionCount < maxRevisions` | người thuê (ký) | `RevisionRequested`, `revisionDeadline` = bây giờ + `revisionWindow`, `revisionCount++` |
| `Submitted` | `claim` sau `submittedAt + reviewWindow` | **bất kỳ ai** | `Released`: 100% về freelancer |
| `RevisionRequested` | `submit(contentHash)` trước `revisionDeadline` | freelancer (ký) | `Submitted`, `submittedAt` mới |
| `RevisionRequested` | `settleSplit` sau `revisionDeadline` | **bất kỳ ai** | `Split`: 50% về người thuê, 50% về freelancer |

Quy tắc cốt lõi:
- **Đã nộp bài thì người thuê không thể lấy lại 100%.** Sau khi freelancer nộp, chỉ có thể kết thúc theo một trong ba cách: duyệt, quá hạn duyệt thì freelancer nhận hết, hoặc freelancer không nộp lại bản sửa thì **chia đôi 50/50**. Đây là quyết định của người dùng. Lý do: không bên nào lạm dụng được nút "yêu cầu sửa".
- **Làm tròn khi chia:** người thuê nhận `amount / 2`, freelancer nhận phần còn lại, tức phần lẻ 1 đơn vị nhỏ nhất thuộc về freelancer.
- Hết `maxRevisions` thì không yêu cầu sửa được nữa. Người thuê chỉ còn hai cách: duyệt, hoặc chờ hết hạn duyệt.
- `claim` và `settleSplit` cho phép **bất kỳ ai** gọi, nên không phụ thuộc server của app.
- **Không dùng cron** (người dùng quyết). Thay vào đó:
  - Trang chi tiết job và trang `/j/[jobId]` hiện nút "Hoàn tất" khi đã quá hạn. Bấm vào thì relayer gửi `claim` hoặc `settleSplit`.
  - Freelancer cũng có thể tự gọi trực tiếp contract qua Snowtrace.
- **Rủi ro chấp nhận ở v1:** freelancer nộp bài kém liên tục đến hết số lần sửa thì người thuê vẫn mất tiền. Chưa có trọng tài.
- Có chống replay (nonce + deadline trong chữ ký EIP-712). Có test Foundry cho mọi ô trong bảng trên, kể cả các trường hợp sai trạng thái và sai người ký.

### 5.6 Dữ liệu
DB lưu: user (username, hash mật khẩu argon2/bcrypt, địa chỉ ví, private key đã mã hoá), các lần tìm kiếm (mô tả, ứng viên, chi phí), log thanh toán x402, job (id on-chain, freelancer, link ứng viên, tx hash). Trạng thái trên chain là nguồn sự thật: app đọc trạng thái job từ contract, không tin vào bản sao trong DB.

### 5.7 Triển khai (người dùng đã quyết: Vercel + SQLite, không cron)
- Deploy lên Vercel để freelancer mở được link `/j/[jobId]` từ internet.
- **Lưu ý kỹ thuật:** file SQLite **không tồn tại lâu** trên Vercel, vì filesystem của serverless function bị xoá giữa các lần chạy. Vì vậy dùng **libSQL / Turso**: tương thích SQLite, có bản hosted chạy được trên Vercel. Khi chạy local, `DATABASE_URL=file:local.db`. Trên Vercel, trỏ sang Turso. Code giống nhau (Drizzle + `@libsql/client`).
- Mọi key (`RELAYER_PRIVATE_KEY`, `WALLET_ENCRYPTION_KEY`, …) đặt trong Environment Variables của Vercel, đánh dấu Sensitive.

## 6. Mặc định đã chọn (người dùng có thể đổi)
- Thời gian duyệt 7 ngày, thời gian sửa 3 ngày, tối đa 2 lần sửa. Người thuê chỉnh được khi tạo job.
- Bắt đầu trên Fuji với USDC test (faucet Circle).
- Relayer + EIP-712 thay cho ERC-4337.
- Ví custodial do server giữ.
- Trước khi nộp bài, chỉ freelancer được huỷ (`decline`). Người thuê không huỷ đơn phương được trước hạn nộp.
- Giá search proxy mặc định là 0.01 USDC test mỗi lần gọi.

## 7. Bảo mật
Đây là mô hình **custodial**: ai chiếm được server, file `.env` hoặc mật khẩu đăng nhập là rút được tiền. Chấp nhận được cho công cụ cá nhân chạy testnet. Trước khi lên mainnet bắt buộc phải có: 2FA, giới hạn số tiền mỗi job và mỗi ngày, cách sao lưu và khôi phục key, và audit contract.

## 8. `.env.example` (người dùng tự điền)
```
# LLM (OpenAI-compatible, nhà cung cấp tuỳ ý)
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=

# Search providers phía sau proxy x402 (dùng API key)
SEARCH_X_URL=
SEARCH_X_API_KEY=
SEARCH_LINKEDIN_URL=
SEARCH_LINKEDIN_API_KEY=
SEARCH_THREADS_URL=
SEARCH_THREADS_API_KEY=

# x402 — phía bán (proxy)
X402_FACILITATOR_URL=
X402_PAY_TO=
X402_PRICE_PER_CALL_USDC=0.01

# x402 — phía mua (agent)
X402_MAX_PER_CALL_USDC=0.05
X402_MAX_PER_SEARCH_USDC=0.50

# Chain (Avalanche Fuji)
AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
USDC_ADDRESS=0x5425890298aed601595a70AB815c96711a31Bc65
ESCROW_ADDRESS=
RELAYER_PRIVATE_KEY=

# App
APP_URL=
WALLET_ENCRYPTION_KEY=          # 32 bytes, base64
AUTH_SECRET=
DATABASE_URL=file:local.db      # trên Vercel: libsql://<db>.turso.io
DATABASE_AUTH_TOKEN=
```

## 9. Để người build tự quyết
- Thư viện auth (Auth.js hoặc better-auth).
- Thư viện UI. Cấu trúc thư mục, dạng monorepo hoặc một repo Next.js kèm thư mục `contracts/`.
- Prompt cho agent, cách xếp hạng ứng viên, số vòng gọi tool tối đa.
- Chọn facilitator x402 cụ thể nào trong số những cái hỗ trợ Fuji.
- Provider search cụ thể đứng sau proxy.
- Format của các adapter search, miễn là thêm một provider mới chỉ cần sửa `.env` và một adapter mỏng.
