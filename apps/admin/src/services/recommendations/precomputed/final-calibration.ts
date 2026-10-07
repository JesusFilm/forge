import { createHash, createPublicKey, verify } from "node:crypto"
import { z } from "zod"

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/
const HEX = /^[a-f0-9]{64}$/
const BASE64URL = /^[A-Za-z0-9_-]+$/
const HOUR_MS = 3_600_000
const MAX_HOURS = 60 * 24
const FRESHNESS_MS = 15 * 60_000

const trustedKeys = z.record(
  z.string().regex(ID),
  z
    .object({
      sourceId: z.string().regex(ID),
      boundMethod: z.string().regex(ID),
      publicKeyPem: z.string().min(1).max(4_096),
    })
    .strict(),
)

const claimsSchema = z
  .object({
    contractVersion: z.literal("precomputed-final-calibration-v1"),
    authority: z.literal("independent_browser_edge"),
    sourceId: z.string().regex(ID),
    sourceRunId: z.string().regex(ID),
    experimentId: z.string().regex(ID),
    generationId: z.string().regex(ID),
    configurationDigest: z.string().regex(HEX),
    policyDigest: z.string().regex(HEX),
    startsAt: z.string(),
    endsAt: z.string(),
    finalAt: z.string(),
    observedAt: z.string(),
    collectionMode: z.literal("independent_initiation_and_web_receipt_v1"),
    boundMethod: z.string().regex(ID),
    coverage: z.literal("complete"),
    dropRetryProbe: z.literal("passed"),
    deliveryInitiated: z.number().int().safe().positive(),
    deliveryReachedWeb: z.number().int().safe().nonnegative(),
    clickInitiated: z.number().int().safe().positive(),
    clickReachedWeb: z.number().int().safe().nonnegative(),
    lossUpperBoundRate: z.number().min(0).max(1),
    quietHourBits: z.string().min(1).max(512).regex(BASE64URL),
  })
  .strict()

export type FinalCalibrationClaims = z.infer<typeof claimsSchema>

export class FinalCalibrationError extends Error {
  constructor(
    readonly code:
      | "invalid_assertion"
      | "untrusted_attestor"
      | "stale_assertion"
      | "incomplete_calibration"
      | "incompatible_target"
      | "already_final"
      | "already_attested",
  ) {
    super(code)
    this.name = "FinalCalibrationError"
  }
}

function exactIso(value: string): Date | null {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
    ? date
    : null
}

function digest(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex")
}

/** A missing Redis hour is quiet only when this independent signed bitset
 * explicitly says no experiment request was initiated in that UTC hour. */
export function calibrationQuietHours(
  claims: FinalCalibrationClaims,
): Set<string> {
  const start = new Date(claims.startsAt).getTime()
  const end = new Date(claims.finalAt).getTime()
  const hours = (end - start) / HOUR_MS
  const bytes = Buffer.from(claims.quietHourBits, "base64url")
  if (
    !Number.isSafeInteger(hours) ||
    hours < 1 ||
    hours > MAX_HOURS ||
    bytes.length !== Math.ceil(hours / 8) ||
    bytes.toString("base64url") !== claims.quietHourBits
  )
    throw new FinalCalibrationError("incomplete_calibration")
  const quiet = new Set<string>()
  for (let index = 0; index < bytes.length * 8; index++) {
    const set = (bytes[Math.floor(index / 8)]! & (1 << (index % 8))) !== 0
    if (index >= hours) {
      if (set) throw new FinalCalibrationError("incomplete_calibration")
      continue
    }
    if (set)
      quiet.add(
        new Date(start + index * HOUR_MS)
          .toISOString()
          .slice(0, 13)
          .replace(/[-T]/g, ""),
      )
  }
  return quiet
}

export type VerifiedFinalCalibration = {
  claims: FinalCalibrationClaims
  keyId: string
  sourceId: string
  publicKeyDigest: string
  assertionDigest: string
  quietHours: ReadonlySet<string>
}

type AttemptCounts = Pick<
  FinalCalibrationClaims,
  | "deliveryInitiated"
  | "deliveryReachedWeb"
  | "clickInitiated"
  | "clickReachedWeb"
  | "lossUpperBoundRate"
>

type ScopedAttemptCounts = {
  delivery_attempt: number
  delivery_response_failed: number
  click_attempt: number
  click_unavailable: number
}

/** Both sources count request attempts, including retries. An independently
 * observed request absent from scoped Web telemetry is loss, and a scoped
 * failed response is loss too; neither may disappear behind a balanced hash. */
export function reconcileFinalCalibrationLoss(
  independent: AttemptCounts,
  scoped: ScopedAttemptCounts,
): {
  upperBoundRate: number
  unattributedDeliveryAttempts: number
  unattributedClickAttempts: number
} | null {
  if (
    !Number.isSafeInteger(independent.deliveryInitiated) ||
    independent.deliveryInitiated < 1 ||
    !Number.isSafeInteger(independent.deliveryReachedWeb) ||
    independent.deliveryReachedWeb < 0 ||
    independent.deliveryReachedWeb > independent.deliveryInitiated ||
    !Number.isSafeInteger(independent.clickInitiated) ||
    independent.clickInitiated < 1 ||
    !Number.isSafeInteger(independent.clickReachedWeb) ||
    independent.clickReachedWeb < 0 ||
    independent.clickReachedWeb > independent.clickInitiated ||
    !Number.isFinite(independent.lossUpperBoundRate) ||
    independent.lossUpperBoundRate < 0 ||
    independent.lossUpperBoundRate > 1 ||
    !Number.isSafeInteger(scoped.delivery_attempt) ||
    scoped.delivery_attempt < 0 ||
    scoped.delivery_attempt > independent.deliveryReachedWeb ||
    !Number.isSafeInteger(scoped.delivery_response_failed) ||
    scoped.delivery_response_failed < 0 ||
    scoped.delivery_response_failed > scoped.delivery_attempt ||
    !Number.isSafeInteger(scoped.click_attempt) ||
    scoped.click_attempt < 0 ||
    scoped.click_attempt > independent.clickReachedWeb ||
    !Number.isSafeInteger(scoped.click_unavailable) ||
    scoped.click_unavailable < 0 ||
    scoped.click_unavailable > scoped.click_attempt
  )
    return null
  const unattributedDeliveryAttempts =
    independent.deliveryReachedWeb - scoped.delivery_attempt
  const unattributedClickAttempts =
    independent.clickReachedWeb - scoped.click_attempt
  const downstreamLossRate = Math.max(
    (unattributedDeliveryAttempts + scoped.delivery_response_failed) /
      independent.deliveryInitiated,
    (unattributedClickAttempts + scoped.click_unavailable) /
      independent.clickInitiated,
  )
  return {
    upperBoundRate: Math.min(
      1,
      independent.lossUpperBoundRate + downstreamLossRate,
    ),
    unattributedDeliveryAttempts,
    unattributedClickAttempts,
  }
}

/** Verify a compact Ed25519 JWS with a separately configured source/method
 * binding. The operator only transports the signed assertion, not its counts. */
export async function verifyFinalCalibrationAssertion(
  assertion: string,
  trustedKeyring: string | undefined,
  now = new Date(),
  options: { allowHistorical?: boolean } = {},
): Promise<VerifiedFinalCalibration> {
  if (
    !trustedKeyring ||
    typeof assertion !== "string" ||
    assertion.length > 8_192 ||
    !Number.isFinite(now.getTime())
  )
    throw new FinalCalibrationError("untrusted_attestor")
  let keyring: z.infer<typeof trustedKeys>
  try {
    keyring = trustedKeys.parse(JSON.parse(trustedKeyring))
  } catch {
    throw new FinalCalibrationError("untrusted_attestor")
  }
  const parts = assertion.split(".")
  if (
    parts.length !== 3 ||
    parts.some((part) => !part || !BASE64URL.test(part))
  )
    throw new FinalCalibrationError("invalid_assertion")
  let header: unknown
  try {
    const headerBytes = Buffer.from(parts[0]!, "base64url")
    if (headerBytes.toString("base64url") !== parts[0])
      throw new Error("noncanonical_header")
    header = JSON.parse(headerBytes.toString("utf8"))
  } catch {
    throw new FinalCalibrationError("invalid_assertion")
  }
  if (
    !header ||
    typeof header !== "object" ||
    Array.isArray(header) ||
    Object.keys(header).sort().join(",") !== "alg,kid,typ"
  )
    throw new FinalCalibrationError("invalid_assertion")
  const fields = header as Record<string, unknown>
  if (
    fields.alg !== "EdDSA" ||
    fields.typ !== "precomputed-calibration+jws" ||
    typeof fields.kid !== "string" ||
    !ID.test(fields.kid)
  )
    throw new FinalCalibrationError("invalid_assertion")
  const keyRecord = Object.hasOwn(keyring, fields.kid)
    ? keyring[fields.kid]
    : undefined
  if (!keyRecord) throw new FinalCalibrationError("untrusted_attestor")
  let key: ReturnType<typeof createPublicKey>
  try {
    key = createPublicKey(keyRecord.publicKeyPem.replaceAll("\\n", "\n"))
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong_key_type")
    const signature = Buffer.from(parts[2]!, "base64url")
    if (
      signature.length !== 64 ||
      signature.toString("base64url") !== parts[2] ||
      !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, signature)
    )
      throw new Error("invalid_signature")
  } catch {
    throw new FinalCalibrationError("invalid_assertion")
  }
  let claims: FinalCalibrationClaims
  try {
    const payloadBytes = Buffer.from(parts[1]!, "base64url")
    if (payloadBytes.toString("base64url") !== parts[1])
      throw new Error("noncanonical_payload")
    claims = claimsSchema.parse(JSON.parse(payloadBytes.toString("utf8")))
  } catch {
    throw new FinalCalibrationError("incomplete_calibration")
  }
  const startsAt = exactIso(claims.startsAt)
  const endsAt = exactIso(claims.endsAt)
  const finalAt = exactIso(claims.finalAt)
  const observedAt = exactIso(claims.observedAt)
  if (
    claims.sourceId !== keyRecord.sourceId ||
    claims.boundMethod !== keyRecord.boundMethod
  )
    throw new FinalCalibrationError("untrusted_attestor")
  if (
    !startsAt ||
    !endsAt ||
    !finalAt ||
    !observedAt ||
    startsAt.getTime() % HOUR_MS !== 0 ||
    endsAt.getTime() % HOUR_MS !== 0 ||
    finalAt.getTime() % HOUR_MS !== 0 ||
    !(startsAt < endsAt && endsAt <= finalAt && finalAt <= observedAt) ||
    claims.deliveryReachedWeb > claims.deliveryInitiated ||
    claims.clickReachedWeb > claims.clickInitiated ||
    claims.lossUpperBoundRate <
      Math.max(
        (claims.deliveryInitiated - claims.deliveryReachedWeb) /
          claims.deliveryInitiated,
        (claims.clickInitiated - claims.clickReachedWeb) /
          claims.clickInitiated,
      )
  )
    throw new FinalCalibrationError("incomplete_calibration")
  if (
    observedAt > now ||
    (!options.allowHistorical &&
      now.getTime() - observedAt.getTime() > FRESHNESS_MS)
  )
    throw new FinalCalibrationError("stale_assertion")
  const quietHours = calibrationQuietHours(claims)
  return {
    claims,
    keyId: fields.kid,
    sourceId: claims.sourceId,
    publicKeyDigest: digest(
      key.export({ format: "der", type: "spki" }) as Buffer,
    ),
    assertionDigest: digest(assertion),
    quietHours,
  }
}
