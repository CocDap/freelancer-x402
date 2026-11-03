# Freelancer Hire (AI search + x402 + Avalanche escrow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Công cụ cá nhân: agent AI tìm freelancer viết content trên X/LinkedIn/Threads (trả phí search qua x402 trên Fuji) và escrow USDC gasless trên Avalanche Fuji thay cho tiền cọc.

**Architecture:** Một app Next.js 16 (App Router) ở gốc repo, kèm thư mục `contracts/` (Foundry). Mọi việc ký và gửi giao dịch đều chạy phía server: ví người thuê là EOA, key được mã hoá trong DB; một ví relayer trả gas. Freelancer ký EIP-712 bằng ví của họ trên trang công khai `/j/[jobId]`. Search proxy x402 (`withX402`) nằm trong chính app, phía sau gọi Tavily bằng API key.

**Tech Stack:** TypeScript, Next.js 16.4, pnpm, AI SDK 7 (`ai`) + `@ai-sdk/openai-compatible` 3, `@x402/next` / `@x402/fetch` / `@x402/evm` / `@x402/core` 2.29, viem 2, wagmi 3 (chỉ trang freelancer), better-auth 1.7 (plugin username), drizzle-orm + `@libsql/client` (file local / Turso), zod, vitest, Foundry (forge 1.1) + OpenZeppelin Contracts 5.

**Spec:** `docs/superpowers/specs/2026-11-03-freelancer-hire-x402-design.md`

## Global Constraints

- Chain: Avalanche Fuji, chainId `43113`, CAIP-2 `eip155:43113`. USDC Fuji `0x5425890298aed601595a70AB815c96711a31Bc65`, 6 decimals. Mọi địa chỉ lấy từ env, không hardcode trong code.
- LLM: chỉ dùng `@ai-sdk/openai-compatible` với `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. Không import SDK riêng của bất kỳ provider nào.
- Private key **không bao giờ** được gửi xuống client, ghi vào log, hay lưu plaintext. Mã hoá AES-256-GCM bằng `WALLET_ENCRYPTION_KEY` (32 byte, base64).
- Người thuê không kết nối ví và không trả gas. Freelancer không trả gas.
- Không dùng cron. Các thao tác khi quá hạn (`claim`, `settleSplit`) do người dùng bấm nút để kích hoạt; contract cho phép bất kỳ ai gọi.
- Mặc định của job: `reviewWindow` 7 ngày, `revisionWindow` 3 ngày, `maxRevisions` 2. Contract cho phép mỗi window tối thiểu `60` giây (để test trên testnet), `maxRevisions` ≤ `5`.
- Chia khi freelancer không nộp lại bản sửa: người thuê nhận `amount / 2` (chia nguyên), freelancer nhận `amount - amount / 2`.
- x402: proxy thu `X402_PRICE_PER_CALL_USDC` (mặc định `0.01`). Agent không bao giờ trả quá `X402_MAX_PER_CALL_USDC` (`0.05`) cho một lần gọi, hoặc quá `X402_MAX_PER_SEARCH_USDC` (`0.50`) cho một lần tìm kiếm. Chỉ chấp nhận network `eip155:43113` và đúng `USDC_ADDRESS`.
- Chỉ có một người dùng: được đăng ký khi DB chưa có user nào; từ người thứ hai trở đi trả lỗi 403.
- UI viết bằng tiếng Việt.
- Code mới phải kiểm tra API thật của package đã cài: đọc `node_modules/ai/docs/` và README của `@x402/*`. Đừng dựa vào trí nhớ về API của AI SDK v6 hoặc x402 v1.

## Review Focus

1. **Relayer hết AVAX.** Mọi thao tác escrow phải báo lỗi rõ ràng bằng tiếng Việt ("Ví relayer hết AVAX…") trước khi gửi giao dịch, thay vì treo hoặc lỗi chung chung. Test nằm ở Task 5.
2. **Người thuê không đủ USDC khi tạo job.** Chặn trước khi ký, báo số dư hiện có và số cần. Test nằm ở Task 5.
3. **Địa chỉ freelancer sai, bằng `0x0`, hoặc trùng ví người thuê.** Form từ chối, và contract cũng revert. Test nằm ở Task 2 và Task 6.
4. **Bấm hai lần hoặc gửi lại cùng một chữ ký.** Lần thứ hai thất bại một cách gọn gàng (dựa vào `actionNonce`), không mất tiền, UI hiện trạng thái mới nhất. Test nằm ở Task 2 và Task 5.
5. **Search vượt ngân sách, hoặc LLM/provider lỗi giữa chừng.** Agent dừng trả tiền, trả về các ứng viên đã tìm được kèm cảnh báo, và số tiền đã tiêu hiển thị đúng. Test nằm ở Task 9 và Task 10.

---

## File Structure

```
contracts/
  foundry.toml
  src/FreelanceEscrow.sol          # escrow nhiều job, EIP-712, EIP-3009 funding
  test/FreelanceEscrow.t.sol
  test/mocks/MockUSDC.sol          # ERC20 + EIP-3009 receiveWithAuthorization (dùng cả cho anvil)
  script/Deploy.s.sol              # deploy escrow (+ MockUSDC khi chạy local)
src/
  lib/env.ts                       # zod parse process.env -> Env
  lib/db/schema.ts, lib/db/client.ts
  lib/wallet/crypto.ts             # encryptKey / decryptKey
  lib/wallet/user-wallet.ts        # tạo / tải ví người thuê
  lib/auth.ts, lib/auth-client.ts  # better-auth
  lib/chain/clients.ts             # publicClient, relayerClient
  lib/chain/escrow-abi.ts          # ABI sinh từ forge out
  lib/escrow/typed-data.ts         # EIP-712 domain/types, dùng chung client + server
  lib/escrow/terms.ts              # jobNonce(), toUnits(), validate terms
  lib/escrow/relay.ts              # gửi tx qua relayer
  lib/escrow/read.ts               # getJob() -> JobView
  lib/search/tavily.ts             # gọi Tavily theo source
  lib/x402/server.ts               # resource server + route config
  lib/x402/client.ts               # payingFetch có budget
  lib/agent/schema.ts, lib/agent/find-freelancers.ts
  app/(auth)/login/page.tsx, app/(auth)/signup/page.tsx
  app/api/auth/[...all]/route.ts
  app/api/x402/search/[source]/route.ts
  app/api/public/jobs/[jobId]/route.ts     # freelancer relay (submit/decline/claim/settle)
  app/search/page.tsx, app/search/actions.ts
  app/jobs/page.tsx, app/jobs/new/page.tsx, app/jobs/[id]/page.tsx, app/jobs/actions.ts
  app/wallet/page.tsx
  app/j/[jobId]/page.tsx, app/j/[jobId]/freelancer-panel.tsx  # client, wagmi
  proxy.ts                         # chặn route khi chưa đăng nhập (trừ /j, /api/public, /api/x402, /api/auth)
tests/                             # vitest, cùng cấu trúc với src/lib
  setup/anvil.ts                   # globalSetup: anvil + deploy MockUSDC + escrow
.env.example
```

---

### Task 1: Scaffold app, env, test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/lib/env.ts`, `tests/lib/env.test.ts`

**Interfaces:**
- Produces: `getEnv(): Env` (cached, zod). `Env` gồm mọi khoá trong `.env.example`; các số tiền USDC được parse thành `number`; `WALLET_ENCRYPTION_KEY` là `Buffer` dài 32.

- [ ] **Step 1:** `git init`. Scaffold bằng `pnpm create next-app@16.4 . --ts --app --src-dir --eslint --tailwind --use-pnpm --yes`. Thêm vitest. Script: `"test": "vitest run"`, `"test:contracts": "cd contracts && forge test"`.
- [ ] **Step 2: Viết `.env.example`**: copy mục 8 của spec, với hai thay đổi:
  - Thay khối `SEARCH_*` bằng `SEARCH_PROVIDER=tavily` và `SEARCH_API_KEY=`. Mục 9 của spec giao việc chọn provider cho người build: một API key Tavily dùng cho cả ba nguồn.
  - Thêm `X402_FACILITATOR_URL=https://facilitator.payai.network` (đổi được), `X402_NETWORK=eip155:43113`, `RELAYER_MIN_AVAX=0.05`.
- [ ] **Step 3: Viết test** `tests/lib/env.test.ts`:
  - `parses valid env`: số tiền `X402_MAX_PER_CALL_USDC` thành `0.05`.
  - `rejects WALLET_ENCRYPTION_KEY not 32 bytes`: báo lỗi có tên khoá.
  - `rejects missing LLM_BASE_URL`.
- [ ] **Step 4:** Chạy `pnpm test tests/lib/env.test.ts`. Kỳ vọng FAIL (module chưa có).
- [ ] **Step 5:** Implement `getEnv()` trong `src/lib/env.ts` bằng `z.object(...).parse(process.env)`.
- [ ] **Step 6:** Chạy `pnpm test`. Kỳ vọng PASS. Chạy `pnpm build`. Kỳ vọng build thành công.
- [ ] **Step 7:** Commit `chore: scaffold next app, env schema, vitest`.

### Task 2: Escrow contract

**Files:**
- Create: `contracts/foundry.toml`, `contracts/src/FreelanceEscrow.sol`, `contracts/test/mocks/MockUSDC.sol`, `contracts/test/FreelanceEscrow.t.sol`, `contracts/script/Deploy.s.sol`

**Interfaces:**
- Produces (Solidity, `pragma ^0.8.24`, OZ 5 `EIP712` + `SignatureChecker`):
  - `enum State { None, Funded, Submitted, RevisionRequested, Released, Refunded, Split }`
  - `struct Terms { address freelancer; uint256 amount; uint64 deliverDeadline; uint32 reviewWindow; uint32 revisionWindow; uint8 maxRevisions; }`
  - `struct Job { address buyer; address freelancer; uint256 amount; uint64 deliverDeadline; uint32 reviewWindow; uint32 revisionWindow; uint8 maxRevisions; uint8 revisionCount; uint64 submittedAt; uint64 revisionDeadline; uint32 actionNonce; State state; bytes32 contentHash; }`
  - `constructor(address usdc)`; domain EIP-712 `name="FreelanceEscrow"`, `version="1"`.
  - `function jobNonce(bytes32 jobId, Terms calldata t) public pure returns (bytes32)` = `keccak256(abi.encode(jobId, t))`.
  - `function createJob(bytes32 jobId, address buyer, Terms calldata t, uint256 validAfter, uint256 validBefore, bytes calldata usdcSig) external`. Gọi `usdc.receiveWithAuthorization(buyer, address(this), t.amount, validAfter, validBefore, jobNonce(jobId,t), v, r, s)`. Vì nonce của EIP-3009 ràng buộc toàn bộ điều khoản job, chữ ký USDC của người thuê chính là chữ ký đồng ý điều khoản.
  - Typed data: `Action(bytes32 jobId,uint8 kind,bytes32 data,uint32 actionNonce,uint256 deadline)`. `kind` gồm: `1=Submit, 2=Approve, 3=RequestRevision, 4=Refund, 5=Decline`.
  - `submit(bytes32 jobId, bytes32 contentHash, uint256 deadline, bytes calldata sig)` (freelancer), `approve(jobId, deadline, sig)`, `requestRevision(jobId, deadline, sig)`, `refund(jobId, deadline, sig)` (người thuê), `decline(jobId, deadline, sig)` (freelancer). Nếu `sig.length == 0` và `msg.sender` đúng là bên phải ký thì chấp nhận luôn, để freelancer gọi trực tiếp qua Snowtrace được.
  - `claim(bytes32 jobId)`, `settleSplit(bytes32 jobId)`: bất kỳ ai cũng gọi được.
  - `getJob(bytes32) view returns (Job memory)`, `domainSeparator() view returns (bytes32)`.
  - Events: `JobCreated(jobId, buyer, freelancer, amount)`, `Submitted(jobId, contentHash, revisionCount)`, `Approved`, `RevisionRequested(jobId, revisionDeadline)`, `Refunded`, `Declined`, `Claimed`, `SplitSettled(jobId, buyerAmount, freelancerAmount)`.
  - Custom errors: `BadState`, `BadSigner`, `Expired`, `TooEarly`, `BadTerms`, `JobExists`, `NoRevisionsLeft`.
- Bảng chuyển trạng thái: đúng như bảng ở mục 5.5 của spec. Mỗi hành động có chữ ký thì kiểm tra `deadline >= block.timestamp` rồi `actionNonce++`.
- `MockUSDC`: ERC20 6 decimals, có `mint`, và `receiveWithAuthorization` theo đúng EIP-3009 (typehash `ReceiveWithAuthorization`, domain `name="USD Coin"`, `version="2"`, giống USDC Fuji; check lại `name()` / `version()` của USDC Fuji trên Snowtrace trước khi deploy).

- [ ] **Step 1:** `forge init contracts --no-git`, `forge install OpenZeppelin/openzeppelin-contracts --no-git`, viết remappings.
- [ ] **Step 2: Viết tests** trong `FreelanceEscrow.t.sol`. Tạo người thuê và freelancer bằng `vm.addr`, ký bằng `vm.sign`, amount `100e6`.
  - `test_createJob_locksFunds`: số dư escrow `100e6`, state `Funded`.
  - `test_createJob_revertsIfTermsTampered`: relayer đổi `freelancer` sau khi người thuê ký → revert (vì nonce EIP-3009 không khớp).
  - `test_createJob_revertsBadTerms`: freelancer `0x0`; freelancer == buyer; amount 0; deadline trong quá khứ; window < 60; maxRevisions > 5. Mỗi trường hợp → `BadTerms`.
  - `test_createJob_revertsDuplicateId` → `JobExists`.
  - `test_submit_thenApprove_paysFreelancer100`.
  - `test_refund_afterDeadline_noSubmit_paysBuyer100`; `test_refund_beforeDeadline_reverts` → `TooEarly`.
  - `test_refund_afterSubmit_reverts` → `BadState` (quy tắc cốt lõi).
  - `test_decline_refundsBuyer`.
  - `test_claim_afterReviewWindow_anyone_paysFreelancer`; `test_claim_beforeWindow_reverts`.
  - `test_requestRevision_thenResubmit_resetsSubmittedAt`.
  - `test_requestRevision_exceedsMax_reverts` → `NoRevisionsLeft`.
  - `test_settleSplit_afterRevisionDeadline_splits`: amount `100e6 + 1` → người thuê nhận `50e6`, freelancer nhận `50e6 + 1`.
  - `test_settleSplit_beforeDeadline_reverts`; `test_refund_inRevisionRequested_reverts`.
  - `test_replaySignature_reverts` → `BadSigner` (vì `actionNonce` đã tăng).
  - `test_wrongSigner_reverts`: người thuê ký `submit` → `BadSigner`.
  - `test_expiredSignature_reverts` → `Expired`.
  - `test_freelancerDirectCall_noSig_submits`.
- [ ] **Step 3:** Chạy `forge test`. Kỳ vọng FAIL (compile lỗi, contract chưa có).
- [ ] **Step 4:** Implement `FreelanceEscrow.sol` và `MockUSDC.sol`.
- [ ] **Step 5:** Chạy `forge test -vv`. Kỳ vọng tất cả PASS.
- [ ] **Step 6:** Viết `Deploy.s.sol`: đọc `USDC_ADDRESS`; nếu biến này rỗng thì deploy `MockUSDC` trước. In ra địa chỉ escrow.
- [ ] **Step 7:** Commit `feat(contracts): freelance escrow with EIP-712 actions and EIP-3009 funding`.

### Task 3: DB, key encryption, user wallet

**Files:**
- Create: `src/lib/db/schema.ts`, `src/lib/db/client.ts`, `drizzle.config.ts`, `src/lib/wallet/crypto.ts`, `src/lib/wallet/user-wallet.ts`, `tests/lib/wallet/crypto.test.ts`, `tests/lib/wallet/user-wallet.test.ts`

**Interfaces:**
- Consumes: `getEnv()`.
- Produces:
  - Bảng `wallet(userId PK, address, encryptedKey)`, `search(id, userId, brief JSON, candidates JSON, spentUsdc real, warnings JSON, createdAt)`, `x402_payment(id, searchId, url, amountUsdc, txHash, createdAt)`, `job(id = jobId hex, userId, freelancerAddress, candidateUrl, contentUrl, createTx, createdAt)`. Bảng của better-auth do Task 4 sinh ra.
  - `db` (drizzle libsql, đọc `DATABASE_URL` và `DATABASE_AUTH_TOKEN`).
  - `encryptKey(pk: Hex, key: Buffer): string` (`base64(iv|tag|ciphertext)`), `decryptKey(blob: string, key: Buffer): Hex`.
  - `createUserWallet(userId: string): Promise<Address>`, `getUserAccount(userId: string): Promise<PrivateKeyAccount>`, `getUserAddress(userId): Promise<Address>`.

- [ ] **Step 1: Viết tests:**
  - `roundtrip`: decrypt(encrypt(pk)) === pk.
  - `ciphertext differs per call`.
  - `tampered blob throws`.
  - `wrong key throws`.
  - `createUserWallet stores encrypted key, never plaintext`: hex của pk không xuất hiện trong row của DB.
  - `getUserAccount returns account whose address matches stored`.
  - DB trong test dùng `file::memory:`.
- [ ] **Step 2:** Chạy test. Kỳ vọng FAIL.
- [ ] **Step 3:** Implement bằng `node:crypto` (`aes-256-gcm`, iv 12 byte) và viem `generatePrivateKey` / `privateKeyToAccount`.
- [ ] **Step 4:** Chạy test. Kỳ vọng PASS. Chạy `pnpm drizzle-kit generate` để sinh migration.
- [ ] **Step 5:** Commit `feat: libsql schema and encrypted custodial wallets`.

### Task 4: Auth (username + mật khẩu, chỉ một user)

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`, `src/proxy.ts`, `tests/lib/auth.test.ts`

**Interfaces:**
- Consumes: `db`, `createUserWallet`.
- Produces: `auth` (better-auth, plugin `username`), `requireUser(): Promise<{ id: string; username: string }>` (redirect `/login` khi chưa đăng nhập).
- better-auth bắt buộc phải có email. Cách xử lý: client gửi email tổng hợp `${username}@users.invalid`, UI không hiện email. Hook `databaseHooks.user.create.before` trả lỗi 403 nếu đã có user. Hook `after` gọi `createUserWallet`.

- [ ] **Step 1: Viết tests** (gọi `auth.api` trực tiếp):
  - `first signup succeeds and creates wallet`.
  - `second signup rejected 403`.
  - `login with username+password returns session`.
  - `wrong password rejected`.
- [ ] **Step 2:** Chạy test. Kỳ vọng FAIL.
- [ ] **Step 3:** Implement auth và hai trang form (tiếng Việt). `proxy.ts` redirect mọi route tới `/login`, trừ `/login`, `/signup`, `/j/*`, `/api/auth/*`, `/api/public/*`, `/api/x402/*`.
- [ ] **Step 4:** Chạy test. Kỳ vọng PASS. Chạy `pnpm dev`, đăng ký, rồi kiểm tra lần đăng ký thứ hai bị chặn.
- [ ] **Step 5:** Commit `feat: single-user username auth with wallet on signup`.

### Task 5: Chain clients, typed data, relay, job reads

**Files:**
- Create: `src/lib/chain/clients.ts`, `src/lib/chain/escrow-abi.ts`, `src/lib/escrow/typed-data.ts`, `src/lib/escrow/terms.ts`, `src/lib/escrow/relay.ts`, `src/lib/escrow/read.ts`, `tests/setup/anvil.ts`, `tests/lib/escrow/relay.test.ts`

**Interfaces:**
- Consumes: ABI từ `contracts/out/FreelanceEscrow.sol/FreelanceEscrow.json` (script `pnpm abi` sinh `escrow-abi.ts` dạng `as const`), `getUserAccount`.
- Produces:
  - `publicClient`, `relayerClient` (viem, chain `avalancheFuji`, hoặc anvil khi `AVALANCHE_RPC_URL` trỏ localhost và chainId lấy từ RPC).
  - `typed-data.ts`: `escrowDomain(chainId, escrow)`, `ACTION_TYPES`, `ActionKind = { Submit:1, Approve:2, RequestRevision:3, Refund:4, Decline:5 } as const`, `actionMessage(jobId, kind, data, actionNonce, deadline)`. File này không import gì từ server, để trang freelancer dùng chung được.
  - `terms.ts`: `type JobTermsInput = { freelancer: Address; amountUsdc: string; deliverDeadline: Date; reviewDays: number; revisionDays: number; maxRevisions: number }`, `toTerms(input, buyer): Terms` (ném `TermsError` với message tiếng Việt khi địa chỉ sai, bằng `0x0`, trùng người thuê, amount ≤ 0, hoặc quá 6 chữ số thập phân), `newJobId(): Hex`, `jobNonce(jobId, terms): Hex` (khớp với Solidity).
  - `relay.ts`, mọi hàm trả về `Promise<Hex>` (tx hash, đã chờ có receipt):
    - `createJob(userId, input: JobTermsInput)`: kiểm tra số dư USDC, ký EIP-3009 với nonce = `jobNonce`, rồi gửi tx.
    - `buyerAction(userId, jobId, kind: 'approve'|'requestRevision'|'refund')`.
    - `relayFreelancerAction(jobId, kind: 'submit'|'decline', contentHash: Hex, deadline: bigint, sig: Hex)`.
    - `finalize(jobId)`: gọi `claim` hoặc `settleSplit` tuỳ trạng thái.
    - Lỗi: `RelayerUnderfundedError` (khi số dư relayer < `RELAYER_MIN_AVAX`), `InsufficientUsdcError { have, need }`, `ChainActionError` (chuyển custom error của contract thành message tiếng Việt).
  - `read.ts`: `getJob(jobId): Promise<JobView>`, trong đó `JobView` = các trường của `Job` + `amountUsdc: string` + `availableActions: { buyer: ('approve'|'requestRevision'|'refund')[]; freelancer: ('submit'|'decline')[]; anyone: ('claim'|'settleSplit')[] }`, tính dựa trên `block.timestamp` của block mới nhất.

- [ ] **Step 1:** `tests/setup/anvil.ts` (vitest `globalSetup`): spawn `anvil --port 8546`, chạy `forge script Deploy` với `USDC_ADDRESS` rỗng, rồi ghi `ESCROW_ADDRESS`, `USDC_ADDRESS`, `AVALANCHE_RPC_URL`, `RELAYER_PRIVATE_KEY` (account #0 của anvil) vào `process.env`. Tắt anvil sau khi test xong.
- [ ] **Step 2: Viết tests** (mint MockUSDC cho ví người thuê, dùng `evm_increaseTime` để tua thời gian):
  - `createJob locks funds and buyer pays no gas`: số dư AVAX của người thuê vẫn bằng 0.
  - `createJob with insufficient USDC throws InsufficientUsdcError before any tx`: nonce của relayer không đổi.
  - `relayer below RELAYER_MIN_AVAX throws RelayerUnderfundedError`.
  - `toTerms rejects freelancer == buyer / zero / malformed`.
  - `full flow submit→approve`: availableActions đúng ở mỗi bước.
  - `requestRevision→timeout→finalize splits 50/50`.
  - `submit relayed twice with same sig: second throws ChainActionError, state unchanged`.
  - `jobNonce TS equals contract.jobNonce`.
- [ ] **Step 3:** Chạy test. Kỳ vọng FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Chạy `pnpm test`. Kỳ vọng PASS.
- [ ] **Step 6:** Commit `feat: gasless escrow relay and job views`.

### Task 6: Giao diện người thuê (job, ví)

**Files:**
- Create: `src/app/jobs/page.tsx`, `src/app/jobs/new/page.tsx`, `src/app/jobs/[id]/page.tsx`, `src/app/jobs/actions.ts`, `src/app/wallet/page.tsx`, `src/app/layout.tsx` (nav)

**Interfaces:**
- Consumes: `requireUser`, `createJob`, `buyerAction`, `finalize`, `getJob`, `getUserAddress`.
- Produces (server actions): `createJobAction(formData) → { jobId } | { error }`, `buyerActionAction(jobId, kind)`, `finalizeAction(jobId)`. `/jobs/new` nhận query `?candidate=<url>` để điền sẵn link ứng viên.

- [ ] **Step 1:** Trang `/wallet`: địa chỉ ví, số dư USDC và AVAX, link faucet Circle (Fuji), số dư AVAX của relayer.
- [ ] **Step 2:** Trang `/jobs/new`: form có các trường địa chỉ ví freelancer, số USDC, hạn nộp, số ngày duyệt (7), số ngày sửa (3), số lần sửa tối đa (2), link ứng viên. Khi `toTerms` báo lỗi thì hiện lỗi ngay bên cạnh trường tương ứng. Nút "Khoá tiền" bị disable trong lúc đang gửi.
- [ ] **Step 3:** Trang `/jobs/[id]`:
  - Hiện trạng thái (bằng tiếng Việt), số tiền, các mốc thời gian, link bài (`contentUrl`), link Snowtrace.
  - Chỉ hiện các nút có trong `availableActions`: "Duyệt", "Yêu cầu sửa", "Hoàn tiền", "Hoàn tất".
  - Có link công khai `${APP_URL}/j/${jobId}` kèm nút copy.
  - Mọi `RelayerUnderfundedError`, `InsufficientUsdcError` và `ChainActionError` hiện thành banner lỗi.
- [ ] **Step 4:** Trang `/jobs`: danh sách job của người dùng, mỗi job kèm trạng thái đọc từ chain.
- [ ] **Step 5:** Kiểm tra bằng tay trên anvil (`pnpm dev` với env local):
  - Tạo job, rồi mở trang job.
  - Thử freelancer trùng ví mình → báo lỗi.
  - Bấm "Khoá tiền" hai lần liên tiếp → chỉ tạo ra một job.
- [ ] **Step 6:** Commit `feat: buyer job and wallet pages`.

### Task 7: Trang công khai cho freelancer

**Files:**
- Create: `src/app/j/[jobId]/page.tsx`, `src/app/j/[jobId]/freelancer-panel.tsx`, `src/app/api/public/jobs/[jobId]/route.ts`, `tests/app/public-job-route.test.ts`

**Interfaces:**
- Consumes: `getJob`, `relayFreelancerAction`, `finalize`, `escrowDomain`, `ACTION_TYPES`, `ActionKind`.
- Produces:
  - `POST /api/public/jobs/[jobId]`, body (zod): `{ kind: 'submit'|'decline', contentUrl?: string, deadline: string, sig: Hex }` hoặc `{ kind: 'finalize' }`.
  - Với `submit`: server tính `contentHash = keccak256(toBytes(contentUrl))`, lưu `contentUrl` vào bảng `job`, rồi relay.
  - Trả về `{ txHash }`, hoặc `{ error }` kèm status 400/409.

- [ ] **Step 1: Viết tests** cho route handler (chạy trên anvil):
  - `submit with valid freelancer sig → 200 and state Submitted`.
  - `submit signed by non-freelancer → 409`.
  - `contentUrl not http(s) → 400`.
  - `finalize before deadline → 409`.
- [ ] **Step 2:** Chạy test. Kỳ vọng FAIL.
- [ ] **Step 3:** Implement route.
  - `page.tsx` là server component hiện thông tin job: số tiền đã khoá, link Snowtrace, các mốc thời gian, luật chơi (số ngày duyệt, số ngày sửa, số lần sửa, quy tắc chia 50/50), không cần đăng nhập.
  - `freelancer-panel.tsx` là client component dùng wagmi (connector `injected`, chain Fuji):
    - Kết nối ví.
    - Ô "Link bài".
    - Nút "Nộp bài": `signTypedData`, sau đó POST lên route.
    - Nút "Từ chối nhận việc".
    - Nút "Hoàn tất" (finalize) khi được phép.
  - Nếu ví đang kết nối không phải `job.freelancer` thì báo "Ví này không phải ví freelancer của job".
- [ ] **Step 4:** Chạy test. Kỳ vọng PASS. Kiểm tra bằng tay bằng MetaMask trên anvil: nộp bài, rồi người thuê duyệt.
- [ ] **Step 5:** Commit `feat: public freelancer job page with gasless signing`.

### Task 8: Search proxy x402 (phía bán)

**Files:**
- Create: `src/lib/search/tavily.ts`, `src/lib/x402/server.ts`, `src/app/api/x402/search/[source]/route.ts`, `tests/lib/search/tavily.test.ts`, `tests/app/x402-route.test.ts`

**Interfaces:**
- Produces:
  - `type Source = 'x'|'linkedin'|'threads'`.
  - `type SearchHit = { source: Source; url: string; title: string; snippet: string }`.
  - `searchSource(source: Source, query: string, limit?: number): Promise<SearchHit[]>`: POST `https://api.tavily.com/search` với `include_domains`: `x` → `["x.com","twitter.com"]`, `linkedin` → `["linkedin.com"]`, `threads` → `["threads.net","threads.com"]`.
  - `GET /api/x402/search/[source]?q=` trả về `{ hits: SearchHit[] }`. Route bọc bằng `withX402(handler, { "/api/x402/search/[source]": routeConfig }, resourceServer)`.
  - `routeConfig.accepts`: `scheme: "exact"`, `network: X402_NETWORK`, `payTo: X402_PAY_TO`, giá tính từ `X402_PRICE_PER_CALL_USDC`.
  - Nếu dạng giá `"$0.01"` không tự ra được USDC Fuji thì truyền giá dạng `{ amount: "<atomic>", asset: USDC_ADDRESS, extra: { name, version } }`, với name/version đọc từ contract USDC. Đây là chỗ cần xác nhận lại bằng types của `@x402/evm` đã cài.
  - `resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: X402_FACILITATOR_URL })).register(X402_NETWORK, new ExactEvmScheme())`.
  - Route trả 400 khi `source` không hợp lệ hoặc `q` rỗng. Vì `withX402` chỉ settle khi status < 400, các request lỗi sẽ không bị tính tiền.

- [ ] **Step 1: Viết tests:**
  - Tavily (mock `fetch`): `maps source to include_domains`, `normalizes results to SearchHit`, `non-200 throws SearchProviderError`.
  - Route: `request without payment → 402 with accepts[0].network === "eip155:43113" and payTo === X402_PAY_TO`, `invalid source → 400`.
- [ ] **Step 2:** Chạy test. Kỳ vọng FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Chạy test. Kỳ vọng PASS. Gọi `curl -i localhost:3000/api/x402/search/x?q=test`, kỳ vọng nhận `402` với header payment-required.
- [ ] **Step 5:** Commit `feat: x402-gated search proxy on Fuji`.

### Task 9: Client x402 có giới hạn chi tiêu (phía mua)

**Files:**
- Create: `src/lib/x402/client.ts`, `tests/lib/x402/client.test.ts`

**Interfaces:**
- Consumes: `getUserAccount`, `db`.
- Produces:
  - `createPayingFetch(opts: { account: PrivateKeyAccount; searchId: string; maxPerCallUsdc: number; maxPerSearchUsdc: number; network: string; asset: Address }): { fetch: typeof fetch; spentUsdc(): number }`.
  - Bọc `wrapFetchWithPayment` của `@x402/fetch` với `ExactEvmScheme(account)` đăng ký cho `network`.
  - `paymentRequirementsSelector` chỉ chọn requirement khớp cả `network` lẫn `asset`, có amount ≤ mức tối đa mỗi lần gọi, và tổng đã tiêu + amount ≤ mức tối đa mỗi lần tìm. Không có requirement nào hợp lệ thì ném `BudgetExceededError` **trước khi ký**.
  - Sau mỗi lần trả thành công: decode header payment-response, cộng dồn vào `spentUsdc`, và insert một dòng `x402_payment`.

- [ ] **Step 1: Viết tests** (server 402 giả bằng `undici` MockAgent hoặc một handler `withX402` cục bộ, facilitator mock):
  - `pays once and returns body`: spentUsdc = 0.01, có 1 dòng log.
  - `rejects price above per-call cap without signing`: hàm ký không được gọi.
  - `stops when cumulative would exceed per-search cap`.
  - `rejects wrong network or wrong asset`.
- [ ] **Step 2:** Chạy test. Kỳ vọng FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Chạy test. Kỳ vọng PASS.
- [ ] **Step 5:** Commit `feat: budgeted x402 paying fetch`.

### Task 10: Agent tìm freelancer + trang tìm kiếm

**Files:**
- Create: `src/lib/agent/schema.ts`, `src/lib/agent/find-freelancers.ts`, `src/app/search/page.tsx`, `src/app/search/actions.ts`, `tests/lib/agent/find-freelancers.test.ts`

**Interfaces:**
- Consumes: `createPayingFetch`, `getUserAccount`, `getEnv`, route `GET ${APP_URL}/api/x402/search/[source]`.
- Produces:
  - `Brief = { topic: string; contentType: string; language: string; tone?: string; budgetUsdc?: number; deadline?: string }`.
  - `Candidate = { name: string; handle?: string; profileUrl: string; sampleUrls: string[]; source: Source; fitReason: string; risks: string[] }`.
  - `runFreelancerSearch(userId: string, brief: Brief, deps?: { model?: LanguageModel; fetch?: typeof fetch }): Promise<{ searchId: string; candidates: Candidate[]; spentUsdc: number; warnings: string[] }>`.
  - Model: `createOpenAICompatible({ name: "llm", baseURL: LLM_BASE_URL, apiKey: LLM_API_KEY })(LLM_MODEL)`.
  - Tools: `search_x`, `search_linkedin`, `search_threads`, mỗi tool nhận `{ query: string }` và trả `SearchHit[]` qua paying fetch.
  - Giới hạn tối đa 8 bước. Đầu ra có cấu trúc: tối đa 10 `Candidate`, loại trùng theo `profileUrl`, và chỉ giữ ứng viên có `profileUrl` thật sự xuất hiện trong các hit đã trả về (chống model bịa link). Dùng API structured output của AI SDK 7, xem `node_modules/ai/docs/`.
  - `BudgetExceededError` hoặc lỗi của provider/LLM: không ném ra ngoài. Agent dừng, trả về các ứng viên đã có kèm `warnings`. Kết quả lưu vào bảng `search`.

- [ ] **Step 1: Viết tests** với `MockLanguageModelV*` của `ai/test` và fetch giả:
  - `returns candidates only with urls seen in hits`.
  - `dedupes by profileUrl`.
  - `budget exceeded mid-run returns partial results with warning`.
  - `LLM error returns empty candidates with warning, spent recorded`.
- [ ] **Step 2:** Chạy test. Kỳ vọng FAIL.
- [ ] **Step 3:** Implement. Trang `/search`:
  - Form `Brief`.
  - Kết quả hiện dạng thẻ: tên, link hồ sơ, bài mẫu, lý do phù hợp, rủi ro, nút "Thuê người này" dẫn tới `/jobs/new?candidate=<profileUrl>`.
  - Dòng "Đã tiêu X USDC (test)" và các cảnh báo.
- [ ] **Step 4:** Chạy test. Kỳ vọng PASS.
- [ ] **Step 5:** Commit `feat: freelancer search agent and search page`.

### Task 11: Deploy Fuji + Vercel, kiểm thử end-to-end

**Files:**
- Create: `README.md` (tiếng Việt: cài đặt, điền `.env`, faucet, deploy), `docs/e2e-checklist.md`

- [ ] **Step 1:** Deploy contract lên Fuji:
  ```bash
  cd contracts && forge script script/Deploy.s.sol --rpc-url $AVALANCHE_RPC_URL --private-key $RELAYER_PRIVATE_KEY --broadcast
  ```
  Ghi lại `ESCROW_ADDRESS`. Kiểm tra `name()` / `version()` của USDC Fuji khớp với domain đang dùng trong `relay.ts`.
- [ ] **Step 2:** Xác nhận facilitator hỗ trợ `eip155:43113`: gọi endpoint `/supported` của facilitator. Nếu không hỗ trợ, đổi `X402_FACILITATOR_URL` sang facilitator khác, hoặc tự host x402-rs, rồi ghi lại vào README.
- [ ] **Step 3:** Viết `docs/e2e-checklist.md`, chạy hết trên Fuji với các window 60 giây:
  - Đăng ký, nạp USDC test từ faucet.
  - Tìm kiếm, xem số tiền đã tiêu và kiểm tra tx thật trên Snowtrace.
  - Tạo job: người thuê không tốn AVAX.
  - Freelancer (dùng ví thứ hai) nộp bài, người thuê duyệt.
  - Job thứ hai: quá hạn mà không nộp thì hoàn tiền.
  - Job thứ ba: yêu cầu sửa, không nộp lại, chia 50/50.
  - Job thứ tư: nộp rồi người thuê im lặng, freelancer bấm "Hoàn tất".
- [ ] **Step 4:** Deploy lên Vercel:
  - Tạo DB Turso và đặt `DATABASE_URL`, `DATABASE_AUTH_TOKEN`. Đặt tất cả env vào Vercel, đánh dấu Sensitive.
  - Chạy migration lên Turso. Chạy lại checklist trên URL Vercel.
- [ ] **Step 5:** Commit `docs: setup, deploy, and e2e checklist`.
