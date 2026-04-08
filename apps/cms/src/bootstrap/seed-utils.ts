import type { Core } from "@strapi/strapi"

export const DEFAULT_LOCALE = "en"

/** Map human-readable locale suffix (from section keys) to Strapi locale code. */
const LOCALE_MAP: Record<string, string> = { english: "en" }

export type VideoDocument = {
  id: number
  title: string
  slug: string
  documentId: string
}

type DocumentService<TDocument extends Record<string, unknown>> = {
  findFirst: (input: Record<string, unknown>) => Promise<TDocument | null>
  create: (input: Record<string, unknown>) => Promise<TDocument>
  delete: (input: Record<string, unknown>) => Promise<unknown>
}

export type ExperienceDocument = {
  documentId: string
}

export function getExperienceService(
  strapi: Core.Strapi,
): DocumentService<ExperienceDocument & Record<string, unknown>> {
  return strapi.documents(
    "api::experience.experience",
  ) as unknown as DocumentService<ExperienceDocument & Record<string, unknown>>
}

/**
 * Parse the locale suffix from a section key.
 * e.g. "easter-explained/english" → "en", "easter-meaning" → "en"
 */
export function parseSectionKeyLocale(sectionKey: string): string {
  const slashIdx = sectionKey.lastIndexOf("/")
  if (slashIdx === -1) return DEFAULT_LOCALE
  const suffix = sectionKey.slice(slashIdx + 1)
  return LOCALE_MAP[suffix] ?? DEFAULT_LOCALE
}

/**
 * Look up an existing published video by slug + locale.
 * Falls back to creating a placeholder via Document Service if not found.
 * Returns numeric id needed for Strapi component relation fields.
 */
export async function findOrCreatePublishedVideo(
  strapi: Core.Strapi,
  slug: string,
  title: string,
  locale: string = DEFAULT_LOCALE,
): Promise<VideoDocument> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knex = (strapi.db as any).connection
  const row = await knex("videos")
    .select("id", "document_id as documentId", "title", "slug")
    .where("slug", slug)
    .where("locale", locale)
    .whereNotNull("published_at")
    .orderBy("id")
    .first()

  if (row) {
    strapi.log.info(
      `[seed] Using existing Video "${row.title}" (${slug}, locale=${locale}, id=${row.id})`,
    )
    return row as VideoDocument
  }

  // Fallback: create placeholder via Document Service then re-fetch for numeric id
  const docService = strapi.documents(
    "api::video.video",
  ) as unknown as DocumentService<Record<string, unknown>>
  await docService.create({
    locale,
    status: "published",
    data: { title, slug },
  })

  const created = await knex("videos")
    .select("id", "document_id as documentId", "title", "slug")
    .where("slug", slug)
    .where("locale", locale)
    .orderBy("id", "desc")
    .first()
  if (!created)
    throw new Error(`[seed] Failed to create video "${slug}" (locale=${locale})`)

  strapi.log.info(
    `[seed] Created placeholder Video "${title}" (${slug}, locale=${locale}, id=${created.id})`,
  )
  return created as VideoDocument
}

/**
 * After Experience creation, Strapi v5 Document Service silently drops
 * relations in components nested 2+ levels deep in dynamic zones.
 * This function patches the missing link table rows for `sections.video`
 * components by matching on `section_key`.
 *
 * @param videoMap  sectionKey → numeric video ID (same keys used in buildVideoSectionContent)
 */
export async function patchNestedVideoRelations(
  strapi: Core.Strapi,
  videoMap: Map<string, number>,
): Promise<void> {
  if (videoMap.size === 0) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knex = (strapi.db as any).connection
  const sectionKeys = [...videoMap.keys()]

  // Find all sections.video component rows matching our section keys
  const components: { id: number; section_key: string }[] = await knex(
    "components_sections_videos",
  )
    .select("id", "section_key")
    .whereIn("section_key", sectionKeys)

  if (components.length === 0) return

  // Find which components already have a link row (idempotent)
  // Strapi naming: video_id → components_sections_videos(id), inv_video_id → videos(id)
  const componentIds = components.map((c) => c.id)
  const existingLinks: { video_id: number }[] = await knex(
    "components_sections_videos_video_lnk",
  )
    .select("video_id")
    .whereIn("video_id", componentIds)
  const linked = new Set(existingLinks.map((l) => l.video_id))

  // Build missing link rows
  const missingRows = components
    .filter((c) => !linked.has(c.id))
    .map((c) => ({
      video_id: c.id,
      inv_video_id: videoMap.get(c.section_key)!,
    }))
    .filter((r) => r.video_id != null)

  if (missingRows.length === 0) {
    strapi.log.info("[seed] All sections.video relations already linked.")
    return
  }

  await knex("components_sections_videos_video_lnk").insert(missingRows)
  strapi.log.info(
    `[seed] Patched ${missingRows.length} nested video relation(s).`,
  )
}
