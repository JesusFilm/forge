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
  LanguageGlobeBlockSchema,
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
} from "@/domain/blocks"
import type { z } from "zod"
import { builder, type ContextShape } from "@/graphql/builder"
import { publicMediaAssetPreviewUrl } from "@/services/media-asset.service"
import { sortVideoImagesByDisplayPreference } from "@/services/video-image-selection"
import { getOrScheduleVideoImageBlurDataUrl } from "@/services/video-image-blur-data-url.service"

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
type LanguageGlobeBlock = z.infer<typeof LanguageGlobeBlockSchema>
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

type MediaPreviewContext = {
  request: {
    url: string
  }
  prisma: {
    mediaAsset: {
      findUnique: (args: { where: { id: string } }) => Promise<{
        id: string
        backend: string
        status: string
        visibility: string
        objectKey: string | null
        previewObjectKey: string | null
        muxPlaybackId: string | null
        width: number | null
        height: number | null
        blurDataUrl: string | null
        dominantColor: string | null
      } | null>
    }
  }
}

type BlockImageAsset = NonNullable<
  Awaited<ReturnType<MediaPreviewContext["prisma"]["mediaAsset"]["findUnique"]>>
>

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

function selectedBlockVideoDubArgs(
  row: { videoId?: unknown; languageId?: unknown },
  query: object,
) {
  const videoId = optionalString(row.videoId)
  const languageId = optionalString(row.languageId)
  if (!videoId || !languageId) return null

  return {
    ...query,
    where: {
      videoId,
      languageId,
      deletedAt: null,
      published: true,
      OR: [
        { hls: { not: null } },
        { dash: { not: null } },
        { share: { not: null } },
      ],
      video: { deletedAt: null },
    },
    orderBy: [{ duration: "desc" as const }, { id: "asc" as const }],
  }
}

async function resolveMediaAssetPreviewUrl(
  ctx: MediaPreviewContext,
  assetId: unknown,
) {
  const id = optionalString(assetId)
  if (!id) return null
  const asset = await ctx.prisma.mediaAsset.findUnique({ where: { id } })
  return asset ? publicMediaAssetPreviewUrl(asset) : null
}

async function resolveBlockImageAsset(
  row: object,
  ctx: MediaPreviewContext,
  assetField: string,
) {
  const record = row as Record<string, unknown>
  const id = optionalString(record[assetField])
  if (!id) return null

  const asset = await ctx.prisma.mediaAsset.findUnique({ where: { id } })
  if (!asset) return null

  return publicMediaAssetPreviewUrl(asset) ? asset : null
}

async function resolveAssetBackedUrl(
  row: object,
  ctx: MediaPreviewContext,
  assetField: string,
) {
  const record = row as Record<string, unknown>
  if (optionalString(record[assetField])) {
    return resolveMediaAssetPreviewUrl(ctx, record[assetField])
  }

  return null
}

const BlockImageAssetRef = builder
  .objectRef<BlockImageAsset>("BlockImageAsset")
  .implement({
    description:
      "Public-safe media asset metadata for rendering Experience block imagery.",
    fields: (t) => ({
      id: t.exposeID("id"),
      previewUrl: t.string({
        nullable: true,
        resolve: (row) => publicMediaAssetPreviewUrl(row),
      }),
      blurDataUrl: t.exposeString("blurDataUrl", { nullable: true }),
      dominantColor: t.exposeString("dominantColor", { nullable: true }),
      width: t.exposeInt("width", { nullable: true }),
      height: t.exposeInt("height", { nullable: true }),
    }),
  })

type VideoImageMetadataSource = {
  id: string
  mobileCinematicHigh: string | null
  mobileCinematicLow: string | null
  videoStill: string | null
  url: string | null
  thumbnail: string | null
  width: number | null
  height: number | null
  blurDataUrl: string | null
  dominantColor: string | null
}

function videoImageUrl(image: VideoImageMetadataSource) {
  return (
    image.mobileCinematicHigh ??
    image.mobileCinematicLow ??
    image.videoStill ??
    image.url ??
    image.thumbnail
  )
}

function selectRenderableVideoImage(
  images: readonly VideoImageMetadataSource[],
) {
  return (
    sortVideoImagesByDisplayPreference(images).find((image) =>
      videoImageUrl(image),
    ) ?? null
  )
}

async function resolveMediaCollectionVideoImageMetadata(
  videoId: string,
  ctx: Pick<ContextShape, "loaders" | "prisma">,
) {
  const images = await ctx.loaders.videoImagesByVideoId.load(videoId)
  const image = selectRenderableVideoImage(images)
  const imageUrl = image ? videoImageUrl(image) : null
  if (image && imageUrl && (!image.blurDataUrl || !image.dominantColor)) {
    await getOrScheduleVideoImageBlurDataUrl({
      imageId: image.id,
      imageUrl,
      prisma: ctx.prisma,
    })
  }

  return image
}

const BlockVideoImageRef = builder
  .objectRef<VideoImageMetadataSource>("BlockVideoImage")
  .implement({
    description:
      "Public-safe metadata for the linked Video image used by an Experience block item.",
    fields: (t) => ({
      id: t.exposeID("id"),
      previewUrl: t.string({
        nullable: true,
        resolve: (row) => videoImageUrl(row),
      }),
      blurDataUrl: t.exposeString("blurDataUrl", { nullable: true }),
      dominantColor: t.exposeString("dominantColor", { nullable: true }),
      width: t.exposeInt("width", { nullable: true }),
      height: t.exposeInt("height", { nullable: true }),
    }),
  })

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
    promotional: { value: "promotional" },
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

const MediaCollectionThumbnailOrientationEnum = builder.enumType(
  "MediaCollectionThumbnailOrientation",
  {
    description: "The portrait or landscape shape used by media item cards.",
    values: {
      vertical: { value: "vertical" },
      horizontal: { value: "horizontal" },
    } as const,
  },
)

// Shared by both `mediaCollection` and `videoCarousel` — one GraphQL enum.
const ItemsSourceEnum = builder.enumType("ItemsSource", {
  description:
    "Where a collection's items come from. Shared by MediaCollectionBlock.itemsSource and VideoCarouselBlock.itemsSource.",
  values: {
    manual: { value: "manual" },
    routeVideoChildren: { value: "routeVideoChildren" },
    dynamicCollections: { value: "dynamicCollections" },
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
    backgroundImageAssetId: t.exposeString("backgroundImageAssetId", {
      nullable: true,
    }),
    backgroundImageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "backgroundImageAssetId"),
    }),
    ctaEnabled: t.exposeBoolean("ctaEnabled", { nullable: true }),
    ctaLabel: t.exposeString("ctaLabel", { nullable: true }),
    ctaLink: t.exposeString("ctaLink", { nullable: true }),
    attribution: t.exposeString("attribution", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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

const MediaCollectionItemRef = builder.objectRef<MediaCollectionItem>(
  "MediaCollectionItem",
)
MediaCollectionItemRef.implement({
  description: "Single entry in MediaCollectionBlock.items.",
  fields: (t) => ({
    coreId: t.string({
      nullable: true,
      description:
        "The referenced Video's public coreId — the identifier consumer clients (TV/mobile/web) pass to watchHomeVideos to hydrate this item. Resolved via the batched videoById loader; null when the item has no videoId.",
      resolve: async (row, _args, ctx) => {
        const videoId = optionalString(row.videoId)
        if (!videoId) return null

        const video = await ctx.loaders.videoById.load(videoId)
        if (video?.deletedAt) return null
        return video?.coreId ?? null
      },
    }),
    videoId: t.exposeString("videoId", { nullable: true }),
    languageId: t.exposeString("languageId", { nullable: true }),
    languageSlug: t.string({
      nullable: true,
      description:
        "Public Watch language slug resolved from the authored languageId. Lets consumers build valid collection routes even when the item references a parent collection with no direct VideoDub.",
      resolve: async (row, _args, ctx) => {
        const languageId = optionalString(row.languageId)
        if (!languageId) return null

        const language = await ctx.loaders.languageById.load(languageId)
        if (language?.deletedAt) return null
        return language?.slug ?? null
      },
    }),
    videoDub: t.prismaField({
      type: "VideoDub",
      nullable: true,
      description:
        "Live playable dub resolved from this item's videoId + languageId. Blocks store only identity; stream URLs come from the VideoDub row.",
      resolve: (query, row, _args, ctx) => {
        const args = selectedBlockVideoDubArgs(row, query)
        return args ? ctx.prisma.videoDub.findFirst(args) : null
      },
    }),
    videoSlug: t.string({
      nullable: true,
      description:
        "Canonical public Watch slug for the linked video. Falls back to the stored snapshot when no videoId is present.",
      resolve: async (row, _args, ctx) => {
        const videoId = optionalString(row.videoId)
        if (!videoId) return optionalString(row.videoSlug)

        const video = await ctx.loaders.videoById.load(videoId)
        if (video?.deletedAt) return null
        return video?.slug ?? optionalString(row.videoSlug)
      },
    }),
    videoImage: t.field({
      type: BlockVideoImageRef,
      nullable: true,
      description:
        "The linked Video image used as the item poster fallback when no block image asset is authored.",
      resolve: async (row, _args, ctx) => {
        const videoId = optionalString(row.videoId)
        if (!videoId) return null

        return resolveMediaCollectionVideoImageMetadata(videoId, ctx)
      },
    }),
    titleOverride: t.exposeString("titleOverride", { nullable: true }),
    resolvedTitle: t.string({
      nullable: true,
      description:
        "Authored title override or the first nonblank published title for the linked Video in the exact requested locale.",
      args: {
        locale: t.arg.string({ required: true }),
      },
      resolve: async (row, args, ctx) => {
        const titleOverride = row.titleOverride?.trim()
        if (titleOverride) return titleOverride

        const videoId = optionalString(row.videoId)
        if (!videoId) return null

        const video = await ctx.loaders.videoById.load(videoId)
        if (video == null || video.deletedAt) return null

        const locales = await ctx.loaders.videoLocalesByVideoIdAndFilter.load({
          videoId,
          locale: args.locale,
          languageSlug: null,
          visibleOnly: true,
        })

        for (const locale of locales) {
          if (locale.locale !== args.locale) continue
          const title = locale.title?.trim()
          if (title) return title
        }
        return null
      },
    }),
    subtitleOverride: t.exposeString("subtitleOverride", { nullable: true }),
    labelOverride: t.exposeString("labelOverride", { nullable: true }),
    collectionSize: t.exposeString("collectionSize", { nullable: true }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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
    languageId: t.exposeString("languageId", { nullable: true }),
    videoDub: t.prismaField({
      type: "VideoDub",
      nullable: true,
      description:
        "Live playable dub resolved from this item's videoId + languageId. Blocks store only identity; stream URLs come from the VideoDub row.",
      resolve: (query, row, _args, ctx) => {
        const args = selectedBlockVideoDubArgs(row, query)
        return args ? ctx.prisma.videoDub.findFirst(args) : null
      },
    }),
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
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
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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
    mediaUrl: t.string({
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveAssetBackedUrl(row, ctx, "mediaAssetId"),
    }),
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
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
    backgroundColor: t.exposeString("backgroundColor", { nullable: true }),
    categoryLabel: t.exposeString("categoryLabel", { nullable: true }),
    variant: t.field({
      type: MediaCollectionVariantEnum,
      nullable: false,
      resolve: (row) => row.variant,
    }),
    thumbnailOrientation: t.field({
      type: MediaCollectionThumbnailOrientationEnum,
      nullable: true,
      description:
        "Authored media card shape. Null preserves the legacy variant-derived orientation.",
      resolve: (row) => row.thumbnailOrientation ?? null,
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
    defaultCollectionSlug: t.string({
      nullable: true,
      description:
        "First visible parent collection slug shared by every linked manual item, in the first item's relation order. Null when items are empty, unlinked, or mixed.",
      resolve: async (row, _args, ctx) => {
        if (row.itemsSource !== "manual") return null

        const videoIds = row.items.map((item) => optionalString(item.videoId))
        if (
          videoIds.length === 0 ||
          videoIds.some((videoId) => videoId == null)
        ) {
          return null
        }

        const relationsByItem =
          await ctx.loaders.videoParentsByChildId.loadMany(
            videoIds.map((videoId) => ({
              videoId: videoId as string,
              visibleOnly: true,
            })),
          )
        const parentIdsByItem: string[][] = []
        for (const relations of relationsByItem) {
          if (relations instanceof Error) throw relations
          if (relations.length === 0) return null
          parentIdsByItem.push(relations.map((relation) => relation.parentId))
        }

        const parentIds = Array.from(new Set(parentIdsByItem.flat()))
        const parents = await ctx.loaders.videoById.loadMany(parentIds)
        const slugByParentId = new Map<string, string>()
        parents.forEach((parent, index) => {
          if (parent instanceof Error) throw parent
          if (parent == null || parent.deletedAt) return
          const slug = optionalString(parent.slug)
          const parentId = parentIds[index]
          if (slug && parentId) slugByParentId.set(parentId, slug)
        })

        const parentSlugsByItem = parentIdsByItem.map((ids) =>
          ids.flatMap((id) => {
            const slug = slugByParentId.get(id)
            return slug ? [slug] : []
          }),
        )
        const firstItemParentSlugs = parentSlugsByItem[0] ?? []
        return (
          firstItemParentSlugs.find((candidate) =>
            parentSlugsByItem.every((slugs) => slugs.includes(candidate)),
          ) ?? null
        )
      },
    }),
    showItemNumbers: t.exposeBoolean("showItemNumbers"),
    footerText: t.exposeString("footerText", { nullable: true }),
    excludedVideoIds: t.field({
      type: ["String"],
      nullable: false,
      description:
        "Video or collection ids excluded from dynamic collection feed results.",
      resolve: (row) => row.excludedVideoIds ?? [],
    }),
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
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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
    videoId: t.exposeString("videoId", { nullable: true }),
    languageId: t.exposeString("languageId", { nullable: true }),
    videoDub: t.prismaField({
      type: "VideoDub",
      nullable: true,
      description:
        "Live playable dub resolved from this block's videoId + languageId. Blocks store only identity; stream URLs come from the VideoDub row.",
      resolve: (query, row, _args, ctx) => {
        const args = selectedBlockVideoDubArgs(row, query)
        return args ? ctx.prisma.videoDub.findFirst(args) : null
      },
    }),
    mediaUrl: t.string({
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveAssetBackedUrl(row, ctx, "mediaAssetId"),
    }),
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
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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
    imageAssetId: t.exposeString("imageAssetId", { nullable: true }),
    imageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "imageAssetId"),
    }),
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
    languageId: t.exposeString("languageId", { nullable: true }),
    videoDub: t.prismaField({
      type: "VideoDub",
      nullable: true,
      description:
        "Live playable dub resolved from this block's videoId + languageId. Blocks store only identity; stream URLs come from the VideoDub row.",
      resolve: (query, row, _args, ctx) => {
        const args = selectedBlockVideoDubArgs(row, query)
        return args ? ctx.prisma.videoDub.findFirst(args) : null
      },
    }),
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

const LanguageGlobeBlockRef =
  builder.objectRef<LanguageGlobeBlock>("LanguageGlobeBlock")
LanguageGlobeBlockRef.implement({
  description:
    "Animated language globe with locale-authored promotional copy and action.",
  fields: (t) => ({
    t: t.exposeString("t"),
    sectionKey: t.exposeString("sectionKey", { nullable: true }),
    eyebrow: t.exposeString("eyebrow", { nullable: true }),
    title: t.exposeString("title"),
    description: t.exposeString("description", { nullable: true }),
    ctaEnabled: t.exposeBoolean("ctaEnabled", { nullable: true }),
    ctaLabel: t.exposeString("ctaLabel", { nullable: true }),
    ctaLink: t.exposeString("ctaLink", { nullable: true }),
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
    backgroundImageAssetId: t.exposeString("backgroundImageAssetId", {
      nullable: true,
    }),
    backgroundImageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "backgroundImageAssetId"),
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
    backgroundImageAssetId: t.exposeString("backgroundImageAssetId", {
      nullable: true,
    }),
    backgroundImageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "backgroundImageAssetId"),
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
    backgroundImageAssetId: t.exposeString("backgroundImageAssetId", {
      nullable: true,
    }),
    backgroundImageAsset: t.field({
      type: BlockImageAssetRef,
      nullable: true,
      resolve: (row, _args, ctx) =>
        resolveBlockImageAsset(row, ctx, "backgroundImageAssetId"),
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
  languageGlobe: "LanguageGlobeBlock",
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

// Unions — top-level members. Excludes `quizButton` (section-only) and
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
    LanguageGlobeBlockRef,
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
