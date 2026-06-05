// Experience service — CRUD + list + getBySlug.
//
// Mutation methods: (1) Zod parse input, (2) ABAC check, (3) Prisma call.
// Read methods: (1) tier check, (2) role-based WHERE filtering, (3) Prisma call.
// Resolvers delegate here; they never call Prisma directly for mutations.

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

    return this.prisma.experience.create({
      data: {
        isTemplate: input.isTemplate,
        ownerId: user?.id ?? null,
        locales: {
          create: {
            locale: input.locale,
            slug: input.slug,
            title: input.title,
            blocks: input.blocks,
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
    return this.prisma.experienceLocale.create({
      data: {
        ...data,
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
      void refreshWatchRouteManifest({
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
    void refreshWatchRouteManifest({
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
          blocks: snapshot.blocks as Prisma.InputJsonValue,
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
    void refreshWatchRouteManifest({
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
    const result = await this.prisma.$transaction(async (tx) => {
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

      // Optimistic-concurrency guard: the write only lands if the row's
      // `updatedAt` still matches the pre-image we snapshotted above. A
      // concurrent manual save (or another chat turn) between read and
      // write bumps `updatedAt`, the conditional match returns count 0,
      // and we throw so the chat turn surfaces "reload and retry" instead
      // of silently clobbering the other writer's change (lost update).
      // Throwing rolls back the transaction, so no orphan HISTORICAL
      // revision row is left behind.
      const { count } = await tx.experienceLocale.updateMany({
        where: { id, updatedAt: existing.updatedAt },
        data: data as Prisma.ExperienceLocaleUncheckedUpdateInput,
      })
      if (count === 0) {
        throw new ConcurrentModificationError("ExperienceLocale", id)
      }

      // Re-fetch the freshly-updated row for the return value
      // (`updateMany` returns a count, not the row).
      const updated = await tx.experienceLocale.findUniqueOrThrow({
        where: { id },
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
