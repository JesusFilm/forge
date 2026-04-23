// Per-component block transformers — cms Strapi v5 row shape →
// admin Zod BlockSchema shape.
//
// Each transformer:
//   - Constructs the admin shape FROM SCRATCH (no spread of cms row
//     attrs). Strapi internal fields (`__component`, `id` — though
//     those aren't on our row types anyway since the repository
//     surface is already typed) cannot leak in.
//   - Drops fields admin's BlockSchema doesn't model (cms is a
//     subset; admin's optional fields may simply be absent).
//   - Maps null/empty-string cms values to undefined so admin's
//     Zod `.optional()` fields parse cleanly.
//   - Uses the supplied `videoIdLookup` to resolve cms numeric video
//     ids → admin Video cuids. Misses collapse to `videoId =
//     undefined` (admin BlockSchema treats every videoId field as
//     optional — verified against `apps/admin/src/domain/blocks.ts`).
//
// The transformer registry (`transformBlocksTopLevel`) routes by
// `componentType` and dispatches to the matching per-component fn.
// Section + container variants recurse into the narrower
// SectionContent / ContainerContent scopes via the same registry
// (admin's BlockSchema declares three scopes; cms uses one
// dynamic-zone shape so a runtime scope check is what enforces
// admin's invariants).
//
// Validation is NOT performed here — the dump service runs
// `BlocksSchema.parse()` on the assembled top-level array so error
// attribution is single-pass and one-sided.

import type {
  Block,
  ContainerContentBlock,
  SectionContentBlock,
} from "@/domain/blocks"
import type {
  CmsAdventCountdown,
  CmsBibleQuoteItem,
  CmsBibleQuotesCarousel,
  CmsCard,
  CmsComponentRow,
  CmsContainer,
  CmsContainerSlot,
  CmsCta,
  CmsEasterDates,
  CmsInfoBlockItem,
  CmsInfoBlocks,
  CmsMediaCollection,
  CmsMediaCollectionItem,
  CmsNavigationCarousel,
  CmsNavigationCarouselItem,
  CmsPromoBanner,
  CmsQuizButton,
  CmsRelatedQuestionItem,
  CmsRelatedQuestions,
  CmsSection,
  CmsText,
  CmsVideo,
  CmsVideoCarousel,
  CmsVideoCarouselItem,
  CmsVideoHero,
} from "./cms-experience-source.types"

// -----------------------------------------------------------------------------
// Typed transform error
// -----------------------------------------------------------------------------

/**
 * Thrown by a per-component transformer when a structural invariant
 * fails (admin requires a field cms didn't provide, etc.). The dump
 * service catches this and surfaces it as a per-target outcome
 * `failed_validation: transform_error` with the cms cmp_id +
 * componentType in the reason payload — never the raw row data
 * (cf. zod-validation-errors-must-not-echo-user-controlled-input
 * learning).
 */
export class BlockTransformError extends Error {
  readonly code: "required_field_missing" | "unknown_component_type"
  readonly componentType: string
  readonly cmpId: number | undefined
  constructor(args: {
    code: BlockTransformError["code"]
    componentType: string
    cmpId?: number
    message: string
  }) {
    super(args.message)
    this.name = "BlockTransformError"
    this.code = args.code
    this.componentType = args.componentType
    this.cmpId = args.cmpId
  }
}

/**
 * Look up cms-numeric → admin-cuid for video relations. Returns
 * `undefined` for misses so admin's optional `videoId` fields stay
 * Zod-clean.
 */
export type VideoIdLookup = (cmsVideoId: number | null) => string | undefined

// -----------------------------------------------------------------------------
// Helpers — null-to-undefined coercion for Zod optional fields
// -----------------------------------------------------------------------------

function nullToUndef<T>(value: T | null): T | undefined {
  return value === null ? undefined : value
}

function emptyStringToUndef(value: string | null): string | undefined {
  if (value === null) return undefined
  if (value.length === 0) return undefined
  return value
}

// -----------------------------------------------------------------------------
// Top-level dispatch
// -----------------------------------------------------------------------------

/**
 * Walk the cms component list and return one admin `Block` per cms
 * component, in declaration order. Throws `BlockTransformError` if
 * any component fails its required-field check; the dump service
 * propagates the failure to the per-target outcome.
 */
export function transformBlocksTopLevel(
  components: readonly CmsComponentRow[],
  lookup: VideoIdLookup,
): Block[] {
  const out: Block[] = []
  for (const c of components) {
    const block = transformOne(c, lookup)
    if (block === undefined) continue
    out.push(block as Block)
  }
  return out
}

/**
 * Dispatch one component to its transformer by `componentType`. The
 * dispatcher always builds the admin shape; scope correctness
 * (`quizButton` only inside section.content, `section`/`container`
 * not inside container.content, etc.) is enforced downstream by
 * `BlocksSchema` / `SectionContentBlockSchema` /
 * `ContainerContentBlockSchema` at parse time, not here.
 */
function transformOne(
  c: CmsComponentRow,
  lookup: VideoIdLookup,
): Block | SectionContentBlock | ContainerContentBlock | undefined {
  switch (c.componentType) {
    case "sections.advent-countdown":
      return transformAdventCountdown(c)
    case "sections.bible-quotes-carousel":
      return transformBibleQuotesCarousel(c)
    case "sections.card":
      return transformCard(c)
    case "sections.container":
      return transformContainer(c, lookup)
    case "sections.container-slot":
      return transformContainerSlot(c)
    case "sections.cta":
      return transformCta(c)
    case "sections.easter-dates":
      return transformEasterDates(c)
    case "sections.info-blocks":
      return transformInfoBlocks(c)
    case "sections.media-collection":
      return transformMediaCollection(c, lookup)
    case "sections.navigation-carousel":
      return transformNavigationCarousel(c)
    case "sections.promo-banner":
      return transformPromoBanner(c)
    case "sections.quiz-button":
      return transformQuizButton(c)
    case "sections.related-questions":
      return transformRelatedQuestions(c)
    case "sections.section":
      return transformSection(c, lookup)
    case "sections.text":
      return transformText(c)
    case "sections.video":
      return transformVideo(c, lookup)
    case "sections.video-carousel":
      return transformVideoCarousel(c, lookup)
    case "sections.video-hero":
      return transformVideoHero(c, lookup)
    default: {
      // Exhaustive check: a new variant added to CmsComponentRow
      // will fail compile here until handled.
      const _exhaustive: never = c
      throw new BlockTransformError({
        code: "unknown_component_type",
        componentType:
          (_exhaustive as { componentType?: string }).componentType ??
          "<unknown>",
        message: "Unknown cms component type encountered during transform",
      })
    }
  }
}

// -----------------------------------------------------------------------------
// Per-component transformers (alphabetical by Strapi UID)
// -----------------------------------------------------------------------------

function transformAdventCountdown(c: CmsAdventCountdown): Block | undefined {
  if (c.title === null || c.title.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: c.componentType,
      cmpId: c.cmp_id,
      message: "advent-countdown.title is required by admin BlockSchema",
    })
  }
  return {
    t: "adventCountdown",
    sectionKey: emptyStringToUndef(c.section_key),
    title: c.title,
    scripture: emptyStringToUndef(c.scripture),
    scriptureReference: emptyStringToUndef(c.scripture_reference),
    locale: emptyStringToUndef(c.locale),
  }
}

function transformBibleQuotesCarousel(
  c: CmsBibleQuotesCarousel,
): Block | undefined {
  return {
    t: "bibleQuotesCarousel",
    sectionKey: emptyStringToUndef(c.section_key),
    heading: emptyStringToUndef(c.heading),
    quotes: c.quotes.map(transformBibleQuoteItem),
  }
}

function transformBibleQuoteItem(q: CmsBibleQuoteItem) {
  if (q.reference === null || q.reference.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: "sections.bible-quote-item",
      cmpId: q.cmp_id,
      message: "bible-quote-item.reference is required by admin BlockSchema",
    })
  }
  if (q.text === null || q.text.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: "sections.bible-quote-item",
      cmpId: q.cmp_id,
      message: "bible-quote-item.text is required by admin BlockSchema",
    })
  }
  return {
    reference: q.reference,
    text: q.text,
    ctaLabel: emptyStringToUndef(q.cta_label),
    ctaLink: emptyStringToUndef(q.cta_link),
    attribution: emptyStringToUndef(q.attribution),
    imageUrl: emptyStringToUndef(q.image_url),
    backgroundColor: emptyStringToUndef(q.background_color),
  }
}

function transformCard(c: CmsCard): Block | undefined {
  if (c.title === null || c.title.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: c.componentType,
      cmpId: c.cmp_id,
      message: "card.title is required by admin BlockSchema",
    })
  }
  if (c.description === null || c.description.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: c.componentType,
      cmpId: c.cmp_id,
      message: "card.description is required by admin BlockSchema",
    })
  }
  return {
    t: "card",
    sectionKey: emptyStringToUndef(c.section_key),
    title: c.title,
    description: c.description,
    link: emptyStringToUndef(c.link),
    variant: c.variant === "featured" ? "featured" : "default",
  }
}

function transformContainer(
  c: CmsContainer,
  lookup: VideoIdLookup,
): Block | undefined {
  return {
    t: "container",
    sectionKey: emptyStringToUndef(c.section_key),
    content: c.content
      .map((child) => transformOne(child, lookup))
      .filter((b): b is ContainerContentBlock => b !== undefined),
  }
}

function transformContainerSlot(c: CmsContainerSlot): ContainerContentBlock {
  return {
    t: "containerSlot",
    gridSpan: c.grid_span ?? 6,
  }
}

function transformCta(c: CmsCta): Block | undefined {
  if (c.button_label === null || c.button_label.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: c.componentType,
      cmpId: c.cmp_id,
      message: "cta.buttonLabel is required by admin BlockSchema",
    })
  }
  return {
    t: "cta",
    sectionKey: emptyStringToUndef(c.section_key),
    heading: emptyStringToUndef(c.heading),
    body: emptyStringToUndef(c.body),
    buttonLabel: c.button_label,
    buttonLink: emptyStringToUndef(c.button_link),
    variant: c.variant === "secondary" ? "secondary" : "primary",
  }
}

function transformEasterDates(c: CmsEasterDates): Block | undefined {
  if (c.easter_dates_title === null || c.easter_dates_title.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: c.componentType,
      cmpId: c.cmp_id,
      message: "easter-dates.easterDatesTitle is required by admin BlockSchema",
    })
  }
  if (c.western_easter_label === null || c.western_easter_label.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: c.componentType,
      cmpId: c.cmp_id,
      message:
        "easter-dates.westernEasterLabel is required by admin BlockSchema",
    })
  }
  if (
    c.orthodox_easter_label === null ||
    c.orthodox_easter_label.length === 0
  ) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: c.componentType,
      cmpId: c.cmp_id,
      message:
        "easter-dates.orthodoxEasterLabel is required by admin BlockSchema",
    })
  }
  if (c.passover_label === null || c.passover_label.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: c.componentType,
      cmpId: c.cmp_id,
      message: "easter-dates.passoverLabel is required by admin BlockSchema",
    })
  }
  return {
    t: "easterDates",
    sectionKey: emptyStringToUndef(c.section_key),
    easterDatesTitle: c.easter_dates_title,
    westernEasterLabel: c.western_easter_label,
    orthodoxEasterLabel: c.orthodox_easter_label,
    passoverLabel: c.passover_label,
    locale: emptyStringToUndef(c.locale),
  }
}

function transformInfoBlocks(c: CmsInfoBlocks): Block | undefined {
  return {
    t: "infoBlocks",
    sectionKey: emptyStringToUndef(c.section_key),
    widthPercent: nullToUndef(c.width_percent),
    intro: emptyStringToUndef(c.intro),
    heading: emptyStringToUndef(c.heading),
    description: emptyStringToUndef(c.description),
    blocks: c.blocks.map(transformInfoBlockItem),
  }
}

function transformInfoBlockItem(b: CmsInfoBlockItem) {
  if (b.icon === null || b.icon.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: "sections.info-block-item",
      cmpId: b.cmp_id,
      message: "info-block-item.icon is required by admin BlockSchema",
    })
  }
  if (b.title === null || b.title.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: "sections.info-block-item",
      cmpId: b.cmp_id,
      message: "info-block-item.title is required by admin BlockSchema",
    })
  }
  if (b.description === null || b.description.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: "sections.info-block-item",
      cmpId: b.cmp_id,
      message: "info-block-item.description is required by admin BlockSchema",
    })
  }
  return {
    icon: b.icon,
    title: b.title,
    description: b.description,
  }
}

function transformMediaCollection(
  c: CmsMediaCollection,
  lookup: VideoIdLookup,
): Block | undefined {
  // Admin requires `variant`. Cms allows null at the DB level; if
  // null we default to "carousel" (the most common cms value).
  // Leave the choice surfaced via fallback rather than failing the
  // locale, since cms historically wrote null for default.
  const variant: "carousel" | "grid" | "collection" | "hero" | "player" =
    c.variant === "carousel" ||
    c.variant === "grid" ||
    c.variant === "collection" ||
    c.variant === "hero" ||
    c.variant === "player"
      ? c.variant
      : "carousel"
  const itemsSource: "manual" | "routeVideoChildren" =
    c.items_source === "routeVideoChildren" ? "routeVideoChildren" : "manual"
  return {
    t: "mediaCollection",
    sectionKey: emptyStringToUndef(c.section_key),
    categoryLabel: emptyStringToUndef(c.category_label),
    variant,
    itemsSource,
    title: emptyStringToUndef(c.title),
    subtitle: emptyStringToUndef(c.subtitle),
    description: emptyStringToUndef(c.description),
    ctaLink: emptyStringToUndef(c.cta_link),
    ctaLabel: emptyStringToUndef(c.cta_label),
    showItemNumbers: c.show_item_numbers ?? false,
    footerText: emptyStringToUndef(c.footer_text),
    items: c.items.map((i) => transformMediaCollectionItem(i, lookup)),
  }
}

function transformMediaCollectionItem(
  i: CmsMediaCollectionItem,
  lookup: VideoIdLookup,
) {
  return {
    videoId: lookup(i.cms_video_id),
    imageOverrideUrl: emptyStringToUndef(i.image_url),
    titleOverride: emptyStringToUndef(i.title_override),
    subtitleOverride: emptyStringToUndef(i.subtitle_override),
    labelOverride: emptyStringToUndef(i.label_override),
    collectionSize: emptyStringToUndef(i.collection_size),
    linkToSectionKey: emptyStringToUndef(i.link_to_section_key),
  }
}

function transformNavigationCarousel(c: CmsNavigationCarousel): Block {
  return {
    t: "navigationCarousel",
    sectionKey: emptyStringToUndef(c.section_key),
    items: c.items.map(transformNavigationCarouselItem),
  }
}

function transformNavigationCarouselItem(i: CmsNavigationCarouselItem) {
  if (i.content_id === null || i.content_id.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: "sections.navigation-carousel-item",
      cmpId: i.cmp_id,
      message:
        "navigation-carousel-item.contentId is required by admin BlockSchema",
    })
  }
  if (i.title === null || i.title.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: "sections.navigation-carousel-item",
      cmpId: i.cmp_id,
      message:
        "navigation-carousel-item.title is required by admin BlockSchema",
    })
  }
  return {
    contentId: i.content_id,
    title: i.title,
    category: emptyStringToUndef(i.category),
    imageUrl: emptyStringToUndef(i.image_url),
    backgroundColor: emptyStringToUndef(i.background_color),
  }
}

function transformPromoBanner(c: CmsPromoBanner): Block | undefined {
  if (c.heading === null || c.heading.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: c.componentType,
      cmpId: c.cmp_id,
      message: "promo-banner.heading is required by admin BlockSchema",
    })
  }
  if (c.description === null || c.description.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: c.componentType,
      cmpId: c.cmp_id,
      message: "promo-banner.description is required by admin BlockSchema",
    })
  }
  if (c.cta_link === null || c.cta_link.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: c.componentType,
      cmpId: c.cmp_id,
      message: "promo-banner.ctaLink is required by admin BlockSchema",
    })
  }
  return {
    t: "promoBanner",
    sectionKey: emptyStringToUndef(c.section_key),
    widthPercent: nullToUndef(c.width_percent),
    intro: emptyStringToUndef(c.intro),
    heading: c.heading,
    description: c.description,
    ctaLink: c.cta_link,
  }
}

function transformQuizButton(c: CmsQuizButton): SectionContentBlock {
  if (c.button_text === null || c.button_text.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: c.componentType,
      cmpId: c.cmp_id,
      message: "quiz-button.buttonText is required by admin BlockSchema",
    })
  }
  if (c.iframe_src === null || c.iframe_src.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: c.componentType,
      cmpId: c.cmp_id,
      message: "quiz-button.iframeSrc is required by admin BlockSchema",
    })
  }
  // Admin's QuizButtonBlockSchema enforces the nextstep.is URL
  // pattern at Zod-parse time; we don't pre-check here.
  return {
    t: "quizButton",
    buttonText: c.button_text,
    iframeSrc: c.iframe_src,
  }
}

function transformRelatedQuestions(c: CmsRelatedQuestions): Block {
  return {
    t: "relatedQuestions",
    sectionKey: emptyStringToUndef(c.section_key),
    heading: emptyStringToUndef(c.heading),
    questions: c.questions.map(transformRelatedQuestionItem),
    ctaLabel: emptyStringToUndef(c.cta_label),
    ctaLink: emptyStringToUndef(c.cta_link),
  }
}

function transformRelatedQuestionItem(q: CmsRelatedQuestionItem) {
  if (q.question === null || q.question.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: "sections.related-question-item",
      cmpId: q.cmp_id,
      message:
        "related-question-item.question is required by admin BlockSchema",
    })
  }
  if (q.answer === null || q.answer.length === 0) {
    throw new BlockTransformError({
      code: "required_field_missing",
      componentType: "sections.related-question-item",
      cmpId: q.cmp_id,
      message: "related-question-item.answer is required by admin BlockSchema",
    })
  }
  return {
    question: q.question,
    answer: q.answer,
  }
}

function transformSection(c: CmsSection, lookup: VideoIdLookup): Block {
  return {
    t: "section",
    sectionKey: emptyStringToUndef(c.section_key),
    backgroundColor: emptyStringToUndef(c.background_color),
    blurHash: emptyStringToUndef(c.blur_hash),
    backgroundOpacity: nullToUndef(c.background_opacity),
    dynamicBackgroundImage: c.dynamic_background_image ?? false,
    staticOverlay: c.static_overlay ?? false,
    content: c.content
      .map((child) => transformOne(child, lookup))
      .filter((b): b is SectionContentBlock => b !== undefined),
  }
}

function transformText(c: CmsText): Block {
  const headingLevel = (() => {
    switch (c.heading_level) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return c.heading_level
      default:
        return undefined
    }
  })()
  const variant = (() => {
    switch (c.variant) {
      case "default":
      case "lead":
      case "small":
        return c.variant
      default:
        return undefined
    }
  })()
  return {
    t: "text",
    sectionKey: emptyStringToUndef(c.section_key),
    heading: emptyStringToUndef(c.heading),
    headingLevel,
    subtitle: emptyStringToUndef(c.subtitle),
    contentParagraphs:
      c.content_paragraphs && c.content_paragraphs.length > 0
        ? c.content_paragraphs
        : undefined,
    variant,
  }
}

function transformVideo(c: CmsVideo, lookup: VideoIdLookup): Block {
  return {
    t: "video",
    sectionKey: emptyStringToUndef(c.section_key),
    useRouteVideo: c.use_route_video ?? false,
    streamingUrl: emptyStringToUndef(c.streaming_url),
    videoId: lookup(c.cms_video_id),
    title: emptyStringToUndef(c.title),
    subtitle: emptyStringToUndef(c.subtitle),
  }
}

function transformVideoCarousel(
  c: CmsVideoCarousel,
  lookup: VideoIdLookup,
): Block {
  return {
    t: "videoCarousel",
    sectionKey: emptyStringToUndef(c.section_key),
    itemsSource: "manual",
    title: emptyStringToUndef(c.title),
    subtitle: emptyStringToUndef(c.subtitle),
    description: emptyStringToUndef(c.description),
    items: c.items.map((i) => transformVideoCarouselItem(i, lookup)),
  }
}

function transformVideoCarouselItem(
  i: CmsVideoCarouselItem,
  lookup: VideoIdLookup,
) {
  return {
    videoId: lookup(i.cms_video_id),
    streamingUrl: emptyStringToUndef(i.streaming_url),
    imageUrl: emptyStringToUndef(i.image_url),
    titleOverride: emptyStringToUndef(i.title_override),
    backgroundColor: emptyStringToUndef(i.background_color),
  }
}

function transformVideoHero(c: CmsVideoHero, lookup: VideoIdLookup): Block {
  return {
    t: "videoHero",
    sectionKey: emptyStringToUndef(c.section_key),
    useRouteVideo: c.use_route_video ?? false,
    videoId: lookup(c.cms_video_id),
    streamingUrl: emptyStringToUndef(c.streaming_url),
    heading: emptyStringToUndef(c.heading),
    subheading: emptyStringToUndef(c.subheading),
    ctaLink: emptyStringToUndef(c.cta_link),
    ctaLabel: emptyStringToUndef(c.cta_label),
  }
}

// -----------------------------------------------------------------------------
// Exports for tests
// -----------------------------------------------------------------------------

export const _internals = {
  transformAdventCountdown,
  transformBibleQuotesCarousel,
  transformCard,
  transformContainer,
  transformContainerSlot,
  transformCta,
  transformEasterDates,
  transformInfoBlocks,
  transformMediaCollection,
  transformNavigationCarousel,
  transformPromoBanner,
  transformQuizButton,
  transformRelatedQuestions,
  transformSection,
  transformText,
  transformVideo,
  transformVideoCarousel,
  transformVideoHero,
}
