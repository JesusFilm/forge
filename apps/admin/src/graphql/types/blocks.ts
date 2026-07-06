// Pothos types projecting the Zod `BlockSchema` discriminated unions onto
// GraphQL. Each block is a POJO from the JSON column (not a Prisma model),
// so registered via `builder.objectRef<Block>`. Mutations still accept
// `blocks` as `JSON` input — only QUERY OUTPUT is strongly typed.
//
// Adding a new block kind: update Zod schema + scope union(s) + the Pothos
// type + T_TO_TYPENAME + matching union list. All four are enforced by
// `blocks.drift.test.ts`.
//
// Pre-implementation Zod construct audit (recorded for future drift):
//   - `.url()` (×25) → projects to `String` (no native URL scalar registered)
//   - `.regex(/.../)` on `iframeSrc` (QuizButtonBlock) → projects to `String`
//     (validation lives at the Zod service boundary; GraphQL has no pattern
//     type)
//   - `z.custom<never>(() => true)` on `slots` (ContainerBlock) → exposed as
//     `JSON` scalar; legacy-tolerated, consumers should ignore
//   - 0× `.transform(...)`, 0× `.refine(...)`, 0× non-discriminated `z.union(...)`

import type {
  AdventCountdownBlockSchema,
  BibleQuotesCarouselBlockSchema,
  BibleQuoteItemSchema,
  Block,
  CardBlockSchema,
  ContainerBlockSchema,
  ContainerContentBlock as ContainerContentBlockValue,
  ContainerSlotBlockSchema,
  ContainerSlotSpansSchema,
  CtaBlockSchema,
  EasterDatesBlockSchema,
  InfoBlockItemSchema,
  InfoBlocksBlockSchema,
  MediaCollectionBlockSchema,
  MediaCollectionItemSchema,
  NavigationCarouselBlockSchema,
  NavigationCarouselItemSchema,
  PromoBannerBlockSchema,
  QuizButtonBlockSchema,
  RelatedQuestionItemSchema,
  RelatedQuestionsBlockSchema,
  SectionBlockSchema,
  SectionContentBlock as SectionContentBlockValue,
  TextBlockSchema,
  VideoBlockSchema,
  VideoCarouselBlockSchema,
  VideoCarouselItemSchema,
  VideoHeroBlockSchema,
  VideoRecommendationsBlockSchema,
  WatchHomeHeroBlockSchema,
  WatchHomePromoBlockSchema,
  WatchHomePromoCardSchema,
} from "@/domain/blocks"
import type { z } from "zod"
import { builder } from "@/graphql/builder"

// Typed value helpers — each block POJO mirrors its Zod schema output.

type AdventCountdownBlock = z.infer<typeof AdventCountdownBlockSchema>
type BibleQuotesCarouselBlock = z.infer<typeof BibleQuotesCarouselBlockSchema>
type BibleQuoteItem = z.infer<typeof BibleQuoteItemSchema>
type CardBlock = z.infer<typeof CardBlockSchema>
type ContainerBlock = z.infer<typeof ContainerBlockSchema>
type ContainerSlotBlock = z.infer<typeof ContainerSlotBlockSchema>
type ContainerSlotSpans = z.infer<typeof ContainerSlotSpansSchema>
type CtaBlock = z.infer<typeof CtaBlockSchema>
type EasterDatesBlock = z.infer<typeof EasterDatesBlockSchema>
type InfoBlockItem = z.infer<typeof InfoBlockItemSchema>
type InfoBlocksBlock = z.infer<typeof InfoBlocksBlockSchema>
type MediaCollectionBlock = z.infer<typeof MediaCollectionBlockSchema>
type MediaCollectionItem = z.infer<typeof MediaCollectionItemSchema>
type NavigationCarouselBlock = z.infer<typeof NavigationCarouselBlockSchema>
type NavigationCarouselItem = z.infer<typeof NavigationCarouselItemSchema>
type PromoBannerBlock = z.infer<typeof PromoBannerBlockSchema>
type QuizButtonBlock = z.infer<typeof QuizButtonBlockSchema>
type RelatedQuestionItem = z.infer<typeof RelatedQuestionItemSchema>
type RelatedQuestionsBlock = z.infer<typeof RelatedQuestionsBlockSchema>
type SectionBlock = z.infer<typeof SectionBlockSchema>
type TextBlock = z.infer<typeof TextBlockSchema>
type VideoBlock = z.infer<typeof VideoBlockSchema>
type VideoCarouselBlock = z.infer<typeof VideoCarouselBlockSchema>
type VideoCarouselItem = z.infer<typeof VideoCarouselItemSchema>
type VideoHeroBlock = z.infer<typeof VideoHeroBlockSchema>
type VideoRecommendationsBlock = z.infer<typeof VideoRecommendationsBlockSchema>
type WatchHomeHeroBlock = z.infer<typeof WatchHomeHeroBlockSchema>
type WatchHomePromoBlock = z.infer<typeof WatchHomePromoBlockSchema>
type WatchHomePromoCard = z.infer<typeof WatchHomePromoCardSchema>

/** Surfaces unknown stored `t` discriminators as GraphQL errors instead of silently dropping. */
export class UnknownBlockKindError extends Error {
  readonly kind: string
  constructor(kind: string) {
    super(
      `Unknown block discriminator t="${kind}". Either the Zod BlockSchema is ahead of Pothos, or stored data was hand-edited. See apps/admin/src/graphql/types/blocks.ts.`,
    )
    this.kind = kind
    this.name = "UnknownBlockKindError"
  }
}

// Shared enums

const TextHeadingLevelEnum = builder.enumType("TextHeadingLevel", {
  values: {
    h1: { value: "h1" },
    h2: { value: "h2" },
    h3: { value: "h3" },
    h4: { value: "h4" },
    h5: { value: "h5" },
    h6: { value: "h6" },
  } as const,
})

const CardVariantEnum = builder.enumType("CardVariant", {
  values: {
    default: { value: "default" },
    featured: { value: "featured" },
  } as const,
})

const CtaVariantEnum = builder.enumType("CtaVariant", {
  values: {
    primary: { value: "primary" },
    secondary: { value: "secondary" },
  } as const,
})

const TextVariantEnum = builder.enumType("TextVariant", {
  values: {
    default: { value: "default" },
    lead: { value: "lead" },
    small: { value: "small" },
  } as const,
})

const MediaCollectionVariantEnum = builder.enumType("MediaCollectionVariant", {
  values: {
    carousel: { value: "carousel" },
    grid: { value: "grid" },
    collection: { value: "collection" },
    hero: { value: "hero" },
    player: { value: "player" },
  } as const,
})

// Shared by both `mediaCollection` and `videoCarousel` — one GraphQL enum.
const ItemsSourceEnum = builder.enumType("ItemsSource", {
  description:
    "Where a collection's items come from. Shared by MediaCollectionBlock.itemsSource and VideoCarouselBlock.itemsSource.",
  values: {
    manual: { value: "manual" },
    routeVideoChildren: { value: "routeVideoChildren" },
  } as const,
})

const VideoTitleSourceEnum = builder.enumType("VideoTitleSource", {
  values: {
    manual: { value: "manual" },
    videoTitle: { value: "videoTitle" },
  } as const,
})

const VideoSubtitleSourceEnum = builder.enumType("VideoSubtitleSource", {
  values: {
    manual: { value: "manual" },
    videoDescription: { value: "videoDescription" },
  } as const,
})

const VideoHeroHeadingSourceEnum = builder.enumType("VideoHeroHeadingSource", {
  values: {
    manual: { value: "manual" },
    videoTitle: { value: "videoTitle" },
  } as const,
})

const VideoHeroSubheadingSourceEnum = builder.enumType(
  "VideoHeroSubheadingSource",
  {
    values: {
      manual: { value: "manual" },
      videoDescription: { value: "videoDescription" },
    } as const,
  },
)

// Leaf (non-block) object types embedded inside their parent block.

const BibleQuoteItemRef = builder.objectRef<BibleQuoteItem>("BibleQuoteItem")
BibleQuoteItemRef.implement({
  description: "Single entry in BibleQuotesCarouselBlock.quotes.",
  fields: (t) => ({
    reference: t.exposeString("reference"),
    // Optional: reference-first scripture stores no verse text (apps/web resolves it
    // at render). Hand-authored quotes may still carry text.
    text: t.exposeString("text", { nullable: true }),
    // Structured citation identity so apps/web resolves verse text by stable
    // book/chapter/verse instead of parsing the reference label.
    osisId: t.exposeString("osisId", { nullable: true }),
    chapterStart: t.exposeInt("chapterStart", { nullable: true }),
    chapterEnd: t.exposeInt("chapterEnd", { nullable: true }),
    verseStart: t.exposeInt("verseStart", { nullable: true }),
    verseEnd: t.exposeInt("verseEnd", { nullable: true }),
    backgroundImageUrl: t.exposeString("backgroundImageUrl", {
      nullable: true,
    }),
    backgroundImageAssetId: t.exposeString("backgroundImageAssetId", {
      nullable: true,
    }),
    ctaEnabled: t.exposeBoolean("ctaEnabled", { nullable: true }),
    ctaLabel: t.exposeString("ctaLabel", { nullable: true }),
    ctaLink: t.exposeString("ctaLink", { nullable: true }),
    attribution: t.exposeString("attribution", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
  }),
})

const InfoBlockItemRef = builder.objectRef<InfoBlockItem>("InfoBlockItem")
InfoBlockItemRef.implement({
  description: "Single entry in InfoBlocksBlock.blocks.",
  fields: (t) => ({
    icon: t.exposeString("icon"),
    title: t.exposeString("title"),
    description: t.exposeString("description"),
  }),
})

const WatchHomePromoCardRef =
  builder.objectRef<WatchHomePromoCard>("WatchHomePromoCard")
WatchHomePromoCardRef.implement({
  description: "Single card in WatchHomePromoBlock points or highlights.",
  fields: (t) => ({
    icon: t.exposeString("icon", { nullable: true }),
    title: t.exposeString("title"),
    description: t.exposeString("description"),
  }),
})

const MediaCollectionItemRef = builder.objectRef<MediaCollectionItem>(
  "MediaCollectionItem",
)
MediaCollectionItemRef.implement({
  description: "Single entry in MediaCollectionBlock.items.",
  fields: (t) => ({
    videoId: t.exposeString("videoId", { nullable: true }),
    videoSlug: t.exposeString("videoSlug", { nullable: true }),
    imageOverrideUrl: t.exposeString("imageOverrideUrl", { nullable: true }),
    imageOverrideAssetId: t.exposeString("imageOverrideAssetId", {
      nullable: true,
    }),
    titleOverride: t.exposeString("titleOverride", { nullable: true }),
    subtitleOverride: t.exposeString("subtitleOverride", { nullable: true }),
    labelOverride: t.exposeString("labelOverride", { nullable: true }),
    collectionSize: t.exposeString("collectionSize", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    linkToSectionKey: t.exposeString("linkToSectionKey", { nullable: true }),
  }),
})

const NavigationCarouselItemRef = builder.objectRef<NavigationCarouselItem>(
  "NavigationCarouselItem",
)
NavigationCarouselItemRef.implement({
  description: "Single entry in NavigationCarouselBlock.items.",
  fields: (t) => ({
    contentId: t.exposeString("contentId"),
    title: t.exposeString("title"),
    category: t.exposeString("category", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
  }),
})

const RelatedQuestionItemRef = builder.objectRef<RelatedQuestionItem>(
  "RelatedQuestionItem",
)
RelatedQuestionItemRef.implement({
  description: "Single entry in RelatedQuestionsBlock.questions.",
  fields: (t) => ({
    question: t.exposeString("question"),
    answer: t.exposeString("answer"),
  }),
})

const VideoCarouselItemRef =
  builder.objectRef<VideoCarouselItem>("VideoCarouselItem")
VideoCarouselItemRef.implement({
  description: "Single entry in VideoCarouselBlock.items.",
  fields: (t) => ({
    videoId: t.exposeString("videoId", { nullable: true }),
    streamingUrl: t.exposeString("streamingUrl", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageOverrideUrl: t.exposeString("imageOverrideUrl", { nullable: true }),
    imageOverrideAssetId: t.exposeString("imageOverrideAssetId", {
      nullable: true,
    }),
    titleOverride: t.exposeString("titleOverride", { nullable: true }),
    subtitleOverride: t.exposeString("subtitleOverride", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
  }),
})

const ContainerSlotSpansRef =
  builder.objectRef<ContainerSlotSpans>("ContainerSlotSpans")
ContainerSlotSpansRef.implement({
  description: "Per-breakpoint grid span overrides on a ContainerSlotBlock.",
  fields: (t) => ({
    xs: t.exposeInt("xs", { nullable: true }),
    sm: t.exposeInt("sm", { nullable: true }),
    md: t.exposeInt("md", { nullable: true }),
    lg: t.exposeInt("lg", { nullable: true }),
    xl: t.exposeInt("xl", { nullable: true }),
  }),
})

// Block object types — one per Zod discriminated-union member.
// `t` re-exposes the Zod discriminator alongside `__typename` so consumers
// can dispatch on either.

const AdventCountdownBlockRef = builder.objectRef<AdventCountdownBlock>(
  "AdventCountdownBlock",
)
AdventCountdownBlockRef.implement({
  description: "Advent calendar countdown block.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    title: t.exposeString("title"),
    scripture: t.exposeString("scripture", { nullable: true }),
    scriptureReference: t.exposeString("scriptureReference", {
      nullable: true,
    }),
    locale: t.exposeString("locale", { nullable: true }),
  }),
})

const BibleQuotesCarouselBlockRef = builder.objectRef<BibleQuotesCarouselBlock>(
  "BibleQuotesCarouselBlock",
)
BibleQuotesCarouselBlockRef.implement({
  description: "Carousel of Bible quote items.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    heading: t.exposeString("heading", { nullable: true }),
    quotes: t.field({
      type: [BibleQuoteItemRef],
      nullable: false,
      resolve: (row) => row.quotes,
    }),
  }),
})

const CardBlockRef = builder.objectRef<CardBlock>("CardBlock")
CardBlockRef.implement({
  description: "Simple title/description card with optional media + link.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    title: t.exposeString("title"),
    description: t.exposeString("description"),
    mediaUrl: t.exposeString("mediaUrl", { nullable: true }),
    mediaAssetId: t.exposeString("mediaAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    link: t.exposeString("link", { nullable: true }),
    variant: t.field({
      type: CardVariantEnum,
      nullable: false,
      resolve: (row) => row.variant,
    }),
  }),
})

const CtaBlockRef = builder.objectRef<CtaBlock>("CtaBlock")
CtaBlockRef.implement({
  description: "Call-to-action block with button label + link.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    heading: t.exposeString("heading", { nullable: true }),
    body: t.exposeString("body", { nullable: true }),
    buttonLabel: t.exposeString("buttonLabel"),
    buttonLink: t.exposeString("buttonLink", { nullable: true }),
    variant: t.field({
      type: CtaVariantEnum,
      nullable: false,
      resolve: (row) => row.variant,
    }),
  }),
})

const EasterDatesBlockRef =
  builder.objectRef<EasterDatesBlock>("EasterDatesBlock")
EasterDatesBlockRef.implement({
  description: "Yearly Easter / Passover dates display block.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    easterDatesTitle: t.exposeString("easterDatesTitle"),
    westernEasterLabel: t.exposeString("westernEasterLabel"),
    orthodoxEasterLabel: t.exposeString("orthodoxEasterLabel"),
    passoverLabel: t.exposeString("passoverLabel"),
    westernEasterEnabled: t.exposeBoolean("westernEasterEnabled", {
      nullable: true,
    }),
    orthodoxEasterEnabled: t.exposeBoolean("orthodoxEasterEnabled", {
      nullable: true,
    }),
    passoverEnabled: t.exposeBoolean("passoverEnabled", { nullable: true }),
    locale: t.exposeString("locale", { nullable: true }),
  }),
})

const InfoBlocksBlockRef = builder.objectRef<InfoBlocksBlock>("InfoBlocksBlock")
InfoBlocksBlockRef.implement({
  description: "Grouped info-tile block.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    widthPercent: t.exposeInt("widthPercent", { nullable: true }),
    intro: t.exposeString("intro", { nullable: true }),
    heading: t.exposeString("heading", { nullable: true }),
    description: t.exposeString("description", { nullable: true }),
    blocks: t.field({
      type: [InfoBlockItemRef],
      nullable: false,
      resolve: (row) => row.blocks,
    }),
  }),
})

const MediaCollectionBlockRef = builder.objectRef<MediaCollectionBlock>(
  "MediaCollectionBlock",
)
MediaCollectionBlockRef.implement({
  description:
    "A configurable collection of media items (carousel, grid, hero, etc.).",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    categoryLabel: t.exposeString("categoryLabel", { nullable: true }),
    variant: t.field({
      type: MediaCollectionVariantEnum,
      nullable: false,
      resolve: (row) => row.variant,
    }),
    itemsSource: t.field({
      type: ItemsSourceEnum,
      nullable: false,
      resolve: (row) => row.itemsSource,
    }),
    title: t.exposeString("title", { nullable: true }),
    subtitle: t.exposeString("subtitle", { nullable: true }),
    description: t.exposeString("description", { nullable: true }),
    ctaLink: t.exposeString("ctaLink", { nullable: true }),
    ctaLabel: t.exposeString("ctaLabel", { nullable: true }),
    showItemNumbers: t.exposeBoolean("showItemNumbers"),
    footerText: t.exposeString("footerText", { nullable: true }),
    items: t.field({
      type: [MediaCollectionItemRef],
      nullable: false,
      resolve: (row) => row.items,
    }),
  }),
})

const NavigationCarouselBlockRef = builder.objectRef<NavigationCarouselBlock>(
  "NavigationCarouselBlock",
)
NavigationCarouselBlockRef.implement({
  description: "Cross-block navigation carousel.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    items: t.field({
      type: [NavigationCarouselItemRef],
      nullable: false,
      resolve: (row) => row.items,
    }),
  }),
})

const PromoBannerBlockRef =
  builder.objectRef<PromoBannerBlock>("PromoBannerBlock")
PromoBannerBlockRef.implement({
  description: "Promotional banner with heading, description, and CTA.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    widthPercent: t.exposeInt("widthPercent", { nullable: true }),
    intro: t.exposeString("intro", { nullable: true }),
    heading: t.exposeString("heading"),
    description: t.exposeString("description"),
    ctaEnabled: t.exposeBoolean("ctaEnabled", { nullable: true }),
    ctaLabel: t.exposeString("ctaLabel", { nullable: true }),
    ctaLink: t.exposeString("ctaLink"),
  }),
})

const QuizButtonBlockRef = builder.objectRef<QuizButtonBlock>("QuizButtonBlock")
QuizButtonBlockRef.implement({
  description: "Quiz launcher button. Only valid inside SectionContent.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    buttonText: t.exposeString("buttonText"),
    // Zod `.regex(...)` enforces nextstep.is URL at write time; GraphQL has no pattern scalar.
    iframeSrc: t.exposeString("iframeSrc"),
  }),
})

const RelatedQuestionsBlockRef = builder.objectRef<RelatedQuestionsBlock>(
  "RelatedQuestionsBlock",
)
RelatedQuestionsBlockRef.implement({
  description: "Accordion of related Q&A pairs with optional CTA.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    heading: t.exposeString("heading", { nullable: true }),
    questions: t.field({
      type: [RelatedQuestionItemRef],
      nullable: false,
      resolve: (row) => row.questions,
    }),
    ctaEnabled: t.exposeBoolean("ctaEnabled", { nullable: true }),
    ctaLabel: t.exposeString("ctaLabel", { nullable: true }),
    ctaLink: t.exposeString("ctaLink", { nullable: true }),
  }),
})

const TextBlockRef = builder.objectRef<TextBlock>("TextBlock")
TextBlockRef.implement({
  description: "Rich text block with heading, subtitle, and paragraphs.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    heading: t.exposeString("heading", { nullable: true }),
    headingLevel: t.field({
      type: TextHeadingLevelEnum,
      nullable: true,
      resolve: (row) => row.headingLevel ?? null,
    }),
    subtitle: t.exposeString("subtitle", { nullable: true }),
    contentParagraphs: t.field({
      type: ["String"],
      nullable: true,
      resolve: (row) => row.contentParagraphs ?? null,
    }),
    variant: t.field({
      type: TextVariantEnum,
      nullable: true,
      resolve: (row) => row.variant ?? null,
    }),
  }),
})

const VideoBlockRef = builder.objectRef<VideoBlock>("VideoBlock")
VideoBlockRef.implement({
  description: "Embedded video block with playback controls + clip range.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    useRouteVideo: t.exposeBoolean("useRouteVideo"),
    streamingUrl: t.exposeString("streamingUrl", { nullable: true }),
    videoId: t.exposeString("videoId", { nullable: true }),
    mediaUrl: t.exposeString("mediaUrl", { nullable: true }),
    mediaAssetId: t.exposeString("mediaAssetId", { nullable: true }),
    clipStartSeconds: t.exposeFloat("clipStartSeconds", { nullable: true }),
    clipEndSeconds: t.exposeFloat("clipEndSeconds", { nullable: true }),
    autoplay: t.exposeBoolean("autoplay", { nullable: true }),
    muted: t.exposeBoolean("muted", { nullable: true }),
    loop: t.exposeBoolean("loop", { nullable: true }),
    showControls: t.exposeBoolean("showControls", { nullable: true }),
    titleSource: t.field({
      type: VideoTitleSourceEnum,
      nullable: true,
      resolve: (row) => row.titleSource ?? null,
    }),
    subtitleSource: t.field({
      type: VideoSubtitleSourceEnum,
      nullable: true,
      resolve: (row) => row.subtitleSource ?? null,
    }),
    title: t.exposeString("title", { nullable: true }),
    subtitle: t.exposeString("subtitle", { nullable: true }),
  }),
})

const VideoCarouselBlockRef =
  builder.objectRef<VideoCarouselBlock>("VideoCarouselBlock")
VideoCarouselBlockRef.implement({
  description: "Horizontal video carousel.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    itemsSource: t.field({
      type: ItemsSourceEnum,
      nullable: false,
      resolve: (row) => row.itemsSource,
    }),
    title: t.exposeString("title", { nullable: true }),
    subtitle: t.exposeString("subtitle", { nullable: true }),
    description: t.exposeString("description", { nullable: true }),
    items: t.field({
      type: [VideoCarouselItemRef],
      nullable: false,
      resolve: (row) => row.items,
    }),
  }),
})

const VideoRecommendationsBlockRef =
  builder.objectRef<VideoRecommendationsBlock>("VideoRecommendationsBlock")
VideoRecommendationsBlockRef.implement({
  description:
    "Forward-looking recommendations carousel powered at render time by sceneRecommendations(...). No editor UX yet.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    title: t.exposeString("title", { nullable: true }),
    subtitle: t.exposeString("subtitle", { nullable: true }),
    description: t.exposeString("description", { nullable: true }),
    sourceVideoId: t.exposeString("sourceVideoId", { nullable: true }),
    sourceSceneIndex: t.exposeInt("sourceSceneIndex", { nullable: true }),
    limit: t.exposeInt("limit"),
  }),
})

const VideoHeroBlockRef = builder.objectRef<VideoHeroBlock>("VideoHeroBlock")
VideoHeroBlockRef.implement({
  description: "Full-bleed hero video block with optional CTA overlay.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    useRouteVideo: t.exposeBoolean("useRouteVideo"),
    ctaEnabled: t.exposeBoolean("ctaEnabled", { nullable: true }),
    videoId: t.exposeString("videoId", { nullable: true }),
    streamingUrl: t.exposeString("streamingUrl", { nullable: true }),
    clipStartSeconds: t.exposeFloat("clipStartSeconds", { nullable: true }),
    clipEndSeconds: t.exposeFloat("clipEndSeconds", { nullable: true }),
    autoplay: t.exposeBoolean("autoplay", { nullable: true }),
    muted: t.exposeBoolean("muted", { nullable: true }),
    loop: t.exposeBoolean("loop", { nullable: true }),
    showControls: t.exposeBoolean("showControls", { nullable: true }),
    headingSource: t.field({
      type: VideoHeroHeadingSourceEnum,
      nullable: true,
      resolve: (row) => row.headingSource ?? null,
    }),
    subheadingSource: t.field({
      type: VideoHeroSubheadingSourceEnum,
      nullable: true,
      resolve: (row) => row.subheadingSource ?? null,
    }),
    heading: t.exposeString("heading", { nullable: true }),
    subheading: t.exposeString("subheading", { nullable: true }),
    ctaLink: t.exposeString("ctaLink", { nullable: true }),
    ctaLabel: t.exposeString("ctaLabel", { nullable: true }),
  }),
})

const WatchHomeHeroBlockRef =
  builder.objectRef<WatchHomeHeroBlock>("WatchHomeHeroBlock")
WatchHomeHeroBlockRef.implement({
  description:
    "Top-level placeholder that renders the Web-owned Watch Home hero.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
  }),
})

const WatchHomePromoBlockRef = builder.objectRef<WatchHomePromoBlock>(
  "WatchHomePromoBlock",
)
WatchHomePromoBlockRef.implement({
  description:
    "Watch homepage mission promo and beta tester CTA block authored in Experience Builder.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    eyebrow: t.exposeString("eyebrow", { nullable: true }),
    heading: t.exposeString("heading"),
    description: t.exposeString("description"),
    points: t.field({
      type: [WatchHomePromoCardRef],
      nullable: false,
      resolve: (row) => row.points,
    }),
    highlightsHeading: t.exposeString("highlightsHeading", { nullable: true }),
    highlights: t.field({
      type: [WatchHomePromoCardRef],
      nullable: false,
      resolve: (row) => row.highlights,
    }),
    invitationEyebrow: t.exposeString("invitationEyebrow", {
      nullable: true,
    }),
    invitationHeading: t.exposeString("invitationHeading"),
    invitationGradientText: t.exposeString("invitationGradientText", {
      nullable: true,
    }),
    invitationDescription: t.exposeString("invitationDescription"),
    ctaLabel: t.exposeString("ctaLabel"),
    ctaLink: t.exposeString("ctaLink"),
  }),
})

const ContainerSlotBlockRef =
  builder.objectRef<ContainerSlotBlock>("ContainerSlotBlock")
ContainerSlotBlockRef.implement({
  description:
    "Slot divider marker inside ContainerBlock.content. Only valid inside ContainerContent.",
  fields: (t) => ({
    t: t.exposeString("t"),
    gridSpan: t.exposeInt("gridSpan"),
    spans: t.field({
      type: ContainerSlotSpansRef,
      nullable: true,
      resolve: (row) => row.spans ?? null,
    }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    backgroundImageUrl: t.exposeString("backgroundImageUrl", {
      nullable: true,
    }),
    backgroundImageAssetId: t.exposeString("backgroundImageAssetId", {
      nullable: true,
    }),
  }),
})

const ContainerBlockRef = builder.objectRef<ContainerBlock>("ContainerBlock")
ContainerBlockRef.implement({
  description:
    "Side-by-side layout container with repeatable slots. `content` dispatches into ContainerContentBlock.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    backgroundImageUrl: t.exposeString("backgroundImageUrl", {
      nullable: true,
    }),
    backgroundImageAssetId: t.exposeString("backgroundImageAssetId", {
      nullable: true,
    }),
    content: t.field({
      type: [ContainerContentBlock],
      nullable: false,
      resolve: (row) => row.content,
    }),
    // Legacy-tolerated nested-slot payloads; opaque JSON — consumers should ignore.
    slots: t.field({
      type: "JSON",
      nullable: true,
      resolve: (row) => row.slots ?? null,
    }),
  }),
})

const SectionBlockRef = builder.objectRef<SectionBlock>("SectionBlock")
SectionBlockRef.implement({
  description:
    "Wrapper section with background + dynamic content. Cannot contain another section.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    backgroundImageUrl: t.exposeString("backgroundImageUrl", {
      nullable: true,
    }),
    backgroundImageAssetId: t.exposeString("backgroundImageAssetId", {
      nullable: true,
    }),
    blurHash: t.exposeString("blurHash", { nullable: true }),
    backgroundOpacity: t.exposeFloat("backgroundOpacity", { nullable: true }),
    dynamicBackgroundImage: t.exposeBoolean("dynamicBackgroundImage"),
    staticOverlay: t.exposeBoolean("staticOverlay"),
    content: t.field({
      type: [SectionContentBlock],
      nullable: false,
      resolve: (row) => row.content,
    }),
  }),
})

// Discriminator → typename lookup. Bijective; drift-CI asserts round-trip.
//
// The `satisfies Record<Block["t"], string>` is the load-bearing compile-time
// check — adding a Zod variant without an entry here fails tsc before drift-CI
// runs. Drift test still catches typename-typo regressions that satisfies
// cannot see (typename values are strings).
export const T_TO_TYPENAME = {
  adventCountdown: "AdventCountdownBlock",
  bibleQuotesCarousel: "BibleQuotesCarouselBlock",
  card: "CardBlock",
  container: "ContainerBlock",
  containerSlot: "ContainerSlotBlock",
  cta: "CtaBlock",
  easterDates: "EasterDatesBlock",
  infoBlocks: "InfoBlocksBlock",
  mediaCollection: "MediaCollectionBlock",
  navigationCarousel: "NavigationCarouselBlock",
  promoBanner: "PromoBannerBlock",
  quizButton: "QuizButtonBlock",
  relatedQuestions: "RelatedQuestionsBlock",
  section: "SectionBlock",
  text: "TextBlock",
  video: "VideoBlock",
  videoCarousel: "VideoCarouselBlock",
  videoHero: "VideoHeroBlock",
  videoRecommendations: "VideoRecommendationsBlock",
  watchHomeHero: "WatchHomeHeroBlock",
  watchHomePromo: "WatchHomePromoBlock",
} as const satisfies Record<
  Block["t"] | SectionContentBlockValue["t"] | ContainerContentBlockValue["t"],
  string
>

export type BlockKind = keyof typeof T_TO_TYPENAME
export type BlockTypename = (typeof T_TO_TYPENAME)[BlockKind]

/** Inverse of T_TO_TYPENAME; drift-CI asserts the bijection. */
export const TYPENAME_TO_T: Readonly<Record<BlockTypename, BlockKind>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(T_TO_TYPENAME).map(([t, typename]) => [typename, t]),
    ) as Record<BlockTypename, BlockKind>,
  )

function resolveBlockTypename(value: { t: string }): BlockTypename {
  const typename = (T_TO_TYPENAME as Record<string, BlockTypename | undefined>)[
    value.t
  ]
  if (typename == null) {
    throw new UnknownBlockKindError(value.t)
  }
  return typename
}

// Unions — 17 top-level members. Excludes `quizButton` (section-only) and
// `containerSlot` (container-only).
export const ExperienceBlock = builder.unionType("ExperienceBlock", {
  description:
    "Discriminated union of every block kind admin's editor can place at the top level of ExperienceLocale.blocks. Wire-discriminate via __typename or the explicit `t` field — both project from the Zod discriminator.",
  types: [
    AdventCountdownBlockRef,
    BibleQuotesCarouselBlockRef,
    CardBlockRef,
    ContainerBlockRef,
    CtaBlockRef,
    EasterDatesBlockRef,
    InfoBlocksBlockRef,
    MediaCollectionBlockRef,
    NavigationCarouselBlockRef,
    PromoBannerBlockRef,
    RelatedQuestionsBlockRef,
    SectionBlockRef,
    TextBlockRef,
    VideoBlockRef,
    VideoCarouselBlockRef,
    VideoHeroBlockRef,
    VideoRecommendationsBlockRef,
    WatchHomeHeroBlockRef,
    WatchHomePromoBlockRef,
  ],
  resolveType: (value: Block) => resolveBlockTypename(value),
})

/** 13 members allowed inside `section.content`. Excludes `section` (no recursion) and top-level-only blocks. */
export const SectionContentBlock = builder.unionType("SectionContentBlock", {
  description:
    "Discriminated union of block kinds allowed inside section.content.",
  types: [
    BibleQuotesCarouselBlockRef,
    CardBlockRef,
    ContainerBlockRef,
    CtaBlockRef,
    InfoBlocksBlockRef,
    MediaCollectionBlockRef,
    NavigationCarouselBlockRef,
    PromoBannerBlockRef,
    QuizButtonBlockRef,
    RelatedQuestionsBlockRef,
    TextBlockRef,
    VideoBlockRef,
    VideoCarouselBlockRef,
  ],
  resolveType: (value: SectionContentBlockValue) => resolveBlockTypename(value),
})

/** 10 members allowed inside `container.content` (narrowest scope). Includes `containerSlot` divider. */
export const ContainerContentBlock = builder.unionType(
  "ContainerContentBlock",
  {
    description:
      "Discriminated union of block kinds allowed inside container.content. The narrowest scope.",
    types: [
      AdventCountdownBlockRef,
      BibleQuotesCarouselBlockRef,
      CardBlockRef,
      ContainerSlotBlockRef,
      CtaBlockRef,
      EasterDatesBlockRef,
      MediaCollectionBlockRef,
      RelatedQuestionsBlockRef,
      TextBlockRef,
      VideoBlockRef,
    ],
    resolveType: (value: ContainerContentBlockValue) =>
      resolveBlockTypename(value),
  },
)
