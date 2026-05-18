// Partner API key service — issuance / list / revoke / rotate / verify.
//
// Backed by the `PartnerApiKey` Prisma model. Consumed by:
//   - `src/auth/search-bearer.ts` (verifyPartnerToken — first branch of
//     the bearer-as-passport composer)
//   - `src/scripts/partner-keys.ts` (CLI: create / list / revoke / rotate /
//     import-from-env)
//   - `src/app/dashboard/partner-keys/page.tsx` (read-only dashboard view)
//
// Design notes:
//
// - Verification wraps the Prisma lookup in `Promise.race` against a
//   1500ms budget. On timeout the validator returns `{ valid: false }`
//   so the OR-composer falls through to the env-CSV branches (in
//   dual-accept) or fails closed (after env-CSV retirement). Pattern
//   per `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`.
//
// - `lastUsedAt` updates are fire-and-forget — they MUST NOT block the
//   request and MUST NOT crash on Prisma errors. Pattern per
//   `docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md`.
//   No slot is reserved (the service is stateless), so a simple
//   `.catch()` observability wrapper is sufficient.
//
// - Plaintext tokens NEVER persist. `createPartnerKey` returns the
//   plaintext exactly once for the caller to display; subsequent calls
//   only return the stored hash.

import { Prisma } from "@prisma/client"
import { prisma as defaultPrisma } from "@/db/client"
import {
  generatePartnerToken,
  hashRawToken,
  parsePartnerToken,
  timingSafeEqualHex,
} from "@/auth/partner-token"

/** Hot-path lookup timeout. Shorter than any sensible upstream caller budget. */
export const PARTNER_KEY_LOOKUP_TIMEOUT_MS = 1500

type PrismaLike = typeof defaultPrisma

/** Public-safe projection — never includes `keyHash`. */
export type PartnerApiKeySummary = {
  id: string
  keyId: string
  name: string
  ownerEmail: string
  note: string | null
  createdAt: Date
  updatedAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdById: string | null
  revokedById: string | null
}

export type CreatePartnerKeyInput = {
  name: string
  ownerEmail: string
  note?: string | null
  createdById?: string | null
}

export type ImportFromEnvInput = {
  rawToken: string
  name: string
  ownerEmail: string
  note?: string | null
  createdById?: string | null
}

/** Issuance result. `rawToken` is shown to the operator EXACTLY ONCE. */
export type CreatePartnerKeyResult = {
  keyId: string
  rawToken: string
  record: PartnerApiKeySummary
}

/** Verify result. `keyId` is omitted on failure to keep the type narrow. */
export type VerifyPartnerTokenResult =
  | { valid: true; keyId: string }
  | { valid: false }

/** Thrown when a CLI / service caller references a keyId that doesn't exist. */
export class PartnerKeyNotFoundError extends Error {
  readonly keyId: string
  constructor(keyId: string) {
    super(`PartnerApiKey not found: keyId=${keyId}`)
    this.name = "PartnerKeyNotFoundError"
    this.keyId = keyId
  }
}

/** Thrown when `import-from-env` is asked to seed a token whose hash already exists. */
export class PartnerKeyAlreadyExistsError extends Error {
  readonly keyHashPrefix: string
  constructor(keyHashPrefix: string) {
    super(
      `PartnerApiKey already exists for this token (keyHash starts with ${keyHashPrefix}…)`,
    )
    this.name = "PartnerKeyAlreadyExistsError"
    this.keyHashPrefix = keyHashPrefix
  }
}

const SUMMARY_SELECT = {
  id: true,
  keyId: true,
  name: true,
  ownerEmail: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  lastUsedAt: true,
  revokedAt: true,
  createdById: true,
  revokedById: true,
} as const satisfies Prisma.PartnerApiKeySelect

// ---------------------------------------------------------------------------
// Issuance / mutation
// ---------------------------------------------------------------------------

/**
 * Issue a fresh partner key. Generates the token, hashes it, persists the
 * row. Returns the plaintext exactly once — caller MUST present it to the
 * operator with a "save this now" banner, since the row only stores the
 * sha256 hash.
 */
export async function createPartnerKey(
  input: CreatePartnerKeyInput,
  prisma: PrismaLike = defaultPrisma,
): Promise<CreatePartnerKeyResult> {
  const { keyId, rawToken, keyHash } = generatePartnerToken()
  const record = await prisma.partnerApiKey.create({
    data: {
      keyId,
      keyHash,
      name: input.name,
      ownerEmail: input.ownerEmail,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
    select: SUMMARY_SELECT,
  })
  return { keyId, rawToken, record }
}

/**
 * Seed a partner key row from an existing plaintext token (used by the
 * one-time `partner-keys import-from-env` CLI subcommand to migrate
 * today's `SEARCH_API_KEYS` entries into the DB without changing the
 * token value the partner already holds).
 *
 * The keyId is fabricated — the legacy env-CSV token has no embedded
 * keyId, so we generate a fresh one for log/dashboard surfacing. The
 * `rawToken` parameter is the existing opaque value and stays
 * authoritative; this function never returns the plaintext (operator
 * already has it).
 */
export async function importPartnerKeyFromPlaintext(
  input: ImportFromEnvInput,
  prisma: PrismaLike = defaultPrisma,
): Promise<PartnerApiKeySummary> {
  const keyHash = hashRawToken(input.rawToken)
  const existing = await prisma.partnerApiKey.findUnique({
    where: { keyHash },
    select: { keyHash: true },
  })
  if (existing) {
    throw new PartnerKeyAlreadyExistsError(keyHash.slice(0, 8))
  }
  // Generate a synthetic keyId since legacy tokens don't carry one.
  // Use the token-format generator just for the keyId segment.
  const { keyId } = generatePartnerToken()
  return prisma.partnerApiKey.create({
    data: {
      keyId,
      keyHash,
      name: input.name,
      ownerEmail: input.ownerEmail,
      note: input.note ?? "Imported from SEARCH_API_KEYS env CSV.",
      createdById: input.createdById ?? null,
    },
    select: SUMMARY_SELECT,
  })
}

/**
 * Idempotently mark a key as revoked. Already-revoked keys return the
 * existing row unchanged (no error). Throws `PartnerKeyNotFoundError`
 * for unknown keyIds so the CLI / dashboard can give the operator a
 * clean error message.
 */
export async function revokePartnerKey(
  args: { keyId: string; revokedById?: string | null },
  prisma: PrismaLike = defaultPrisma,
): Promise<PartnerApiKeySummary> {
  const existing = await prisma.partnerApiKey.findUnique({
    where: { keyId: args.keyId },
    select: { id: true, revokedAt: true },
  })
  if (!existing) {
    throw new PartnerKeyNotFoundError(args.keyId)
  }
  if (existing.revokedAt) {
    return prisma.partnerApiKey.findUniqueOrThrow({
      where: { keyId: args.keyId },
      select: SUMMARY_SELECT,
    })
  }
  return prisma.partnerApiKey.update({
    where: { keyId: args.keyId },
    data: {
      revokedAt: new Date(),
      revokedById: args.revokedById ?? null,
    },
    select: SUMMARY_SELECT,
  })
}

/**
 * Issue a new key for the same partner, leaving the old key active.
 * Operator coordinates the partner cutover (new token shared via Slack
 * DM), then calls `revokePartnerKey(oldKeyId)` once the new key has
 * non-null `lastUsedAt` in logs / dashboard.
 */
export async function rotatePartnerKey(
  args: { keyId: string; createdById?: string | null },
  prisma: PrismaLike = defaultPrisma,
): Promise<{
  old: PartnerApiKeySummary
  fresh: CreatePartnerKeyResult
}> {
  const old = await prisma.partnerApiKey.findUnique({
    where: { keyId: args.keyId },
    select: SUMMARY_SELECT,
  })
  if (!old) {
    throw new PartnerKeyNotFoundError(args.keyId)
  }
  const fresh = await createPartnerKey(
    {
      name: old.name,
      ownerEmail: old.ownerEmail,
      note: old.note
        ? `Rotation of ${old.keyId}: ${old.note}`
        : `Rotation of ${old.keyId}`,
      createdById: args.createdById ?? null,
    },
    prisma,
  )
  return { old, fresh }
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export type ListPartnerKeysOptions = {
  includeRevoked?: boolean
}

/**
 * List all partner keys for the operator surface (CLI / dashboard).
 * Default `includeRevoked: false` filters out soft-revoked rows; set to
 * true for the full audit trail. Sorted by `lastUsedAt DESC NULLS LAST,
 * createdAt DESC` so active integrations float to the top and never-used
 * keys (NULL lastUsedAt) cluster at the bottom of the active set.
 *
 * Never returns `keyHash` — the projection enforces it.
 */
export async function listPartnerKeys(
  options: ListPartnerKeysOptions = {},
  prisma: PrismaLike = defaultPrisma,
): Promise<PartnerApiKeySummary[]> {
  return prisma.partnerApiKey.findMany({
    where: options.includeRevoked ? {} : { revokedAt: null },
    orderBy: [
      { lastUsedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    select: SUMMARY_SELECT,
  })
}

// ---------------------------------------------------------------------------
// Hot-path verify
// ---------------------------------------------------------------------------

/**
 * Verify an `Authorization: Bearer …` header against the DB-backed key
 * store. Returns `{ valid: true, keyId }` on a constant-time-compared
 * hash match for a non-revoked row; `{ valid: false }` otherwise.
 *
 * Implementation notes:
 *
 * 1. Parse the prefix first — if the token shape isn't `jfp_search_*`,
 *    fall through without a DB call. This makes the partner branch
 *    cheap for every request that carries a different bearer shape
 *    (consumer / workflow / legacy search-csv tokens).
 *
 * 2. Wrap the Prisma `findUnique` in `Promise.race` against
 *    `PARTNER_KEY_LOOKUP_TIMEOUT_MS`. Postgres outage → typed
 *    timeout → `{ valid: false }` so the composer can fall through.
 *
 * 3. On match, fire-and-forget `lastUsedAt` update. NEVER `await` it
 *    — the response would block waiting for a DB write the request
 *    doesn't need to see. `.catch()` swallows + logs any error so a
 *    transient Prisma hiccup can't crash the request handler.
 *
 * 4. Constant-time hash compare via `timingSafeEqualHex`. Decoded
 *    buffers are 32 bytes each, length-checked before compare.
 */
export async function verifyPartnerToken(
  authHeader: string | null,
  prisma: PrismaLike = defaultPrisma,
): Promise<VerifyPartnerTokenResult> {
  const parsed = parsePartnerToken(authHeader)
  if (!parsed) return { valid: false }

  const presentedHash = hashRawToken(parsed.rawToken)

  let row: { keyId: string; keyHash: string; revokedAt: Date | null } | null
  try {
    row = await raceWithTimeout(
      prisma.partnerApiKey.findUnique({
        where: { keyId: parsed.keyId },
        select: { keyId: true, keyHash: true, revokedAt: true },
      }),
      PARTNER_KEY_LOOKUP_TIMEOUT_MS,
    )
  } catch (err) {
    if (err instanceof PartnerKeyLookupTimeoutError) {
      // Plain-string log per Railway logsV2 silencing learning.
      console.error(
        `[search] event=partner_key.lookup_timeout keyId=${parsed.keyId} budgetMs=${PARTNER_KEY_LOOKUP_TIMEOUT_MS}`,
      )
    } else {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[search] event=partner_key.lookup_error keyId=${parsed.keyId} error=${sanitizeLogValue(message)}`,
      )
    }
    return { valid: false }
  }

  if (!row) return { valid: false }
  if (row.revokedAt) return { valid: false }

  if (!timingSafeEqualHex(presentedHash, row.keyHash)) {
    return { valid: false }
  }

  // Fire-and-forget last-used timestamp update. MUST NOT throw, MUST
  // NOT block. Sync throws inside the body (Prisma client construction,
  // etc.) are caught by the outer try; async rejection caught by
  // `.catch()`. See `in-memory-slot-reservation-fire-and-forget-20260506`.
  try {
    void prisma.partnerApiKey
      .update({
        where: { keyId: row.keyId },
        data: { lastUsedAt: new Date() },
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(
          `[search] event=partner_key.last_used_at_update_failed keyId=${row?.keyId} error=${sanitizeLogValue(message)}`,
        )
      })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(
      `[search] event=partner_key.last_used_at_update_failed keyId=${row.keyId} error=${sanitizeLogValue(message)}`,
    )
  }

  return { valid: true, keyId: row.keyId }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Typed error raised when the Prisma lookup exceeds the budget. */
class PartnerKeyLookupTimeoutError extends Error {
  constructor(budgetMs: number) {
    super(`PartnerApiKey lookup exceeded ${budgetMs}ms budget`)
    this.name = "PartnerKeyLookupTimeoutError"
  }
}

/**
 * `Promise.race` between the work promise and a timeout. The timer is
 * cleared as soon as the work resolves so we never leak a `setTimeout`
 * handle. Throws `PartnerKeyLookupTimeoutError` on budget expiry.
 */
async function raceWithTimeout<T>(
  work: Promise<T>,
  budgetMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race<T>([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new PartnerKeyLookupTimeoutError(budgetMs))
        }, budgetMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Strip CR/LF so a thrown error message can't inject newlines into the
 * structured log line. Mirrors the log-injection-sanitizer pattern from
 * the keyword-first mode-normalization helper.
 */
function sanitizeLogValue(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").slice(0, 200)
}
