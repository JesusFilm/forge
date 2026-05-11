// WatchSetting service — PUBLIC homepage configuration. Shape mirrors
// Strapi's `watchSetting(locale)` at `apps/web/src/lib/content.ts:48-63`.
// Both reads gate on `status: "PUBLISHED"` + `archivedAt: null` (content
// filter, not authz — auth lives at the resolver's `public: true`).
// Locale-fallback is STRICT NULL (Strapi v5 i18n parity). The web-side
// `WatchExperience` fragment rewrite from `on Experience` to
// `on ExperienceLocale` is tracked under U5b/U6.

import type { ExperienceLocale, PrismaClient } from "@prisma/client"

export type WatchSettingShape = {
  documentId: string | null
  homepageExperience: ExperienceLocale | null
  defaultTemplateExperience: ExperienceLocale | null
}

export class WatchSettingService {
  constructor(private prisma: PrismaClient) {}

  async get({ locale }: { locale: string }): Promise<WatchSettingShape> {
    const [homepage, template] = await Promise.all([
      this.findHomepageLocale(locale),
      this.findTemplateLocale(locale),
    ])

    // Derived from returned locale rows (not parent Experience.id) —
    // otherwise an unpublished-locale template would leak its existence to
    // anonymous callers via documentId.
    const documentId = homepage?.experienceId ?? template?.experienceId ?? null

    return {
      documentId,
      homepageExperience: homepage,
      defaultTemplateExperience: template,
    }
  }

  private async findHomepageLocale(
    locale: string,
  ): Promise<ExperienceLocale | null> {
    const matches = await this.prisma.experienceLocale.findMany({
      where: {
        isHomepage: true,
        locale,
        status: "PUBLISHED",
        experience: { archivedAt: null },
      },
      orderBy: { updatedAt: "desc" },
      take: 2,
    })

    if (matches.length > 1) {
      console.warn(
        JSON.stringify({
          event: "watch_setting.homepage.multiple_rows",
          locale,
          // take:2 caps the count — log a lower bound, not exact.
          count_min: matches.length,
          capped_at_take: 2,
          chosen_id: matches[0].id,
        }),
      )
    }

    return matches[0] ?? null
  }

  // Asymmetric with findHomepageLocale because isTemplate lives on the
  // parent Experience. TODO: mirror the multi-row warning if two
  // Experiences both have `isTemplate: true`.
  private async findTemplateLocale(
    locale: string,
  ): Promise<ExperienceLocale | null> {
    const template = await this.prisma.experience.findFirst({
      where: { isTemplate: true, archivedAt: null },
      include: {
        locales: {
          where: { locale, status: "PUBLISHED" },
          take: 1,
        },
      },
    })

    return template?.locales[0] ?? null
  }
}
