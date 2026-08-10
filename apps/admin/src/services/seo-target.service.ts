import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"

type SeoTransaction = Prisma.TransactionClient

export class SeoTargetStaleError extends Error {
  constructor() {
    super("The SEO proposal target changed after analysis")
    this.name = "SeoTargetStaleError"
  }
}

export class SeoTargetConflictError extends Error {
  constructor() {
    super("The SEO proposal target already has an active draft")
    this.name = "SeoTargetConflictError"
  }
}

export class SeoTargetUnsupportedError extends Error {
  constructor() {
    super("The SEO proposal target cannot be materialized")
    this.name = "SeoTargetUnsupportedError"
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function seoContentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function pickFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    [...fields].map((field) => [field, value[field] ?? null]),
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function treatmentFields(
  diff: unknown,
  allowed: ReadonlySet<string>,
): Record<string, unknown> {
  const record = asRecord(diff)
  if (!record || Object.keys(record).length === 0) {
    throw new SeoTargetUnsupportedError()
  }
  const result: Record<string, unknown> = {}
  for (const [field, raw] of Object.entries(record)) {
    if (!allowed.has(field)) throw new SeoTargetUnsupportedError()
    const exactDiff = asRecord(raw)
    result[field] = exactDiff && "after" in exactDiff ? exactDiff.after : raw
  }
  return result
}

const VIDEO_FIELDS = new Set([
  "title",
  "description",
  "snippet",
  "imageAlt",
  "searchTitle",
  "searchDescription",
  "socialImageAssetId",
])

const EXPERIENCE_FIELDS = new Set([
  "slug",
  "isHomepage",
  "pathSegment",
  "title",
  "metaDescription",
  "ogTitle",
  "ogDescription",
  "ogImageUrl",
  "blocks",
])

export function seoVideoLocaleActivationHash(
  value: Record<string, unknown>,
): string {
  return seoContentHash(pickFields(value, VIDEO_FIELDS))
}

export function seoExperienceLocaleActivationHash(
  value: Record<string, unknown>,
): string {
  return seoContentHash(pickFields(value, EXPERIENCE_FIELDS))
}

export function seoVideoLocaleSnapshot(row: {
  id: string
  videoId: string
  locale: string | null
  languageId: string | null
  languageSlug: string | null
  languageCoreId: string | null
  source: string
  title: string | null
  description: string | null
  snippet: string | null
  imageAlt: string | null
  searchTitle: string | null
  searchDescription: string | null
  socialImageAssetId: string | null
  status: string
  publishedAt: Date | null
  syncedAt: Date | null
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    videoId: row.videoId,
    locale: row.locale,
    languageId: row.languageId,
    languageSlug: row.languageSlug,
    languageCoreId: row.languageCoreId,
    source: row.source,
    title: row.title,
    description: row.description,
    snippet: row.snippet,
    imageAlt: row.imageAlt,
    searchTitle: row.searchTitle,
    searchDescription: row.searchDescription,
    socialImageAssetId: row.socialImageAssetId,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    syncedAt: row.syncedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function seoExperienceLocaleSnapshot(row: {
  id: string
  experienceId: string
  locale: string
  slug: string
  isHomepage: boolean
  pathSegment: string | null
  title: string | null
  metaDescription: string | null
  ogTitle: string | null
  ogDescription: string | null
  ogImageUrl: string | null
  blocks: Prisma.JsonValue
  status: string
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    experienceId: row.experienceId,
    locale: row.locale,
    slug: row.slug,
    isHomepage: row.isHomepage,
    pathSegment: row.pathSegment,
    title: row.title,
    metaDescription: row.metaDescription,
    ogTitle: row.ogTitle,
    ogDescription: row.ogDescription,
    ogImageUrl: row.ogImageUrl,
    blocks: row.blocks,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export type SeoEditorialVersion = {
  id: string
  baseContentHash: string | null
  editorialDiff: Prisma.JsonValue | null
  proposal: { targetType: string; targetId: string | null; locale: string }
}

export type SeoDraftMaterialization = {
  revisionId: string
  editorPath: string
  preChangeSnapshot: Prisma.InputJsonObject
  treatmentSnapshot: Prisma.InputJsonObject
  preChangeHash: string
  treatmentHash: string
  expectedActivationHash: string
}

export class SeoTargetService {
  async materializeEditorialDraft({
    tx,
    version,
    actorId,
  }: {
    tx: SeoTransaction
    version: SeoEditorialVersion
    actorId: string
  }): Promise<SeoDraftMaterialization> {
    if (!version.proposal.targetId) throw new SeoTargetStaleError()
    if (version.proposal.targetType === "VideoLocale") {
      return this.materializeVideoLocale({ tx, version, actorId })
    }
    if (version.proposal.targetType === "ExperienceLocale") {
      return this.materializeExperienceLocale({ tx, version, actorId })
    }
    throw new SeoTargetUnsupportedError()
  }

  private async materializeVideoLocale({
    tx,
    version,
    actorId,
  }: {
    tx: SeoTransaction
    version: SeoEditorialVersion
    actorId: string
  }): Promise<SeoDraftMaterialization> {
    const targetId = version.proposal.targetId!
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM video_locale WHERE id = ${targetId} FOR UPDATE`,
    )
    const row = await tx.videoLocale.findUnique({ where: { id: targetId } })
    if (
      !row ||
      row.deletedAt ||
      row.status === "ARCHIVED" ||
      (row.locale ?? row.languageSlug) !== version.proposal.locale
    ) {
      throw new SeoTargetStaleError()
    }
    const before = seoVideoLocaleSnapshot(row)
    if (
      !version.baseContentHash ||
      seoContentHash(before) !== version.baseContentHash
    ) {
      throw new SeoTargetStaleError()
    }
    await this.assertNoDraft(tx, "VideoLocale", row.id)
    const treatment = treatmentFields(version.editorialDiff, VIDEO_FIELDS)
    const after = { ...before, ...treatment }
    const revision = await this.createDraft({
      tx,
      entityType: "VideoLocale",
      entityId: row.id,
      snapshot: { v: 1, data: after },
      actorId,
    })
    return {
      revisionId: revision.id,
      editorPath: `/dashboard/videos?videoId=${encodeURIComponent(row.videoId)}&videoLocaleId=${encodeURIComponent(row.id)}`,
      preChangeSnapshot: { v: 1, data: before } as Prisma.InputJsonObject,
      treatmentSnapshot: { v: 1, data: after } as Prisma.InputJsonObject,
      preChangeHash: seoContentHash(before),
      treatmentHash: seoContentHash(after),
      expectedActivationHash: seoVideoLocaleActivationHash(after),
    }
  }

  private async materializeExperienceLocale({
    tx,
    version,
    actorId,
  }: {
    tx: SeoTransaction
    version: SeoEditorialVersion
    actorId: string
  }): Promise<SeoDraftMaterialization> {
    const targetId = version.proposal.targetId!
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM experience_locale WHERE id = ${targetId} FOR UPDATE`,
    )
    const row = await tx.experienceLocale.findUnique({
      where: { id: targetId },
      include: { experience: { select: { archivedAt: true } } },
    })
    if (
      !row ||
      row.experience.archivedAt ||
      row.status === "ARCHIVED" ||
      row.locale !== version.proposal.locale
    ) {
      throw new SeoTargetStaleError()
    }
    const before = seoExperienceLocaleSnapshot(row)
    if (
      !version.baseContentHash ||
      seoContentHash(before) !== version.baseContentHash
    ) {
      throw new SeoTargetStaleError()
    }
    await this.assertNoDraft(tx, "ExperienceLocale", row.id)
    const treatment = treatmentFields(version.editorialDiff, EXPERIENCE_FIELDS)
    const after = { ...before, ...treatment }
    const revision = await this.createDraft({
      tx,
      entityType: "ExperienceLocale",
      entityId: row.id,
      snapshot: { v: 1, data: after },
      actorId,
    })
    return {
      revisionId: revision.id,
      editorPath: `/dashboard/experiences/${encodeURIComponent(row.experienceId)}?locale=${encodeURIComponent(row.locale)}`,
      preChangeSnapshot: { v: 1, data: before } as Prisma.InputJsonObject,
      treatmentSnapshot: { v: 1, data: after } as Prisma.InputJsonObject,
      preChangeHash: seoContentHash(before),
      treatmentHash: seoContentHash(after),
      expectedActivationHash: seoExperienceLocaleActivationHash(after),
    }
  }

  async currentHashes({
    tx,
    targetType,
    targetId,
    locale,
  }: {
    tx: SeoTransaction
    targetType: string
    targetId: string | null
    locale: string
  }): Promise<{ contentHash: string; activationHash: string } | null> {
    if (!targetId) return null
    if (targetType === "VideoLocale") {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM video_locale WHERE id = ${targetId} FOR SHARE`,
      )
      const row = await tx.videoLocale.findUnique({ where: { id: targetId } })
      if (
        !row ||
        row.deletedAt ||
        row.status === "ARCHIVED" ||
        (row.locale ?? row.languageSlug) !== locale
      ) {
        return null
      }
      const snapshot = seoVideoLocaleSnapshot(row)
      return {
        contentHash: seoContentHash(snapshot),
        activationHash: seoVideoLocaleActivationHash(snapshot),
      }
    }
    if (targetType === "ExperienceLocale") {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM experience_locale WHERE id = ${targetId} FOR SHARE`,
      )
      const row = await tx.experienceLocale.findUnique({
        where: { id: targetId },
        include: { experience: { select: { archivedAt: true } } },
      })
      if (
        !row ||
        row.experience.archivedAt ||
        row.status === "ARCHIVED" ||
        row.locale !== locale
      ) {
        return null
      }
      const snapshot = seoExperienceLocaleSnapshot(row)
      return {
        contentHash: seoContentHash(snapshot),
        activationHash: seoExperienceLocaleActivationHash(snapshot),
      }
    }
    return null
  }

  private async assertNoDraft(
    tx: SeoTransaction,
    entityType: string,
    entityId: string,
  ) {
    const existing = await tx.contentRevision.findFirst({
      where: { entityType, entityId, status: "DRAFT" },
      select: { id: true },
    })
    if (existing) throw new SeoTargetConflictError()
  }

  private async createDraft({
    tx,
    entityType,
    entityId,
    snapshot,
    actorId,
  }: {
    tx: SeoTransaction
    entityType: string
    entityId: string
    snapshot: Prisma.InputJsonObject
    actorId: string
  }) {
    try {
      return await tx.contentRevision.create({
        data: {
          entityType,
          entityId,
          snapshot,
          status: "DRAFT",
          revisedBy: actorId,
          revisedByKind: "AI",
          reason: "Approved SEO proposal",
        },
        select: { id: true },
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new SeoTargetConflictError()
      }
      throw error
    }
  }
}
