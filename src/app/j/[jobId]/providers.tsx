"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { defineChain } from "viem";
import { avalancheFuji } from "viem/chains";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

// Public data only. Signing needs just the injected wallet; the RPC here is the chain's public endpoint.
function publicChain(chainId: number) {
  if (chainId === avalancheFuji.id) return avalancheFuji;
  return defineChain({
    id: chainId,
    name: "Local chain",
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: ["http://127.0.0.1:8546"] } },
  });
}

export function PublicJobProviders({ chainId, children }: { chainId: number; children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [config] = useState(() => {
    const chain = publicChain(chainId);
    return createConfig({
      chains: [chain],
      connectors: [injected()],
      transports: { [chain.id]: http() },
      ssr: true,
    });
  });
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
