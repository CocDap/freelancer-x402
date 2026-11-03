// Server-side only (reads RELAYER_PRIVATE_KEY via getEnv).
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { getEnv } from "@/lib/env";

export type RelayerClient = WalletClient<Transport, Chain, Account>;

export type ChainClients = {
  chain: Chain;
  publicClient: PublicClient<Transport, Chain>;
  relayerClient: RelayerClient;
  escrow: Address;
  usdc: Address;
  /** RELAYER_MIN_AVAX: relay refuses to send while the relayer holds less than this. */
  relayerMinAvax: number;
};

/** avalancheFuji for 43113; otherwise a chain built from the RPC's own chainId (e.g. anvil 31337). */
export function chainFor(chainId: number, rpcUrl: string): Chain {
  if (chainId === avalancheFuji.id) {
    return { ...avalancheFuji, rpcUrls: { default: { http: [rpcUrl] } } };
  }
  return defineChain({
    id: chainId,
    name: `Local ${chainId}`,
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

const cache = new Map<string, Promise<ChainClients>>();

/**
 * Clients built from env (AVALANCHE_RPC_URL, RELAYER_PRIVATE_KEY, ESCROW_ADDRESS, USDC_ADDRESS, RELAYER_MIN_AVAX).
 * Lazy: nothing reads env or touches the network until first call. Cached per env combination.
 */
export function getChainClients(): Promise<ChainClients> {
  const env = getEnv();
  const key = [env.AVALANCHE_RPC_URL, env.RELAYER_PRIVATE_KEY, env.ESCROW_ADDRESS, env.USDC_ADDRESS, env.RELAYER_MIN_AVAX].join("|");
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      const transport = http(env.AVALANCHE_RPC_URL);
      const chainId = await createPublicClient({ transport }).getChainId();
      const chain = chainFor(chainId, env.AVALANCHE_RPC_URL);
      return {
        chain,
        publicClient: createPublicClient({ chain, transport }),
        relayerClient: createWalletClient({
          chain,
          transport,
          account: privateKeyToAccount(env.RELAYER_PRIVATE_KEY as `0x${string}`),
        }),
        escrow: env.ESCROW_ADDRESS as Address,
        usdc: env.USDC_ADDRESS as Address,
        relayerMinAvax: env.RELAYER_MIN_AVAX,
      };
    })();
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

/** Optional injected dependencies (tests, scripts). Anything missing falls back to getChainClients(). */
export type ChainDeps = Partial<ChainClients>;

const CHAIN_KEYS = ["chain", "publicClient", "relayerClient", "escrow", "usdc", "relayerMinAvax"] as const;

export async function resolveChainClients(deps: ChainDeps = {}): Promise<ChainClients> {
  const given = Object.fromEntries(
    CHAIN_KEYS.filter((k) => deps[k] !== undefined).map((k) => [k, deps[k]]),
  ) as ChainDeps;
  if (Object.keys(given).length === CHAIN_KEYS.length) return given as ChainClients;
  return { ...(await getChainClients()), ...given };
}

export async function getPublicClient() {
  return (await getChainClients()).publicClient;
}

export async function getRelayerClient() {
  return (await getChainClients()).relayerClient;
}
