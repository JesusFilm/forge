/**
 * Experience List Service
 *
 * Returns published experiences with minimal metadata needed to render the
 * Manager "Experiences" report. Uses raw SQL via knex, mirroring the
 * pattern in `video-coverage` and `language-geo` services.
 *
 * When `languageCoreIds` is provided, the matching languages are looked up
 * in the `languages` table to resolve their BCP-47 codes, and experiences
 * are filtered to those locales. When omitted, all locales are returned.
 *
 * Critical: filters `published_at IS NOT NULL` to avoid counting Strapi v5
 * draft rows.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Strapi knex typings are not public
type KnexInstance = any

type ExperienceRow = {
  document_id: string
  slug: string | null
  title: string | null
  locale: string | null
  is_homepage: boolean | null
  is_template: boolean | null
  created_at: string | Date | null
}

export type ExperienceListResult = {
  documentId: string
  slug: string | null
  title: string | null
  locale: string | null
  isHomepage: boolean
  isTemplate: boolean
  createdAt: string | null
}

function toIso(value: string | Date | null): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  // Knex may return a string already in ISO or Postgres format.
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString()
}

export async function queryExperienceList(
  knex: KnexInstance,
  languageCoreIds?: string[],
): Promise<ExperienceListResult[]> {
  const hasLangFilter = languageCoreIds && languageCoreIds.length > 0

  let locales: string[] | undefined

  if (hasLangFilter) {
    const rows: Array<{ bcp_47: string | null }> = await knex
      .select("bcp_47")
      .from("languages")
      .whereIn("core_id", languageCoreIds)
      .whereNotNull("bcp_47")

    locales = Array.from(
      new Set(
        rows
          .map((row) => row.bcp_47)
          .filter((code): code is string => !!code && code.length > 0),
      ),
    )

    // If the language IDs didn't map to any enabled locale, return empty.
    if (locales.length === 0) return []
  }

  const query = knex
    .select(
      "document_id",
      "slug",
      "title",
      "locale",
      "is_homepage",
      "is_template",
      "created_at",
    )
    .from("experiences")
    .whereNotNull("published_at")
    .orderBy("created_at", "desc")

  if (locales && locales.length > 0) {
    query.whereIn("locale", locales)
  }

  const rows: ExperienceRow[] = await query

  return rows.map((row) => ({
    documentId: row.document_id,
    slug: row.slug,
    title: row.title,
    locale: row.locale,
    isHomepage: row.is_homepage === true,
    isTemplate: row.is_template === true,
    createdAt: toIso(row.created_at),
  }))
}
