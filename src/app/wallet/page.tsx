import { ExternalLinkIcon, TriangleAlertIcon } from "lucide-react";
import { headers } from "next/headers";
import { after, connection } from "next/server";
import { Suspense } from "react";
import { CopyButton } from "@/components/copy-button";
import { DetailList, DetailRow, ExtLink } from "@/components/detail-list";
import { LoadingBlock } from "@/components/loading";
import { PageHeader, PageShell } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getChainClients } from "@/lib/chain/clients";
import { grantWelcomeUsdc } from "@/lib/escrow/relay";
import { usdcAbi } from "@/lib/chain/usdc-abi";
import { CIRCLE_FAUCET_URL, formatAvax, formatUsdc, snowtraceAddress } from "@/lib/jobs/format";
import { clientIp } from "@/lib/request-ip";
import { getUserAddress } from "@/lib/wallet/user-wallet";

async function Content() {
  await connection(); // request-time only: reads session, DB and chain
  const user = await requireUser();
  const address = await getUserAddress(user.id);
  // Retries the one-time welcome grant if signup couldn't send it (no-op once granted or IP already used).
  const ip = clientIp(await headers());
  after(() =>
    grantWelcomeUsdc(user.id, ip).catch((err: unknown) => {
      console.error("[wallet] welcome grant failed:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
    }),
  );
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
    <>
      <Card>
        <CardHeader>
          <CardDescription>Số dư USDC</CardDescription>
          <CardTitle className="font-mono text-3xl font-semibold tabular-nums">{formatUsdc(usdc)}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <span className="text-sm text-muted-foreground">Địa chỉ ví của bạn</span>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all font-mono text-sm">
              <ExtLink href={link}>{address}</ExtLink>
            </code>
            <CopyButton text={address} />
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
          <span>
            AVAX: <span className="font-mono text-foreground">{formatAvax(avax)}</span> (không cần, relayer trả gas)
          </span>
          <a href={CIRCLE_FAUCET_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-foreground underline underline-offset-4">
            Lấy USDC testnet <ExternalLinkIcon className="size-3" />
          </a>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Relayer</CardTitle>
          <CardDescription>Ví trả phí gas thay bạn và freelancer.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <DetailList>
            <DetailRow label="Số dư AVAX">
              <span className="inline-flex items-center gap-2">
                <span className="font-mono">{formatAvax(relayerAvax)}</span>
                <Badge variant={relayerLow ? "destructive" : "success"}>{relayerLow ? "Thiếu" : "Đủ"}</Badge>
              </span>
            </DetailRow>
            <DetailRow label="Tối thiểu">
              <span className="font-mono">{c.relayerMinAvax}</span>
            </DetailRow>
          </DetailList>
          {relayerLow && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Relayer hết AVAX</AlertTitle>
              <AlertDescription>Chưa thể khoá tiền. Hãy nạp thêm AVAX cho ví relayer.</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export default function WalletPage() {
  return (
    <PageShell>
      <PageHeader title="Ví" description="Ví USDC do app quản lý. Bạn không cần ví riêng hay AVAX." />
      <Suspense fallback={<LoadingBlock rows={2} />}>
        <Content />
      </Suspense>
    </PageShell>
  );
}
