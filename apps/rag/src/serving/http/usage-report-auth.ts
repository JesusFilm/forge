import { createHash, timingSafeEqual } from "node:crypto"
import { UsageError } from "../../contracts/consumer-usage.js"
/** Provision independent report secrets; consumer keys and portal ownership confer no reporting rights. */
export function reportAuthorizer(
  serialized: string,
): (secret: string | null) => Promise<boolean> {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new UsageError("unavailable")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new UsageError("unavailable")
  const entries = Object.entries(parsed)
  if (
    !entries.length ||
    entries.some(
      ([principal, hash]) =>
        !["jaco", "ragbot"].includes(principal) ||
        typeof hash !== "string" ||
        !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new UsageError("unavailable")
  const hashes = entries.map(([, hash]) => Buffer.from(hash as string, "hex"))
  return async (secret) => {
    if (!secret || secret.length > 512) return false
    const digest = createHash("sha256").update(secret).digest()
    let allowed = false
    for (const hash of hashes)
      allowed = timingSafeEqual(hash, digest) || allowed
    return allowed
  }
}
