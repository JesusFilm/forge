// Experience service — CRUD + list + getBySlug.
//
// Mutation methods: (1) Zod parse input, (2) ABAC check, (3) Prisma call.
// Read methods: (1) tier check, (2) role-based WHERE filtering, (3) Prisma call.
// Resolvers delegate here; they never call Prisma directly for mutations.

import { after } from "next/server"
import { randomBytes } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { isEditorOrAdmin, type Principal } from "@/auth/principal"
import {
  hasPermission,
  canViewExperience,
  canEditExperienceLocale,
  canPublishExperienceLocale,
  canArchiveExperience,
} from "@/auth/permissions"
import { start } from "workflow/api"
import {
  ConcurrentModificationError,
  ExperienceDuplicationError,
  ForbiddenError,
  NotFoundError,
} from "./errors"
import { BlocksSchema } from "@/domain/blocks"
import { runExperienceEmbedding } from "@/workflows/experienceEmbedding"
import { emitRevalidateWebhook } from "./revalidate-webhook"
import { refreshWatchRouteManifest } from "./watch-route-manifest-refresh.service"
import { backfillExperienceVideoLanguageIds } from "./experience-video-language-backfill"
import {
  CreateExperienceInput,
  DuplicateExperienceInput,
  CreateExperienceLocaleInput,
  UpdateExperienceLocaleInput,
  PublishExperienceLocaleInput,
  DiscardExperienceLocaleDraftInput,
  RestoreExperienceLocaleRevisionInput,
  ArchiveExperienceInput,
  ChatMutationInput,
  ExperienceLocaleDraftDataSchema,
  type ExperienceLocaleDraftData,
} from "./experience.schemas"

function availableDuplicateSlug(
  sourceSlug: string,
  usedSlugs: Set<string>,
): string {
  for (let copyNumber = 1; ; copyNumber += 1) {
    const suffix = copyNumber === 1 ? "-copy" : `-copy-${copyNumber}`
    const base =
      sourceSlug.slice(0, 200 - suffix.length).replace(/-+$/g, "") ||
      "experience"
    const candidate = `${base}${suffix}`
    if (!usedSlugs.has(candidate)) {
      usedSlugs.add(candidate)
      return candidate
    }
  }
}

export class ExperienceEmbeddingEligibilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExperienceEmbeddingEligibilityError"
  }
}

function snapshotEnvelope(
  data: Prisma.InputJsonObject,
): Prisma.InputJsonObject {
  return { v: 1, data }
}

/**
 * Refresh the watch-route manifest snapshot reliably without blocking the
 * editor response.
 *
 * The refresh regenerates AND persists the snapshot apps/web reads to admit
 * `/watch` routes, so it MUST run to completion — but the editor must not wait
 * on it. A bare `void` is dropped when a Next standalone Server Action / route
 * handler returns before the detached promise settles, which left freshly
 * published experiences absent from the snapshot and their watch preview 404'd
 * until the next refresh happened to land. We start the refresh immediately and
 * hand the in-flight promise to `after()`, which keeps the runtime alive until
 * it settles after the response is flushed. Outside a request scope (unit
 * tests, CLIs) `after()` throws, so we fall back to the detached promise.
 * `refreshWatchRouteManifest` never rejects (it returns a typed outcome), so
 * neither path risks an unhandled rejection.
 */
function refreshManifestAfterResponse(
  args: Parameters<typeof refreshWatchRouteManifest>[0],
): void {
  const refresh = refreshWatchRouteManifest(args)
  try {
    after(() => refresh)
  } catch {
    void refresh
  }
}

type LocaleSnapshotSource = {
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
  blocks: unknown
  status: string
  publishedAt: Date | null
  createdAt?: Date
  updatedAt?: Date
}

function draftDataFromLocale(
  locale: LocaleSnapshotSource,
): ExperienceLocaleDraftData {
  return ExperienceLocaleDraftDataSchema.parse({
    slug: locale.slug,
    isHomepage: locale.isHomepage,
    pathSegment: locale.pathSegment,
    title: locale.title,
    metaDescription: locale.metaDescription,
    ogTitle: locale.ogTitle,
    ogDescription: locale.ogDescription,
    ogImageUrl: locale.ogImageUrl,
    blocks: locale.blocks,
  })
}

function snapshotExperienceLocale(
  locale: LocaleSnapshotSource,
): Prisma.InputJsonObject {
  return snapshotEnvelope(
    draftDataFromLocale(locale) as unknown as Prisma.InputJsonObject,
  )
}

function asSnapshotRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function effectiveDraftData(
  canonical: LocaleSnapshotSource,
  snapshot: unknown,
): ExperienceLocaleDraftData {
  const base = draftDataFromLocale(canonical)
  const envelope = asSnapshotRecord(snapshot)
  const data = asSnapshotRecord(envelope?.data)
  // Older and SEO-created revisions may be partial. Adopt them by filling all
  // missing locale-owned fields from canonical before the next write.
  return ExperienceLocaleDraftDataSchema.parse({ ...base, ...(data ?? {}) })
}

function effectiveLocale<T extends LocaleSnapshotSource>(
  canonical: T,
  data: ExperienceLocaleDraftData,
): Omit<T, keyof ExperienceLocaleDraftData> & ExperienceLocaleDraftData {
  return { ...canonical, ...data }
}

export class ExperienceService {
  constructor(private prisma: PrismaClient) {}

  private async stageLocaleDraft({
    id,
    patch,
    user,
    revisedByKind,
    reason,
  }: {
    id: string
    patch: Partial<ExperienceLocaleDraftData>
    user: Principal | null
    revisedByKind: "USER" | "AI"
    reason: string
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM experience_locale WHERE id = ${id} FOR UPDATE`,
        )
        const canonical = await tx.experienceLocale.findUniqueOrThrow({
          where: { id },
          include: {
            experience: {
              select: { ownerId: true, archivedAt: true, isTemplate: true },
            },
          },
        })
        if (!canEditExperienceLocale(user, canonical)) {
          throw new ForbiddenError()
        }

        const activeDraft = await tx.contentRevision.findFirst({
          where: {
            entityType: "ExperienceLocale",
            entityId: id,
            status: "DRAFT",
          },
          orderBy: { revisedAt: "desc" },
        })
        const base = activeDraft
          ? effectiveDraftData(canonical, activeDraft.snapshot)
          : draftDataFromLocale(canonical)
        const data = ExperienceLocaleDraftDataSchema.parse({
          ...base,
          ...patch,
        })
        const snapshot = snapshotEnvelope(
          data as unknown as Prisma.InputJsonObject,
        )
        const revisedAt = new Date()

        const draft = activeDraft
          ? await tx.contentRevision.update({
              where: { id: activeDraft.id },
              data: {
                snapshot,
                // SEO-created drafts may predate preview capabilities. Mint
                // while holding the locale lock so adoption is atomic.
                previewToken:
                  activeDraft.previewToken ??
                  randomBytes(32).toString("base64url"),
                revisedBy: user?.id ?? null,
                revisedByKind,
                reason,
                revisedAt,
              },
            })
          : await tx.contentRevision.create({
              data: {
                entityType: "ExperienceLocale",
                entityId: id,
                snapshot,
                status: "DRAFT",
                previewToken: randomBytes(32).toString("base64url"),
                revisedBy: user?.id ?? null,
                revisedByKind,
                reason,
                revisedAt,
              },
            })

        // The editorial draft is shared. Once a human/AI editor changes an
        // SEO-materialized treatment it is no longer the exact approved payload.
        await tx.seoProposalMaterialization.updateMany({
          where: {
            contentRevisionId: draft.id,
            status: { not: "STALE" },
          },
          data: { status: "STALE" },
        })

        return {
          canonical,
          beforeEffective: effectiveLocale(canonical, base),
          effective: effectiveLocale(canonical, data),
          activeDraft: draft,
        }
      },
      // The locale row lock serializes this shared draft. READ COMMITTED lets
      // a waiting save observe and merge the preceding committed draft,
      // avoiding Serializable P2034 aborts while preserving last-save-wins.
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  }

  async getLocaleDraftState({
    id,
    user,
  }: {
    id: string
    user: Principal | null
  }) {
    if (!hasPermission(user, "read:experiences")) throw new ForbiddenError()
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM experience_locale WHERE id = ${id} FOR UPDATE`,
        )
        const canonical = await tx.experienceLocale.findUniqueOrThrow({
          where: { id },
          include: {
            experience: {
              select: { ownerId: true, archivedAt: true, isTemplate: true },
            },
          },
        })
        // Draft snapshots and preview capabilities are write-surface data.
        // Enforce ownership/state ABAC before even looking up the revision.
        if (
          !canEditExperienceLocale(user, canonical) &&
          !canPublishExperienceLocale(user, canonical)
        ) {
          throw new ForbiddenError()
        }

        let activeDraft = await tx.contentRevision.findFirst({
          where: {
            entityType: "ExperienceLocale",
            entityId: id,
            status: "DRAFT",
          },
          orderBy: { revisedAt: "desc" },
        })
        if (activeDraft && activeDraft.previewToken === null) {
          activeDraft = await tx.contentRevision.update({
            where: { id: activeDraft.id },
            data: { previewToken: randomBytes(32).toString("base64url") },
          })
        }
        return {
          canonical,
          effective: activeDraft
            ? effectiveLocale(
                canonical,
                effectiveDraftData(canonical, activeDraft.snapshot),
              )
            : effectiveLocale(canonical, draftDataFromLocale(canonical)),
          activeDraft,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  }

  async create({
    input: raw,
    user,
    draftAttribution,
  }: {
    input: unknown
    user: Principal | null
    draftAttribution?: {
      revisedByKind: "USER" | "AI"
      reason: string
    }
  }) {
    const input = CreateExperienceInput.parse(raw)
    // Defense-in-depth: also checked by scope-auth at the resolver layer.
    if (!hasPermission(user, "write:experiences")) {
      throw new ForbiddenError()
    }

    const blocks = await backfillExperienceVideoLanguageIds({
      prisma: this.prisma,
      blocks: input.blocks,
      locale: input.locale,
    })

    return this.prisma.$transaction(async (tx) => {
      const experience = await tx.experience.create({
        data: {
          isTemplate: input.isTemplate,
          ownerId: user?.id ?? null,
          locales: {
            create: {
              locale: input.locale,
              slug: input.slug,
              // Required identity lives canonically; authored content starts
              // in the staged aggregate even before the first publication.
              blocks: [],
            },
          },
        },
        include: { locales: true },
      })
      const locale = experience.locales[0]
      if (!locale) throw new Error("Experience locale creation failed.")
      const data = ExperienceLocaleDraftDataSchema.parse({
        ...draftDataFromLocale(locale),
        title: input.title ?? null,
        metaDescription: input.metaDescription ?? null,
        blocks: blocks.blocks,
      })
      await tx.contentRevision.create({
        data: {
          entityType: "ExperienceLocale",
          entityId: locale.id,
          snapshot: snapshotEnvelope(data as unknown as Prisma.InputJsonObject),
          status: "DRAFT",
          previewToken: randomBytes(32).toString("base64url"),
          revisedBy: user?.id ?? null,
          revisedByKind: draftAttribution?.revisedByKind ?? "USER",
          reason:
            draftAttribution?.reason ??
            "Initial Experience locale draft created",
        },
      })
      return {
        ...experience,
        locales: [
          effectiveLocale(locale, data),
          ...experience.locales.slice(1),
        ],
      }
    })
  }

  async duplicate({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = DuplicateExperienceInput.parse(raw)

    // Gate write permission before loading the source. This prevents callers
    // without create authority from probing draft or archived Experience ids.
    if (!user?.id || !hasPermission(user, "write:experiences")) {
      throw new ForbiddenError()
    }
    const ownerId = user.id

    const source = await this.prisma.experience.findFirst({
      where: { id: input.id },
      select: {
        isTemplate: true,
        archivedAt: true,
        locales: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            locale: true,
            slug: true,
            isHomepage: true,
            pathSegment: true,
            title: true,
            metaDescription: true,
            ogTitle: true,
            ogDescription: true,
            ogImageUrl: true,
            blocks: true,
          },
        },
      },
    })
    if (!source) {
      throw new NotFoundError("Experience", input.id)
    }
    if (!canViewExperience(user, source)) {
      throw new ForbiddenError()
    }

    if (source.locales.length === 0) {
      throw new ExperienceDuplicationError()
    }

    const sourceLocales = source.locales.map((locale) => {
      const blocks = BlocksSchema.safeParse(locale.blocks)
      if (!blocks.success) {
        throw new ExperienceDuplicationError()
      }
      return locale
    })

    const localeCodes = Array.from(
      new Set(sourceLocales.map((locale) => locale.locale)),
    )
    const existingSlugs = await this.prisma.experienceLocale.findMany({
      where: {
        locale: { in: localeCodes },
      },
      select: { locale: true, slug: true },
    })
    const usedSlugsByLocale = new Map(
      localeCodes.map((locale) => [locale, new Set<string>()]),
    )
    for (const row of existingSlugs) {
      usedSlugsByLocale.get(row.locale)!.add(row.slug)
    }

    return this.prisma.experience.create({
      data: {
        // Template classification is authored canonical state, not publication
        // state. Preserve it so route-only template blocks remain editable.
        isTemplate: source.isTemplate,
        ownerId,
        locales: {
          create: sourceLocales.map((locale) => ({
            locale: locale.locale,
            slug: availableDuplicateSlug(
              locale.slug,
              usedSlugsByLocale.get(locale.locale)!,
            ),
            isHomepage: false,
            pathSegment: locale.pathSegment,
            title: locale.title,
            metaDescription: locale.metaDescription,
            ogTitle: locale.ogTitle,
            ogDescription: locale.ogDescription,
            ogImageUrl: locale.ogImageUrl,
            blocks: locale.blocks as Prisma.InputJsonValue,
            status: "DRAFT",
            publishedAt: null,
          })),
        },
      },
      include: { locales: true },
    })
  }

  async createLocale({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = CreateExperienceLocaleInput.parse(raw)

    const experience = await this.prisma.experience.findUniqueOrThrow({
      where: { id: input.experienceId },
      select: { ownerId: true, archivedAt: true },
    })

    if (
      !canEditExperienceLocale(user, {
        status: "DRAFT",
        experience,
      })
    ) {
      throw new ForbiddenError()
    }

    const { experienceId, ...data } = input
    const blocks = await backfillExperienceVideoLanguageIds({
      prisma: this.prisma,
      blocks: input.blocks,
      locale: input.locale,
    })
    return this.prisma.$transaction(async (tx) => {
      const locale = await tx.experienceLocale.create({
        data: {
          experienceId,
          locale: data.locale,
          slug: data.slug,
          blocks: [],
        },
      })
      const draftData = ExperienceLocaleDraftDataSchema.parse({
        ...draftDataFromLocale(locale),
        ...data,
        blocks: blocks.blocks,
      })
      await tx.contentRevision.create({
        data: {
          entityType: "ExperienceLocale",
          entityId: locale.id,
          snapshot: snapshotEnvelope(
            draftData as unknown as Prisma.InputJsonObject,
          ),
          status: "DRAFT",
          previewToken: randomBytes(32).toString("base64url"),
          revisedBy: user?.id ?? null,
          revisedByKind: "USER",
          reason: "Initial Experience locale draft created",
        },
      })
      return effectiveLocale(locale, draftData)
    })
  }

  async list({
    input: raw,
    user,
    query,
  }: {
    input: { limit?: number; offset?: number; includeArchived?: boolean }
    user: Principal | null
    query: object
  }) {
    // Defense-in-depth: also checked by scope-auth at the resolver layer.
    if (!hasPermission(user, "read:experiences")) {
      throw new ForbiddenError()
    }

    const includeArchived = raw.includeArchived && isEditorOrAdmin(user)

    return this.prisma.experience.findMany({
      ...query,
      where: includeArchived ? {} : { archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: Math.min(raw.limit ?? 50, 200),
      skip: raw.offset ?? 0,
    })
  }

  async getById({
    id,
    user,
    query,
  }: {
    id: string
    user: Principal | null
    query: object
  }) {
    // Defense-in-depth: also checked by scope-auth at the resolver layer.
    if (!hasPermission(user, "read:experiences")) {
      throw new ForbiddenError()
    }

    const where: Record<string, unknown> = { id }
    if (!isEditorOrAdmin(user)) {
      where.archivedAt = null
    }

    return this.prisma.experience.findFirst({ ...query, where })
  }

  async getBySlug({
    locale,
    slug,
    user,
    query,
  }: {
    locale: string
    slug: string
    user: Principal | null
    query: object
  }) {
    const where: Record<string, unknown> = { locale, slug }

    // PUBLIC and VIEWER see published only + exclude archived parents.
    // EDITOR and ADMIN see all statuses including drafts.
    if (!isEditorOrAdmin(user)) {
      where.status = "PUBLISHED"
      const experienceFilter: Record<string, unknown> = { archivedAt: null }
      // R9: hide template experiences from PUBLIC + CONSUMER_BEARER (web
      // SSR's identity) so the consumer never sees a template via the
      // public surface. VIEWER bypasses this filter (editorial-tier
      // read; templates are editorial artifacts staff translators and
      // reviewers need to inspect).
      if (user === null || user.role === "CONSUMER_BEARER") {
        experienceFilter.isTemplate = false
      }
      where.experience = experienceFilter
    }

    return this.prisma.experienceLocale.findFirst({ ...query, where })
  }

  async updateLocale({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = UpdateExperienceLocaleInput.parse(raw)

    const existing = await this.prisma.experienceLocale.findUniqueOrThrow({
      where: { id: input.id },
      select: {
        id: true,
        experienceId: true,
        locale: true,
        slug: true,
        isHomepage: true,
        pathSegment: true,
        title: true,
        metaDescription: true,
        ogTitle: true,
        ogDescription: true,
        ogImageUrl: true,
        blocks: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        experience: {
          select: { ownerId: true, archivedAt: true, isTemplate: true },
        },
      },
    })

    if (!canEditExperienceLocale(user, existing)) {
      throw new ForbiddenError()
    }

    const { id, ...data } = input
    if (input.blocks !== undefined) {
      const blocks = await backfillExperienceVideoLanguageIds({
        prisma: this.prisma,
        blocks: input.blocks,
        locale: existing.locale,
      })
      data.blocks = blocks.blocks as typeof data.blocks
    }

    const staged = await this.stageLocaleDraft({
      id,
      patch: data,
      user,
      revisedByKind: "USER",
      reason: "Locale draft saved from admin editor",
    })
    return staged.effective
  }

  async publishLocale({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = PublishExperienceLocaleInput.parse(raw)

    const existing = await this.prisma.experienceLocale.findUniqueOrThrow({
      where: { id: input.id },
      select: {
        id: true,
        experienceId: true,
        locale: true,
        slug: true,
        isHomepage: true,
        pathSegment: true,
        title: true,
        metaDescription: true,
        ogTitle: true,
        ogDescription: true,
        ogImageUrl: true,
        blocks: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        experience: { select: { ownerId: true, archivedAt: true } },
      },
    })

    if (!canPublishExperienceLocale(user, existing)) {
      throw new ForbiddenError()
    }

    const { published, previous } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM experience_locale WHERE id = ${input.id} FOR UPDATE`,
        )
        const canonical = await tx.experienceLocale.findUniqueOrThrow({
          where: { id: input.id },
          include: {
            experience: { select: { ownerId: true, archivedAt: true } },
          },
        })
        if (!canPublishExperienceLocale(user, canonical))
          throw new ForbiddenError()

        let draft = await tx.contentRevision.findFirst({
          where: {
            entityType: "ExperienceLocale",
            entityId: input.id,
            status: "DRAFT",
          },
          orderBy: { revisedAt: "desc" },
        })
        // Compatibility for rows created before staged revisions existed.
        if (!draft && canonical.status === "DRAFT") {
          draft = await tx.contentRevision.create({
            data: {
              entityType: "ExperienceLocale",
              entityId: canonical.id,
              snapshot: snapshotExperienceLocale(canonical),
              status: "DRAFT",
              previewToken: randomBytes(32).toString("base64url"),
              revisedBy: user?.id ?? null,
              revisedByKind: "USER",
              reason: "Legacy unpublished locale adopted for first publish",
            },
          })
        }
        if (!draft) {
          throw new NotFoundError("Active ExperienceLocale draft", input.id)
        }
        const draftData = effectiveDraftData(canonical, draft.snapshot)
        const appliedAt = new Date()

        await tx.contentRevision.create({
          data: {
            entityType: "ExperienceLocale",
            entityId: canonical.id,
            snapshot: snapshotExperienceLocale(canonical),
            status: "HISTORICAL",
            revisedBy: user?.id ?? null,
            revisedByKind: "USER",
            reason: "Canonical locale before draft publication",
          },
        })

        const next = await tx.experienceLocale.update({
          where: { id: input.id },
          data: {
            ...draftData,
            blocks: draftData.blocks as Prisma.InputJsonValue,
            status: "PUBLISHED",
            publishedAt: appliedAt,
          },
        })
        await tx.contentRevision.update({
          where: { id: draft.id },
          data: { status: "HISTORICAL", appliedAt },
        })
        return { published: next, previous: canonical }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )

    // Fire-and-forget: a fresh publish always changes the public surface.
    // `emitRevalidateWebhook` never throws and is intentionally not awaited
    // — admin's publish UX must not block on web's ISR refresh.
    void emitRevalidateWebhook({
      model: "experience",
      slug: published.slug,
      locale: published.locale,
    })
    if (previous.slug !== published.slug) {
      void emitRevalidateWebhook({
        model: "experience",
        slug: previous.slug,
        locale: previous.locale,
      })
    }
    if (published.isHomepage || previous.isHomepage) {
      void emitRevalidateWebhook({
        model: "watch-setting",
        slug: null,
        locale: published.locale,
      })
    }
    refreshManifestAfterResponse({
      prisma: this.prisma,
      reason: "experience.publish",
    })
    return published
  }

  async discardLocaleDraft({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = DiscardExperienceLocaleDraftInput.parse(raw)
    const existing = await this.prisma.experienceLocale.findUniqueOrThrow({
      where: { id: input.id },
      include: {
        experience: { select: { ownerId: true, archivedAt: true } },
      },
    })
    if (!canEditExperienceLocale(user, existing)) throw new ForbiddenError()

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM experience_locale WHERE id = ${input.id} FOR UPDATE`,
        )
        const canonical = await tx.experienceLocale.findUniqueOrThrow({
          where: { id: input.id },
          include: {
            experience: { select: { ownerId: true, archivedAt: true } },
          },
        })
        const draft = await tx.contentRevision.findFirst({
          where: {
            entityType: "ExperienceLocale",
            entityId: input.id,
            status: "DRAFT",
          },
        })
        if (draft) {
          await tx.seoProposalMaterialization.updateMany({
            where: {
              contentRevisionId: draft.id,
              status: { not: "STALE" },
            },
            data: { status: "STALE" },
          })
          await tx.contentRevision.update({
            where: { id: draft.id },
            data: { status: "DISCARDED" },
          })
        }
        return canonical
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  }

  async restoreLocaleRevision({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = RestoreExperienceLocaleRevisionInput.parse(raw)

    const revision = await this.prisma.contentRevision.findUniqueOrThrow({
      where: { id: input.revisionId },
    })

    if (revision.entityType !== "ExperienceLocale") {
      throw new NotFoundError("ExperienceLocale revision", input.revisionId)
    }

    const envelope = asSnapshotRecord(revision.snapshot)
    const snapshot = asSnapshotRecord(envelope?.data)

    if (!snapshot) {
      throw new Error("Revision snapshot is invalid.")
    }

    const existing = await this.prisma.experienceLocale.findUniqueOrThrow({
      where: { id: revision.entityId },
      select: {
        id: true,
        experienceId: true,
        locale: true,
        slug: true,
        isHomepage: true,
        pathSegment: true,
        title: true,
        metaDescription: true,
        ogTitle: true,
        ogDescription: true,
        ogImageUrl: true,
        blocks: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        experience: { select: { ownerId: true, archivedAt: true } },
      },
    })

    if (!canEditExperienceLocale(user, existing)) {
      throw new ForbiddenError()
    }

    const restoredData = effectiveDraftData(existing, revision.snapshot)
    const restoredBlocks = await backfillExperienceVideoLanguageIds({
      prisma: this.prisma,
      blocks: restoredData.blocks,
      locale: existing.locale,
    })
    const staged = await this.stageLocaleDraft({
      id: existing.id,
      patch: {
        ...restoredData,
        blocks: ExperienceLocaleDraftDataSchema.shape.blocks.parse(
          restoredBlocks.blocks,
        ),
      },
      user,
      revisedByKind: "USER",
      reason: `Restored revision ${revision.id} into active draft`,
    })
    return staged.effective
  }

  async archive({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = ArchiveExperienceInput.parse(raw)

    const existing = await this.prisma.experience.findFirst({
      where: { id: input.id },
      select: { id: true, ownerId: true, archivedAt: true },
    })

    if (!existing) {
      throw new NotFoundError("Experience", input.id)
    }

    if (!canArchiveExperience(user, existing)) {
      throw new ForbiddenError()
    }

    const archived = await this.prisma.experience.update({
      where: { id: input.id },
      data: { archivedAt: new Date() },
    })

    // Fire-and-forget: archiving pulls every locale of this experience
    // out of the public surface. Web's `watch-setting` handler invalidates
    // the root layout + every homepage path, which is a broader
    // invalidation than strictly needed but safe. Not awaited so a sick
    // web instance can't block admin's archive UX.
    void emitRevalidateWebhook({
      model: "watch-setting",
      slug: null,
      locale: null,
    })
    refreshManifestAfterResponse({
      prisma: this.prisma,
      reason: "experience.archive",
    })
    return archived
  }

  async triggerEmbedding({
    localeId,
    user,
  }: {
    localeId: string
    user: Principal | null
  }) {
    if (!hasPermission(user, "write:experiences")) {
      throw new ForbiddenError()
    }

    const locale = await this.prisma.experienceLocale.findUniqueOrThrow({
      where: { id: localeId },
      include: {
        experience: {
          select: {
            ownerId: true,
            archivedAt: true,
          },
        },
      },
    })

    if (!canEditExperienceLocale(user, locale)) {
      throw new ForbiddenError()
    }
    if (locale.experience.archivedAt != null) {
      throw new NotFoundError("ExperienceLocale", localeId)
    }
    if (locale.status !== "PUBLISHED") {
      throw new ExperienceEmbeddingEligibilityError(
        "ExperienceLocale must be published before embedding",
      )
    }

    // Dispatch via the useworkflow runtime — direct invocation throws in
    // production because `"use workflow"` is enforced by the build plugin.
    // See docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md.
    const run = await start(runExperienceEmbedding, [{ localeId }])
    return run.returnValue
  }
  /**
   * Apply a validated AI chat-mutation envelope to an experience locale
   * (experience-AI chat; additive port from the chat branch).
   *
   * Slug is intentionally NOT writable from this method — the chat
   * panel is barred from changing slugs. `ChatMutationInput` omits
   * `slug` entirely so a `.strict()` envelope can never sneak it in.
   */
  async applyChatMutation({
    input,
    user,
    reason,
  }: {
    input: {
      id: string
      title?: string
      metaDescription?: string | null
      ogImageUrl?: string | null
      blocks?: unknown[]
    }
    user: Principal | null
    reason: string
  }) {
    const parsed = ChatMutationInput.parse(input)

    const existing = await this.prisma.experienceLocale.findUniqueOrThrow({
      where: { id: parsed.id },
      select: {
        id: true,
        experienceId: true,
        locale: true,
        slug: true,
        isHomepage: true,
        pathSegment: true,
        title: true,
        metaDescription: true,
        ogTitle: true,
        ogDescription: true,
        ogImageUrl: true,
        blocks: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        experience: {
          select: { ownerId: true, archivedAt: true, isTemplate: true },
        },
      },
    })

    if (!canEditExperienceLocale(user, existing)) {
      throw new ForbiddenError()
    }

    const { id, ...data } = parsed
    if (parsed.blocks !== undefined) {
      const blocks = await backfillExperienceVideoLanguageIds({
        prisma: this.prisma,
        blocks: parsed.blocks,
        locale: existing.locale,
      })
      data.blocks = blocks.blocks as typeof data.blocks
    }
    const staged = await this.stageLocaleDraft({
      id,
      patch: data,
      user,
      revisedByKind: "AI",
      reason,
    })
    return { before: staged.beforeEffective, after: staged.effective }
  }
}
