import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { InvalidInputError, NotFoundError } from "./errors"
import { UserPlaylistReportDetailCipher } from "./user-playlist-report-crypto"
import { USER_PLAYLIST_REPORT_CATEGORIES } from "./user-playlist-report.service"

const BLOCK_REASONS = [
  "ABUSE",
  "COPYRIGHT",
  "PRIVACY",
  "SAFETY",
  "SPAM",
  "OTHER_POLICY",
] as const

const RESTORE_REASONS = [
  "REVIEW_CLEARED",
  "APPEAL_APPROVED",
  "ERROR_CORRECTED",
] as const

const ModeratorActorSchema = z
  .object({ actorSubject: z.string().min(1).max(255).regex(/^\S+$/) })
  .strict()

const BlockInputSchema = z
  .object({
    playlistId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    reasonCode: z.enum(BLOCK_REASONS),
  })
  .strict()

const RestoreInputSchema = z
  .object({
    playlistId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    reasonCode: z.enum(RESTORE_REASONS),
  })
  .strict()

const ReportQueueInputSchema = z
  .object({
    first: z.number().int().min(1).max(100).default(20),
    after: z.string().min(1).max(128).optional(),
    category: z.enum(USER_PLAYLIST_REPORT_CATEGORIES).optional(),
  })
  .strict()

export interface UserPlaylistModeratorAuthorizer<Credential = unknown> {
  assertModerator(
    credential: Credential,
  ): Promise<{ actorSubject: string }> | { actorSubject: string }
}

export type UserPlaylistModerationResult = {
  playlistId: string
  moderationState: "ACTIVE" | "BLOCKED"
  changed: boolean
  auditedAt: Date
}

export type UserPlaylistModeratorReport = {
  reportId: string
  playlistId: string
  category: (typeof USER_PLAYLIST_REPORT_CATEGORIES)[number]
  detailPlainText: string | null
  detailStatus: "AVAILABLE" | "ABSENT" | "EXPIRED" | "UNAVAILABLE"
  createdAt: Date
}

export type UserPlaylistModeratorReportPage = {
  items: UserPlaylistModeratorReport[]
  nextCursor: string | null
}

export class UserPlaylistModerationService<Credential = unknown> {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dependencies: {
      authorizer: UserPlaylistModeratorAuthorizer<Credential>
      detailCipher: UserPlaylistReportDetailCipher
      now?: () => Date
    },
  ) {}

  private async actor(credential: Credential): Promise<string> {
    const actor = ModeratorActorSchema.safeParse(
      await this.dependencies.authorizer.assertModerator(credential),
    )
    if (!actor.success) throw new InvalidInputError("Invalid moderator actor")
    return actor.data.actorSubject
  }

  private async changeModerationState(input: {
    playlistId: string
    action: "BLOCK" | "RESTORE"
    reasonCode:
      | (typeof BLOCK_REASONS)[number]
      | (typeof RESTORE_REASONS)[number]
    actorSubject: string
  }): Promise<UserPlaylistModerationResult> {
    const before = input.action === "BLOCK" ? "ACTIVE" : "BLOCKED"
    const after = input.action === "BLOCK" ? "BLOCKED" : "ACTIVE"
    const auditedAt = (this.dependencies.now ?? (() => new Date()))()

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.userPlaylist.updateMany({
        where: { id: input.playlistId, moderationState: before },
        data: { moderationState: after },
      })
      if (updated.count === 0) {
        const existing = await tx.userPlaylist.findUnique({
          where: { id: input.playlistId },
          select: { moderationState: true },
        })
        if (!existing) throw new NotFoundError("User Playlist")
      }
      await tx.userPlaylistModerationAudit.create({
        data: {
          playlistId: input.playlistId,
          actorSubject: input.actorSubject,
          action: input.action,
          reasonCode: input.reasonCode,
          createdAt: auditedAt,
        },
      })
      return {
        playlistId: input.playlistId,
        moderationState: after,
        changed: updated.count === 1,
        auditedAt,
      }
    })
  }

  async block(
    untrustedInput: unknown,
    credential: Credential,
  ): Promise<UserPlaylistModerationResult> {
    const actorSubject = await this.actor(credential)
    const input = BlockInputSchema.safeParse(untrustedInput)
    if (!input.success) throw new InvalidInputError("Invalid block request")
    return this.changeModerationState({
      ...input.data,
      action: "BLOCK",
      actorSubject,
    })
  }

  async restore(
    untrustedInput: unknown,
    credential: Credential,
  ): Promise<UserPlaylistModerationResult> {
    const actorSubject = await this.actor(credential)
    const input = RestoreInputSchema.safeParse(untrustedInput)
    if (!input.success) throw new InvalidInputError("Invalid restore request")
    return this.changeModerationState({
      ...input.data,
      action: "RESTORE",
      actorSubject,
    })
  }

  async listReports(
    untrustedInput: unknown,
    credential: Credential,
  ): Promise<UserPlaylistModeratorReportPage> {
    await this.actor(credential)
    const input = ReportQueueInputSchema.safeParse(untrustedInput)
    if (!input.success) {
      throw new InvalidInputError("Invalid report queue request")
    }
    const rows = await this.prisma.userPlaylistReport.findMany({
      where: input.data.category
        ? { category: input.data.category }
        : undefined,
      ...(input.data.after
        ? { cursor: { id: input.data.after }, skip: 1 }
        : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.data.first + 1,
      select: {
        id: true,
        playlistId: true,
        category: true,
        detailCiphertext: true,
        detailKeyId: true,
        detailNonce: true,
        detailAuthTag: true,
        detailDeleteAfter: true,
        detailDeletedAt: true,
        createdAt: true,
      },
    })
    const hasMore = rows.length > input.data.first
    const page = hasMore ? rows.slice(0, input.data.first) : rows
    const now = (this.dependencies.now ?? (() => new Date()))()
    return {
      items: page.map((row) => {
        let detailPlainText: string | null = null
        let detailStatus: UserPlaylistModeratorReport["detailStatus"] = "ABSENT"
        if (
          row.detailDeletedAt ||
          (row.detailDeleteAfter != null && row.detailDeleteAfter <= now)
        ) {
          detailStatus = "EXPIRED"
        } else if (
          row.detailCiphertext &&
          row.detailKeyId &&
          row.detailNonce &&
          row.detailAuthTag
        ) {
          try {
            detailPlainText = this.dependencies.detailCipher.decrypt(
              {
                ciphertext: row.detailCiphertext,
                keyId: row.detailKeyId,
                nonce: row.detailNonce,
                authTag: row.detailAuthTag,
              },
              {
                reportId: row.id,
                playlistId: row.playlistId,
                category: row.category,
              },
            )
            detailStatus = "AVAILABLE"
          } catch {
            detailStatus = "UNAVAILABLE"
          }
        } else if (
          row.detailCiphertext ||
          row.detailKeyId ||
          row.detailNonce ||
          row.detailAuthTag ||
          row.detailDeleteAfter
        ) {
          detailStatus = "UNAVAILABLE"
        }
        return {
          reportId: row.id,
          playlistId: row.playlistId,
          category: row.category,
          detailPlainText,
          detailStatus,
          createdAt: row.createdAt,
        }
      }),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    }
  }
}
