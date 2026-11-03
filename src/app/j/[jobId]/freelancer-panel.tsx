"use client";

import { CircleCheckIcon, Loader2Icon, SendIcon, TriangleAlertIcon, WalletIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { keccak256, toBytes, zeroHash, type Address, type Hex } from "viem";
import { useConnect, useConnection, useConnectors, useDisconnect, useSignTypedData, useSwitchChain } from "wagmi";
import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ACTION_TYPES, ActionKind, actionMessage, escrowDomain } from "@/lib/escrow/typed-data";

export type PanelProps = {
  jobId: Hex;
  chainId: number;
  escrow: Address;
  freelancer: Address;
  actionNonce: number;
  stateName: string;
  canSubmit: boolean;
  canDecline: boolean;
  canFinalize: boolean;
};

const SIGN_VALIDITY_SECONDS = 600;

export function FreelancerPanel(p: PanelProps) {
  const router = useRouter();
  const connection = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const signTypedData = useSignTypedData();
  const [contentUrl, setContentUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const connected = connection.isConnected && !!connection.address;
  const isFreelancer = connected && connection.address!.toLowerCase() === p.freelancer.toLowerCase();
  const wrongWallet = connected && !isFreelancer;
  const canSign = isFreelancer && !busy;

  async function post(body: unknown) {
    const res = await fetch(`/api/public/jobs/${p.jobId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { txHash?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Có lỗi xảy ra. Vui lòng thử lại.");
    return data.txHash ?? "";
  }

  async function run(label: string, work: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const tx = await work();
      setDone(`${label} thành công. Giao dịch: ${tx}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra. Vui lòng thử lại.");
      // Refresh so a retry signs with the fresh actionNonce (a failed relay may still have consumed/changed it).
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function signAction(kind: number, data: Hex) {
    if (connection.chainId !== p.chainId) await switchChain.mutateAsync({ chainId: p.chainId });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + SIGN_VALIDITY_SECONDS);
    const sig = await signTypedData.mutateAsync({
      domain: escrowDomain(p.chainId, p.escrow),
      types: ACTION_TYPES,
      primaryType: "Action",
      message: actionMessage(p.jobId, kind, data, p.actionNonce, deadline),
    });
    return { sig, deadline: deadline.toString() };
  }

  const submit = () =>
    run("Nộp bài", async () => {
      const url = contentUrl.trim();
      if (!url) throw new Error("Vui lòng nhập link bài.");
      // Hash only for signing; the server recomputes it from the URL.
      const { sig, deadline } = await signAction(ActionKind.Submit, keccak256(toBytes(url)));
      return post({ kind: "submit", contentUrl: url, deadline, sig });
    });

  const decline = () =>
    run("Từ chối nhận việc", async () => {
      const { sig, deadline } = await signAction(ActionKind.Decline, zeroHash);
      return post({ kind: "decline", deadline, sig });
    });

  const finalizeJob = () => run("Hoàn tất", () => post({ kind: "finalize" }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dành cho freelancer</CardTitle>
        <CardDescription>Kết nối ví freelancer để nộp bài hoặc từ chối. Bạn không cần AVAX để trả phí gas.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!connected ? (
          <div className="flex flex-col items-start gap-2">
            <Button
              disabled={connect.isPending || connectors.length === 0}
              onClick={() => connect.mutate({ connector: connectors[0], chainId: p.chainId })}
            >
              {connect.isPending ? <Loader2Icon className="animate-spin" /> : <WalletIcon />}
              {connect.isPending ? "Đang kết nối..." : "Kết nối ví"}
            </Button>
            {connect.isError && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertDescription>Không kết nối được ví. Hãy cài ví (ví dụ MetaMask) và thử lại.</AlertDescription>
              </Alert>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <span className={isFreelancer ? "size-2 rounded-full bg-success" : "size-2 rounded-full bg-warning"} aria-hidden />
            <span className="min-w-0 break-all font-mono">{connection.address}</span>
            <Button variant="link" size="sm" className="ml-auto h-auto px-0" onClick={() => disconnect.mutate()}>
              Ngắt kết nối
            </Button>
          </div>
        )}

        {wrongWallet && (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>Ví này không phải ví freelancer của job</AlertDescription>
          </Alert>
        )}

        {p.canSubmit && (
          <FormField label="Link bài" htmlFor="contentUrl">
            <Input
              id="contentUrl"
              type="url"
              value={contentUrl}
              onChange={(e) => setContentUrl(e.target.value)}
              placeholder="https://..."
              maxLength={2048}
            />
          </FormField>
        )}

        {(p.canSubmit || p.canDecline || p.canFinalize) && (
          <div className="flex flex-wrap gap-2">
            {p.canSubmit && (
              <Button disabled={!canSign} onClick={submit}>
                {busy ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                {busy ? "Đang xử lý..." : "Nộp bài"}
              </Button>
            )}
            {p.canDecline && (
              <Button variant="outline" disabled={!canSign} onClick={decline}>
                Từ chối nhận việc
              </Button>
            )}
            {p.canFinalize && (
              <Button variant="secondary" disabled={busy} onClick={finalizeJob}>
                {busy ? "Đang xử lý..." : "Hoàn tất"}
              </Button>
            )}
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {done && (
          <Alert variant="success" role="status">
            <CircleCheckIcon />
            <AlertDescription className="break-all">{done}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
