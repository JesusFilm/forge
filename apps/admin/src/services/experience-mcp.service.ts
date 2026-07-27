import { z } from "zod"
import type { PrismaClient } from "@prisma/client"

import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"
import { ExperienceService } from "@/services/experience.service"

// `.strict()` is deliberate: `ExperienceService.create`'s own schema silently
// STRIPS unknown keys, so a caller passing e.g. `metaDescription` here would
// otherwise lose the field with no error. Meta/OG fields route through the
// existing `experience.locale.update` tool after creation (the two-call
// composition both operator scripts use).
const CreateExperienceToolInput = z
  .object({
    locale: z.string().min(1).max(35),
    slug: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    blocks: z.array(z.unknown()),
    isTemplate: z.boolean().optional().default(false),
  })
  .strict()

type LocaleRow = {
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
  updatedAt: Date
}

function serializeLocale(locale: LocaleRow) {
  return {
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
    blocks: locale.blocks,
    status: locale.status,
    publishedAt: locale.publishedAt?.toISOString() ?? null,
    updatedAt: locale.updatedAt.toISOString(),
  }
}

function editorUrlFor(experienceId: string, locale: string) {
  const url = new URL(
    `/dashboard/experiences/${experienceId}`,
    env.ADMIN_BASE_URL ?? "http://localhost:3003",
  )
  url.searchParams.set("locale", locale)
  return url.toString()
}

export class ExperienceMcpService {
  constructor(private readonly prisma: PrismaClient) {}

  async createExperience({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = CreateExperienceToolInput.parse(raw)

    // Best-effort idempotency: DRAFT slugs have no DB uniqueness (the partial
    // unique index only covers published rows), so a retrying agent would
    // silently pile up duplicate drafts. Report the existing resource instead
    // of creating a second one. Concurrent creates can still race past this
    // check — acceptable, since the same collision surfaces at publish time.
    const existing = await this.prisma.experienceLocale.findFirst({
      where: {
        locale: input.locale,
        slug: input.slug,
        experience: { archivedAt: null },
      },
      select: { id: true, experienceId: true, status: true },
    })
    if (existing) {
      return {
        created: false as const,
        conflict: {
          reason: "slug_exists" as const,
          locale: input.locale,
          slug: input.slug,
          existingExperienceId: existing.experienceId,
          existingLocaleId: existing.id,
          existingStatus: existing.status,
        },
      }
    }

    const created = await new ExperienceService(this.prisma).create({
      input: {
        locale: input.locale,
        slug: input.slug,
        title: input.title,
        blocks: input.blocks,
        isTemplate: input.isTemplate,
      },
      user,
    })
    const locale = created.locales[0]!

    return {
      created: true as const,
      experience: {
        id: created.id,
        isTemplate: created.isTemplate,
        ownerId: created.ownerId,
      },
      locale: serializeLocale(locale),
      editorUrl: editorUrlFor(created.id, input.locale),
    }
  }
}
