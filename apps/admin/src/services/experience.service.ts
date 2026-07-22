// Experience service — CRUD + list + getBySlug.
//
// Mutation methods: (1) Zod parse input, (2) ABAC check, (3) Prisma call.
// Read methods: (1) tier check, (2) role-based WHERE filtering, (3) Prisma call.
// Resolvers delegate here; they never call Prisma directly for mutations.

import { after } from "next/server"
import { Prisma, type PrismaClient } from "@prisma/client"
import { isEditorOrAdmin, type Principal } from "@/auth/principal"
import {
  hasPermission,
  canEditExperienceLocale,
  canPublishExperienceLocale,
  canArchiveExperience,
} from "@/auth/permissions"
import { start } from "workflow/api"
import {
  ConcurrentModificationError,
  ForbiddenError,
  NotFoundError,
} from "./errors"
import { runExperienceEmbedding } from "@/workflows/experienceEmbedding"
import { emitRevalidateWebhook } from "./revalidate-webhook"
import { refreshWatchRouteManifest } from "./watch-route-manifest-refresh.service"
import { backfillExperienceVideoLanguageIds } from "./experience-video-language-backfill"
import {
  CreateExperienceInput,
  CreateExperienceLocaleInput,
  UpdateExperienceLocaleInput,
  PublishExperienceLocaleInput,
  RestoreExperienceLocaleRevisionInput,
  ArchiveExperienceInput,
  ChatMutationInput,
} from "./experience.schemas"

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

function snapshotExperienceLocale(locale: {
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
}): Prisma.InputJsonObject {
  return snapshotEnvelope({
    id: locale.id,
    experienceId: locale.experienceId,
    locale: locale.locale,
    slug: locale.slug,
    isHomepage: locale.isHomepage,
    pathSegment: locale.pathSegment,
    title: locale.title,
    metaDescription: locale.metaDescription,
    ogTitle: locale.ogTitle,
    ogDescription: locale.ogDescription,
    ogImageUrl: locale.ogImageUrl,
    blocks: locale.blocks as Prisma.InputJsonValue,
    status: locale.status,
    publishedAt: locale.publishedAt?.toISOString() ?? null,
    createdAt: locale.createdAt?.toISOString() ?? null,
    updatedAt: locale.updatedAt?.toISOString() ?? null,
  })
}

function asSnapshotRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export class ExperienceService {
  constructor(private prisma: PrismaClient) {}

  async create({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
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

    return this.prisma.experience.create({
      data: {
        isTemplate: input.isTemplate,
        ownerId: user?.id ?? null,
        locales: {
          create: {
            locale: input.locale,
            slug: input.slug,
            title: input.title,
            blocks: blocks.blocks as Prisma.InputJsonValue,
          },
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
    return this.prisma.experienceLocale.create({
      data: {
        ...data,
        blocks: blocks.blocks as Prisma.InputJsonValue,
        experience: {
          connect: { id: experienceId },
        },
      },
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

    const { id, isTemplate, ...data } = input
    if (input.blocks !== undefined) {
      const blocks = await backfillExperienceVideoLanguageIds({
        prisma: this.prisma,
        blocks: input.blocks,
        locale: existing.locale,
      })
      data.blocks = blocks.blocks as typeof data.blocks
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.contentRevision.create({
        data: {
          entityType: "ExperienceLocale",
          entityId: existing.id,
          snapshot: snapshotExperienceLocale(existing),
          status: "HISTORICAL",
          revisedBy: user?.id ?? null,
          revisedByKind: "USER",
          reason: "Locale updated from admin editor",
        },
      })

      if (typeof isTemplate === "boolean") {
        await tx.experience.update({
          where: { id: existing.experienceId },
          data: { isTemplate },
        })
      }

      return tx.experienceLocale.update({
        where: { id },
        data,
      })
    })

    // Fire-and-forget: refresh web's ISR cache for any update that
    // touches a PUBLISHED locale. Draft-only edits never affected
    // public pages so they don't need revalidation. `emitRevalidateWebhook`
    // never throws and is intentionally not awaited so a sick web
    // instance can't add the 5s timeout budget to admin's publish UX.
    if (updated.status === "PUBLISHED") {
      void emitRevalidateWebhook({
        model: "experience",
        slug: updated.slug,
        locale: updated.locale,
      })
      if (updated.isHomepage || typeof isTemplate === "boolean") {
        // Homepage / template flag changes ripple through the watch
        // settings derived view — refresh that too.
        void emitRevalidateWebhook({
          model: "watch-setting",
          slug: null,
          locale: updated.locale,
        })
      }
      refreshManifestAfterResponse({
        prisma: this.prisma,
        reason: "experience.update",
      })
    }
    return updated
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

    const published = await this.prisma.$transaction(async (tx) => {
      await tx.contentRevision.create({
        data: {
          entityType: "ExperienceLocale",
          entityId: existing.id,
          snapshot: snapshotExperienceLocale(existing),
          status: "HISTORICAL",
          revisedBy: user?.id ?? null,
          revisedByKind: "USER",
          reason: "Locale published from admin editor",
        },
      })

      return tx.experienceLocale.update({
        where: { id: input.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      })
    })

    // Fire-and-forget: a fresh publish always changes the public surface.
    // `emitRevalidateWebhook` never throws and is intentionally not awaited
    // — admin's publish UX must not block on web's ISR refresh.
    void emitRevalidateWebhook({
      model: "experience",
      slug: published.slug,
      locale: published.locale,
    })
    if (published.isHomepage) {
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

    const restoredBlocks = await backfillExperienceVideoLanguageIds({
      prisma: this.prisma,
      blocks: snapshot.blocks,
      locale: existing.locale,
    })

    return this.prisma.$transaction(async (tx) => {
      const restoredAt = new Date()

      await tx.contentRevision.update({
        where: { id: revision.id },
        data: {
          appliedAt: restoredAt,
        },
      })

      return tx.experienceLocale.update({
        where: { id: existing.id },
        data: {
          slug:
            typeof snapshot.slug === "string" ? snapshot.slug : existing.slug,
          isHomepage:
            typeof snapshot.isHomepage === "boolean"
              ? snapshot.isHomepage
              : existing.isHomepage,
          pathSegment:
            typeof snapshot.pathSegment === "string"
              ? snapshot.pathSegment
              : snapshot.pathSegment === null
                ? null
                : existing.pathSegment,
          title:
            typeof snapshot.title === "string"
              ? snapshot.title
              : snapshot.title === null
                ? null
                : existing.title,
          metaDescription:
            typeof snapshot.metaDescription === "string"
              ? snapshot.metaDescription
              : snapshot.metaDescription === null
                ? null
                : existing.metaDescription,
          ogTitle:
            typeof snapshot.ogTitle === "string"
              ? snapshot.ogTitle
              : snapshot.ogTitle === null
                ? null
                : existing.ogTitle,
          ogDescription:
            typeof snapshot.ogDescription === "string"
              ? snapshot.ogDescription
              : snapshot.ogDescription === null
                ? null
                : existing.ogDescription,
          ogImageUrl:
            typeof snapshot.ogImageUrl === "string"
              ? snapshot.ogImageUrl
              : snapshot.ogImageUrl === null
                ? null
                : existing.ogImageUrl,
          blocks: restoredBlocks.blocks as Prisma.InputJsonValue,
          status: "DRAFT",
          updatedAt: restoredAt,
        },
      })
    })
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

    // Full-precision optimistic-concurrency token. `experience_locale.
    // updated_at` is a bare TIMESTAMPTZ (microsecond precision), but Prisma
    // reads it into a JS Date (millisecond precision) — so comparing
    // `where updated_at = <Date>` silently fails for any row whose stored
    // value carries sub-millisecond digits (set by a non-Prisma writer:
    // now()/raw SQL/import/background enrich), tripping the guard on every
    // apply. Capture the value as text to preserve full precision; the
    // guard below compares text-to-text inside the locked transaction.
    const baselineRows = await this.prisma.$queryRaw<{ u: string }[]>(
      Prisma.sql`SELECT updated_at::text AS u FROM experience_locale WHERE id = ${parsed.id}`,
    )
    const baselineUpdatedAtText = baselineRows[0]?.u ?? null

    const { id, ...data } = parsed
    if (parsed.blocks !== undefined) {
      const blocks = await backfillExperienceVideoLanguageIds({
        prisma: this.prisma,
        blocks: parsed.blocks,
        locale: existing.locale,
      })
      data.blocks = blocks.blocks as typeof data.blocks
    }
    const result = await this.prisma.$transaction(async (tx) => {
      // Optimistic-concurrency guard with a row lock. `SELECT ... FOR
      // UPDATE` locks the row for the rest of this transaction so no
      // writer can slip in between the check and the write. We compare the
      // CURRENT full-precision `updated_at::text` against the baseline
      // captured above (full precision, same `::text` form): if they
      // differ, a concurrent manual save or chat turn changed the row
      // since we read it, so we throw — surfacing "reload and retry"
      // instead of clobbering the other writer (lost update). Throwing
      // rolls back the transaction, so no orphan HISTORICAL revision row
      // is left behind.
      const lockedRows = await tx.$queryRaw<{ u: string }[]>(
        Prisma.sql`SELECT updated_at::text AS u FROM experience_locale WHERE id = ${id} FOR UPDATE`,
      )
      if (
        lockedRows.length === 0 ||
        lockedRows[0]?.u !== baselineUpdatedAtText
      ) {
        throw new ConcurrentModificationError("ExperienceLocale", id)
      }

      await tx.contentRevision.create({
        data: {
          entityType: "ExperienceLocale",
          entityId: existing.id,
          snapshot: snapshotExperienceLocale(existing),
          status: "HISTORICAL",
          revisedBy: user?.id ?? null,
          revisedByKind: "AI",
          reason,
        },
      })

      // Row is locked and version-verified above, so a plain update is
      // safe — no `updatedAt` predicate (which would re-introduce the
      // millisecond-truncation mismatch).
      const updated = await tx.experienceLocale.update({
        where: { id },
        data: data as Prisma.ExperienceLocaleUncheckedUpdateInput,
      })

      return { before: existing, after: updated }
    })

    // Fire-and-forget web revalidation, mirroring update/publish above.
    void emitRevalidateWebhook({
      model: "experience",
      slug: result.after.slug,
      locale: result.after.locale,
    })
    return result
  }
}
