import { Badge } from "@/components/ui/badge";

type Variant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive";

const VARIANTS: Record<string, Variant> = {
  None: "outline",
  Funded: "secondary",
  Submitted: "warning",
  RevisionRequested: "warning",
  Released: "success",
  Refunded: "outline",
  Split: "outline",
};

/** Colour follows the on-chain state; the label is passed in so buyer and freelancer pages keep their own wording. */
export function JobStatusBadge({ stateName, label }: { stateName: string; label: string }) {
  return <Badge variant={VARIANTS[stateName] ?? "outline"}>{label}</Badge>;
}
