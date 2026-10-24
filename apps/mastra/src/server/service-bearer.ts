import { timingSafeEqual } from "node:crypto"

const bearerPrefix = /^Bearer\s+/i

export function parseServiceApiKeys(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
}

export function isValidServiceBearer({
  authHeader,
  allowlist,
}: {
  authHeader: string | null | undefined
  allowlist: readonly string[]
}): boolean {
  if (!authHeader || !bearerPrefix.test(authHeader)) return false
  const presented = authHeader.replace(bearerPrefix, "")
  if (presented.length === 0 || allowlist.length === 0) return false

  const presentedBuffer = Buffer.from(presented)
  let matched = false

  for (const key of allowlist) {
    const keyBuffer = Buffer.from(key)
    if (keyBuffer.length !== presentedBuffer.length) continue
    if (timingSafeEqual(presentedBuffer, keyBuffer)) {
      matched = true
    }
  }

  return matched
}

export function unauthorizedJson() {
  return new Response(JSON.stringify({ error: "Service bearer required" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  })
}
