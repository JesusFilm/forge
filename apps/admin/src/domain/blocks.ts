// Experience block schema — Zod discriminated union mirroring the 16 top-level
// block component types from the legacy CMS, plus the nested leaves each
// block composes. Validated at the service boundary on write (Unit 7).
//
// Discriminator: each block carries a `t` field (short for "type") selected
// from the enum below. Strapi's dashed component paths (`sections.bible-
// quotes-carousel`) become camelCase (`bibleQuotesCarousel`) so the shape is
// ergonomic for TypeScript consumers and agent-authored fixtures.
//
// Three scopes, declared top-down so Zod types resolve without z.lazy:
//   - `ContainerContentBlockSchema`     — narrowest set, allowed inside
//                                          `container.content` (excludes
//                                          container + section, includes slot
//                                          divider markers)
//   - `SectionContentBlockSchema`        — allowed inside `section.content`
//                                          (includes container + quizButton;
//                                          excludes section itself)
//   - `BlockSchema`                      — top level of `ExperienceLocale.blocks`
//                                          (excludes quizButton)
//
// Media fields are asset-backed for authored block visuals. Video-derived
// images remain resolved from Video rows at read time.
//
// Agent extensibility (R25): adding a new block type is (1) add a Zod schema
// + `t` literal below, (2) add it to the relevant scope union, (3) add UI
// handling in the dashboard. No Prisma migration required.

import { z } from "zod"

// -----------------------------------------------------------------------------
// Shared primitives
// -----------------------------------------------------------------------------

/**
 * Every top-level block can be tagged with a stable sectionKey for deep
 * linking, analytics, and cross-block references (navigation carousel).
 */
const sectionKey = z.string().min(1).max(200).optional()

/** Explicit union of Strapi heading levels so downstream renderers are narrow. */
const headingLevel = z.enum(["h1", "h2", "h3", "h4", "h5", "h6"])
const assetId = z.string().min(1).optional()
const mediaUrl = z.string().refine(
  (value) => {
    if (value.startsWith("/")) return true
    return URL.canParse(value)
  },
  { message: "Invalid URL" },
)

// -----------------------------------------------------------------------------
// Leaf components (embedded inside blocks; not top-level)
// -----------------------------------------------------------------------------

/** `sections.bible-quote-item` — nested inside bibleQuotesCarousel.quotes. */
export const BibleQuoteItemSchema = z
  .object({
    reference: z.string().min(1),
    /**
     * Verse text. Optional because reference-first scripture (video-anchored
     * generation) stores only the reference + structured citation identity and
     * resolves the actual verse text at web render from the YouVersion / jsdelivr
     * pipeline — the LLM never authors it. Hand-authored quotes may still carry text.
     */
    text: z.string().min(1).optional(),
    /**
     * Structured citation identity (from BibleCitation rows) so apps/web can resolve
     * verse text by stable book/chapter/verse instead of parsing the reference label.
     * Optional for backward compatibility with existing hand-authored quotes.
     */
    osisId: z.string().min(1).optional(),
    chapterStart: z.number().int().min(1).optional(),
    chapterEnd: z.number().int().min(1).optional(),
    verseStart: z.number().int().min(1).optional(),
    verseEnd: z.number().int().min(1).optional(),
    backgroundImageAssetId: assetId,
    ctaEnabled: z.boolean().optional(),
    ctaLabel: z.string().optional(),
    ctaLink: z.string().optional(),
    attribution: z.string().optional(),
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
  })
  .strict()

/** `sections.info-block` — nested inside infoBlocks.blocks. */
export const InfoBlockItemSchema = z
  .object({
    icon: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
  })
  .strict()

/** `sections.media-collection-item` — nested inside mediaCollection.items. */
export const MediaCollectionItemSchema = z
  .object({
    /** Reference to a Video row by id (resolved on read). */
    videoId: z.string().optional(),
    /** Reference to a Language row by id for language-specific video picks. */
    languageId: z.string().optional(),
    /** Snapshot of the Video route slug so static authored collections can link. */
    videoSlug: z.string().min(1).optional(),
    titleOverride: z.string().optional(),
    subtitleOverride: z.string().optional(),
    labelOverride: z.string().optional(),
    collectionSize: z.string().optional(),
    imageAssetId: assetId,
    linkToSectionKey: z.string().optional(),
  })
  .strict()

/** `sections.navigation-carousel-item` — nested inside navigationCarousel.items. */
export const NavigationCarouselItemSchema = z
  .object({
    contentId: z.string().min(1),
    title: z.string().min(1),
    category: z.string().optional(),
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
  })
  .strict()

/** `sections.related-question-item` — nested inside relatedQuestions.questions. */
export const RelatedQuestionItemSchema = z
  .object({
    question: z.string().min(1),
    /** Rich text. Legacy used Strapi richtext; here plain markdown string. */
    answer: z.string().min(1),
  })
  .strict()

/** `sections.video-carousel-item` — nested inside videoCarousel.items. */
export const VideoCarouselItemSchema = z
  .object({
    videoId: z.string().optional(),
    /** Reference to a Language row by id for language-specific video picks. */
    languageId: z.string().optional(),
    streamingUrl: z.string().optional(),
    imageAssetId: assetId,
    titleOverride: z.string().optional(),
    subtitleOverride: z.string().optional(),
    backgroundColor: z.string().optional(),
  })
  .strict()

// -----------------------------------------------------------------------------
// Simple / non-composing blocks (no nested sections or containers)
// -----------------------------------------------------------------------------

export const AdventCountdownBlockSchema = z
  .object({
    t: z.literal("adventCountdown"),
    sectionKey,
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
    title: z.string().min(1),
    scripture: z.string().optional(),
    scriptureReference: z.string().optional(),
    locale: z.string().optional(),
  })
  .strict()

export const BibleQuotesCarouselBlockSchema = z
  .object({
    t: z.literal("bibleQuotesCarousel"),
    sectionKey,
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
    heading: z.string().optional(),
    quotes: z.array(BibleQuoteItemSchema).default([]),
  })
  .strict()

export const CardBlockSchema = z
  .object({
    t: z.literal("card"),
    sectionKey,
    title: z.string().min(1),
    description: z.string().min(1),
    mediaUrl: mediaUrl.optional(),
    mediaAssetId: assetId,
    backgroundColor: z.string().optional(),
    link: z.string().optional(),
    variant: z.enum(["default", "featured"]).default("default"),
  })
  .strict()

export const CtaBlockSchema = z
  .object({
    t: z.literal("cta"),
    sectionKey,
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
    heading: z.string().optional(),
    body: z.string().optional(),
    buttonLabel: z.string().min(1),
    buttonLink: z.string().optional(),
    variant: z.enum(["primary", "secondary"]).default("primary"),
  })
  .strict()

export const EasterDatesBlockSchema = z
  .object({
    t: z.literal("easterDates"),
    sectionKey,
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
    easterDatesTitle: z.string().min(1),
    westernEasterLabel: z.string().min(1),
    orthodoxEasterLabel: z.string().min(1),
    passoverLabel: z.string().min(1),
    westernEasterEnabled: z.boolean().optional(),
    orthodoxEasterEnabled: z.boolean().optional(),
    passoverEnabled: z.boolean().optional(),
    locale: z.string().optional(),
  })
  .strict()

export const InfoBlocksBlockSchema = z
  .object({
    t: z.literal("infoBlocks"),
    sectionKey,
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
    widthPercent: z.number().int().min(1).max(100).optional(),
    intro: z.string().optional(),
    heading: z.string().optional(),
    description: z.string().optional(),
    blocks: z.array(InfoBlockItemSchema).default([]),
  })
  .strict()

export const MediaCollectionBlockSchema = z
  .object({
    t: z.literal("mediaCollection"),
    sectionKey,
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
    categoryLabel: z.string().optional(),
    variant: z.enum(["carousel", "grid", "collection", "hero", "player"]),
    thumbnailOrientation: z.enum(["vertical", "horizontal"]).optional(),
    itemsSource: z.enum(["manual", "routeVideoChildren"]).default("manual"),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    ctaLink: z.string().optional(),
    ctaLabel: z.string().optional(),
    showItemNumbers: z.boolean().default(false),
    footerText: z.string().optional(),
    items: z.array(MediaCollectionItemSchema).default([]),
  })
  .strict()

export const NavigationCarouselBlockSchema = z
  .object({
    t: z.literal("navigationCarousel"),
    sectionKey,
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
    items: z.array(NavigationCarouselItemSchema).default([]),
  })
  .strict()

export const PromoBannerBlockSchema = z
  .object({
    t: z.literal("promoBanner"),
    sectionKey,
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
    widthPercent: z.number().int().min(1).max(100).optional(),
    intro: z.string().optional(),
    heading: z.string().min(1),
    description: z.string().min(1),
    ctaEnabled: z.boolean().optional(),
    ctaLabel: z.string().optional(),
    ctaLink: z.string().min(1),
  })
  .strict()

/**
 * `sections.quiz-button` — allowed ONLY inside `section.content`, never at
 * the top level (mirrors the Strapi dynamic-zone restriction).
 */
export const QuizButtonBlockSchema = z
  .object({
    t: z.literal("quizButton"),
    sectionKey,
    buttonText: z.string().min(1),
    /** Must be a nextstep.is URL per the legacy regex constraint. */
    iframeSrc: z.string().regex(/^https:\/\/[\w.-]+\.nextstep\.is\/.*$/, {
      message: "iframeSrc must be a nextstep.is URL",
    }),
  })
  .strict()

export const RelatedQuestionsBlockSchema = z
  .object({
    t: z.literal("relatedQuestions"),
    sectionKey,
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
    heading: z.string().optional(),
    questions: z.array(RelatedQuestionItemSchema).default([]),
    ctaEnabled: z.boolean().optional(),
    ctaLabel: z.string().optional(),
    ctaLink: z.string().optional(),
  })
  .strict()

export const TextBlockSchema = z
  .object({
    t: z.literal("text"),
    sectionKey,
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
    heading: z.string().optional(),
    headingLevel: headingLevel.optional(),
    subtitle: z.string().optional(),
    contentParagraphs: z.array(z.string()).optional(),
    variant: z.enum(["default", "lead", "small", "promotional"]).optional(),
  })
  .strict()

export const VideoBlockSchema = z
  .object({
    t: z.literal("video"),
    sectionKey,
    useRouteVideo: z.boolean().default(false),
    streamingUrl: z.string().optional(),
    /** Reference to a Video row by id. */
    videoId: z.string().optional(),
    /** Reference to a Language row by id for language-specific video picks. */
    languageId: z.string().optional(),
    mediaUrl: mediaUrl.optional(),
    mediaAssetId: assetId,
    clipStartSeconds: z.number().min(0).optional(),
    clipEndSeconds: z.number().min(0).optional(),
    autoplay: z.boolean().optional(),
    muted: z.boolean().optional(),
    loop: z.boolean().optional(),
    showControls: z.boolean().optional(),
    titleSource: z.enum(["manual", "videoTitle"]).optional(),
    subtitleSource: z.enum(["manual", "videoDescription"]).optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
  })
  .strict()

export const VideoCarouselBlockSchema = z
  .object({
    t: z.literal("videoCarousel"),
    sectionKey,
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
    itemsSource: z.enum(["manual", "routeVideoChildren"]).default("manual"),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    items: z.array(VideoCarouselItemSchema).default([]),
  })
  .strict()

/**
 * Forward-looking block for the recommendations surface. R5 lands the
 * schema only — no editor UX, no renderer. Powered at render time by
 * `sceneRecommendations(videoId | slug, locale, limit)` (R5 GraphQL
 * query). Modelled after `VideoCarouselBlockSchema`: top-level,
 * video-driven, content derived at render time rather than authored
 * item-by-item. See plan §Key Technical Decisions #13.
 */
export const VideoRecommendationsBlockSchema = z
  .object({
    t: z.literal("videoRecommendations"),
    sectionKey,
    imageAssetId: assetId,
    backgroundColor: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    /** Seed Video cuid. Omit to derive from the route's video. */
    sourceVideoId: z.string().optional(),
    /** Seed scene index. Omit for per-video mode. */
    sourceSceneIndex: z.number().int().min(0).optional(),
    /** Number of recommendations to render. Matches service MAX_LIMIT. */
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict()

export const VideoHeroBlockSchema = z
  .object({
    t: z.literal("videoHero"),
    sectionKey,
    useRouteVideo: z.boolean().default(false),
    ctaEnabled: z.boolean().optional(),
    videoId: z.string().optional(),
    /** Reference to a Language row by id for language-specific video picks. */
    languageId: z.string().optional(),
    streamingUrl: z.string().optional(),
    clipStartSeconds: z.number().min(0).optional(),
    clipEndSeconds: z.number().min(0).optional(),
    autoplay: z.boolean().optional(),
    muted: z.boolean().optional(),
    loop: z.boolean().optional(),
    showControls: z.boolean().optional(),
    headingSource: z.enum(["manual", "videoTitle"]).optional(),
    subheadingSource: z.enum(["manual", "videoDescription"]).optional(),
    heading: z.string().optional(),
    subheading: z.string().optional(),
    ctaLink: z.string().optional(),
    ctaLabel: z.string().optional(),
  })
  .strict()

export const WatchHomeHeroBlockSchema = z
  .object({
    t: z.literal("watchHomeHero"),
    sectionKey,
  })
  .strict()

// -----------------------------------------------------------------------------
// Container composition (no recursion — slot content is a narrower set).
// -----------------------------------------------------------------------------

/**
 * Blocks allowed inside `container.content`. The narrowest scope — no
 * containers, no sections. Slot dividers are represented as block markers in
 * the same ordered list so content can move across dividers without nesting.
 */
export const ContainerSlotSpansSchema = z
  .object({
    xs: z.number().int().min(1).max(12).optional(),
    sm: z.number().int().min(1).max(12).optional(),
    md: z.number().int().min(1).max(12).optional(),
    lg: z.number().int().min(1).max(12).optional(),
    xl: z.number().int().min(1).max(12).optional(),
  })
  .strict()

export const ContainerSlotBlockSchema = z
  .object({
    t: z.literal("containerSlot"),
    gridSpan: z.number().int().min(1).max(12).default(6),
    spans: ContainerSlotSpansSchema.optional(),
    backgroundColor: z.string().optional(),
    backgroundImageAssetId: assetId,
  })
  .strict()

export type ContainerSlotBlock = z.infer<typeof ContainerSlotBlockSchema>

export const ContainerContentBlockSchema = z.discriminatedUnion("t", [
  ContainerSlotBlockSchema,
  MediaCollectionBlockSchema,
  TextBlockSchema,
  RelatedQuestionsBlockSchema,
  CtaBlockSchema,
  BibleQuotesCarouselBlockSchema,
  CardBlockSchema,
  EasterDatesBlockSchema,
  AdventCountdownBlockSchema,
  VideoBlockSchema,
])

export type ContainerContentBlock = z.infer<typeof ContainerContentBlockSchema>

/**
 * `sections.container` — side-by-side layout with repeatable slots.
 * Declared before SectionContent because SectionContent references it.
 */
export const ContainerBlockSchema = z
  .object({
    t: z.literal("container"),
    sectionKey,
    backgroundColor: z.string().optional(),
    backgroundImageAssetId: assetId,
    content: z.array(ContainerContentBlockSchema).default([]),
    /** Legacy nested-slot payloads are tolerated so old drafts can be opened. */
    slots: z.custom<never>(() => true).optional(),
  })
  .strict()

export type ContainerBlock = z.infer<typeof ContainerBlockSchema>

// -----------------------------------------------------------------------------
// Section composition (no recursion — section cannot contain section).
// -----------------------------------------------------------------------------

/**
 * Blocks allowed inside `section.content`. Includes `container` and
 * `quizButton`; deliberately EXCLUDES `section` itself (legacy CMS
 * restriction) and top-level-only blocks like `videoHero`.
 */
export const SectionContentBlockSchema = z.discriminatedUnion("t", [
  MediaCollectionBlockSchema,
  TextBlockSchema,
  PromoBannerBlockSchema,
  InfoBlocksBlockSchema,
  CtaBlockSchema,
  ContainerBlockSchema,
  RelatedQuestionsBlockSchema,
  BibleQuotesCarouselBlockSchema,
  CardBlockSchema,
  VideoBlockSchema,
  QuizButtonBlockSchema,
  VideoCarouselBlockSchema,
  NavigationCarouselBlockSchema,
])

export type SectionContentBlock = z.infer<typeof SectionContentBlockSchema>

/**
 * `sections.section` — wrapper section with background + dynamic content.
 * Cannot contain another section (per legacy CMS).
 */
export const SectionBlockSchema = z
  .object({
    t: z.literal("section"),
    sectionKey,
    backgroundColor: z.string().optional(),
    backgroundImageAssetId: assetId,
    blurHash: z.string().optional(),
    backgroundOpacity: z.number().min(0).max(1).optional(),
    dynamicBackgroundImage: z.boolean().default(false),
    staticOverlay: z.boolean().default(false),
    content: z.array(SectionContentBlockSchema).default([]),
  })
  .strict()

export type SectionBlock = z.infer<typeof SectionBlockSchema>

// -----------------------------------------------------------------------------
// Top-level union — what `ExperienceLocale.blocks` holds.
// -----------------------------------------------------------------------------

/**
 * Discriminated union of the 16 top-level block types for
 * `ExperienceLocale.blocks`. `quizButton` is deliberately excluded here — it
 * only appears inside `section.content`.
 */
export const BlockSchema = z.discriminatedUnion("t", [
  MediaCollectionBlockSchema,
  PromoBannerBlockSchema,
  InfoBlocksBlockSchema,
  CtaBlockSchema,
  VideoHeroBlockSchema,
  ContainerBlockSchema,
  TextBlockSchema,
  SectionBlockSchema,
  RelatedQuestionsBlockSchema,
  BibleQuotesCarouselBlockSchema,
  CardBlockSchema,
  EasterDatesBlockSchema,
  AdventCountdownBlockSchema,
  VideoBlockSchema,
  VideoCarouselBlockSchema,
  VideoRecommendationsBlockSchema,
  NavigationCarouselBlockSchema,
  WatchHomeHeroBlockSchema,
])

export type Block = z.infer<typeof BlockSchema>

/**
 * Schema applied to `ExperienceLocale.blocks` as a whole — an array of
 * top-level blocks. Used by the service layer before writes (Unit 7).
 *
 * Deliberately has NO global `.min()`: this schema governs ALL persistence,
 * including legitimate manual experiences that may have a single block. The
 * AI-generation minimum-block-count rule is single-sourced as
 * `GENERATION_MIN_BLOCKS` in `@forge/experience-schema`
 * and enforced only on the generation path (the workflow's
 * `DraftExperienceSchema` gate + the post-normalize check in
 * `experience-ai-normalize.ts`). Adding a minimum here would reject valid
 * hand-authored 1-block content.
 */
export const BlocksSchema = z.array(BlockSchema)

export type Blocks = z.infer<typeof BlocksSchema>
