import {
  decodeProtectedHeader,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose"
import { z } from "zod"
import {
  RECOMMENDATION_CONTRACTS,
  RecommendationEvidenceKind,
} from "./contracts"

export const DELIVERY_CAPABILITY_LIFETIME_SECONDS = 10 * 60
export const EPISODE_CAPABILITY_ACTIVE_SECONDS = 4 * 60 * 60
export const EPISODE_CAPABILITY_HARD_SECONDS = 6 * 60 * 60
export const RECOMMENDATION_TOKEN_CLOCK_SKEW_SECONDS = 5 * 60

const ISSUER = "forge-admin"
const DELIVERY_AUDIENCE = "forge-web-recommendation-evidence"
const EPISODE_AUDIENCE = "forge-web-recommendation-playback"
const DELIVERY_TYP = "recommendation-delivery+jwt"
const EPISODE_TYP = "recommendation-episode+jwt"
const KID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const KeyringDocument = z
  .object({
    keys: z
      .array(
        z
          .object({
            kid: z.string(),
            status: z.enum(["active", "previous"]),
            key: z.string(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()

export class RecommendationTokenConfigurationError extends Error {
  constructor() {
    super("Recommendation capability keyring configuration is invalid")
    this.name = "RecommendationTokenConfigurationError"
  }
}

export class RecommendationTokenInvalidError extends Error {
  constructor() {
    super("Recommendation capability is invalid")
    this.name = "RecommendationTokenInvalidError"
  }
}

export type RecommendationKey = Readonly<{
  kid: string
  status: "active" | "previous"
  material: Uint8Array
}>

export type RecommendationKeyring = Readonly<{
  active: RecommendationKey
  keysById: ReadonlyMap<string, RecommendationKey>
}>

function decodeKeyMaterial(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new RecommendationTokenConfigurationError()
  }
  const decoded = new Uint8Array(Buffer.from(encoded, "base64url"))
  if (decoded.byteLength < 32) {
    throw new RecommendationTokenConfigurationError()
  }
  return decoded
}

export function parseRecommendationKeyring(
  raw: string | undefined,
): RecommendationKeyring {
  try {
    if (!raw) throw new RecommendationTokenConfigurationError()
    const parsed = KeyringDocument.parse(JSON.parse(raw))
    const keys = parsed.keys.map((entry) => {
      if (!KID_PATTERN.test(entry.kid)) {
        throw new RecommendationTokenConfigurationError()
      }
      return {
        kid: entry.kid,
        status: entry.status,
        material: decodeKeyMaterial(entry.key),
      } satisfies RecommendationKey
    })
    if (new Set(keys.map((entry) => entry.kid)).size !== keys.length) {
      throw new RecommendationTokenConfigurationError()
    }
    const active = keys.filter((entry) => entry.status === "active")
    if (active.length !== 1) {
      throw new RecommendationTokenConfigurationError()
    }
    return {
      active: active[0],
      keysById: new Map(keys.map((entry) => [entry.kid, entry])),
    }
  } catch (error) {
    if (error instanceof RecommendationTokenConfigurationError) throw error
    throw new RecommendationTokenConfigurationError()
  }
}

const CommonClaims = z.object({
  jti: z.string().min(1).max(191),
  iss: z.literal(ISSUER),
  aud: z.union([z.string(), z.array(z.string())]),
  iat: z.number().int(),
  exp: z.number().int(),
})

const DeliveryClaims = CommonClaims.extend({
  typ: z.literal(DELIVERY_TYP),
  requestId: z.string().min(1).max(191),
  itemId: z.string().min(1).max(191),
  sessionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  surface: z.literal(RECOMMENDATION_CONTRACTS.surface),
  manifestId: z.string().min(1).max(191),
  assignmentId: z.string().min(1).max(191).optional(),
  experimentId: z.string().min(1).max(191).optional(),
  experimentVersion: z.string().min(1).max(64).optional(),
  experimentGeneration: z.number().int().positive().optional(),
  experimentArm: z.enum(["control", "challenger"]).optional(),
  effectiveManifestId: z.string().min(1).max(191).optional(),
  assignmentProbability: z.number().positive().max(1).optional(),
  assignmentConfigurationDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
})

const EpisodeClaims = CommonClaims.extend({
  typ: z.literal(EPISODE_TYP),
  episodeId: z.string().min(1).max(191),
  requestId: z.string().min(1).max(191).optional(),
  itemId: z.string().min(1).max(191).optional(),
  sessionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  mediaId: z.string().min(1).max(191),
  generation: z.number().int().positive(),
  hardExp: z.number().int(),
}).superRefine((claims, context) => {
  if ((claims.requestId == null) !== (claims.itemId == null)) {
    context.addIssue({
      code: "custom",
      message: "Episode recommendation lineage must be complete",
    })
  }
})

export type DeliveryCapabilityBinding = Omit<
  z.infer<typeof DeliveryClaims>,
  "typ" | "iss" | "aud" | "iat" | "exp"
>

export type EpisodeCapabilityBinding = Omit<
  z.infer<typeof EpisodeClaims>,
  "typ" | "iss" | "aud" | "iat" | "exp" | "hardExp"
>

type TokenServiceDependencies = Readonly<{
  keyring: RecommendationKeyring
  readRevokedKids: () => Promise<readonly string[]>
  now?: () => Date
}>

function exactBindings(
  payload: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => payload[key] === value,
  )
}

const assignmentClaimKeys = [
  "assignmentId",
  "experimentId",
  "experimentVersion",
  "experimentGeneration",
  "experimentArm",
  "effectiveManifestId",
  "assignmentProbability",
  "assignmentConfigurationDigest",
] as const

function exactAssignmentBindings(
  payload: z.infer<typeof DeliveryClaims>,
  expected: DeliveryCapabilityBinding,
): boolean {
  const present = assignmentClaimKeys.filter(
    (key) => payload[key] !== undefined,
  ).length
  if (present !== 0 && present !== assignmentClaimKeys.length) return false
  return assignmentClaimKeys.every((key) => payload[key] === expected[key])
}

function hasCompleteAssignmentBindings(
  binding: DeliveryCapabilityBinding,
): boolean {
  const present = assignmentClaimKeys.filter(
    (key) => binding[key] !== undefined,
  ).length
  return present === 0 || present === assignmentClaimKeys.length
}

export function createRecommendationTokenService(
  dependencies: TokenServiceDependencies,
) {
  const now = dependencies.now ?? (() => new Date())

  async function assertKidUsable(kid: string): Promise<void> {
    const revoked = await dependencies.readRevokedKids()
    if (revoked.length > 32 || revoked.includes(kid)) {
      throw new RecommendationTokenInvalidError()
    }
  }

  async function sign(
    typ: typeof DELIVERY_TYP | typeof EPISODE_TYP,
    audience: typeof DELIVERY_AUDIENCE | typeof EPISODE_AUDIENCE,
    claims: JWTPayload,
    lifetimeSeconds: number,
    issuedAtSeconds?: number,
    signingKid?: string,
  ): Promise<string> {
    const signingKey =
      signingKid == null
        ? dependencies.keyring.active
        : dependencies.keyring.keysById.get(signingKid)
    if (!signingKey) throw new RecommendationTokenInvalidError()
    await assertKidUsable(signingKey.kid)
    const issuedAt = issuedAtSeconds ?? Math.floor(now().getTime() / 1_000)
    return new SignJWT({ ...claims, typ })
      .setProtectedHeader({
        alg: "HS256",
        typ,
        kid: signingKey.kid,
      })
      .setIssuer(ISSUER)
      .setAudience(audience)
      .setJti(String(claims.jti))
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + lifetimeSeconds)
      .sign(signingKey.material)
  }

  async function verify(
    token: string,
    typ: typeof DELIVERY_TYP | typeof EPISODE_TYP,
    audience: typeof DELIVERY_AUDIENCE | typeof EPISODE_AUDIENCE,
    clockToleranceSeconds: number,
    currentDate: Date,
  ): Promise<JWTPayload> {
    try {
      const header = decodeProtectedHeader(token)
      if (
        header.alg !== "HS256" ||
        header.typ !== typ ||
        !header.kid ||
        !KID_PATTERN.test(header.kid)
      ) {
        throw new RecommendationTokenInvalidError()
      }
      const key = dependencies.keyring.keysById.get(header.kid)
      if (!key) throw new RecommendationTokenInvalidError()
      await assertKidUsable(header.kid)
      const result = await jwtVerify(token, key.material, {
        algorithms: ["HS256"],
        issuer: ISSUER,
        audience,
        typ,
        clockTolerance: clockToleranceSeconds,
        currentDate,
      })
      return result.payload
    } catch (error) {
      if (error instanceof RecommendationTokenInvalidError) throw error
      throw new RecommendationTokenInvalidError()
    }
  }

  return {
    async signDeliveryCapability(
      binding: DeliveryCapabilityBinding,
    ): Promise<string> {
      if (!hasCompleteAssignmentBindings(binding)) {
        throw new RecommendationTokenInvalidError()
      }
      return sign(
        DELIVERY_TYP,
        DELIVERY_AUDIENCE,
        binding,
        DELIVERY_CAPABILITY_LIFETIME_SECONDS,
      )
    },

    async verifyDeliveryCapability(
      token: string,
      expected: DeliveryCapabilityBinding,
    ) {
      const receivedAt = now()
      const payload = await verify(
        token,
        DELIVERY_TYP,
        DELIVERY_AUDIENCE,
        0,
        receivedAt,
      )
      const parsed = DeliveryClaims.safeParse(payload)
      const receivedAtSeconds = Math.floor(receivedAt.getTime() / 1_000)
      if (
        !parsed.success ||
        parsed.data.exp - parsed.data.iat !==
          DELIVERY_CAPABILITY_LIFETIME_SECONDS ||
        parsed.data.exp <= receivedAtSeconds ||
        !exactBindings(parsed.data, expected) ||
        !exactAssignmentBindings(parsed.data, expected)
      ) {
        throw new RecommendationTokenInvalidError()
      }
      return parsed.data
    },

    async signEpisodeCapability(
      binding: EpisodeCapabilityBinding,
      replay?: { issuedAt: Date; signingKid: string },
    ): Promise<string> {
      const issuedAt = Math.floor((replay?.issuedAt ?? now()).getTime() / 1_000)
      return sign(
        EPISODE_TYP,
        EPISODE_AUDIENCE,
        { ...binding, hardExp: issuedAt + EPISODE_CAPABILITY_HARD_SECONDS },
        EPISODE_CAPABILITY_ACTIVE_SECONDS,
        issuedAt,
        replay?.signingKid,
      )
    },

    async verifyEpisodeCapability(
      token: string,
      input: EpisodeCapabilityBinding & {
        eventKind: RecommendationEvidenceKind
        occurredAt: Date
        receivedAt: Date
      },
    ) {
      const payload = await verify(
        token,
        EPISODE_TYP,
        EPISODE_AUDIENCE,
        EPISODE_CAPABILITY_HARD_SECONDS - EPISODE_CAPABILITY_ACTIVE_SECONDS,
        input.receivedAt,
      )
      const parsed = EpisodeClaims.safeParse(payload)
      const { occurredAt, receivedAt } = input
      const expected: Record<string, unknown> = { ...input }
      delete expected.eventKind
      delete expected.occurredAt
      delete expected.receivedAt
      if (
        !parsed.success ||
        parsed.data.exp - parsed.data.iat !==
          EPISODE_CAPABILITY_ACTIVE_SECONDS ||
        parsed.data.hardExp - parsed.data.iat !==
          EPISODE_CAPABILITY_HARD_SECONDS ||
        !exactBindings(parsed.data, expected)
      ) {
        throw new RecommendationTokenInvalidError()
      }
      const occurredAtSeconds = Math.floor(occurredAt.getTime() / 1_000)
      const receivedAtSeconds = Math.floor(receivedAt.getTime() / 1_000)
      if (
        occurredAtSeconds <
          parsed.data.iat - RECOMMENDATION_TOKEN_CLOCK_SKEW_SECONDS ||
        occurredAtSeconds >
          receivedAtSeconds + RECOMMENDATION_TOKEN_CLOCK_SKEW_SECONDS ||
        occurredAtSeconds > parsed.data.exp ||
        receivedAtSeconds > parsed.data.hardExp
      ) {
        throw new RecommendationTokenInvalidError()
      }
      const late = receivedAtSeconds > parsed.data.exp
      return { ...parsed.data, late }
    },
  }
}
