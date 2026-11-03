"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { keccak256, toBytes, zeroHash, type Address, type Hex } from "viem";
import { useConnect, useConnection, useConnectors, useDisconnect, useSignTypedData, useSwitchChain } from "wagmi";
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

  const btn = "rounded bg-black px-3 py-2 text-white disabled:opacity-50";

  return (
    <section className="flex flex-col gap-3 rounded border border-zinc-300 p-4">
      <h2 className="text-lg font-medium">Dành cho freelancer</h2>

      {!connected ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-zinc-600">Kết nối ví freelancer để nộp bài hoặc từ chối. Bạn không cần AVAX để trả phí gas.</p>
          <button
            type="button"
            className={btn}
            disabled={connect.isPending || connectors.length === 0}
            onClick={() => connect.mutate({ connector: connectors[0], chainId: p.chainId })}
          >
            {connect.isPending ? "Đang kết nối..." : "Kết nối ví"}
          </button>
          {connect.isError && <p role="alert" className="text-sm text-red-700">Không kết nối được ví. Hãy cài ví (ví dụ MetaMask) và thử lại.</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono break-all">{connection.address}</span>
          <button type="button" className="underline" onClick={() => disconnect.mutate()}>Ngắt kết nối</button>
        </div>
      )}

      {wrongWallet && (
        <p role="alert" className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm">Ví này không phải ví freelancer của job</p>
      )}

      {(p.canSubmit || p.canDecline) && (
        <div className="flex flex-col gap-2">
          {p.canSubmit && (
            <label className="flex flex-col gap-1 text-sm">
              Link bài
              <input
                type="url"
                value={contentUrl}
                onChange={(e) => setContentUrl(e.target.value)}
                placeholder="https://..."
                maxLength={2048}
                className="rounded border border-zinc-300 p-2"
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {p.canSubmit && (
              <button type="button" className={btn} disabled={!canSign} onClick={submit}>
                {busy ? "Đang xử lý..." : "Nộp bài"}
              </button>
            )}
            {p.canDecline && (
              <button type="button" className={btn} disabled={!canSign} onClick={decline}>
                Từ chối nhận việc
              </button>
            )}
          </div>
        </div>
      )}

      {p.canFinalize && (
        <div>
          <button type="button" className={btn} disabled={busy} onClick={finalizeJob}>
            {busy ? "Đang xử lý..." : "Hoàn tất"}
          </button>
        </div>
      )}

      {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {done && <p className="break-all rounded border border-green-300 bg-green-50 p-3 text-sm">{done}</p>}
    </section>
  );
}
