import { eq } from "drizzle-orm";
import { keccak256, toBytes, zeroHash, type Hex } from "viem";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { job } from "@/lib/db/schema";
import { ChainActionError, RelayInputError, RelayerUnderfundedError, finalize, relayFreelancerAction } from "@/lib/escrow/relay";
import { TermsError } from "@/lib/escrow/terms";
import { isJobId } from "@/lib/jobs/format";

// Public, unauthenticated: the freelancer's signature is the only authority. Nothing is stored before the relay succeeds.

const MAX_URL = 2048;

const contentUrl = z
  .string()
  .max(MAX_URL)
  .refine((v) => {
    try {
      const { protocol } = new URL(v);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "contentUrl phải là http(s)");

const common = {
  deadline: z.string().regex(/^\d{1,20}$/),
  sig: z.string().regex(/^0x[0-9a-fA-F]+$/),
};

const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("submit"), contentUrl, ...common }),
  z.object({ kind: z.literal("decline"), ...common }),
  z.object({ kind: z.literal("finalize") }),
]);

function json(payload: unknown, status: number) {
  return Response.json(payload, { status });
}

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId: rawId } = await params;
  if (!isJobId(rawId)) return json({ error: "Mã job không hợp lệ." }, 400);
  const jobId = rawId.toLowerCase() as Hex;

  let parsed;
  try {
    parsed = body.safeParse(await req.json());
  } catch {
    return json({ error: "Dữ liệu gửi lên không hợp lệ." }, 400);
  }
  if (!parsed.success) return json({ error: "Dữ liệu gửi lên không hợp lệ." }, 400);
  const input = parsed.data;

  try {
    if (input.kind === "finalize") {
      return json({ txHash: await finalize(jobId) }, 200);
    }
    const deadline = BigInt(input.deadline);
    const sig = input.sig as Hex;
    if (input.kind === "decline") {
      return json({ txHash: await relayFreelancerAction(jobId, "decline", zeroHash, deadline, sig) }, 200);
    }
    // The hash is always recomputed here; a client-supplied hash is never trusted.
    const txHash = await relayFreelancerAction(jobId, "submit", keccak256(toBytes(input.contentUrl)), deadline, sig);
    // Only after the relay succeeded (signature verified on-chain). No row (job created elsewhere) -> skip.
    await getDb().update(job).set({ contentUrl: input.contentUrl }).where(eq(job.id, jobId));
    return json({ txHash }, 200);
  } catch (err) {
    if (err instanceof RelayInputError || err instanceof TermsError) return json({ error: err.message }, 400);
    if (err instanceof ChainActionError) return json({ error: err.message }, 409);
    if (err instanceof RelayerUnderfundedError) {
      return json({ error: "Hệ thống tạm thời không thể gửi giao dịch. Vui lòng thử lại sau." }, 503);
    }
    console.error("public job action failed:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
    return json({ error: "Có lỗi xảy ra. Vui lòng thử lại sau." }, 500);
  }
}
