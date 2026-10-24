import { createHash } from "node:crypto"

/**
 * Stable non-secret per-fleet-key id: first 12 hex of sha256(rawKey). Safe to
 * bucket on and log; not reversible to the key. SECURITY: the raw key must
 * never appear in a bucket name or a log line.
 */
export function fleetKeyIdFromRawKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex").slice(0, 12)
}
