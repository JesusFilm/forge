// In-memory fake of `CmsExperienceSourceRepository` for service tests.
//
// Tests seed exactly what each method should return for given inputs.
// The fake doesn't try to model Strapi's storage rules — it's a stub
// keyed by `(method, input)` so service tests stay focused on the
// dump pipeline (transform → validate → hash → upsert) rather than
// on cms's polymorphic morph table layout.
//
// The real `cms-experience-source.repository.ts` covers the SQL
// behaviour against a live cms PG; the fake covers the
// service-layer behaviour against a deterministic test surface.

import type {
  CmsComponentRow,
  CmsDocumentLocaleFilter,
  CmsDocumentLocaleSummary,
  CmsExperienceRow,
  CmsExperienceSourceRepository,
} from "./cms-experience-source.types"

export type CmsExperienceSourceFakeSeed = {
  /** Returned by enumerateDocumentLocales (after filter applied). */
  documentLocales?: CmsDocumentLocaleSummary[]
  /**
   * Keyed by `${documentId}::${locale}::${prefer}`. The same row
   * may also be looked up under the alternate `prefer` key when the
   * doc has only one state — seed both keys explicitly for clarity.
   */
  experienceRows?: Record<string, CmsExperienceRow>
  /**
   * Keyed by `${componentTableForOwner}::${ownerEntityId}::${field}`.
   * The value is the ordered list of components admin should see for
   * that owner's dynamic zone.
   */
  components?: Record<string, CmsComponentRow[]>
  /**
   * Keyed by `${relatedType}::${relatedId}::${field}` → URL string.
   * Missing keys return `null` (the same behaviour the real
   * repository exhibits when no morph row exists).
   */
  mediaUrls?: Record<string, string>
}

export function createFakeCmsExperienceSourceRepository(
  seed: CmsExperienceSourceFakeSeed = {},
): CmsExperienceSourceRepository & {
  /** Mutator for tests that need to vary seed mid-test. */
  seed(updates: CmsExperienceSourceFakeSeed): void
} {
  let current: CmsExperienceSourceFakeSeed = clone(seed)

  return {
    seed(updates) {
      current = mergeSeed(current, updates)
    },
    async enumerateDocumentLocales(filter?: CmsDocumentLocaleFilter) {
      const all = current.documentLocales ?? []
      return applyDocumentLocaleFilter(all, filter)
    },
    async loadExperienceRow(documentId, locale, prefer) {
      const key = `${documentId}::${locale}::${prefer}`
      return current.experienceRows?.[key] ?? null
    },
    async loadComponents(componentTableForOwner, ownerEntityId, field) {
      const key = `${componentTableForOwner}::${ownerEntityId}::${field}`
      return current.components?.[key] ?? []
    },
    async loadMediaUrl(relatedType, relatedId, field) {
      const key = `${relatedType}::${relatedId}::${field}`
      return current.mediaUrls?.[key] ?? null
    },
  }
}

function applyDocumentLocaleFilter(
  rows: CmsDocumentLocaleSummary[],
  filter: CmsDocumentLocaleFilter | undefined,
): CmsDocumentLocaleSummary[] {
  if (filter === undefined) return rows
  const docIds =
    filter.documentIds && filter.documentIds.length > 0
      ? new Set(filter.documentIds)
      : null
  const locales =
    filter.locales && filter.locales.length > 0 ? new Set(filter.locales) : null
  return rows.filter((r) => {
    if (docIds && !docIds.has(r.document_id)) return false
    if (locales && !locales.has(r.locale)) return false
    return true
  })
}

function mergeSeed(
  base: CmsExperienceSourceFakeSeed,
  updates: CmsExperienceSourceFakeSeed,
): CmsExperienceSourceFakeSeed {
  return {
    documentLocales: updates.documentLocales ?? base.documentLocales,
    experienceRows: { ...base.experienceRows, ...updates.experienceRows },
    components: { ...base.components, ...updates.components },
    mediaUrls: { ...base.mediaUrls, ...updates.mediaUrls },
  }
}

function clone(seed: CmsExperienceSourceFakeSeed): CmsExperienceSourceFakeSeed {
  // Shallow clone is enough — tests never mutate the seeded values
  // post-seed; they call seed() with replacements.
  return {
    documentLocales: seed.documentLocales?.slice(),
    experienceRows: { ...seed.experienceRows },
    components: { ...seed.components },
    mediaUrls: { ...seed.mediaUrls },
  }
}
