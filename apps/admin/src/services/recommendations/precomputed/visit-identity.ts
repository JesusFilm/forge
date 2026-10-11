import { createHash } from "node:crypto"

/** One browser unit per frozen experiment, never the raw signed cookie. */
export function precomputedBrowserUnitDigest(
  experimentId: string,
  browserDigest: string,
): string {
  return createHash("sha256")
    .update(
      ["precomputed-browser-unit-v1", experimentId, browserDigest].join("\0"),
    )
    .digest("hex")
}
