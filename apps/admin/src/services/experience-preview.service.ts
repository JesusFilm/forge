import type { PrismaClient } from "@prisma/client"
import type { Block } from "@/domain/blocks"
import { ExperienceLocaleDraftSnapshotSchema } from "@/services/experience.schemas"

const PREVIEW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type ExperiencePreviewShape = {
  experienceId: string
  localeId: string
  locale: string
  slug: string
  isHomepage: boolean
  pathSegment: string | null
  title: string | null
  metaDescription: string | null
  ogTitle: string | null
  ogDescription: string | null
  ogImageUrl: string | null
  blocks: Block[]
}

/**
 * Public capability resolver for an active ExperienceLocale draft.
 *
 * The raw bearer token is accepted only as an exact lookup key and is never
 * returned or logged. Invalid, retired, foreign-entity, and archived-parent
 * capabilities all resolve to null with no canonical fallback.
 */
export class ExperiencePreviewService {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveByToken({
    token,
  }: {
    token: string
  }): Promise<ExperiencePreviewShape | null> {
    if (!PREVIEW_TOKEN_PATTERN.test(token)) return null

    const revision = await this.prisma.contentRevision.findUnique({
      where: { previewToken: token },
      select: {
        entityType: true,
        entityId: true,
        status: true,
        snapshot: true,
      },
    })

    if (
      !revision ||
      revision.entityType !== "ExperienceLocale" ||
      revision.status !== "DRAFT"
    ) {
      return null
    }

    const snapshot = ExperienceLocaleDraftSnapshotSchema.safeParse(
      revision.snapshot,
    )
    if (!snapshot.success) return null

    const locale = await this.prisma.experienceLocale.findFirst({
      where: {
        id: revision.entityId,
        experience: { archivedAt: null },
      },
      select: {
        id: true,
        experienceId: true,
        locale: true,
      },
    })
    if (!locale) return null

    return {
      experienceId: locale.experienceId,
      localeId: locale.id,
      locale: locale.locale,
      ...snapshot.data.data,
    }
  }
}
