import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { studioRpcSchema } from "@forge/studio-contracts/transport"
import { studioDocumentSchema, studioIdSchema } from "@forge/studio-contracts"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "../errors"
import { StudioAuthoringService } from "./index"
import { StudioAssetService } from "./assets"
import { StudioSourceService, resolveStudioDocumentSources } from "./sources"
import { StudioTransferService } from "./transfers"
import { ContentPackService } from "./packs"

/** A verified session assertion identifies a user; current DB membership grants access. */
export async function interactiveStudioPrincipal(
  db: PrismaClient,
  userId: string,
): Promise<Principal> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { managerMembership: true },
  })
  if (
    !user ||
    user.managerMembership?.role !== "OPERATOR" ||
    user.managerMembership.revokedAt
  )
    throw new ForbiddenError("Current Studio operator membership required")
  return {
    id: user.id,
    role: user.role,
    managerRole: "OPERATOR",
    studioAuthority: "interactive",
  }
}

/** Narrow endpoint, shared canonical services; never dispatch a caller-supplied actor. */
export async function executeStudioInteractive(
  db: PrismaClient,
  user: Principal,
  raw: unknown,
) {
  if (user.studioAuthority !== "interactive") throw new ForbiddenError()
  return executeStudioRpc(db, user, raw)
}

/** Canonical dispatcher; authorization is supplied only by verified server transports. */
export async function executeStudioRpc(
  db: PrismaClient,
  user: Principal,
  raw: unknown,
) {
  const { action, input } = studioRpcSchema.parse(raw)
  const commands = new StudioAuthoringService(db),
    assets = new StudioAssetService(db),
    sources = new StudioSourceService(db),
    packs = new ContentPackService(db),
    transfers = new StudioTransferService(db)
  switch (action) {
    case "create":
      return commands.create(user, input)
    case "apply":
      return commands.apply(user, input)
    case "approve":
      return commands.approve(user, input)
    case "unpublish":
      return commands.unpublish(user, input)
    case "list":
      return commands.listSummaries(user, input)
    case "read":
      return commands.read(user, studioIdSchema.parse(input))
    case "history": {
      const v = z
        .object({
          projectId: studioIdSchema,
          beforeRevision: z.number().int().positive().optional(),
        })
        .strict()
        .parse(input)
      return commands.history(user, v.projectId, {
        beforeRevision: v.beforeRevision,
        limit: 20,
      })
    }
    case "assets":
      return assets.list(user, input)
    case "asset":
      return assets.read(user, input)
    case "packs":
      return packs.list(user, input)
    case "pack":
      return packs.read(user, studioIdSchema.parse(input))
    case "capture":
      return sources.capture(user, input)
    case "source":
      return sources.read(user, studioIdSchema.parse(input))
    case "eligibility":
      return sources.eligibility(user, studioIdSchema.parse(input))
    case "asset-read":
      return transfers.issue(user, "read", input)
    case "asset-upload":
      return transfers.issue(user, "upload", input)
    case "preview-sources": {
      const v = z
        .object({ projectId: studioIdSchema, document: studioDocumentSchema })
        .strict()
        .parse(input)
      await commands.read(user, v.projectId)
      return db.$transaction((tx) =>
        resolveStudioDocumentSources(tx, v.document),
      )
    }
    case "sources": {
      const project = await commands.read(user, studioIdSchema.parse(input))
      return db.$transaction((tx) =>
        resolveStudioDocumentSources(tx, project.document),
      )
    }
    case "search": {
      const v = z
        .object({
          search: z.string().max(200).default(""),
          language: studioIdSchema,
        })
        .strict()
        .parse(input)
      const dubs = await db.videoDub.findMany({
        where: {
          published: true,
          downloadable: true,
          deletedAt: null,
          language: { slug: v.language, deletedAt: null },
          videoEdition: { deletedAt: null },
          video: {
            deletedAt: null,
            noIndex: false,
            NOT: { restrictViewPlatforms: { hasSome: ["watch", "studio"] } },
            locales: {
              some: {
                status: "PUBLISHED",
                deletedAt: null,
                title: { contains: v.search, mode: "insensitive" },
              },
            },
          },
        },
        take: 30,
        orderBy: { id: "asc" },
        include: {
          video: {
            select: {
              id: true,
              locales: {
                where: { status: "PUBLISHED", deletedAt: null },
                take: 1,
                select: { title: true },
              },
            },
          },
          downloads: {
            where: { deletedAt: null, url: { not: null } },
            orderBy: { height: "desc" },
            take: 10,
          },
          videoEdition: {
            include: {
              subtitles: {
                where: {
                  deletedAt: null,
                  language: { slug: v.language },
                  vttSrc: { not: null },
                },
                orderBy: [{ primary: "desc" }, { aiGenerated: "asc" }],
                take: 10,
              },
            },
          },
        },
      })
      return dubs
        .filter(
          (d) =>
            d.hls && d.downloads.length && d.videoEdition?.subtitles.length,
        )
        .map((d) => ({
          videoId: d.videoId,
          dubId: d.id,
          editionId: d.videoEditionId,
          language: v.language,
          title: d.video.locales[0]?.title ?? d.videoId,
          durationMs: Number(d.lengthInMilliseconds),
          tracks: d.videoEdition!.subtitles.map((t) => ({
            id: t.id,
            primary: t.primary,
            aiGenerated: t.aiGenerated,
          })),
          downloads: d.downloads.map((x) => ({
            id: x.id,
            width: x.width,
            height: x.height,
            quality: x.quality,
          })),
        }))
    }
  }
}
