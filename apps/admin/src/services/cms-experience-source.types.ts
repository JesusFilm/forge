// Strapi v5 row shapes the cms-experience-source repository returns.
//
// Shapes are snake_case to mirror the cms PG column names, NOT admin's
// camelCase convention. The transform from snake→camel happens at the
// dump-service boundary, not at the repository read layer — keeping
// the read layer 1:1 with what cms's tables actually contain makes
// the SQL and the test fixtures easier to read and audit.
//
// All cms ids are integers (Strapi uses SERIAL PK); admin ids are
// cuid strings. Don't conflate the two.
//
// Verified against the live cms DB schema captured during planning
// (see Strapi v5 PostgreSQL Schema research in
// docs/plans/2026-04-23-001-feat-admin-r3-experience-migration-plan.md
// Context & Research §3).

/**
 * One row per `(document_id, locale)` from the `experiences` table.
 * Strapi v5 may carry both a draft (published_at IS NULL) and a
 * published row for the same pair; the enumeration collapses them.
 *
 * `published_at` is the most-recent published row's timestamp (NULL
 * when no published row exists). `draft_updated_at` is the draft
 * row's `updated_at` (NULL when no draft row exists).
 */
export type CmsDocumentLocaleSummary = {
  document_id: string
  locale: string
  has_published: boolean
  has_draft: boolean
  published_at: Date | null
  draft_updated_at: Date | null
}

/**
 * Filter applied to `enumerateDocumentLocales`. Both fields are
 * optional inclusion lists — omitted = no filter on that axis.
 * Length-0 arrays are treated as "omitted" by the workflow layer
 * (parity with R1/R2 mutations).
 */
export type CmsDocumentLocaleFilter = {
  documentIds?: readonly string[]
  locales?: readonly string[]
}

/**
 * Strapi-shape attributes for one (document_id, locale,
 * draft|published) row. `entity_id` is the row's numeric PK on the
 * `experiences` table — used to walk into `experiences_cmps` and
 * `files_related_mph`. `og_image_id` is resolved separately via
 * loadMediaUrl since `ogImage` is a media relation, not a column.
 */
export type CmsExperienceRow = {
  entity_id: number
  document_id: string
  locale: string
  slug: string | null
  is_homepage: boolean | null
  is_template: boolean | null
  title: string | null
  meta_description: string | null
  og_title: string | null
  og_description: string | null
  path_segment: string | null
  published_at: Date | null
  created_at: Date
  updated_at: Date
}

/**
 * One link row from `experiences_cmps` (the dynamic-zone join table).
 * `cmp_id` points into the matching `components_sections_*` table by
 * component_type. `order` is `double precision` so re-orderings can
 * insert fractional values without rewriting the whole list.
 */
export type CmsComponentLink = {
  cmp_id: number
  component_type: string
  order: number
}

/**
 * Discriminator-tagged union of every section component admin's
 * BlockSchema can map to. The `componentType` field IS the Strapi
 * UID (`sections.cta`, `sections.video-hero`, etc.) — the dump
 * service routes by this value to the matching transformer.
 *
 * Fields are snake_case mirrors of the actual cms columns. Optional
 * column types use `| null` rather than `?:` because pg returns
 * `null` for unset columns and we want callers to handle that
 * explicitly.
 */
export type CmsComponentRow =
  | CmsAdventCountdown
  | CmsBibleQuotesCarousel
  | CmsCard
  | CmsContainer
  | CmsContainerSlot
  | CmsCta
  | CmsEasterDates
  | CmsInfoBlocks
  | CmsMediaCollection
  | CmsNavigationCarousel
  | CmsPromoBanner
  | CmsQuizButton
  | CmsRelatedQuestions
  | CmsSection
  | CmsText
  | CmsVideo
  | CmsVideoCarousel
  | CmsVideoHero

export type CmsAdventCountdown = {
  componentType: "sections.advent-countdown"
  cmp_id: number
  section_key: string | null
  title: string | null
  scripture: string | null
  scripture_reference: string | null
  locale: string | null
}

export type CmsBibleQuotesCarousel = {
  componentType: "sections.bible-quotes-carousel"
  cmp_id: number
  section_key: string | null
  heading: string | null
  /** Nested bible-quote-item rows (loaded via the carousel's _cmps join). */
  quotes: CmsBibleQuoteItem[]
}

export type CmsBibleQuoteItem = {
  cmp_id: number
  reference: string | null
  text: string | null
  cta_label: string | null
  cta_link: string | null
  attribution: string | null
  image_url: string | null
  background_color: string | null
}

export type CmsCard = {
  componentType: "sections.card"
  cmp_id: number
  section_key: string | null
  title: string | null
  description: string | null
  link: string | null
  variant: string | null
}

export type CmsContainer = {
  componentType: "sections.container"
  cmp_id: number
  section_key: string | null
  /** Nested container-content blocks (loaded via the container's _cmps join). */
  content: CmsComponentRow[]
}

export type CmsContainerSlot = {
  componentType: "sections.container-slot"
  cmp_id: number
  grid_span: number | null
}

export type CmsCta = {
  componentType: "sections.cta"
  cmp_id: number
  section_key: string | null
  heading: string | null
  body: string | null
  button_label: string | null
  button_link: string | null
  variant: string | null
}

export type CmsEasterDates = {
  componentType: "sections.easter-dates"
  cmp_id: number
  section_key: string | null
  easter_dates_title: string | null
  western_easter_label: string | null
  orthodox_easter_label: string | null
  passover_label: string | null
  locale: string | null
}

export type CmsInfoBlocks = {
  componentType: "sections.info-blocks"
  cmp_id: number
  section_key: string | null
  width_percent: number | null
  intro: string | null
  heading: string | null
  description: string | null
  /** Nested info-block-item rows. */
  blocks: CmsInfoBlockItem[]
}

export type CmsInfoBlockItem = {
  cmp_id: number
  icon: string | null
  title: string | null
  description: string | null
}

export type CmsMediaCollection = {
  componentType: "sections.media-collection"
  cmp_id: number
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
  items: CmsMediaCollectionItem[]
}

export type CmsMediaCollectionItem = {
  cmp_id: number
  title_override: string | null
  subtitle_override: string | null
  label_override: string | null
  collection_size: string | null
  image_url: string | null
  link_to_section_key: string | null
  /** Resolved cms numeric video id from the `_video_lnk` join (null if no relation). */
  cms_video_id: number | null
}

export type CmsNavigationCarousel = {
  componentType: "sections.navigation-carousel"
  cmp_id: number
  section_key: string | null
  items: CmsNavigationCarouselItem[]
}

export type CmsNavigationCarouselItem = {
  cmp_id: number
  content_id: string | null
  title: string | null
  category: string | null
  image_url: string | null
  background_color: string | null
}

export type CmsPromoBanner = {
  componentType: "sections.promo-banner"
  cmp_id: number
  section_key: string | null
  width_percent: number | null
  intro: string | null
  heading: string | null
  description: string | null
  cta_link: string | null
}

export type CmsQuizButton = {
  componentType: "sections.quiz-button"
  cmp_id: number
  button_text: string | null
  iframe_src: string | null
}

export type CmsRelatedQuestions = {
  componentType: "sections.related-questions"
  cmp_id: number
  section_key: string | null
  heading: string | null
  cta_label: string | null
  cta_link: string | null
  questions: CmsRelatedQuestionItem[]
}

export type CmsRelatedQuestionItem = {
  cmp_id: number
  question: string | null
  answer: string | null
}

export type CmsSection = {
  componentType: "sections.section"
  cmp_id: number
  section_key: string | null
  background_color: string | null
  blur_hash: string | null
  background_opacity: number | null
  dynamic_background_image: boolean | null
  static_overlay: boolean | null
  /** Nested section-content blocks (loaded via the section's _cmps join). */
  content: CmsComponentRow[]
}

export type CmsText = {
  componentType: "sections.text"
  cmp_id: number
  section_key: string | null
  heading: string | null
  heading_level: string | null
  subtitle: string | null
  /** JSONB column — Strapi stores the array directly. */
  content_paragraphs: string[] | null
  variant: string | null
}

export type CmsVideo = {
  componentType: "sections.video"
  cmp_id: number
  section_key: string | null
  streaming_url: string | null
  title: string | null
  subtitle: string | null
  use_route_video: boolean | null
  cms_video_id: number | null
}

export type CmsVideoCarousel = {
  componentType: "sections.video-carousel"
  cmp_id: number
  section_key: string | null
  title: string | null
  subtitle: string | null
  description: string | null
  items: CmsVideoCarouselItem[]
}

export type CmsVideoCarouselItem = {
  cmp_id: number
  streaming_url: string | null
  image_url: string | null
  title_override: string | null
  background_color: string | null
  cms_video_id: number | null
}

export type CmsVideoHero = {
  componentType: "sections.video-hero"
  cmp_id: number
  section_key: string | null
  streaming_url: string | null
  heading: string | null
  subheading: string | null
  cta_link: string | null
  cta_label: string | null
  use_route_video: boolean | null
  cms_video_id: number | null
}

/**
 * The repository interface — what the dump service depends on. Both
 * the real `pg`-backed implementation and the in-memory fake satisfy
 * this shape so service tests stay isolated from cms entirely.
 */
export type CmsExperienceSourceRepository = {
  /** List one row per (document_id, locale) drawn from cms.experiences. */
  enumerateDocumentLocales(
    filter?: CmsDocumentLocaleFilter,
  ): Promise<CmsDocumentLocaleSummary[]>

  /**
   * Load the experience row content for a `(document_id, locale)`.
   * `prefer = "published"` returns the published row when one exists,
   * else falls back to the draft. `prefer = "draft"` returns the
   * draft row when one exists, else falls back to published.
   * Returns `null` only if neither row exists.
   */
  loadExperienceRow(
    documentId: string,
    locale: string,
    prefer: "published" | "draft",
  ): Promise<CmsExperienceRow | null>

  /**
   * Walk into the dynamic-zone join (`experiences_cmps` for
   * dynamicZoneOwner = the experience entity_id, or
   * `<component_table>_cmps` for nested zones), return one fully-
   * loaded `CmsComponentRow` per declared block in `order ASC`.
   *
   * `componentTableForOwner` is the table that owns the dynamic
   * zone — `experiences` for top-level, or the parent component's
   * own table (e.g. `components_sections_sections`) for nested
   * zones. The repository derives the right `_cmps` table name
   * from this.
   */
  loadComponents(
    componentTableForOwner: string,
    ownerEntityId: number,
    field: string,
  ): Promise<CmsComponentRow[]>

  /**
   * Look up a media URL via Strapi's polymorphic morph join.
   * `relatedType` is the parent UID (e.g. `api::experience.experience`
   * for the experience-level `ogImage` field, or a component UID for
   * component-scoped media). Returns the first matching `files.url`
   * or `null` when no link or no file exists.
   */
  loadMediaUrl(
    relatedType: string,
    relatedId: number,
    field: string,
  ): Promise<string | null>
}
