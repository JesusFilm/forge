import { createHmac, timingSafeEqual } from "node:crypto"
import type { Principal } from "@/auth/principal"

const PREFIX = "forge-watch-human-v1."
const ACTION = "watch_recommendations"
const FIXTURE_HOSTNAME = "turnstile-test-fixture.local"
const PAYLOAD_KEYS = [
  "visitId",
  "browserDigest",
  "seedMediaId",
  "locale",
  "audioLanguageSlug",
  "action",
  "hostname",
  "issuedAt",
  "expiresAt",
] as const
const BASE64URL = /^[A-Za-z0-9_-]+$/
const HOSTNAME = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

export type WatchHumanReceiptInput = {
  receipt: string | null | undefined
  visitId: string
  browserDigest: string | null
  seedMediaId: string
  locale: string
  audioLanguageSlug: string
  caller: Principal | null
  now: Date
}

export type WatchHumanReceiptConfig = {
  secret: string | undefined
  allowedHostnames: string | undefined
  allowFixtureHostname?: boolean
}

/** Verify the exact, Web-signed Siteverify decision for one Watch visit.
 * Neither a browser assertion nor the ordinary traffic classifier qualifies. */
export function verifyWatchHumanReceipt(
  input: WatchHumanReceiptInput,
  config: WatchHumanReceiptConfig,
): boolean {
  if (
    input.caller?.role !== "CONSUMER_BEARER" ||
    input.caller.fleet !== false ||
    !input.caller.rateLimitBucketKey ||
    !config.secret ||
    Buffer.byteLength(config.secret, "utf8") < 32 ||
    !config.allowedHostnames ||
    !input.browserDigest ||
    !input.receipt ||
    input.receipt.length > 2_048 ||
    !Number.isFinite(input.now.getTime())
  )
    return false

  const [version, payloadB64, macB64, extra] = input.receipt.split(".")
  if (
    version !== "v1" ||
    !payloadB64 ||
    !macB64 ||
    extra !== undefined ||
    !BASE64URL.test(payloadB64) ||
    !BASE64URL.test(macB64)
  )
    return false
  const presented = Buffer.from(macB64, "base64url")
  if (presented.length !== 32 || presented.toString("base64url") !== macB64)
    return false
  const expected = createHmac("sha256", config.secret)
    .update(`${PREFIX}${payloadB64}`, "ascii")
    .digest()
  if (!timingSafeEqual(presented, expected)) return false

  const payloadBytes = Buffer.from(payloadB64, "base64url")
  if (
    payloadBytes.length > 1_024 ||
    payloadBytes.toString("base64url") !== payloadB64
  )
    return false
  const json = payloadBytes.toString("utf8")
  if (!Buffer.from(json, "utf8").equals(payloadBytes)) return false
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return false
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return false
  const fields = payload as Record<string, unknown>
  if (
    Object.keys(fields).join(",") !== PAYLOAD_KEYS.join(",") ||
    JSON.stringify(fields) !== json ||
    fields.visitId !== input.visitId ||
    fields.browserDigest !== input.browserDigest ||
    fields.seedMediaId !== input.seedMediaId ||
    fields.locale !== input.locale ||
    fields.audioLanguageSlug !== input.audioLanguageSlug ||
    fields.action !== ACTION ||
    typeof fields.hostname !== "string" ||
    !HOSTNAME.test(fields.hostname) ||
    (fields.hostname === FIXTURE_HOSTNAME &&
      (!config.allowFixtureHostname ||
        process.env.NODE_ENV === "production")) ||
    !config.allowedHostnames
      .split(",")
      .map((hostname) => hostname.trim())
      .includes(fields.hostname) ||
    typeof fields.issuedAt !== "number" ||
    !Number.isSafeInteger(fields.issuedAt) ||
    typeof fields.expiresAt !== "number" ||
    !Number.isSafeInteger(fields.expiresAt) ||
    fields.expiresAt <= fields.issuedAt ||
    fields.expiresAt - fields.issuedAt > 300
  )
    return false
  const nowSec = Math.floor(input.now.getTime() / 1_000)
  return nowSec + 30 >= fields.issuedAt && nowSec < fields.expiresAt
}
