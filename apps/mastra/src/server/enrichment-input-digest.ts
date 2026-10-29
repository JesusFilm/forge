import { createHash } from "node:crypto"

/** Stable JSON binds semantically identical HTTP objects independent of key order. */
export function executionDigest(value: unknown): string {
  const normalize = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(normalize)
      : item !== null && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, val]) => [key, normalize(val)]),
          )
        : item
  return createHash("sha256")
    .update(JSON.stringify(normalize(value)))
    .digest("hex")
}
