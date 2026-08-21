import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import type { UserPlaylistLifecycleAuthorizer } from "./user-playlist.service"
import {
  type TrustedUserPlaylistReporterIp,
  UserPlaylistReportDetailCipher,
  UserPlaylistReporterIpDigester,
} from "./user-playlist-report-crypto"
import { UserPlaylistReportIntent } from "./user-playlist-report-intent"

// The purge runs daily. Expire material two days before the legal maximum so
// a normal run plus scheduler jitter cannot turn a 30-day policy into 31 days.
const REPORT_DETAIL_RETENTION_MS = 28 * 24 * 60 * 60 * 1000

export const USER_PLAYLIST_REPORT_CATEGORIES = [
  "INAPPROPRIATE_CONTENT",
  "MISLEADING_OR_SPAM",
  "COPYRIGHT_OR_RIGHTS",
  "PRIVACY_OR_PERSONAL_DATA",
  "OTHER_SAFETY",
] as const

export type UserPlaylistReportCategory =
  (typeof USER_PLAYLIST_REPORT_CATEGORIES)[number]

const SubmitUserPlaylistReportSchema = z
  .object({
    reportIntent: z.string().min(1).max(1_024),
    category: z.enum(USER_PLAYLIST_REPORT_CATEGORIES),
    detail: z.string().max(1_000).optional(),
  })
  .strict()

export type UserPlaylistReportLimiterInput = {
  intentDigest: string
  playlistId: string
  ipDigest: string | null
  coarseIpBucket: boolean
  globalKey: "user-playlist-report"
  now: Date
}

/**
 * Implementations must atomically consume the per-intent, playlist, IP (when
 * present), and global buckets. Returning false or throwing denies the write.
 */
export interface UserPlaylistReportLimiter {
  consume(input: UserPlaylistReportLimiterInput): Promise<boolean>
}

export type UserPlaylistReportSubmissionResult = {
  status: "RECEIVED"
}

export async function purgeExpiredUserPlaylistReportSensitiveMaterial(
  prisma: PrismaClient,
  now = new Date(),
): Promise<{ detailRows: number; reporterDigestRows: number }> {
  const [detail, reporter] = await prisma.$transaction([
    prisma.userPlaylistReport.updateMany({
      where: {
        detailDeleteAfter: { lte: now },
        detailDeletedAt: null,
      },
      data: {
        detailCiphertext: null,
        detailKeyId: null,
        detailNonce: null,
        detailAuthTag: null,
        detailDeleteAfter: null,
        detailDeletedAt: now,
      },
    }),
    prisma.userPlaylistReport.updateMany({
      where: {
        reporterDigestDeleteAfter: { lte: now },
        reporterDigestDeletedAt: null,
      },
      data: {
        reporterIpDigest: null,
        reporterIpDigestKeyId: null,
        reporterIpDigestDay: null,
        reporterDigestDeleteAfter: null,
        reporterDigestDeletedAt: now,
      },
    }),
  ])
  return {
    detailRows: detail.count,
    reporterDigestRows: reporter.count,
  }
}

const UNIFORM_RESULT: UserPlaylistReportSubmissionResult = {
  status: "RECEIVED",
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  )
}

export class UserPlaylistReportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dependencies: {
      intent: UserPlaylistReportIntent
      detailCipher: UserPlaylistReportDetailCipher
      ipDigester: UserPlaylistReporterIpDigester
      limiter: UserPlaylistReportLimiter
      lifecycle: UserPlaylistLifecycleAuthorizer
      now?: () => Date
      id?: () => string
    },
  ) {}

  issueIntent(input: {
    playlistId: string
    capabilityDigest: Uint8Array
  }): string {
    return this.dependencies.intent.mint({
      ...input,
      now: (this.dependencies.now ?? (() => new Date()))(),
    })
  }

  async submit(
    untrustedInput: unknown,
    reporterIp: TrustedUserPlaylistReporterIp | null,
  ): Promise<UserPlaylistReportSubmissionResult> {
    const input = SubmitUserPlaylistReportSchema.safeParse(untrustedInput)
    if (!input.success) return UNIFORM_RESULT

    const now = (this.dependencies.now ?? (() => new Date()))()
    let reportablePlaylist:
      | { id: string; ownerSubject: string; capabilityDigest: Uint8Array }
      | undefined

    const intent = await this.dependencies.intent.verifyCurrent({
      token: input.data.reportIntent,
      now,
      resolveCapabilityDigest: async (playlistId) => {
        const row = await this.prisma.userPlaylist.findFirst({
          where: {
            id: playlistId,
            shareState: "SHARED",
            moderationState: "ACTIVE",
            capabilityDigest: { not: null },
          },
          select: {
            id: true,
            ownerSubject: true,
            capabilityDigest: true,
          },
        })
        if (!row?.capabilityDigest) return null
        reportablePlaylist = {
          id: row.id,
          ownerSubject: row.ownerSubject,
          capabilityDigest: row.capabilityDigest,
        }
        return row.capabilityDigest
      },
    })
    if (!intent || !reportablePlaylist) return UNIFORM_RESULT
    const playlist = reportablePlaylist

    try {
      await this.dependencies.lifecycle.assertActive(playlist.ownerSubject)
    } catch {
      return UNIFORM_RESULT
    }

    const ip = this.dependencies.ipDigester.digest(reporterIp, now)
    try {
      const allowed = await this.dependencies.limiter.consume({
        intentDigest: Buffer.from(intent.intentDigest).toString("base64url"),
        playlistId: playlist.id,
        ipDigest: ip ? Buffer.from(ip.digest).toString("base64url") : null,
        coarseIpBucket: ip == null,
        globalKey: "user-playlist-report",
        now,
      })
      if (!allowed) return UNIFORM_RESULT
    } catch {
      return UNIFORM_RESULT
    }

    const reportId = (this.dependencies.id ?? randomUUID)()
    const detail = input.data.detail?.normalize("NFC") ?? null
    const detailMaterial = detail
      ? this.dependencies.detailCipher.encrypt(detail, {
          reportId,
          playlistId: playlist.id,
          category: input.data.category,
        })
      : null

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.userPlaylistReport.create({
          data: {
            id: reportId,
            playlistId: playlist.id,
            category: input.data.category,
            reportIntentDigest: Uint8Array.from(intent.intentDigest),
            reportIntentExpiresAt: intent.expiresAt,
            reporterIpDigest: ip ? Uint8Array.from(ip.digest) : null,
            reporterIpDigestKeyId: ip?.keyId ?? null,
            reporterIpDigestDay: ip?.digestDay ?? null,
            reporterDigestDeleteAfter: ip?.deleteAfter ?? null,
            reporterDigestDeletedAt: null,
            detailCiphertext: detailMaterial
              ? Uint8Array.from(detailMaterial.ciphertext)
              : null,
            detailKeyId: detailMaterial?.keyId ?? null,
            detailNonce: detailMaterial
              ? Uint8Array.from(detailMaterial.nonce)
              : null,
            detailAuthTag: detailMaterial
              ? Uint8Array.from(detailMaterial.authTag)
              : null,
            detailDeleteAfter: detailMaterial
              ? new Date(now.getTime() + REPORT_DETAIL_RETENTION_MS)
              : null,
            detailDeletedAt: null,
            createdAt: now,
          },
        })
      })
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error
    }
    return UNIFORM_RESULT
  }

  async purgeExpiredSensitiveMaterial(): Promise<{
    detailRows: number
    reporterDigestRows: number
  }> {
    const now = (this.dependencies.now ?? (() => new Date()))()
    return purgeExpiredUserPlaylistReportSensitiveMaterial(this.prisma, now)
  }
}
