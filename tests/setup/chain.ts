// Test helper for files that talk to the anvil chain started by tests/setup/anvil.ts.
// Points getEnv() at anvil (so production-default clients work), and returns handy clients.
import { inject } from "vitest";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resetEnvCache } from "@/lib/env";

export const mockUsdcAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
]);

export function setupAnvil() {
  const ctx = inject("anvil");
  process.env.AVALANCHE_RPC_URL = ctx.rpcUrl;
  process.env.USDC_ADDRESS = ctx.usdc;
  process.env.ESCROW_ADDRESS = ctx.escrow;
  process.env.RELAYER_PRIVATE_KEY = ctx.relayerKey;
  resetEnvCache();

  const chain = defineChain({
    id: ctx.chainId,
    name: "anvil",
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [ctx.rpcUrl] } },
  });
  const transport = http(ctx.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const testClient = createTestClient({ chain, transport, mode: "anvil" });
  const funder = createWalletClient({ chain, transport, account: privateKeyToAccount(ctx.funderKey) });

  async function mintUsdc(to: Address, amount: bigint) {
    const hash = await funder.writeContract({ address: ctx.usdc, abi: mockUsdcAbi, functionName: "mint", args: [to, amount] });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  function usdcBalance(of: Address) {
    return publicClient.readContract({ address: ctx.usdc, abi: mockUsdcAbi, functionName: "balanceOf", args: [of] });
  }

  async function increaseTime(seconds: number) {
    await testClient.increaseTime({ seconds });
    await testClient.mine({ blocks: 1 });
  }

  async function latestTimestamp(): Promise<bigint> {
    return (await publicClient.getBlock({ blockTag: "latest" })).timestamp;
  }

  return { ctx, chain, publicClient, testClient, mintUsdc, usdcBalance, increaseTime, latestTimestamp };
}
