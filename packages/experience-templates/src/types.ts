import { z } from "zod"

/**
 * Shared types for generated experiences.
 *
 * These mirror the Strapi v5 section components in apps/cms/src/components/sections/*.
 * The wrapper is `sections.section` which contains nested `content[]`. Top-level
 * blocks may be a wrapper, a hero, or a carousel/collection used full-bleed.
 *
 * Source of truth: apps/cms/src/components/sections/*.json
 */

// -----------------------------------------------------------------------------
// Primitives
// -----------------------------------------------------------------------------

export type Platform = "web" | "mobile"

export type PlatformOrdering = {
  web: number[]
  mobile: number[]
}

export type BackgroundColor =
  | "default"
  | "light"
  | "dark"
  | "primary"
  | "cosmic"
  | "purple"

export type VideoRef = {
  id: number
  documentId: string
  title: string
  slug: string
  streamingUrl: string
  thumbnailUrl?: string
}

// -----------------------------------------------------------------------------
// Video sections
// -----------------------------------------------------------------------------

export type VideoSection = {
  __component: "sections.video"
  /**
   * Required in the shared model — closes a historical AI bug where the model
   * would omit sectionKey and the CMS would silently generate one.
   */
  sectionKey: string
  video: number
  streamingUrl: string
  title: string
  subtitle: string
  videoRef?: VideoRef
}

export type VideoHeroSection = {
  __component: "sections.video-hero"
  sectionKey: string
  streamingUrl: string
  heading: string
  ctaLabel?: string
  ctaLink?: string
  videoRef?: VideoRef
}

export type VideoCarouselItem = {
  sectionKey: string
  video: number
  streamingUrl: string
  title: string
  subtitle?: string
  videoRef?: VideoRef
}

export type VideoCarouselSection = {
  __component: "sections.video-carousel"
  title: string
  subtitle?: string
  description?: string
  sectionKey: string
  items: VideoCarouselItem[]
}

// -----------------------------------------------------------------------------
// Media / navigation collections
// -----------------------------------------------------------------------------

export type MediaCollectionVariant =
  | "carousel"
  | "grid"
  | "collection"
  | "hero"
  | "player"

export type MediaCollectionItemsSource = "manual" | "routeVideoChildren"

export type MediaCollectionItem = {
  video?: { id: number; documentId?: string; slug?: string }
  imageOverride?: unknown
  titleOverride?: string
  subtitleOverride?: string
  labelOverride?: string
  collectionSize?: string
  imageUrl?: string
  linkToSectionKey?: string
}

export type MediaCollectionSection = {
  __component: "sections.media-collection"
  sectionKey?: string
  categoryLabel?: string
  variant: MediaCollectionVariant
  itemsSource?: MediaCollectionItemsSource
  title?: string
  subtitle?: string
  description?: string
  ctaLink?: string
  ctaLabel?: string
  showItemNumbers?: boolean
  footerText?: string
  items?: MediaCollectionItem[]
}

export type NavigationCarouselItem = {
  contentId: string
  title: string
  category?: string
  imageUrl?: string
  backgroundColor?: string
}

export type NavigationCarouselSection = {
  __component: "sections.navigation-carousel"
  sectionKey?: string
  items?: NavigationCarouselItem[]
}

// -----------------------------------------------------------------------------
// Text / content blocks
// -----------------------------------------------------------------------------

export type TextSection = {
  __component: "sections.text"
  heading?: string
  subtitle?: string
  contentParagraphs: string[]
}

export type RelatedQuestion = {
  question: string
  answer: string
}

export type RelatedQuestionsSection = {
  __component: "sections.related-questions"
  heading: string
  ctaLabel?: string
  ctaLink?: string
  questions: RelatedQuestion[]
}

export type BibleQuote = {
  reference: string
  text: string
  attribution?: string
  imageUrl: string
  backgroundColor: string
  ctaLabel?: string
  ctaLink?: string
}

export type BibleQuotesCarouselSection = {
  __component: "sections.bible-quotes-carousel"
  heading: string
  sectionKey: string
  quotes: BibleQuote[]
}

export type QuizButtonSection = {
  __component: "sections.quiz-button"
  buttonText: string
  iframeSrc: string
}

export type CardSection = {
  __component: "sections.card"
  sectionKey?: string
  title: string
  description: string
  media?: unknown
  link?: string
  variant?: "default" | "featured"
}

export type CTASection = {
  __component: "sections.cta"
  sectionKey?: string
  heading?: string
  body?: string
  buttonLabel: string
  buttonLink?: string
  variant?: "primary" | "secondary"
}

export type InfoBlock = {
  /** Strapi schema marks icon/title/description as required on the leaf item. */
  icon: string
  title: string
  description: string
}

export type InfoBlocksSection = {
  __component: "sections.info-blocks"
  sectionKey?: string
  widthPercent?: number
  intro?: string
  heading?: string
  description?: string
  blocks?: InfoBlock[]
}

export type PromoBannerSection = {
  __component: "sections.promo-banner"
  sectionKey?: string
  widthPercent?: number
  intro?: string
  heading: string
  description: string
  ctaLink: string
}

// -----------------------------------------------------------------------------
// Date-aware stubs (kept minimal for V1; schemas live in CMS)
// -----------------------------------------------------------------------------

export type AdventCountdownSection = {
  __component: "sections.advent-countdown"
  sectionKey?: string
  heading?: string
  targetDate?: string
}

export type EasterDatesSection = {
  __component: "sections.easter-dates"
  sectionKey?: string
  heading?: string
}

// -----------------------------------------------------------------------------
// Container + wrapper
// -----------------------------------------------------------------------------

/**
 * Components allowed inside `sections.container.slots[i].content[]`.
 * Per container-slot.json: media-collection, text, related-questions, cta,
 * bible-quotes-carousel, card, easter-dates, advent-countdown, video.
 */
export type SlotContent =
  | VideoSection
  | MediaCollectionSection
  | TextSection
  | RelatedQuestionsSection
  | BibleQuotesCarouselSection
  | CardSection
  | CTASection
  | AdventCountdownSection
  | EasterDatesSection

export type ContainerSlot = {
  gridSpan: number
  content: SlotContent[]
}

export type ContainerSection = {
  __component: "sections.container"
  sectionKey?: string
  slots: ContainerSlot[]
}

/**
 * Components allowed inside `sections.section.content[]`.
 * Per section.json: media-collection, text, promo-banner, info-blocks, cta,
 * container, related-questions, bible-quotes-carousel, card, video,
 * quiz-button, video-carousel, navigation-carousel.
 *
 * Note: we also permit advent-countdown / easter-dates as nested content for
 * forward compatibility — the CMS enforces the final allow-list at write time.
 */
export type SectionContent =
  | VideoSection
  | VideoCarouselSection
  | MediaCollectionSection
  | NavigationCarouselSection
  | TextSection
  | ContainerSection
  | RelatedQuestionsSection
  | BibleQuotesCarouselSection
  | QuizButtonSection
  | CardSection
  | CTASection
  | InfoBlocksSection
  | PromoBannerSection
  | AdventCountdownSection
  | EasterDatesSection

export type SectionWrapper = {
  __component: "sections.section"
  sectionKey: string
  backgroundColor?: BackgroundColor
  blurHash?: string
  backgroundOpacity?: number
  dynamicBackgroundImage?: boolean
  staticOverlay?: boolean
  content: SectionContent[]
}

// -----------------------------------------------------------------------------
// Top-level blocks (what lives in GeneratedExperience.blocks[])
// -----------------------------------------------------------------------------

/**
 * Blocks that may appear at the top level of a generated experience.
 * Nested content (text, container, etc.) always sits inside a SectionWrapper.
 */
export type TopLevelBlock =
  | VideoHeroSection
  | SectionWrapper
  | VideoCarouselSection
  | MediaCollectionSection

/** Convenience union used by parsers that walk mixed trees. */
export type SectionBlock = TopLevelBlock | SectionContent

export type GeneratedExperience = {
  title: string
  slug: string
  metaDescription?: string
  blocks: TopLevelBlock[]
  platformOrdering: PlatformOrdering
}

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  experienceSnapshot?: GeneratedExperience
  suggestions?: string[]
}

// -----------------------------------------------------------------------------
// Zod peers — used by seed-studio for validation + for the generator's
// strict-JSON-Schema instructions.
//
// These mirror the TypeScript types 1:1. We intentionally keep the nested
// content schemas loose (`z.any()`) inside container/section content to avoid
// an explosion of forward-reference hacks; runtime callers can re-narrow with
// discriminated unions after initial parse if they need deeper guarantees.
// -----------------------------------------------------------------------------

const backgroundColorSchema = z.enum([
  "default",
  "light",
  "dark",
  "primary",
  "cosmic",
  "purple",
])

const videoRefSchema = z.object({
  id: z.number(),
  documentId: z.string(),
  title: z.string(),
  slug: z.string(),
  streamingUrl: z.string(),
  thumbnailUrl: z.string().optional(),
})

const videoHeroSectionSchema = z.object({
  __component: z.literal("sections.video-hero"),
  sectionKey: z.string().min(1),
  streamingUrl: z.string(),
  heading: z.string(),
  ctaLabel: z.string().optional(),
  ctaLink: z.string().optional(),
  videoRef: videoRefSchema.optional(),
})

const videoCarouselItemSchema = z.object({
  sectionKey: z.string(),
  video: z.number(),
  streamingUrl: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  videoRef: videoRefSchema.optional(),
})

const videoCarouselSectionSchema = z.object({
  __component: z.literal("sections.video-carousel"),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  sectionKey: z.string().min(1),
  items: z.array(videoCarouselItemSchema),
})

const mediaCollectionSectionSchema = z.object({
  __component: z.literal("sections.media-collection"),
  sectionKey: z.string().optional(),
  categoryLabel: z.string().optional(),
  variant: z.enum(["carousel", "grid", "collection", "hero", "player"]),
  itemsSource: z.enum(["manual", "routeVideoChildren"]).optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  ctaLink: z.string().optional(),
  ctaLabel: z.string().optional(),
  showItemNumbers: z.boolean().optional(),
  footerText: z.string().optional(),
  items: z
    .array(
      z.object({
        video: z
          .object({
            id: z.number(),
            documentId: z.string().optional(),
            slug: z.string().optional(),
          })
          .optional(),
        imageOverride: z.unknown().optional(),
        titleOverride: z.string().optional(),
        subtitleOverride: z.string().optional(),
        labelOverride: z.string().optional(),
        collectionSize: z.string().optional(),
        imageUrl: z.string().optional(),
        linkToSectionKey: z.string().optional(),
      }),
    )
    .optional(),
})

const sectionWrapperSchema = z.object({
  __component: z.literal("sections.section"),
  sectionKey: z.string().min(1),
  backgroundColor: backgroundColorSchema.optional(),
  blurHash: z.string().optional(),
  backgroundOpacity: z.number().min(0).max(1).optional(),
  dynamicBackgroundImage: z.boolean().optional(),
  staticOverlay: z.boolean().optional(),
  // Nested content is kept loose to avoid a cyclic schema; consumers validate
  // deeper using the per-component schemas when they need to.
  content: z.array(z.record(z.string(), z.unknown())),
})

/**
 * Discriminated union for the four canonical top-level block shapes produced
 * by the strict-schema generator. Consumers that need deeper guarantees can
 * re-parse `SectionWrapper.content[]` against a nested schema of their choice.
 */
export const topLevelBlockSchema = z.discriminatedUnion("__component", [
  videoHeroSectionSchema,
  sectionWrapperSchema,
  videoCarouselSectionSchema,
  mediaCollectionSectionSchema,
])

/**
 * Permissive catch-all for blocks produced by legacy free-form providers
 * (Gemini, Claude CLI, Ollama, Codex) which emit flat shapes like
 * `sections.text`, `sections.video`, `sections.bible-quotes-carousel`, etc.
 * at the top level. We only enforce that `__component` is a string — the
 * preview SectionRenderer dispatches by `__component` and unknown types
 * render as null with a dev console warning.
 */
const anyBlockSchema = z.looseObject({
  __component: z.string(),
})

/**
 * Block-level schema that accepts either a canonical strict top-level block
 * OR any loose legacy block. This keeps the strict-schema generator (which
 * always emits canonical shapes) honest while tolerating legacy providers.
 */
export const blockSchema = z.union([topLevelBlockSchema, anyBlockSchema])

export const generatedExperienceSchema = z.object({
  title: z.string(),
  slug: z.string(),
  metaDescription: z.string().optional(),
  blocks: z.array(blockSchema),
  platformOrdering: z.object({
    web: z.array(z.number()),
    mobile: z.array(z.number()),
  }),
})
