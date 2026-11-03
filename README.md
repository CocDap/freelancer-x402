# dapp-avax: thuê freelancer viết bài bằng USDC trên Avalanche Fuji

Người thuê đăng ký và đăng nhập bằng username/password, mỗi tài khoản một ví riêng. Một AI agent tìm freelancer viết bài (X, LinkedIn, Threads) qua proxy tìm kiếm của chính app, mỗi lần gọi trả bằng USDC theo giao thức x402. Người thuê chốt ứng viên rồi khoá tiền vào hợp đồng escrow USDC. Mọi gas do ví relayer của hệ thống trả, nên người thuê và freelancer không cần AVAX.

> Chỉ dùng cho testnet (Avalanche Fuji, chain id 43113). Đây là demo, không phải sản phẩm để giữ tiền thật.

## Kiến trúc

- Next.js (App Router) + better-auth. Mỗi người dùng có một ví custodial; private key được mã hoá bằng `WALLET_ENCRYPTION_KEY` rồi lưu trong DB.
- Relayer: một ví EOA (`RELAYER_PRIVATE_KEY`) gửi mọi giao dịch và trả gas. Người thuê và freelancer chỉ ký EIP-712 / EIP-3009 (USDC `receiveWithAuthorization`).
- `FreelanceEscrow` (thư mục `contracts/`, Foundry) trên Fuji: nhiều job, không có owner/admin. Các nhánh: duyệt (100% cho freelancer), quá hạn không nộp (hoàn tiền), yêu cầu sửa rồi không nộp lại (chia 50/50), nộp rồi người thuê im lặng (freelancer bấm "Hoàn tất").
- Proxy tìm kiếm x402 (`/api/x402/search/[source]`): trả HTTP 402, thu USDC qua facilitator, rồi gọi Tavily. Agent gọi proxy này bằng một `fetch` tự trả tiền có ngân sách (trần mỗi lần gọi và mỗi lượt tìm).
- Agent AI chạy qua bất kỳ API tương thích OpenAI nào (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`).
- DB: SQLite file khi chạy local, Turso (libSQL) khi lên Vercel. ORM: drizzle.

## Yêu cầu

- Node.js 20+ và pnpm 10 (`corepack enable`).
- Foundry (`forge`, `cast`, `anvil`): https://book.getfoundry.sh/getting-started/installation
- Tài khoản: nhà cung cấp LLM, Tavily, Turso và Vercel (cho phần deploy).

## Cài đặt

```sh
pnpm install
```

Mẫu biến môi trường (kèm chú thích từng key) nằm trong [`docs/env-template.md`](docs/env-template.md): sao chép nội dung vào file env của bạn (không commit), rồi tự điền giá trị. Đừng dán secret vào chat hay vào file được commit.

Lưu ý: `pnpm db:migrate` đọc `DATABASE_URL` (và `DATABASE_AUTH_TOKEN`) từ biến môi trường của shell, không đọc từ file env của Next. Khi migrate, hãy export các biến này trong shell (xem phần Turso bên dưới).

Log của server có thể in ra `AVALANCHE_RPC_URL` khi có lỗi RPC. Nếu log được chia sẻ, đừng dùng RPC URL có nhúng sẵn API key.

### Các biến môi trường

Tất cả đều bắt buộc (trừ `DATABASE_AUTH_TOKEN`). Mã nguồn không có giá trị mặc định cho key nào; các giá trị ghi "giá trị gợi ý" chỉ là đề xuất. Cột "Secret" = phải giữ kín và đánh dấu Sensitive trên Vercel.

| Key | Secret | Mô tả |
| --- | --- | --- |
| `LLM_BASE_URL` | không | Base URL của API tương thích OpenAI, ví dụ `https://api.openai.com/v1`. |
| `LLM_API_KEY` | có | API key của nhà cung cấp LLM. |
| `LLM_MODEL` | không | Tên model, ví dụ `gpt-4o-mini`. |
| `SEARCH_PROVIDER` | không | Provider tìm kiếm; hiện chỉ có `tavily`. |
| `SEARCH_API_KEY` | có | API key Tavily, dùng chung cho cả ba nguồn. |
| `X402_FACILITATOR_URL` | không | URL facilitator x402 (giá trị gợi ý: `https://facilitator.payai.network`). |
| `X402_NETWORK` | không | Mạng x402 dạng CAIP-2; Fuji là `eip155:43113`. |
| `X402_PAY_TO` | không | Địa chỉ ví 0x nhận USDC từ proxy tìm kiếm. |
| `X402_PRICE_PER_CALL_USDC` | không | Giá mỗi lần gọi proxy (USDC), giá trị gợi ý `0.01`. |
| `X402_MAX_PER_CALL_USDC` | không | Trần agent chịu trả cho một lần gọi (USDC), giá trị gợi ý `0.05`. |
| `X402_MAX_PER_SEARCH_USDC` | không | Trần tổng chi cho một lượt tìm kiếm (USDC), giá trị gợi ý `0.50`. |
| `AVALANCHE_RPC_URL` | không | RPC Fuji C-Chain, giá trị gợi ý `https://api.avax-test.network/ext/bc/C/rpc`. |
| `USDC_ADDRESS` | không | USDC trên Fuji: `0x5425890298aed601595a70AB815c96711a31Bc65`. |
| `ESCROW_ADDRESS` | không | Địa chỉ `FreelanceEscrow` sau khi deploy. |
| `RELAYER_PRIVATE_KEY` | có | Private key (0x + 64 hex) của ví relayer trả gas. |
| `RELAYER_MIN_AVAX` | không | Số AVAX tối thiểu của relayer; thấp hơn thì app từ chối gửi giao dịch (không chỉ cảnh báo), giá trị gợi ý `0.05`. |
| `WELCOME_GRANT_USDC` | không | USDC relayer tặng ví mới (mặc định `0.3`, `0` = tắt). Mỗi ví một lần và mỗi IP một lần, dù IP đó tạo nhiều tài khoản. Relayer phải có USDC; thiếu thì bỏ qua và trang Ví thử lại sau. |
| `APP_URL` | không | URL gốc của app, ví dụ `http://localhost:3000` hoặc URL Vercel. |
| `WALLET_ENCRYPTION_KEY` | có | 32 byte base64 để mã hoá key ví người dùng: `openssl rand -base64 32`. |
| `AUTH_SECRET` | có | Secret cho better-auth: `openssl rand -base64 32`. |
| `DATABASE_URL` | có | `file:local.db` khi local; `libsql://<db>.turso.io` trên Vercel. |
| `DATABASE_AUTH_TOKEN` | có | Token Turso; để trống khi dùng file local. |

## Tạo khoá và ví

```sh
# Ví relayer (trả gas). Lưu private key vào RELAYER_PRIVATE_KEY, nạp AVAX Fuji vào địa chỉ này.
cast wallet new

# Ví deployer (chỉ để deploy contract). Key được mã hoá trong keystore của Foundry, hỏi mật khẩu khi nhập.
cast wallet import deployer --interactive

# Khoá mã hoá ví và secret đăng nhập
openssl rand -base64 32   # WALLET_ENCRYPTION_KEY
openssl rand -base64 32   # AUTH_SECRET
```

Escrow không có owner nên ví nào có AVAX Fuji cũng deploy được; có thể dùng luôn ví relayer, nhưng nên tách deployer riêng cho gọn.

## Faucet

- AVAX Fuji (cho relayer và deployer): https://core.app/tools/testnet-faucet/
- USDC Fuji (cho ví người thuê, và để thử x402): https://faucet.circle.com/ (chọn Avalanche Fuji). Địa chỉ ví người thuê hiện ở trang Ví của app.

Ví người thuê chỉ cần USDC, không cần AVAX. Ví relayer phải luôn có AVAX, và cần thêm USDC nếu bật quà chào mừng (`WELCOME_GRANT_USDC`).

## Chạy local

Chỉ phần job/escrow chạy được hoàn toàn trên anvil. Tìm kiếm x402 cần facilitator hỗ trợ chain bạn dùng; facilitator công khai không hỗ trợ chain 31337, nên thử tìm kiếm thật phải chạy trên Fuji.

Chạy nhanh trên Fuji (sau khi đã deploy contract và điền env):

```sh
pnpm db:migrate   # tạo bảng trong local.db (DATABASE_URL=file:local.db)
pnpm dev          # http://localhost:3000
```

Chạy với anvil (cổng 8546 giống bộ test; anvil chain id 31337):

```sh
anvil --port 8546
cd contracts
# USDC_ADDRESS trống + chain 31337 => script tự deploy MockUSDC (chỉ cho phép trên chain local)
USDC_ADDRESS= forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8546 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
# key trên là key dev công khai của anvil, KHÔNG dùng trên mạng thật

# Cấp MockUSDC (mint mở, 6 decimals) cho ví người thuê: 100 USDC
cast send <USDC_ADDRESS> "mint(address,uint256)" <ĐỊA_CHỈ_VÍ> 100000000 \
  --rpc-url http://127.0.0.1:8546 --private-key 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
```

Điền `AVALANCHE_RPC_URL=http://127.0.0.1:8546`, `USDC_ADDRESS`, `ESCROW_ADDRESS` từ output của script. Muốn thử mốc thời gian, dùng `cast rpc evm_increaseTime <giây>` rồi `cast rpc evm_mine`.

Trên chain khác 31337 mà `USDC_ADDRESS` trống, script sẽ revert (không bao giờ deploy MockUSDC lên mạng công khai).

Kiểm thử:

```sh
pnpm test             # vitest, tự bật anvil :8546 và deploy contract
pnpm test:contracts   # forge test
pnpm lint
pnpm exec tsc --noEmit
```

## Deploy (các bước bạn tự chạy)

Các lệnh dưới đây cần khoá và tài khoản của bạn nên không được tự động hoá.

### 1. Contract lên Fuji

Ví deployer cần ít AVAX Fuji (xin ở faucet Core).

```sh
cast wallet import deployer --interactive
cd contracts
USDC_ADDRESS=0x5425890298aed601595a70AB815c96711a31Bc65 \
forge script script/Deploy.s.sol \
  --rpc-url https://api.avax-test.network/ext/bc/C/rpc \
  --account deployer --broadcast
```

Copy dòng `ESCROW_ADDRESS=0x...` trong output vào env (`ESCROW_ADDRESS`). Kiểm tra địa chỉ trên https://testnet.snowtrace.io. Domain EIP-712 của USDC Fuji đã được đối chiếu: `name()` = "USD Coin", `version()` = "2" (app cũng đọc giá trị này lúc chạy).

### 2. Turso

```sh
turso db create dapp-avax
turso db show dapp-avax --url            # => DATABASE_URL (libsql://...)
turso db tokens create dapp-avax         # => DATABASE_AUTH_TOKEN
DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... pnpm db:migrate
```

Lưu ý: token Turso là secret. Gõ thẳng vào lệnh sẽ lưu vào lịch sử shell. Hãy export nó từ nguồn được bảo vệ (password manager, file có quyền hạn chế) hoặc thêm một dấu cách ở đầu dòng lệnh (khi shell bật `HIST_IGNORE_SPACE` / `HISTCONTROL=ignorespace`). `pnpm db:migrate` chỉ đọc `DATABASE_URL` / `DATABASE_AUTH_TOKEN` từ shell, không đọc từ file env của Next.

### 3. Vercel

1. Import repo vào Vercel (framework Next.js, mặc định).
2. Thêm toàn bộ biến trong bảng trên vào Project Settings > Environment Variables, đánh dấu Sensitive cho các key "Secret". `DATABASE_URL` là URL Turso, `APP_URL` là URL Vercel.
3. Deploy, rồi **đăng ký tài khoản ngay lập tức** trên URL Vercel: người đăng ký đầu tiên trở thành chủ sở hữu duy nhất, người đăng ký thứ hai nhận 403. Để lâu, người lạ có thể chiếm tài khoản.
4. Chạy lại checklist trong [`docs/e2e-checklist.md`](docs/e2e-checklist.md) trên URL Vercel.

Ví relayer phải có AVAX và ví người thuê phải có USDC trước khi thử.

## Hạn mức chi x402 và cách đổi

Agent không bao giờ trả quá:

- `X402_MAX_PER_CALL_USDC`: trần cho một lần gọi proxy (giá trị gợi ý 0.05).
- `X402_MAX_PER_SEARCH_USDC`: trần tổng cho một lượt tìm (giá trị gợi ý 0.50).
- `X402_PRICE_PER_CALL_USDC`: giá proxy đòi cho mỗi lần gọi (giá trị gợi ý 0.01). Nên để giá không vượt trần mỗi lần gọi, nếu không agent sẽ từ chối trả.

Đổi giá trị trong env (hoặc Environment Variables của Vercel) rồi khởi động lại / deploy lại.

## Facilitator

Kiểm tra `GET https://facilitator.payai.network/supported` (công khai, không cần auth) ngày 2026-11-03: có `{"x402Version":2,"scheme":"exact","network":"eip155:43113"}` (cả bản v1 `avalanche-fuji`). Vì vậy giá trị gợi ý là PayAI. Nếu sau này facilitator ngừng hỗ trợ Fuji, đổi `X402_FACILITATOR_URL` sang một trong các lựa chọn: thirdweb facilitator, hoặc tự host x402-rs (https://github.com/x402-rs/x402-rs). Không cần sửa code.

## Bảo mật

- Ví người thuê là custodial: private key được mã hoá bằng `WALLET_ENCRYPTION_KEY` rồi lưu trong DB. Mất khoá này là mất quyền truy cập ví và tiền trong đó; lộ khoá cùng DB là lộ ví. Hãy sao lưu khoá ở nơi an toàn.
- Chỉ dùng testnet. Không nạp tiền thật.
- Không commit private key hay file env thật. Trên Vercel đánh dấu Sensitive cho mọi secret. Dùng keystore của Foundry cho deployer thay vì `--private-key` trên dòng lệnh.
- `RELAYER_PRIVATE_KEY` chỉ nên giữ AVAX testnet vừa đủ trả gas.

## Hạn chế đã biết

- Không có cron: không ai tự động hoàn tất job khi quá hạn. Nút "Hoàn tất" (người thuê hoặc freelancer bấm, ai cũng gọi được) mới thực hiện bước kết thúc on-chain.
- Tìm kiếm có thể chạy lâu (gọi nhiều nguồn + LLM); trang `/search` đặt `maxDuration = 300` giây, cần gói Vercel cho phép thời lượng này.
- Ai cũng đăng ký được (mỗi tài khoản một ví riêng), không có phân quyền hay admin. Quà chào mừng (`WELCOME_GRANT_USDC`) giới hạn một lần mỗi IP (DB chỉ lưu HMAC của IP, không lưu IP thô). IP lấy từ `x-forwarded-for`: trên Vercel header này đáng tin, còn tự host mà không có proxy tin cậy phía trước thì client giả được. Đổi IP (VPN, 4G) vẫn nhận thêm được; nhiều người chung một mạng (văn phòng, NAT) thì chỉ người đầu tiên nhận.
- SQLite file không bền trên Vercel (hệ thống file tạm), nên bắt buộc dùng Turso khi deploy.
- Form tạo job nhận số ngày lẻ (tối thiểu 0.001 ngày); server bắt buộc cửa sổ duyệt/sửa tối thiểu 60 giây. Xem `docs/e2e-checklist.md` để test với cửa sổ ngắn.
