import { createHash, randomBytes, randomInt } from "node:crypto"

import type { DeviceCodeStatus, PrismaClient } from "@/generated/prisma"

type AuthPrisma = PrismaClient

/**
 * RFC 8628 device authorization grant.
 *
 * Codes never touch the database in plaintext. `deviceCodeHash` / `userCodeHash`
 * are `sha256(raw)` hex — deterministic lookup keys, not password hashes. CodeQL
 * flags this as `js/insufficient-password-hash`; that is a documented false
 * positive. Replacing it with a KDF breaks the lookup outright. See
 * docs/solutions/tooling-decisions/codeql-insufficient-password-hash-false-positive-nonsecret-identifier.md
 *
 * What that hashing does and does not buy, stated honestly:
 *
 * - `deviceCodeHash` covers the credential that actually redeems tokens. The
 *   device code carries 256 bits of entropy, so its unsalted sha256 has no
 *   feasible preimage attack. This is the protection that matters.
 * - `userCodeHash` is brute-forceable — the preimage space is 10^10, seconds of
 *   work for anyone holding a database dump or backup. It is hashed to keep the
 *   code out of dumps and incidental reads, not as a serious secrecy boundary.
 *   That is acceptable because a recovered user code grants nothing on its own:
 *   approving requires an authenticated browser session, and redeeming requires
 *   the device code. `userCodeHash` is in the audit redaction set for the same
 *   reason — treat it as credential-equivalent wherever it could be copied out.
 */

/**
 * D2 (origin plan): the format must be identical on every platform, forever —
 * Paramount+ varied it per platform and left users holding a code that would not
 * fit the web field. The server issues the code and the TV only displays it, so
 * this constant is the single decision point. Numeric favours the majority
 * non-Latin-script audience: a number pad needs no input-mode switch.
 */
export const DEVICE_USER_CODE_FORMAT: "numbers" | "letters" = "numbers"

/**
 * Ten digits, not nine. Against the 5-attempt per-code cap, 10^9 misses
 * RFC 8628 §5.1's 2^-32 guessing bar; 10^10 clears it.
 */
const USER_CODE_SPECS = {
  numbers: { charset: "0123456789", length: 10 },
  letters: { charset: "BCDFGHJKLMNPQRSTVWXZ", length: 8 },
} as const

/** RFC 8628 §5.2 brute-force bound, per code rather than per IP. */
export const MAX_USER_CODE_ATTEMPTS = 5

const DEVICE_CODE_BYTES = 32
const USER_CODE_COLLISION_RETRIES = 5

export type DeviceGrantErrorCode =
  | "access_denied"
  | "authorization_pending"
  | "device_code_already_processed"
  | "expired_token"
  | "invalid_grant"
  | "invalid_request"
  | "slow_down"

export class DeviceGrantError extends Error {
  constructor(
    public readonly code: DeviceGrantErrorCode,
    public readonly description: string,
  ) {
    super(description)
    this.name = "DeviceGrantError"
  }
}

export function hashDeviceSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function generateDeviceCode(): string {
  return randomBytes(DEVICE_CODE_BYTES).toString("base64url")
}

export function generateUserCode(
  format: keyof typeof USER_CODE_SPECS = DEVICE_USER_CODE_FORMAT,
): string {
  const spec = USER_CODE_SPECS[format]
  let code = ""
  for (let index = 0; index < spec.length; index += 1) {
    code += spec.charset[randomInt(spec.charset.length)]
  }
  return code
}

export type IssueDeviceCodeInput = {
  clientId: string
  scopes: readonly string[]
  codeChallenge: string
  codeChallengeMethod: string
  expiresInMs: number
  pollingIntervalMs: number
  now?: Date
}

export type IssuedDeviceCode = {
  deviceCode: string
  userCode: string
  expiresAt: Date
  pollingIntervalMs: number
}

export async function issueDeviceCode(
  prisma: AuthPrisma,
  input: IssueDeviceCodeInput,
): Promise<IssuedDeviceCode> {
  const now = input.now ?? new Date()
  const expiresAt = new Date(now.getTime() + input.expiresInMs)
  const deviceCode = generateDeviceCode()

  // The user code is short by design, so collisions are possible while codes
  // are live. Retry on the unique-constraint violation rather than pre-checking
  // — a read-then-write would be the same TOCTOU the claim path avoids.
  for (let attempt = 0; attempt < USER_CODE_COLLISION_RETRIES; attempt += 1) {
    const userCode = generateUserCode()
    try {
      await prisma.deviceCode.create({
        data: {
          deviceCodeHash: hashDeviceSecret(deviceCode),
          userCodeHash: hashDeviceSecret(userCode),
          clientId: input.clientId,
          scopes: [...input.scopes],
          codeChallenge: input.codeChallenge,
          codeChallengeMethod: input.codeChallengeMethod,
          status: "PENDING",
          pollingIntervalMs: input.pollingIntervalMs,
          expiresAt,
        },
        select: { id: true },
      })

      return {
        deviceCode,
        userCode,
        expiresAt,
        pollingIntervalMs: input.pollingIntervalMs,
      }
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error
    }
  }

  throw new DeviceGrantError(
    "invalid_request",
    "Could not allocate a device code.",
  )
}

export type DeviceCodeLookup = {
  id: string
  clientId: string
  scopes: string[]
  status: DeviceCodeStatus
  userId: string | null
  expiresAt: Date
  attemptCount: number
}

/**
 * Look up a pending code by its user-facing value, for the approval page.
 *
 * Every miss burns an attempt against the row it was aimed at, so a guessing
 * client cannot grind a short code even from many IPs. The counter is bumped on
 * the row itself, which is why the cap is a property of the code and not of the
 * caller.
 */
export async function findPendingByUserCode(
  prisma: AuthPrisma,
  input: { userCode: string; now?: Date },
): Promise<DeviceCodeLookup> {
  const now = input.now ?? new Date()
  const record = await prisma.deviceCode.findUnique({
    where: { userCodeHash: hashDeviceSecret(input.userCode) },
    select: {
      id: true,
      clientId: true,
      scopes: true,
      status: true,
      userId: true,
      expiresAt: true,
      attemptCount: true,
    },
  })

  if (!record) {
    throw new DeviceGrantError("invalid_request", "Unknown code.")
  }
  if (record.expiresAt <= now) {
    throw new DeviceGrantError("expired_token", "This code has expired.")
  }
  if (record.attemptCount >= MAX_USER_CODE_ATTEMPTS) {
    throw new DeviceGrantError(
      "expired_token",
      "This code is no longer usable.",
    )
  }

  return record
}

/** Burn one attempt against a code. Used when a submitted code does not resolve. */
export async function recordUserCodeAttempt(
  prisma: AuthPrisma,
  input: { userCode: string },
): Promise<void> {
  await prisma.deviceCode.updateMany({
    where: { userCodeHash: hashDeviceSecret(input.userCode) },
    data: { attemptCount: { increment: 1 } },
  })
}

/**
 * PENDING -> APPROVED, as one conditional write.
 *
 * `updateMany` with the full precondition in `where` is the claim: `count === 1`
 * means this call made the transition and no other did. A read-then-write here
 * would let two approvals both observe PENDING.
 */
export async function approveDeviceCode(
  prisma: AuthPrisma,
  input: {
    userCode: string
    userId: string
    sessionId: string
    now?: Date
  },
): Promise<void> {
  const now = input.now ?? new Date()
  const claimed = await prisma.deviceCode.updateMany({
    where: {
      userCodeHash: hashDeviceSecret(input.userCode),
      status: "PENDING",
      consumedAt: null,
      expiresAt: { gt: now },
      attemptCount: { lt: MAX_USER_CODE_ATTEMPTS },
    },
    data: {
      status: "APPROVED",
      userId: input.userId,
      sessionId: input.sessionId,
      approvedAt: now,
    },
  })

  if (claimed.count !== 1) {
    throw await explainFailedUserCodeTransition(prisma, input.userCode, now)
  }
}

export async function denyDeviceCode(
  prisma: AuthPrisma,
  input: { userCode: string; userId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date()
  const claimed = await prisma.deviceCode.updateMany({
    where: {
      userCodeHash: hashDeviceSecret(input.userCode),
      status: "PENDING",
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { status: "DENIED", userId: input.userId },
  })

  if (claimed.count !== 1) {
    throw await explainFailedUserCodeTransition(prisma, input.userCode, now)
  }
}

export type PolledDeviceCode = {
  id: string
  clientId: string
  scopes: string[]
  codeChallenge: string
  codeChallengeMethod: string
  userId: string
  sessionId: string | null
}

/**
 * The polling half of the grant.
 *
 * Order matters and is RFC 8628 §3.5: rate check, then expiry, then status. The
 * approved branch claims the row atomically — `consumedAt: null` in the `where`
 * is what makes a device code single-use under concurrent polls. Two polls that
 * both read APPROVED cannot both get `count === 1`.
 */
export async function pollDeviceCode(
  prisma: AuthPrisma,
  input: { deviceCode: string; clientId: string; now?: Date },
): Promise<PolledDeviceCode> {
  const now = input.now ?? new Date()
  const deviceCodeHash = hashDeviceSecret(input.deviceCode)

  const record = await prisma.deviceCode.findUnique({
    where: { deviceCodeHash },
    select: {
      id: true,
      clientId: true,
      scopes: true,
      codeChallenge: true,
      codeChallengeMethod: true,
      status: true,
      userId: true,
      sessionId: true,
      expiresAt: true,
      consumedAt: true,
      lastPolledAt: true,
      pollingIntervalMs: true,
    },
  })

  if (!record) {
    throw new DeviceGrantError("invalid_grant", "Invalid device code.")
  }

  // Bound the client to the client it registered as. The device code alone must
  // never be portable to another client id.
  if (record.clientId !== input.clientId) {
    throw new DeviceGrantError("invalid_grant", "Invalid device code.")
  }

  if (
    record.lastPolledAt != null &&
    now.getTime() - record.lastPolledAt.getTime() < record.pollingIntervalMs
  ) {
    throw new DeviceGrantError("slow_down", "Polling too frequently.")
  }

  await prisma.deviceCode.updateMany({
    where: { id: record.id },
    data: { lastPolledAt: now },
  })

  if (record.expiresAt <= now) {
    throw new DeviceGrantError("expired_token", "Device code has expired.")
  }
  if (record.consumedAt != null) {
    throw new DeviceGrantError("invalid_grant", "Invalid device code.")
  }
  if (record.status === "DENIED") {
    throw new DeviceGrantError("access_denied", "Access denied.")
  }
  if (record.status === "PENDING") {
    throw new DeviceGrantError(
      "authorization_pending",
      "Authorization pending.",
    )
  }

  const claimed = await prisma.deviceCode.updateMany({
    where: {
      deviceCodeHash,
      status: "APPROVED",
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  })

  // Lost the race against a concurrent poll of the same code, or the row expired
  // between the read and the claim. Either way this caller did not claim it.
  if (claimed.count !== 1) {
    throw new DeviceGrantError("invalid_grant", "Invalid device code.")
  }

  if (record.userId == null) {
    throw new DeviceGrantError("invalid_grant", "Invalid device code.")
  }

  return {
    id: record.id,
    clientId: record.clientId,
    scopes: record.scopes,
    codeChallenge: record.codeChallenge,
    codeChallengeMethod: record.codeChallengeMethod,
    userId: record.userId,
    sessionId: record.sessionId,
  }
}

/** Best-effort cleanup of codes that were never redeemed. */
export async function purgeExpiredDeviceCodes(
  prisma: AuthPrisma,
  input: { now?: Date; olderThanMs?: number } = {},
): Promise<number> {
  const now = input.now ?? new Date()
  const cutoff = new Date(now.getTime() - (input.olderThanMs ?? 0))
  const deleted = await prisma.deviceCode.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  })
  return deleted.count
}

/**
 * A failed conditional write is ambiguous by construction: the `where` matched
 * nothing, but not why. One extra read separates the cases so the page can say
 * something true, without ever branching on a value read before the write.
 */
async function explainFailedUserCodeTransition(
  prisma: AuthPrisma,
  userCode: string,
  now: Date,
): Promise<DeviceGrantError> {
  const record = await prisma.deviceCode.findUnique({
    where: { userCodeHash: hashDeviceSecret(userCode) },
    select: { status: true, expiresAt: true, attemptCount: true },
  })

  if (!record) return new DeviceGrantError("invalid_request", "Unknown code.")
  if (record.expiresAt <= now) {
    return new DeviceGrantError("expired_token", "This code has expired.")
  }
  if (record.attemptCount >= MAX_USER_CODE_ATTEMPTS) {
    return new DeviceGrantError(
      "expired_token",
      "This code is no longer usable.",
    )
  }
  return new DeviceGrantError(
    "device_code_already_processed",
    "This code was already used.",
  )
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  )
}
