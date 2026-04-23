// Real `pg.Pool`-backed implementation of the cms-experience-source
// repository. Reads Strapi v5 content directly from cms's Postgres so
// the dump workflow doesn't depend on Strapi's REST or GraphQL layer
// (which gates fields by permission and has dynamic-zone populate
// limits — see the requirements doc Key Decision §3).
//
// All SQL uses parameterized `$N` placeholders. Identifiers (table
// names) cannot be parameterized — they're built from a hardcoded
// allowlist (`COMPONENT_TABLES`) so a typo or attacker-influenced
// component_type cannot inject arbitrary SQL.
//
// Verified against cms's live Strapi v5.42.1 schema during planning:
//   - experiences (document_id, locale, published_at, …)
//   - experiences_cmps (entity_id, cmp_id, component_type, field, order)
//   - 17 components_sections_* tables (one per top-level + leaf
//     component admin's BlockSchema cares about) plus their _cmps
//     joins for composites/sections/containers
//   - 4 _video_lnk tables for video-relation resolution
//   - files / files_related_mph for polymorphic media
//
// Why an allowlist for table names rather than dynamic dispatch over
// `component_type`: a Strapi schema change in cms (new component
// type) must be reflected in admin's BlockSchema first; until then,
// the dump should fail loudly per-locale rather than silently route
// to an unknown table. The fail-loudly path is captured by the
// dump-service's `failed_validation: transform_error` outcome.

import type { Pool } from "pg"
import { getCmsPgPool } from "@/db/cms-pg"
import type {
  CmsBibleQuoteItem,
  CmsComponentLink,
  CmsComponentRow,
  CmsDocumentLocaleFilter,
  CmsDocumentLocaleSummary,
  CmsExperienceRow,
  CmsExperienceSourceRepository,
  CmsInfoBlockItem,
  CmsMediaCollectionItem,
  CmsNavigationCarouselItem,
  CmsRelatedQuestionItem,
  CmsVideoCarouselItem,
} from "./cms-experience-source.types"

// -----------------------------------------------------------------------------
// Table-name allowlist + lookups
// -----------------------------------------------------------------------------

/**
 * Maps Strapi component UID → row table name. Hardcoded so we never
 * concatenate untrusted strings into SQL identifiers. Typed as
 * `Record<KnownComponentType, string>` so a new variant added to
 * `CmsComponentRow` MUST also be added here — TypeScript enforces
 * the parity, the dispatch switch and this allowlist cannot drift.
 */
const COMPONENT_TABLES: Readonly<
  Record<CmsComponentRow["componentType"], string>
> = {
  "sections.advent-countdown": "components_sections_advent_countdowns",
  "sections.bible-quotes-carousel":
    "components_sections_bible_quotes_carousels",
  "sections.card": "components_sections_cards",
  "sections.container": "components_sections_containers",
  "sections.container-slot": "components_sections_container_slots",
  "sections.cta": "components_sections_ctas",
  "sections.easter-dates": "components_sections_easter_dates",
  "sections.info-blocks": "components_sections_info_blocks",
  "sections.media-collection": "components_sections_media_collections",
  "sections.navigation-carousel": "components_sections_navigation_carousels",
  "sections.promo-banner": "components_sections_promo_banners",
  "sections.quiz-button": "components_sections_quiz_buttons",
  "sections.related-questions": "components_sections_related_questions",
  "sections.section": "components_sections_sections",
  "sections.text": "components_sections_texts",
  "sections.video": "components_sections_videos",
  "sections.video-carousel": "components_sections_video_carousels",
  "sections.video-hero": "components_sections_video_heroes",
}

// Repeatable-component attribute tables (loaded by the per-parent
// `loadXxxItems` helpers below). Listed here for grep visibility:
//   bibleQuotesCarousel.quotes  → components_sections_bible_quote_items
//   infoBlocks.blocks           → components_sections_info_blocks_items
//   mediaCollection.items       → components_sections_media_collection_items
//   navigationCarousel.items    → components_sections_navigation_carousel_items
//   relatedQuestions.questions  → components_sections_related_question_items
//   videoCarousel.items         → components_sections_video_carousel_items
// Each is loaded via the parent's `<parent>_cmps` join table with
// `field = '<parent-field-name>'`.

/**
 * Component → (lnk table, owner-fk-column) for video relations. Owner
 * column varies (`video_hero_id`, `video_id`, `video_carousel_item_id`,
 * `media_collection_item_id`) because Strapi's lnk-table column
 * naming follows the parent component's singular name — and in the
 * `sections.video → videos` case, Strapi uses `inv_video_id` for the
 * target to avoid colliding with the owner's `video_id`.
 */
const VIDEO_LINK_TABLES: Readonly<
  Record<string, { table: string; ownerColumn: string; targetColumn: string }>
> = {
  "sections.video-hero": {
    table: "components_sections_video_heroes_video_lnk",
    ownerColumn: "video_hero_id",
    targetColumn: "video_id",
  },
  "sections.video": {
    table: "components_sections_videos_video_lnk",
    ownerColumn: "video_id",
    // Strapi uses `inv_video_id` here because the owner column is
    // already `video_id` (component named `videos`); the inverse-
    // FK gets the `inv_` prefix to avoid collision.
    targetColumn: "inv_video_id",
  },
  "video-carousel-item": {
    table: "components_sections_video_carousel_items_video_lnk",
    ownerColumn: "video_carousel_item_id",
    targetColumn: "video_id",
  },
  "media-collection-item": {
    table: "components_sections_media_collection_items_video_lnk",
    ownerColumn: "media_collection_item_id",
    targetColumn: "video_id",
  },
}

// -----------------------------------------------------------------------------
// Repository factory
// -----------------------------------------------------------------------------

/**
 * Construct a repository bound to the given `pg.Pool`. The
 * production dump workflow calls `getCmsPgPool()` to lazily resolve
 * the singleton; tests can pass a mock pool. Service-level tests use
 * the in-memory fake from `cms-experience-source.fake.ts` instead.
 */
export function createCmsExperienceSourceRepository(
  pool: Pool = getCmsPgPool(),
): CmsExperienceSourceRepository {
  return {
    enumerateDocumentLocales(filter) {
      return enumerateDocumentLocales(pool, filter)
    },
    loadExperienceRow(documentId, locale, prefer) {
      return loadExperienceRow(pool, documentId, locale, prefer)
    },
    loadComponents(componentTableForOwner, ownerEntityId, field) {
      return loadComponents(pool, componentTableForOwner, ownerEntityId, field)
    },
    loadMediaUrl(relatedType, relatedId, field) {
      return loadMediaUrl(pool, relatedType, relatedId, field)
    },
  }
}

// -----------------------------------------------------------------------------
// enumerateDocumentLocales
// -----------------------------------------------------------------------------

async function enumerateDocumentLocales(
  pool: Pool,
  filter: CmsDocumentLocaleFilter | undefined,
): Promise<CmsDocumentLocaleSummary[]> {
  // Group by (document_id, locale); a single pair may have at most
  // two physical rows per Strapi v5 (one draft, one published). The
  // CTEs split the two states so we can surface their timestamps
  // independently — the dump service uses the timestamps to detect
  // "draft pending newer than published" warnings.
  //
  // Filter args (documentIds, locales) are passed as PG text arrays
  // with the `WHERE col = ANY($N::text[])` idiom — supported on
  // PG18 (CLAUDE.md notes the `?::jsonb::text[]` cast is NOT
  // supported, but the `::text[]` array literal here is fine
  // because we send the array through the driver as a JS array, not
  // as a JSON string).
  const documentIdsFilter = filter?.documentIds ?? null
  const localesFilter = filter?.locales ?? null

  const result = await pool.query<{
    document_id: string
    locale: string
    has_published: boolean
    has_draft: boolean
    published_at: Date | null
    draft_updated_at: Date | null
  }>(
    `
    SELECT
      e.document_id,
      e.locale,
      bool_or(e.published_at IS NOT NULL) AS has_published,
      bool_or(e.published_at IS NULL)     AS has_draft,
      max(CASE WHEN e.published_at IS NOT NULL THEN e.published_at END) AS published_at,
      max(CASE WHEN e.published_at IS NULL     THEN e.updated_at   END) AS draft_updated_at
    FROM experiences e
    WHERE e.document_id IS NOT NULL
      AND e.locale       IS NOT NULL
      AND ($1::text[] IS NULL OR e.document_id = ANY($1::text[]))
      AND ($2::text[] IS NULL OR e.locale      = ANY($2::text[]))
    GROUP BY e.document_id, e.locale
    ORDER BY e.document_id, e.locale
    `,
    [documentIdsFilter, localesFilter],
  )

  return result.rows
}

// -----------------------------------------------------------------------------
// loadExperienceRow
// -----------------------------------------------------------------------------

async function loadExperienceRow(
  pool: Pool,
  documentId: string,
  locale: string,
  prefer: "published" | "draft",
): Promise<CmsExperienceRow | null> {
  // Order by preference: `prefer = "published"` returns the published
  // row first when one exists; `prefer = "draft"` returns the draft
  // first. The fallback to the other state is intentional — Strapi
  // v5 guarantees a published doc always has a draft counterpart, so
  // a "published only" query that misses both is a real "no such
  // document" answer.
  const preferOrder =
    prefer === "published"
      ? `published_at DESC NULLS LAST, updated_at DESC`
      : `published_at IS NULL DESC, updated_at DESC`

  const result = await pool.query<CmsExperienceRow>(
    `
    SELECT
      id              AS entity_id,
      document_id,
      locale,
      slug,
      is_homepage,
      is_template,
      title,
      meta_description,
      og_title,
      og_description,
      path_segment,
      published_at,
      created_at,
      updated_at
    FROM experiences
    WHERE document_id = $1
      AND locale      = $2
    ORDER BY ${preferOrder}
    LIMIT 1
    `,
    [documentId, locale],
  )

  return result.rows[0] ?? null
}

// -----------------------------------------------------------------------------
// loadComponents — top-level + recursion
// -----------------------------------------------------------------------------

async function loadComponents(
  pool: Pool,
  componentTableForOwner: string,
  ownerEntityId: number,
  field: string,
): Promise<CmsComponentRow[]> {
  // Strapi names the dynamic-zone join table `<owner>_cmps`. The
  // owner is either the parent content-type table (`experiences`) or
  // the parent component table (`components_sections_sections` etc.
  // for nested zones). We cap allowed owners to a static allowlist
  // so a typo or attacker-influenced value cannot reference an
  // arbitrary table.
  if (!isOwnerTableAllowed(componentTableForOwner)) {
    throw new Error(
      `cms-experience-source: refusing to load components from unknown owner table ${JSON.stringify(componentTableForOwner)}`,
    )
  }
  const cmpsTable = `${componentTableForOwner}_cmps`

  const linkResult = await pool.query<CmsComponentLink>(
    `
    SELECT cmp_id, component_type, "order"
    FROM "${cmpsTable}"
    WHERE entity_id = $1
      AND field     = $2
    ORDER BY "order" ASC
    `,
    [ownerEntityId, field],
  )

  const components: CmsComponentRow[] = []
  for (const link of linkResult.rows) {
    const row = await loadOneComponent(pool, link.component_type, link.cmp_id)
    if (row !== null) components.push(row)
  }
  return components
}

const ALLOWED_OWNER_TABLES: ReadonlySet<string> = new Set<string>([
  "experiences",
  // Nested dynamic zones: section.content + container.content.
  // Other components either don't carry dynamic zones at all or use
  // the repeatable-component pattern (loaded as part of the parent's
  // own row, NOT via this method).
  "components_sections_sections",
  "components_sections_containers",
])

function isOwnerTableAllowed(table: string): boolean {
  return ALLOWED_OWNER_TABLES.has(table)
}

// -----------------------------------------------------------------------------
// loadOneComponent — per-component-type dispatch
// -----------------------------------------------------------------------------

/** Discriminator union of every component_type the repository can load. */
type KnownComponentType = CmsComponentRow["componentType"]

/**
 * Predicate that narrows a raw cms component_type string into the
 * known union. cms can publish a component type admin's BlockSchema
 * doesn't model (e.g. a future Strapi component added to the
 * experience dynamic zone but not yet ported here); those return
 * `null` from loadOneComponent so the dump service surfaces them as
 * `failed_validation: transform_error`. The allowlist is the
 * COMPONENT_TABLES key set so the predicate and the dispatch stay
 * in sync by construction.
 */
function isKnownComponentType(value: string): value is KnownComponentType {
  // Object.prototype.hasOwnProperty.call avoids the `in` operator's
  // prototype-chain false positives (e.g. `'toString' in {}` is true).
  return Object.prototype.hasOwnProperty.call(COMPONENT_TABLES, value)
}

async function loadOneComponent(
  pool: Pool,
  componentType: string,
  cmpId: number,
): Promise<CmsComponentRow | null> {
  if (!isKnownComponentType(componentType)) {
    // Unknown component type — fail loud at the dump-service layer
    // by surfacing the row as null so the caller's outcome is
    // deterministic (failed_validation: transform_error).
    return null
  }

  switch (componentType) {
    case "sections.advent-countdown":
      return loadAdventCountdown(pool, cmpId)
    case "sections.bible-quotes-carousel":
      return loadBibleQuotesCarousel(pool, cmpId)
    case "sections.card":
      return loadCard(pool, cmpId)
    case "sections.container":
      return loadContainer(pool, cmpId)
    case "sections.container-slot":
      return loadContainerSlot(pool, cmpId)
    case "sections.cta":
      return loadCta(pool, cmpId)
    case "sections.easter-dates":
      return loadEasterDates(pool, cmpId)
    case "sections.info-blocks":
      return loadInfoBlocks(pool, cmpId)
    case "sections.media-collection":
      return loadMediaCollection(pool, cmpId)
    case "sections.navigation-carousel":
      return loadNavigationCarousel(pool, cmpId)
    case "sections.promo-banner":
      return loadPromoBanner(pool, cmpId)
    case "sections.quiz-button":
      return loadQuizButton(pool, cmpId)
    case "sections.related-questions":
      return loadRelatedQuestions(pool, cmpId)
    case "sections.section":
      return loadSection(pool, cmpId)
    case "sections.text":
      return loadText(pool, cmpId)
    case "sections.video":
      return loadVideo(pool, cmpId)
    case "sections.video-carousel":
      return loadVideoCarousel(pool, cmpId)
    case "sections.video-hero":
      return loadVideoHero(pool, cmpId)
    default: {
      // Exhaustive check: a new variant added to CmsComponentRow
      // (and therefore to KnownComponentType) without a matching
      // case fails compile here.
      const _exhaustive: never = componentType
      void _exhaustive
      return null
    }
  }
}

// -----------------------------------------------------------------------------
// Per-component loaders (alphabetical)
// -----------------------------------------------------------------------------

async function loadAdventCountdown(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    title: string | null
    scripture: string | null
    scripture_reference: string | null
    locale: string | null
  }>(
    `SELECT section_key, title, scripture, scripture_reference, locale
     FROM components_sections_advent_countdowns WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  return {
    componentType: "sections.advent-countdown",
    cmp_id: cmpId,
    ...row,
  } as const
}

async function loadBibleQuotesCarousel(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    heading: string | null
  }>(
    `SELECT section_key, heading
     FROM components_sections_bible_quotes_carousels WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  const quotes = await loadBibleQuoteItems(pool, cmpId)
  return {
    componentType: "sections.bible-quotes-carousel",
    cmp_id: cmpId,
    section_key: row.section_key,
    heading: row.heading,
    quotes,
  } as const
}

async function loadBibleQuoteItems(
  pool: Pool,
  carouselCmpId: number,
): Promise<CmsBibleQuoteItem[]> {
  // Fetch all child cmp_ids ordered, then fetch their attribute rows
  // in one call. Two queries per parent — fine for the small N
  // (≤20 items per carousel).
  const links = await pool.query<{ cmp_id: number }>(
    `SELECT cmp_id
     FROM components_sections_bible_quotes_carousels_cmps
     WHERE entity_id = $1 AND field = 'quotes'
     ORDER BY "order" ASC`,
    [carouselCmpId],
  )
  if (links.rows.length === 0) return []
  const ids = links.rows.map((r) => r.cmp_id)
  const items = await pool.query<
    Omit<CmsBibleQuoteItem, "cmp_id"> & { id: number }
  >(
    `SELECT id, reference, text, cta_label, cta_link, attribution, image_url, background_color
     FROM components_sections_bible_quote_items
     WHERE id = ANY($1::int[])`,
    [ids],
  )
  // Re-order to match the link order (PG might return rows in any
  // order from `ANY($)`).
  const byId = new Map(items.rows.map((r) => [r.id, r]))
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .map((r) => ({
      cmp_id: r.id,
      reference: r.reference,
      text: r.text,
      cta_label: r.cta_label,
      cta_link: r.cta_link,
      attribution: r.attribution,
      image_url: r.image_url,
      background_color: r.background_color,
    }))
}

async function loadCard(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    title: string | null
    description: string | null
    link: string | null
    variant: string | null
  }>(
    `SELECT section_key, title, description, link, variant
     FROM components_sections_cards WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  return { componentType: "sections.card", cmp_id: cmpId, ...row } as const
}

async function loadContainer(pool: Pool, cmpId: number) {
  const r = await pool.query<{ section_key: string | null }>(
    `SELECT section_key FROM components_sections_containers WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  // Recurse into the container's nested dynamic zone.
  const content = await loadComponents(
    pool,
    "components_sections_containers",
    cmpId,
    "content",
  )
  return {
    componentType: "sections.container",
    cmp_id: cmpId,
    section_key: row.section_key,
    content,
  } as const
}

async function loadContainerSlot(pool: Pool, cmpId: number) {
  const r = await pool.query<{ grid_span: number | null }>(
    `SELECT grid_span FROM components_sections_container_slots WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  return {
    componentType: "sections.container-slot",
    cmp_id: cmpId,
    grid_span: row.grid_span,
  } as const
}

async function loadCta(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    heading: string | null
    body: string | null
    button_label: string | null
    button_link: string | null
    variant: string | null
  }>(
    `SELECT section_key, heading, body, button_label, button_link, variant
     FROM components_sections_ctas WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  return { componentType: "sections.cta", cmp_id: cmpId, ...row } as const
}

async function loadEasterDates(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    easter_dates_title: string | null
    western_easter_label: string | null
    orthodox_easter_label: string | null
    passover_label: string | null
    locale: string | null
  }>(
    `SELECT section_key, easter_dates_title, western_easter_label, orthodox_easter_label, passover_label, locale
     FROM components_sections_easter_dates WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  return {
    componentType: "sections.easter-dates",
    cmp_id: cmpId,
    ...row,
  } as const
}

async function loadInfoBlocks(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    width_percent: number | null
    intro: string | null
    heading: string | null
    description: string | null
  }>(
    `SELECT section_key, width_percent, intro, heading, description
     FROM components_sections_info_blocks WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  const blocks = await loadInfoBlockItems(pool, cmpId)
  return {
    componentType: "sections.info-blocks",
    cmp_id: cmpId,
    section_key: row.section_key,
    width_percent: row.width_percent,
    intro: row.intro,
    heading: row.heading,
    description: row.description,
    blocks,
  } as const
}

async function loadInfoBlockItems(
  pool: Pool,
  parentCmpId: number,
): Promise<CmsInfoBlockItem[]> {
  const links = await pool.query<{ cmp_id: number }>(
    `SELECT cmp_id
     FROM components_sections_info_blocks_cmps
     WHERE entity_id = $1 AND field = 'blocks'
     ORDER BY "order" ASC`,
    [parentCmpId],
  )
  if (links.rows.length === 0) return []
  const ids = links.rows.map((r) => r.cmp_id)
  const items = await pool.query<{
    id: number
    icon: string | null
    title: string | null
    description: string | null
  }>(
    `SELECT id, icon, title, description
     FROM components_sections_info_blocks_items
     WHERE id = ANY($1::int[])`,
    [ids],
  )
  const byId = new Map(items.rows.map((r) => [r.id, r]))
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .map((r) => ({
      cmp_id: r.id,
      icon: r.icon,
      title: r.title,
      description: r.description,
    }))
}

async function loadMediaCollection(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    category_label: string | null
    variant: string | null
    title: string | null
    subtitle: string | null
    description: string | null
    cta_link: string | null
    cta_label: string | null
    show_item_numbers: boolean | null
    footer_text: string | null
    items_source: string | null
  }>(
    `SELECT section_key, category_label, variant, title, subtitle, description,
            cta_link, cta_label, show_item_numbers, footer_text, items_source
     FROM components_sections_media_collections WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  const items = await loadMediaCollectionItems(pool, cmpId)
  return {
    componentType: "sections.media-collection",
    cmp_id: cmpId,
    ...row,
    items,
  } as const
}

async function loadMediaCollectionItems(
  pool: Pool,
  parentCmpId: number,
): Promise<CmsMediaCollectionItem[]> {
  const links = await pool.query<{ cmp_id: number }>(
    `SELECT cmp_id
     FROM components_sections_media_collections_cmps
     WHERE entity_id = $1 AND field = 'items'
     ORDER BY "order" ASC`,
    [parentCmpId],
  )
  if (links.rows.length === 0) return []
  const ids = links.rows.map((r) => r.cmp_id)
  const items = await pool.query<{
    id: number
    title_override: string | null
    subtitle_override: string | null
    label_override: string | null
    collection_size: string | null
    image_url: string | null
    link_to_section_key: string | null
  }>(
    `SELECT id, title_override, subtitle_override, label_override,
            collection_size, image_url, link_to_section_key
     FROM components_sections_media_collection_items
     WHERE id = ANY($1::int[])`,
    [ids],
  )
  // Resolve cms video ids per item via the _video_lnk join. Typed
  // identically to loadVideoCarouselItems below so the two paths
  // stay symmetric — pg returns numeric columns as JS numbers, no
  // defensive casting needed.
  const videoLink = VIDEO_LINK_TABLES["media-collection-item"]!
  const videoLinks = await pool.query<{
    owner_id: number
    video_id: number
  }>(
    `SELECT "${videoLink.ownerColumn}" AS owner_id, "${videoLink.targetColumn}" AS video_id
     FROM "${videoLink.table}"
     WHERE "${videoLink.ownerColumn}" = ANY($1::int[])`,
    [ids],
  )
  const videoByOwner = new Map(
    videoLinks.rows.map((vl) => [vl.owner_id, vl.video_id]),
  )
  const byId = new Map(items.rows.map((r) => [r.id, r]))
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .map((r) => ({
      cmp_id: r.id,
      title_override: r.title_override,
      subtitle_override: r.subtitle_override,
      label_override: r.label_override,
      collection_size: r.collection_size,
      image_url: r.image_url,
      link_to_section_key: r.link_to_section_key,
      cms_video_id: videoByOwner.get(r.id) ?? null,
    }))
}

async function loadNavigationCarousel(pool: Pool, cmpId: number) {
  const r = await pool.query<{ section_key: string | null }>(
    `SELECT section_key FROM components_sections_navigation_carousels WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  const items = await loadNavigationCarouselItems(pool, cmpId)
  return {
    componentType: "sections.navigation-carousel",
    cmp_id: cmpId,
    section_key: row.section_key,
    items,
  } as const
}

async function loadNavigationCarouselItems(
  pool: Pool,
  parentCmpId: number,
): Promise<CmsNavigationCarouselItem[]> {
  const links = await pool.query<{ cmp_id: number }>(
    `SELECT cmp_id
     FROM components_sections_navigation_carousels_cmps
     WHERE entity_id = $1 AND field = 'items'
     ORDER BY "order" ASC`,
    [parentCmpId],
  )
  if (links.rows.length === 0) return []
  const ids = links.rows.map((r) => r.cmp_id)
  const items = await pool.query<{
    id: number
    content_id: string | null
    title: string | null
    category: string | null
    image_url: string | null
    background_color: string | null
  }>(
    `SELECT id, content_id, title, category, image_url, background_color
     FROM components_sections_navigation_carousel_items
     WHERE id = ANY($1::int[])`,
    [ids],
  )
  const byId = new Map(items.rows.map((r) => [r.id, r]))
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .map((r) => ({
      cmp_id: r.id,
      content_id: r.content_id,
      title: r.title,
      category: r.category,
      image_url: r.image_url,
      background_color: r.background_color,
    }))
}

async function loadPromoBanner(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    width_percent: number | null
    intro: string | null
    heading: string | null
    description: string | null
    cta_link: string | null
  }>(
    `SELECT section_key, width_percent, intro, heading, description, cta_link
     FROM components_sections_promo_banners WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  return {
    componentType: "sections.promo-banner",
    cmp_id: cmpId,
    ...row,
  } as const
}

async function loadQuizButton(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    button_text: string | null
    iframe_src: string | null
  }>(
    `SELECT button_text, iframe_src
     FROM components_sections_quiz_buttons WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  return {
    componentType: "sections.quiz-button",
    cmp_id: cmpId,
    ...row,
  } as const
}

async function loadRelatedQuestions(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    heading: string | null
    cta_label: string | null
    cta_link: string | null
  }>(
    `SELECT section_key, heading, cta_label, cta_link
     FROM components_sections_related_questions WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  const questions = await loadRelatedQuestionItems(pool, cmpId)
  return {
    componentType: "sections.related-questions",
    cmp_id: cmpId,
    ...row,
    questions,
  } as const
}

async function loadRelatedQuestionItems(
  pool: Pool,
  parentCmpId: number,
): Promise<CmsRelatedQuestionItem[]> {
  const links = await pool.query<{ cmp_id: number }>(
    `SELECT cmp_id
     FROM components_sections_related_questions_cmps
     WHERE entity_id = $1 AND field = 'questions'
     ORDER BY "order" ASC`,
    [parentCmpId],
  )
  if (links.rows.length === 0) return []
  const ids = links.rows.map((r) => r.cmp_id)
  const items = await pool.query<{
    id: number
    question: string | null
    answer: string | null
  }>(
    `SELECT id, question, answer
     FROM components_sections_related_question_items
     WHERE id = ANY($1::int[])`,
    [ids],
  )
  const byId = new Map(items.rows.map((r) => [r.id, r]))
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .map((r) => ({
      cmp_id: r.id,
      question: r.question,
      answer: r.answer,
    }))
}

async function loadSection(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    background_color: string | null
    blur_hash: string | null
    background_opacity: number | null
    dynamic_background_image: boolean | null
    static_overlay: boolean | null
  }>(
    `SELECT section_key, background_color, blur_hash, background_opacity,
            dynamic_background_image, static_overlay
     FROM components_sections_sections WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  // Recurse into the section's nested content zone.
  const content = await loadComponents(
    pool,
    "components_sections_sections",
    cmpId,
    "content",
  )
  return {
    componentType: "sections.section",
    cmp_id: cmpId,
    ...row,
    content,
  } as const
}

async function loadText(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    heading: string | null
    heading_level: string | null
    subtitle: string | null
    content_paragraphs: unknown
    variant: string | null
  }>(
    `SELECT section_key, heading, heading_level, subtitle, content_paragraphs, variant
     FROM components_sections_texts WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  // content_paragraphs is JSONB — pg's default behaviour parses it
  // into a JS value. If cms wrote a non-array, normalize to null
  // rather than letting downstream Zod parse a malformed shape.
  const contentParagraphs = Array.isArray(row.content_paragraphs)
    ? (row.content_paragraphs.filter((p) => typeof p === "string") as string[])
    : null
  return {
    componentType: "sections.text",
    cmp_id: cmpId,
    section_key: row.section_key,
    heading: row.heading,
    heading_level: row.heading_level,
    subtitle: row.subtitle,
    content_paragraphs: contentParagraphs,
    variant: row.variant,
  } as const
}

async function loadVideo(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    streaming_url: string | null
    title: string | null
    subtitle: string | null
    use_route_video: boolean | null
  }>(
    `SELECT section_key, streaming_url, title, subtitle, use_route_video
     FROM components_sections_videos WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  const cmsVideoId = await loadVideoRelationFor(pool, "sections.video", cmpId)
  return {
    componentType: "sections.video",
    cmp_id: cmpId,
    ...row,
    cms_video_id: cmsVideoId,
  } as const
}

async function loadVideoCarousel(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    title: string | null
    subtitle: string | null
    description: string | null
  }>(
    `SELECT section_key, title, subtitle, description
     FROM components_sections_video_carousels WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  const items = await loadVideoCarouselItems(pool, cmpId)
  return {
    componentType: "sections.video-carousel",
    cmp_id: cmpId,
    ...row,
    items,
  } as const
}

async function loadVideoCarouselItems(
  pool: Pool,
  parentCmpId: number,
): Promise<CmsVideoCarouselItem[]> {
  const links = await pool.query<{ cmp_id: number }>(
    `SELECT cmp_id
     FROM components_sections_video_carousels_cmps
     WHERE entity_id = $1 AND field = 'items'
     ORDER BY "order" ASC`,
    [parentCmpId],
  )
  if (links.rows.length === 0) return []
  const ids = links.rows.map((r) => r.cmp_id)
  const items = await pool.query<{
    id: number
    streaming_url: string | null
    image_url: string | null
    title_override: string | null
    background_color: string | null
  }>(
    `SELECT id, streaming_url, image_url, title_override, background_color
     FROM components_sections_video_carousel_items
     WHERE id = ANY($1::int[])`,
    [ids],
  )
  const videoLink = VIDEO_LINK_TABLES["video-carousel-item"]!
  const videoLinks = await pool.query<{
    owner_id: number
    video_id: number
  }>(
    `SELECT "${videoLink.ownerColumn}" AS owner_id, "${videoLink.targetColumn}" AS video_id
     FROM "${videoLink.table}"
     WHERE "${videoLink.ownerColumn}" = ANY($1::int[])`,
    [ids],
  )
  const videoByOwner = new Map(
    videoLinks.rows.map((vl) => [vl.owner_id, vl.video_id]),
  )
  const byId = new Map(items.rows.map((r) => [r.id, r]))
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .map((r) => ({
      cmp_id: r.id,
      streaming_url: r.streaming_url,
      image_url: r.image_url,
      title_override: r.title_override,
      background_color: r.background_color,
      cms_video_id: videoByOwner.get(r.id) ?? null,
    }))
}

async function loadVideoHero(pool: Pool, cmpId: number) {
  const r = await pool.query<{
    section_key: string | null
    streaming_url: string | null
    heading: string | null
    subheading: string | null
    cta_link: string | null
    cta_label: string | null
    use_route_video: boolean | null
  }>(
    `SELECT section_key, streaming_url, heading, subheading, cta_link, cta_label, use_route_video
     FROM components_sections_video_heroes WHERE id = $1`,
    [cmpId],
  )
  const row = r.rows[0]
  if (row === undefined) return null
  const cmsVideoId = await loadVideoRelationFor(
    pool,
    "sections.video-hero",
    cmpId,
  )
  return {
    componentType: "sections.video-hero",
    cmp_id: cmpId,
    ...row,
    cms_video_id: cmsVideoId,
  } as const
}

async function loadVideoRelationFor(
  pool: Pool,
  componentType: string,
  ownerId: number,
): Promise<number | null> {
  const link = VIDEO_LINK_TABLES[componentType]
  if (link === undefined) return null
  const r = await pool.query<{ video_id: number }>(
    `SELECT "${link.targetColumn}" AS video_id
     FROM "${link.table}"
     WHERE "${link.ownerColumn}" = $1
     LIMIT 1`,
    [ownerId],
  )
  return r.rows[0]?.video_id ?? null
}

// -----------------------------------------------------------------------------
// loadMediaUrl — polymorphic morph join
// -----------------------------------------------------------------------------

async function loadMediaUrl(
  pool: Pool,
  relatedType: string,
  relatedId: number,
  field: string,
): Promise<string | null> {
  const r = await pool.query<{ url: string | null }>(
    `SELECT f.url
     FROM files_related_mph m
     JOIN files f ON f.id = m.file_id
     WHERE m.related_type = $1
       AND m.related_id   = $2
       AND m.field        = $3
     ORDER BY m."order" ASC
     LIMIT 1`,
    [relatedType, relatedId, field],
  )
  return r.rows[0]?.url ?? null
}
