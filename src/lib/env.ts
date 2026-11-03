import "server-only";
import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");
const amount = z.coerce.number().positive();

const schema = z.object({
  // LLM (OpenAI-compatible)
  LLM_BASE_URL: z.string().url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),

  // Search (one provider key for all sources)
  SEARCH_PROVIDER: z.enum(["tavily"]),
  SEARCH_API_KEY: z.string().min(1),

  // x402 seller side
  X402_FACILITATOR_URL: z.string().url(),
  X402_NETWORK: z.string().min(1),
  X402_PAY_TO: address,
  X402_PRICE_PER_CALL_USDC: amount,

  // x402 buyer side
  X402_MAX_PER_CALL_USDC: amount,
  X402_MAX_PER_SEARCH_USDC: amount,

  // Chain
  AVALANCHE_RPC_URL: z.string().url(),
  USDC_ADDRESS: address,
  ESCROW_ADDRESS: address,
  RELAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be 0x + 64 hex chars"),
  RELAYER_MIN_AVAX: amount,

  // App
  APP_URL: z.string().url(),
  WALLET_ENCRYPTION_KEY: z
    .string()
    .transform((v) => Buffer.from(v, "base64"))
    .refine((b) => b.length === 32, "must decode to exactly 32 bytes (base64)"),
  AUTH_SECRET: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DATABASE_AUTH_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  cached = result.data;
  return cached;
}

/** Test helper: drop the cached Env so the next getEnv() re-reads process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
