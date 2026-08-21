import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { env, resolveUserPlaylistRuntimeControls } from "@/config/env"
import { getRedisClient } from "@/infra/redis"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "@/services/errors"
import { ConsumerLifecycleService } from "@/services/consumer-lifecycle.service"
import { UserPlaylistCapability } from "@/services/user-playlist-capability"
import { PrismaUserPlaylistMediaEligibility } from "@/services/user-playlist-media-eligibility"
import { UserPlaylistModerationService } from "@/services/user-playlist-moderation.service"
import {
  UserPlaylistReportDetailCipher,
  UserPlaylistReporterIpDigester,
} from "@/services/user-playlist-report-crypto"
import { UserPlaylistReportIntent } from "@/services/user-playlist-report-intent"
import { RedisUserPlaylistReportLimiter } from "@/services/user-playlist-report-limiter"
import { UserPlaylistReportService } from "@/services/user-playlist-report.service"
import { UserPlaylistService } from "@/services/user-playlist.service"

const KeyRingSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
        key: z.string().regex(/^[A-Za-z0-9_-]+$/),
        active: z.boolean().optional(),
      })
      .strict(),
  )
  .min(1)

export type UserPlaylistGraphqlRuntimeConfig = {
  capabilityLookupKeys?: string
  capabilityEncryptionKeys?: string
  reportIntentKeys?: string
  reportDetailKeys?: string
  reportIpKeys?: string
  termsVersion?: string
  privacyVersion?: string
  communityGuidelinesVersion?: string
}

export class UserPlaylistGraphqlRuntimeConfigurationError extends Error {
  constructor() {
    super("User Playlist runtime is not configured")
    this.name = "UserPlaylistGraphqlRuntimeConfigurationError"
  }
}

function parseRing(raw: string | undefined) {
  if (!raw) throw new UserPlaylistGraphqlRuntimeConfigurationError()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new UserPlaylistGraphqlRuntimeConfigurationError()
  }
  const entries = KeyRingSchema.safeParse(parsed)
  if (!entries.success) throw new UserPlaylistGraphqlRuntimeConfigurationError()
  return entries.data.map((entry) => {
    const key = Buffer.from(entry.key, "base64url")
    if (key.byteLength !== 32 || key.toString("base64url") !== entry.key) {
      throw new UserPlaylistGraphqlRuntimeConfigurationError()
    }
    return { id: entry.id, key, active: entry.active }
  })
}

function optionalPolicyVersions(config: UserPlaylistGraphqlRuntimeConfig) {
  const values = [
    config.termsVersion,
    config.privacyVersion,
    config.communityGuidelinesVersion,
  ]
  if (values.every((value) => value == null)) return undefined
  if (
    values.some(
      (value) =>
        typeof value !== "string" || value.length === 0 || value.length > 64,
    )
  ) {
    throw new UserPlaylistGraphqlRuntimeConfigurationError()
  }
  return {
    terms: config.termsVersion!,
    privacy: config.privacyVersion!,
    communityGuidelines: config.communityGuidelinesVersion!,
  }
}

export function createUserPlaylistGraphqlRuntime(
  prisma: PrismaClient,
  config: UserPlaylistGraphqlRuntimeConfig,
  redis: ConstructorParameters<typeof RedisUserPlaylistReportLimiter>[0],
) {
  const lifecycle = new ConsumerLifecycleService(prisma)
  let playlistService: UserPlaylistService | undefined
  let reportService: UserPlaylistReportService | undefined
  let moderationService:
    | UserPlaylistModerationService<Principal | null>
    | undefined

  const detailCipher = () =>
    new UserPlaylistReportDetailCipher({
      keys: parseRing(config.reportDetailKeys),
    })

  return {
    playlist(): UserPlaylistService {
      playlistService ??= new UserPlaylistService(prisma, {
        lifecycle,
        mediaEligibility: new PrismaUserPlaylistMediaEligibility(prisma),
        capability: new UserPlaylistCapability({
          lookupKeys: parseRing(config.capabilityLookupKeys),
          encryptionKeys: parseRing(config.capabilityEncryptionKeys),
        }),
        policyVersions: optionalPolicyVersions(config),
        publicReadsEnabled: () =>
          resolveUserPlaylistRuntimeControls().anonymousPublicReadEnabled,
      })
      return playlistService
    },
    report(): UserPlaylistReportService {
      reportService ??= new UserPlaylistReportService(prisma, {
        intent: new UserPlaylistReportIntent({
          keys: parseRing(config.reportIntentKeys),
        }),
        detailCipher: detailCipher(),
        ipDigester: new UserPlaylistReporterIpDigester({
          keys: parseRing(config.reportIpKeys),
        }),
        limiter: new RedisUserPlaylistReportLimiter(redis),
        lifecycle,
      })
      return reportService
    },
    moderation(): UserPlaylistModerationService<Principal | null> {
      moderationService ??= new UserPlaylistModerationService(prisma, {
        detailCipher: detailCipher(),
        authorizer: {
          assertModerator: (principal) => {
            if (
              principal?.role !== "ADMIN" ||
              typeof principal.id !== "string" ||
              principal.id.length === 0
            ) {
              throw new ForbiddenError()
            }
            return { actorSubject: principal.id }
          },
        },
      })
      return moderationService
    },
  }
}

export type UserPlaylistGraphqlRuntime = ReturnType<
  typeof createUserPlaylistGraphqlRuntime
>

const runtimes = new WeakMap<PrismaClient, UserPlaylistGraphqlRuntime>()

export function getUserPlaylistGraphqlRuntime(
  prisma: PrismaClient,
): UserPlaylistGraphqlRuntime {
  const existing = runtimes.get(prisma)
  if (existing) return existing
  const runtime = createUserPlaylistGraphqlRuntime(
    prisma,
    {
      capabilityLookupKeys: env.USER_PLAYLIST_CAPABILITY_LOOKUP_KEYS,
      capabilityEncryptionKeys: env.USER_PLAYLIST_CAPABILITY_ENCRYPTION_KEYS,
      reportIntentKeys: env.USER_PLAYLIST_REPORT_INTENT_KEYS,
      reportDetailKeys: env.USER_PLAYLIST_REPORT_DETAIL_KEYS,
      reportIpKeys: env.USER_PLAYLIST_REPORT_IP_KEYS,
      termsVersion: env.USER_PLAYLIST_TERMS_VERSION,
      privacyVersion: env.USER_PLAYLIST_PRIVACY_VERSION,
      communityGuidelinesVersion:
        env.USER_PLAYLIST_COMMUNITY_GUIDELINES_VERSION,
    },
    getRedisClient(),
  )
  runtimes.set(prisma, runtime)
  return runtime
}
