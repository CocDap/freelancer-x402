/**
 * Client IP from proxy headers: first `x-forwarded-for` entry, else `x-real-ip`, else null. On Vercel these are
 * set by the platform; on a self-hosted server without a trusted proxy in front, clients can spoof them.
 */
export function clientIp(headers: Headers | null | undefined): string | null {
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers?.get("x-real-ip")?.trim() || null;
}
