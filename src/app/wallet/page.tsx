import { connection } from "next/server";
import { Suspense } from "react";
import { CopyButton } from "@/components/copy-button";
import { requireUser } from "@/lib/auth";
import { getChainClients } from "@/lib/chain/clients";
import { usdcAbi } from "@/lib/chain/usdc-abi";
import { CIRCLE_FAUCET_URL, formatAvax, formatUsdc, snowtraceAddress } from "@/lib/jobs/format";
import { getUserAddress } from "@/lib/wallet/user-wallet";

async function Content() {
  await connection(); // request-time only: reads session, DB and chain
  const user = await requireUser();
  const address = await getUserAddress(user.id);
  const c = await getChainClients();
  const relayer = c.relayerClient.account.address;
  const [usdc, avax, relayerAvax] = await Promise.all([
    c.publicClient.readContract({ address: c.usdc, abi: usdcAbi, functionName: "balanceOf", args: [address] }),
    c.publicClient.getBalance({ address }),
    c.publicClient.getBalance({ address: relayer }),
  ]);
  const link = snowtraceAddress(c.chain.id, address);
  const relayerLow = relayerAvax < BigInt(Math.round(c.relayerMinAvax * 1e18));
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <h2 className="font-medium">Địa chỉ ví của bạn</h2>
        <p className="flex flex-wrap items-center gap-2 break-all font-mono text-sm">
          {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="underline">{address}</a> : address}
          <CopyButton text={address} />
        </p>
      </section>
      <section className="flex flex-col gap-1 text-sm">
        <p>Số dư USDC: <strong>{formatUsdc(usdc)}</strong></p>
        <p>Số dư AVAX: <strong>{formatAvax(avax)}</strong> <span className="text-zinc-500">(không cần, relayer trả gas)</span></p>
        <p>
          Cần USDC testnet?{" "}
          <a href={CIRCLE_FAUCET_URL} target="_blank" rel="noopener noreferrer" className="underline">Faucet của Circle (Fuji)</a>
        </p>
      </section>
      <section className="flex flex-col gap-1 text-sm">
        <h2 className="font-medium">Relayer</h2>
        <p>Số dư AVAX của relayer: <strong>{formatAvax(relayerAvax)}</strong> (tối thiểu {c.relayerMinAvax})</p>
        {relayerLow && (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">Ví relayer hết AVAX nên chưa thể khoá tiền. Hãy nạp thêm AVAX cho relayer.</p>
        )}
      </section>
    </div>
  );
}

export default function WalletPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Ví</h1>
      <Suspense fallback={<p>Đang tải...</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
