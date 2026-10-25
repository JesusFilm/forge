import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"

const SEO_CSRF_LIFETIME_SECONDS = 15 * 60
const MAX_CONSUMED_TOKENS = 10_000
const consumedTokens = new Map<string, number>()

type SeoCsrfPayload = {
  v: 1
  actorId: string
  nonce: string
  exp: number
}

export type SeoCsrfFailure = "invalid" | "expired" | "reused" | "actor_mismatch"

function getSecret(): string {
  const secret = env.MANAGER_SESSION_SECRET ?? env.MANAGER_MOCK_SESSION_SECRET
  if (!secret) throw new Error("Manager session signing is not configured")
  return secret
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", getSecret())
    .update(`seo-csrf-v1.${encodedPayload}`)
    .digest("base64url")
}

function encodePayload(payload: SeoCsrfPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url")
}

function parsePayload(value: string): SeoCsrfPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<SeoCsrfPayload>
    if (
      parsed.v !== 1 ||
      typeof parsed.actorId !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null
    }
    return parsed as SeoCsrfPayload
  } catch {
    return null
  }
}

function equalSignature(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

function purgeConsumed(nowSeconds: number) {
  for (const [nonce, expiresAt] of consumedTokens) {
    if (expiresAt <= nowSeconds) consumedTokens.delete(nonce)
  }
  while (consumedTokens.size > MAX_CONSUMED_TOKENS) {
    const oldest = consumedTokens.keys().next().value as string | undefined
    if (!oldest) break
    consumedTokens.delete(oldest)
  }
}

export function issueSeoCsrfToken(
  actorId: string,
  now = new Date(),
  nonce: string = randomUUID(),
): string {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const payload = encodePayload({
    v: 1,
    actorId,
    nonce,
    exp: nowSeconds + SEO_CSRF_LIFETIME_SECONDS,
  })
  return `${payload}.${sign(payload)}`
}

export function consumeSeoCsrfToken(
  token: string,
  actorId: string,
  now = new Date(),
): { ok: true } | { ok: false; reason: SeoCsrfFailure } {
  if (token.length > 4_096) return { ok: false, reason: "invalid" }
  const [encodedPayload, signature, extra] = token.split(".")
  if (!encodedPayload || !signature || extra) {
    return { ok: false, reason: "invalid" }
  }
  if (!equalSignature(signature, sign(encodedPayload))) {
    return { ok: false, reason: "invalid" }
  }

  const payload = parsePayload(encodedPayload)
  if (!payload) return { ok: false, reason: "invalid" }
  if (payload.actorId !== actorId) {
    return { ok: false, reason: "actor_mismatch" }
  }

  const nowSeconds = Math.floor(now.getTime() / 1000)
  purgeConsumed(nowSeconds)
  if (payload.exp <= nowSeconds) return { ok: false, reason: "expired" }
  if (consumedTokens.has(payload.nonce)) {
    return { ok: false, reason: "reused" }
  }

  consumedTokens.set(payload.nonce, payload.exp)
  return { ok: true }
}

export function resetSeoCsrfStateForTests() {
  consumedTokens.clear()
}
