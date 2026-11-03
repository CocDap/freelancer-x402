import "server-only";
import { HTTPFacilitatorClient, x402ResourceServer, type RouteConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { parseUnits } from "viem";
import { getPublicClient } from "@/lib/chain/clients";
import { usdcAbi } from "@/lib/chain/usdc-abi";
import { getEnv } from "@/lib/env";

/**
 * Price in USDC (6 decimals) as an atomic-unit string, via exact decimal math (no float multiply).
 * toFixed(6) first normalizes the number to a plain decimal string (no exponent notation).
 */
export function toAtomicUsdc(price: number): string {
  const atomic = parseUnits(price.toFixed(6), 6);
  if (atomic <= 0n) throw new Error("X402_PRICE_PER_CALL_USDC must be at least 0.000001");
  return atomic.toString();
}

let domainCache: { key: string; value: Promise<{ name: string; version: string }> } | undefined;

/** EIP-712 domain name/version read from the USDC contract itself, cached per address. */
export function getUsdcDomain(): Promise<{ name: string; version: string }> {
  const { USDC_ADDRESS } = getEnv();
  const key = USDC_ADDRESS.toLowerCase();
  if (domainCache?.key !== key) {
    const address = USDC_ADDRESS as `0x${string}`;
    const value = getPublicClient().then((c) =>
      Promise.all([
        c.readContract({ address, abi: usdcAbi, functionName: "name" }),
        c.readContract({ address, abi: usdcAbi, functionName: "version" }),
      ]).then(([name, version]) => ({ name, version })),
    );
    const entry = { key, value };
    value.catch(() => {
      if (domainCache === entry) domainCache = undefined;
    });
    domainCache = entry;
  }
  return domainCache.value;
}

let resourceServer: x402ResourceServer | undefined;
let resourceServerKey: string | undefined;

/** Lazy singleton: facilitator client + ExactEvmScheme on X402_NETWORK. Nothing touches env/network at import. */
export function getResourceServer(): x402ResourceServer {
  const env = getEnv();
  const key = `${env.X402_FACILITATOR_URL}|${env.X402_NETWORK}`;
  if (!resourceServer || resourceServerKey !== key) {
    resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: env.X402_FACILITATOR_URL })).register(
      env.X402_NETWORK as `${string}:${string}`,
      new ExactEvmScheme(),
    );
    resourceServerKey = key;
  }
  return resourceServer;
}

/**
 * Route config for one paid search call. `@x402/evm` has no default USDC asset for eip155:43113, so the money
 * string form ("$0.01") cannot resolve; the explicit AssetAmount form is used (resolved per request, so the
 * contract read stays lazy and cached).
 */
export function buildSearchRouteConfig(): RouteConfig {
  const env = getEnv();
  return {
    accepts: {
      scheme: "exact",
      network: env.X402_NETWORK as `${string}:${string}`,
      payTo: env.X402_PAY_TO,
      price: async () => ({
        amount: toAtomicUsdc(getEnv().X402_PRICE_PER_CALL_USDC),
        asset: getEnv().USDC_ADDRESS,
        extra: await getUsdcDomain(),
      }),
    },
    description: "Tìm kiếm freelancer trên mạng xã hội (một lần gọi)",
    mimeType: "application/json",
  };
}
