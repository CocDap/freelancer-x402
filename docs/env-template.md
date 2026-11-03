# Mẫu biến môi trường

Sao chép khối dưới đây vào file env của bạn (file thật, không commit) rồi tự điền giá trị. Mọi giá trị là giá trị gợi ý, mã nguồn không có giá trị mặc định cho bất kỳ key nào. Đừng dán secret vào chat hay vào file được commit.

```sh
# --- LLM (API tương thích OpenAI) ---
LLM_BASE_URL=https://api.openai.com/v1      # base URL của API
LLM_API_KEY=                                # SECRET: API key của nhà cung cấp LLM
LLM_MODEL=gpt-4o-mini                       # tên model

# --- Tìm kiếm ---
SEARCH_PROVIDER=tavily                      # hiện chỉ hỗ trợ "tavily"
SEARCH_API_KEY=                             # SECRET: API key Tavily (dùng chung cho 3 nguồn)

# --- x402 (bên bán: proxy tìm kiếm của app) ---
X402_FACILITATOR_URL=https://facilitator.payai.network   # facilitator hỗ trợ Fuji
X402_NETWORK=eip155:43113                   # CAIP-2; Fuji = eip155:43113
X402_PAY_TO=0x...                           # địa chỉ ví nhận USDC từ proxy tìm kiếm
X402_PRICE_PER_CALL_USDC=0.01               # giá mỗi lần gọi proxy (USDC)

# --- x402 (bên mua: ngân sách của agent) ---
X402_MAX_PER_CALL_USDC=0.05                 # trần cho một lần gọi; nên >= giá mỗi lần gọi
X402_MAX_PER_SEARCH_USDC=0.50               # trần tổng cho một lượt tìm

# --- Chuỗi ---
AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc   # RPC Fuji C-Chain (đừng nhúng API key vào URL nếu log được chia sẻ)
USDC_ADDRESS=0x5425890298aed601595a70AB815c96711a31Bc65         # USDC trên Fuji
ESCROW_ADDRESS=0x...                        # địa chỉ FreelanceEscrow sau khi deploy
RELAYER_PRIVATE_KEY=                        # SECRET: 0x + 64 hex, ví relayer trả gas (tạo bằng `cast wallet new`)
RELAYER_MIN_AVAX=0.05                       # dưới mức này app từ chối gửi giao dịch (không chỉ cảnh báo)
WELCOME_GRANT_USDC=0.3                      # USDC relayer tặng mỗi ví mới một lần; 0 = tắt. Relayer cần có USDC

# --- App ---
APP_URL=http://localhost:3000               # URL gốc; trên Vercel là URL deploy
WALLET_ENCRYPTION_KEY=                      # SECRET: 32 byte base64, `openssl rand -base64 32`
AUTH_SECRET=                                # SECRET: `openssl rand -base64 32`
DATABASE_URL=file:local.db                  # local: file:local.db; Vercel: libsql://<db>.turso.io
DATABASE_AUTH_TOKEN=                        # SECRET: token Turso; để trống khi dùng file local
```
