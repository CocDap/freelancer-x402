import type { FieldName } from "@/lib/jobs/errors";

export type CreateJobState = {
  error?: string;
  /** true when the error is chain/relayer related and should render as a banner */
  banner?: boolean;
  fieldErrors?: Partial<Record<FieldName, string>>;
  values?: Record<string, string>;
};

export type ActionResult = { ok: true; txHash: string } | { ok: false; error: string };
