import { createHash } from "node:crypto"

/** Existing canonical Admin hash; array order and exact string bytes are significant. */
export function studioHash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
}
