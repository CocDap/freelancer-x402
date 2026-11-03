// Fill any unset env key with a valid dummy value so getEnv() (strict) works in tests.
// Never overrides values already present in process.env.
export const TEST_ENV_DEFAULTS: Record<string, string> = {
  LLM_BASE_URL: "http://localhost:11434/v1",
  LLM_API_KEY: "test-llm-key",
  LLM_MODEL: "test-model",
  SEARCH_PROVIDER: "tavily",
  SEARCH_API_KEY: "test-search-key",
  X402_FACILITATOR_URL: "https://facilitator.payai.network",
  X402_NETWORK: "eip155:43113",
  X402_PAY_TO: "0x0000000000000000000000000000000000000001",
  X402_PRICE_PER_CALL_USDC: "0.01",
  X402_MAX_PER_CALL_USDC: "0.05",
  X402_MAX_PER_SEARCH_USDC: "0.50",
  AVALANCHE_RPC_URL: "https://api.avax-test.network/ext/bc/C/rpc",
  USDC_ADDRESS: "0x5425890298aed601595a70AB815c96711a31Bc65",
  ESCROW_ADDRESS: "0x0000000000000000000000000000000000000002",
  RELAYER_PRIVATE_KEY: "0x" + "11".repeat(32),
  RELAYER_MIN_AVAX: "0.05",
  APP_URL: "http://localhost:3000",
  WALLET_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  AUTH_SECRET: "test-auth-secret-test-auth-secret",
  DATABASE_URL: "file:test.db",
};

for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
