// WatchSetting service — public read-only homepage configuration.
//
// Returns the same shape apps/web consumes from Strapi today via the
// `watchSetting(locale)` query (see `apps/web/src/lib/content.ts:48-63`).
// Once the homepage migrates to admin, the web `WatchExperience`
// fragment must rewrite from `on Experience` to `on ExperienceLocale`
// because admin's per-locale model puts slug/title/blocks/etc on
// ExperienceLocale, not Experience. That fragment rewrite is tracked
// under U5b/U6 and is NOT part of Unit 2.
//
// Auth contract: PUBLIC. No `hasPermission` guard because the resolver's
// `authScopes: { public: true }` is the auth contract. Both Prisma reads
// gate on `status: "PUBLISHED"` and `archivedAt: null` for anonymous-safe
// content — this is a service-layer-level filter, not an authz check.
//
// Locale-fallback semantics: STRICT NULL. If no homepage Experience has
// an ExperienceLocale row for the requested `$locale` with
// `status: "PUBLISHED"`, returns `null`. Matches Strapi v5 GraphQL
// plugin's default behavior for singleType + i18n localized content.
// If a non-`en` locale request returns null in production, that signals
// a data-readiness gap, not a service bug.
//
// Multi-row tiebreak: if two ExperienceLocale rows somehow have
// `isHomepage: true` for the same locale (data anomaly), the service
// returns the most recently updated one (orderBy: updatedAt desc) and
// logs a structured warning so operators can investigate.

import type { ExperienceLocale, PrismaClient } from "@prisma/client"

export type WatchSettingShape = {
  documentId: string | null
  homepageExperience: ExperienceLocale | null
  defaultTemplateExperience: ExperienceLocale | null
}

export class WatchSettingService {
  constructor(private prisma: PrismaClient) {}

  async get({ locale }: { locale: string }): Promise<WatchSettingShape> {
    // Parallel reads — no data dependency between homepage and template
    // lookups. Halves wall-clock latency on the consumer homepage hot path.
    const [homepage, template] = await Promise.all([
      this.findHomepageLocale(locale),
      this.findTemplateLocale(locale),
    ])

    // documentId mirrors Strapi's stable cross-locale identifier. Admin's
    // Experience.id is a cuid that is stable for the lifetime of the
    // migration (the content dump upserts by cms_document_id rather than
    // re-creating rows). For the homepage path we surface the parent
    // Experience id; if neither homepage nor template exists, the
    // documentId is null.
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
          count: matches.length,
          chosen_id: matches[0].id,
        }),
      )
    }

    return matches[0] ?? null
  }

  // The isTemplate flag lives on the parent Experience (not on
  // ExperienceLocale like isHomepage), so the query shape is asymmetric
  // with findHomepageLocale by necessity — we read the parent and pull
  // its single matching published locale via `include`. The multi-row
  // tiebreak that findHomepageLocale logs about can also happen here
  // if two Experiences both have `isTemplate: true`; today the
  // editorial UI doesn't prevent that and the impact is silent
  // wrong-template selection. Left for a follow-up — flagged here so
  // a future maintainer can mirror the homepage warning shape.
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
