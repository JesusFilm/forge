import { type Blocks } from "@/domain/blocks"

export type BlockTone = "hero" | "quote" | "grid" | "standard"

export type BlockSummary = {
  key: string
  typeLabel: string
  title: string
  body: string
  tone: BlockTone
  badges: string[]
}

export type BlockTemplateKey =
  | "adventCountdown"
  | "bibleQuotesCarousel"
  | "card"
  | "container"
  | "cta"
  | "easterDates"
  | "infoBlocks"
  | "mediaCollection"
  | "navigationCarousel"
  | "promoBanner"
  | "promotionalText"
  | "relatedQuestions"
  | "section"
  | "text"
  | "video"
  | "videoCarousel"
  | "videoHero"
  | "watchHomeHero"
  | "routeVideo"
  | "routeVideoCarousel"
  | "routeVideoHero"
  | "routeRelatedQuestions"

export const BLOCK_TEMPLATE_KEYS: BlockTemplateKey[] = [
  "videoHero",
  "video",
  "videoCarousel",
  "watchHomeHero",
  "routeVideoHero",
  "routeVideo",
  "routeVideoCarousel",
  "routeRelatedQuestions",
  "mediaCollection",
  "text",
  "promotionalText",
  "cta",
  "infoBlocks",
  "card",
  "bibleQuotesCarousel",
  "relatedQuestions",
  "navigationCarousel",
  "promoBanner",
  "section",
  "container",
  "easterDates",
  "adventCountdown",
]

export type BlockRecord = Record<string, unknown>
export type GridBreakpoint = "xs" | "sm" | "md" | "lg" | "xl"
export type ContainerSlotSpans = Partial<Record<GridBreakpoint, number>>

export const GRID_BREAKPOINTS: GridBreakpoint[] = ["xs", "sm", "md", "lg", "xl"]
export const CONTAINER_SLOT_BLOCK_TYPE = "containerSlot"
export const CONTAINER_SLOT_LAYOUT_PRESETS = [
  { label: "12", spans: [12] },
  { label: "6 / 6", spans: [6, 6] },
  { label: "8 / 4", spans: [8, 4] },
  { label: "4 / 8", spans: [4, 8] },
  { label: "4 / 4 / 4", spans: [4, 4, 4] },
  { label: "3 / 3 / 3 / 3", spans: [3, 3, 3, 3] },
] as const

export function contentParagraphsFromEditorText(
  value: string,
  variant: unknown,
) {
  const separator = variant === "promotional" ? /\n\s*\n/g : /\n/g

  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function editorTextFromContentParagraphs(
  paragraphs: string[],
  variant: unknown,
) {
  return paragraphs.join(variant === "promotional" ? "\n\n" : "\n")
}

const legacyEditorOnlyKeys = new Set([
  "backgroundImageUrl",
  "imageUrl",
  "streamingUrl",
  "videoSlug",
])

export type VideoLibraryItem = {
  key: string
  title: string
  description: string | null
  id: string
  label: string | null
  labelLabel: string | null
  childCount?: number
  isCollectionTarget?: boolean
  sourceLabel: string
  sourceTone: "success" | "warning" | "danger" | "info" | "muted"
  dubs: string
  updated: string
  duration: string
  durationSeconds: number | null
  previewImageUrl: string | null
  previewStreamUrl: string | null
  playableDubs?: VideoLibraryPlayableDub[]
  hasGrounding: boolean
  collectionPreviewItems?: Array<{
    key: string
    title: string
    previewImageUrl: string | null
  }>
}

export type VideoLibraryPlayableDub = {
  key: string
  label: string
  languageId: string | null
  languageSlug: string | null
  bcp47: string | null
  streamUrl: string
  duration: string
  durationSeconds: number | null
}

export type VideoHeroHeadingSource = "manual" | "videoTitle"
export type VideoHeroSubheadingSource = "manual" | "videoDescription"
export type VideoBlockTitleSource = "manual" | "videoTitle"
export type VideoBlockSubtitleSource = "manual" | "videoDescription"

export function clampGridSpan(value: unknown, fallback = 6) {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.round(clampNumber(parsed, 1, 12))
}

export function defaultContainerSlotSpans(
  gridSpan: unknown,
): Required<ContainerSlotSpans> {
  const baseSpan = clampGridSpan(gridSpan)
  return {
    xs: 12,
    sm: 12,
    md: baseSpan,
    lg: baseSpan,
    xl: baseSpan,
  }
}

export function readContainerSlotSpans(
  slot: BlockRecord,
): Required<ContainerSlotSpans> {
  const defaults = defaultContainerSlotSpans(slot.gridSpan)
  const spansRecord = asRecord(slot.spans)

  if (!spansRecord) return defaults

  return GRID_BREAKPOINTS.reduce<Required<ContainerSlotSpans>>(
    (resolved, breakpoint) => ({
      ...resolved,
      [breakpoint]: clampGridSpan(
        spansRecord[breakpoint],
        defaults[breakpoint],
      ),
    }),
    defaults,
  )
}

export function writeContainerSlotSpan(
  slot: BlockRecord,
  breakpoint: GridBreakpoint,
  span: number,
): BlockRecord {
  return {
    ...slot,
    spans: {
      ...defaultContainerSlotSpans(slot.gridSpan),
      ...(asRecord(slot.spans) ?? {}),
      [breakpoint]: clampGridSpan(span),
    },
  }
}

export function createContainerSlotBlock(gridSpan = 6): BlockRecord {
  return {
    t: CONTAINER_SLOT_BLOCK_TYPE,
    gridSpan,
    spans: defaultContainerSlotSpans(gridSpan),
  }
}

export function createContainerSlotLayout(spans: readonly number[]) {
  return spans.map((span) => createContainerSlotBlock(clampGridSpan(span)))
}

export function isContainerSlotBlock(value: unknown): value is BlockRecord {
  return asRecord(value)?.t === CONTAINER_SLOT_BLOCK_TYPE
}

export function readContainerContent(container: BlockRecord): unknown[] {
  return asArray(container.content)
}

export function containerSlotMarkerIndexes(content: unknown[]) {
  return content.reduce<number[]>((indexes, item, index) => {
    if (isContainerSlotBlock(item)) indexes.push(index)
    return indexes
  }, [])
}

const optionalEmptyStringKeys = new Set([
  "backgroundColor",
  "backgroundImageAssetId",
  "buttonLink",
  "category",
  "categoryLabel",
  "clipEndSeconds",
  "clipStartSeconds",
  "ctaLabel",
  "ctaLink",
  "footerText",
  "imageAssetId",
  "imageUrl",
  "labelOverride",
  "languageId",
  "link",
  "linkToSectionKey",
  "mediaUrl",
  "mediaAssetId",
  "ogImageUrl",
  "sectionKey",
  "streamingUrl",
  "subtitle",
  "subtitleOverride",
  "titleOverride",
  "videoId",
])

export function asRecord(value: unknown): BlockRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as BlockRecord)
    : null
}

export function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

export function asBoolean(value: unknown) {
  return value === true
}

export function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

export function stringFromOptionalNumber(value: unknown) {
  const number = asNumber(value)
  return number === null ? "" : String(number)
}

export function parseClipInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function findVideoLibraryItemInList(
  videoLibrary: VideoLibraryItem[],
  value: unknown,
) {
  const key = asString(value)
  if (!key) return null

  return (
    videoLibrary.find((item) => item.key === key || item.id === key) ?? null
  )
}

export function normalizeEditorBlockPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeEditorBlockPayload(item))
  }
  if (!value || typeof value !== "object") {
    return value
  }

  const record = value as BlockRecord
  const normalizedEntries = Object.entries(record)
    .map(([key, item]) => [key, normalizeEditorBlockPayload(item)] as const)
    .filter(([key, item]) => {
      if (legacyEditorOnlyKeys.has(key)) return false
      if (record.t === "container" && key === "slots") return false
      if (item === null || item === undefined) return false
      if (typeof item !== "string") return true
      if (item.trim().length > 0) return true
      return !optionalEmptyStringKeys.has(key) && !key.endsWith("Url")
    })

  return Object.fromEntries(normalizedEntries)
}

export function normalizeEditorBlocks(blocks: unknown[]): Blocks {
  return normalizeEditorBlockPayload(blocks) as Blocks
}

export function summarizeBlock(
  block: unknown,
  index: number,
  videoLibrary: VideoLibraryItem[],
): BlockSummary {
  const value = asRecord(block)
  const fallbackType = asString(value?.t) || "block"
  const summaryKey =
    asString(value?.sectionKey) ||
    asString(value?.id) ||
    `${fallbackType}-${index}`
  if (!value) {
    return {
      key: summaryKey,
      typeLabel: "Unknown",
      title: "Unsupported block",
      body: "This block could not be summarized from the current payload.",
      tone: "standard",
      badges: [],
    }
  }

  const type = asString(value.t) || "block"

  if (type === "videoHero") {
    const headingSource =
      (asString(value.headingSource) as VideoHeroHeadingSource) || "manual"
    const subheadingSource =
      (asString(value.subheadingSource) as VideoHeroSubheadingSource) ||
      "manual"
    const selectedVideo = findVideoLibraryItemInList(
      videoLibrary,
      value.videoId,
    )
    const resolvedHeading =
      headingSource === "videoTitle"
        ? (selectedVideo?.title ?? asString(value.heading))
        : asString(value.heading)
    const resolvedSubheading =
      subheadingSource === "videoDescription"
        ? (selectedVideo?.description ?? asString(value.subheading))
        : asString(value.subheading)

    return {
      key: summaryKey,
      typeLabel: asBoolean(value.useRouteVideo)
        ? "Route Video Hero"
        : "Video Hero",
      title: resolvedHeading || "Video Hero",
      body: resolvedSubheading || "Hero block",
      tone: "hero",
      badges: [
        asBoolean(value.useRouteVideo) ? "ROUTE_VIDEO" : "AUTHORED_VIDEO",
      ],
    }
  }

  if (type === "watchHomeHero") {
    return {
      key: summaryKey,
      typeLabel: "Watch Home Hero",
      title: "Watch Home Hero",
      body: "Renders the static Watch homepage hero.",
      tone: "hero",
      badges: ["WATCH_HOME"],
    }
  }

  if (type === "bibleQuotesCarousel") {
    const quotes = asArray(value.quotes)
    const firstQuote = asRecord(quotes[0])
    return {
      key: summaryKey,
      typeLabel: "Quote Carousel",
      title:
        asString(value.heading) ||
        asString(firstQuote?.text) ||
        "Quote carousel",
      body:
        asString(firstQuote?.reference) ||
        `${quotes.length || 0} quotes configured`,
      tone: "standard",
      badges: [],
    }
  }

  if (type === "infoBlocks") {
    const items = asArray(value.blocks)
    const itemTitles = items
      .map((item) => asString(asRecord(item)?.title))
      .filter(Boolean)
      .slice(0, 3)
    return {
      key: summaryKey,
      typeLabel: "Key Details",
      title: asString(value.heading) || "Key details",
      body:
        itemTitles.join(" | ") ||
        asString(value.description) ||
        "Supporting detail cards",
      tone: "grid",
      badges: [],
    }
  }

  if (type === "mediaCollection") {
    const items = asArray(value.items)
    return {
      key: summaryKey,
      typeLabel: "Media Collection",
      title: asString(value.title) || "Media collection",
      body:
        asString(value.description) ||
        `${items.length || 0} items in ${asString(value.variant) || "grid"} mode`,
      tone: "grid",
      badges: [],
    }
  }

  if (type === "videoCarousel") {
    const items = asArray(value.items)
    const itemsSource = asString(value.itemsSource) || "manual"
    const usesRouteVideoChildren = itemsSource === "routeVideoChildren"
    return {
      key: summaryKey,
      typeLabel: usesRouteVideoChildren
        ? "Route Video Carousel"
        : "Video Carousel",
      title:
        asString(value.title) ||
        (usesRouteVideoChildren ? "Related videos" : "Video carousel"),
      body:
        asString(value.description) ||
        (usesRouteVideoChildren
          ? "Pulls from the current route video's descendants"
          : `${items.length || 0} carousel items`),
      tone: "grid",
      badges: usesRouteVideoChildren
        ? ["ROUTE_VIDEO_CHILDREN"]
        : [`${items.length || 0} items`],
    }
  }

  if (type === "navigationCarousel") {
    const items = asArray(value.items)
    return {
      key: summaryKey,
      typeLabel: "Navigation Carousel",
      title: "Navigation carousel",
      body:
        items.length > 0
          ? `${items.length} navigation destination${items.length === 1 ? "" : "s"}`
          : "Navigation carousel",
      tone: "grid",
      badges: [],
    }
  }

  if (type === "cta") {
    return {
      key: summaryKey,
      typeLabel: "Call to Action",
      title: asString(value.heading) || "Call to action",
      body:
        asString(value.body) ||
        "Prompt the user to continue deeper into the flow.",
      tone: "standard",
      badges: [],
    }
  }

  if (type === "text") {
    const paragraphs = asArray(value.contentParagraphs)
      .map((item) => (typeof item === "string" ? item : ""))
      .filter(Boolean)
    return {
      key: summaryKey,
      typeLabel: "Text",
      title: asString(value.heading) || "Rich text",
      body: paragraphs[0] || asString(value.subtitle) || "Narrative body copy",
      tone: "standard",
      badges: [asString(value.variant) || "default"],
    }
  }

  if (type === "card") {
    return {
      key: summaryKey,
      typeLabel: "Card",
      title: asString(value.title) || "Card",
      body: asString(value.description) || "Card description",
      tone: "standard",
      badges: [asString(value.variant) || "default"],
    }
  }

  if (type === "promoBanner") {
    return {
      key: summaryKey,
      typeLabel: "Promo Banner",
      title: asString(value.heading) || "Promo banner",
      body: asString(value.description) || "Banner copy",
      tone: "standard",
      badges: [],
    }
  }

  if (type === "relatedQuestions") {
    const questions = asArray(value.questions)
    const usesRouteQuestions =
      asString(value.questionsSource) === "routeVideoGeneratedQuestions"
    return {
      key: summaryKey,
      typeLabel: usesRouteQuestions
        ? "Route Related Questions"
        : "Related Questions",
      title: asString(value.heading) || "Related questions",
      body: usesRouteQuestions
        ? `${questions.length || 0} authored fallback questions configured`
        : `${questions.length || 0} questions configured`,
      tone: "standard",
      badges: usesRouteQuestions ? ["ROUTE_VIDEO_QUESTIONS"] : [],
    }
  }

  if (type === "video") {
    const titleSource =
      (asString(value.titleSource) as VideoBlockTitleSource) || "manual"
    const subtitleSource =
      (asString(value.subtitleSource) as VideoBlockSubtitleSource) || "manual"
    const selectedVideo = findVideoLibraryItemInList(
      videoLibrary,
      value.videoId,
    )
    const resolvedTitle =
      titleSource === "videoTitle"
        ? (selectedVideo?.title ?? asString(value.title))
        : asString(value.title)
    const resolvedSubtitle =
      subtitleSource === "videoDescription"
        ? (selectedVideo?.description ?? asString(value.subtitle))
        : asString(value.subtitle)

    return {
      key: summaryKey,
      typeLabel: asBoolean(value.useRouteVideo) ? "Route Video" : "Video",
      title: resolvedTitle || "Video",
      body: resolvedSubtitle || "Video block",
      tone: "standard",
      badges: asBoolean(value.useRouteVideo) ? ["ROUTE_VIDEO"] : [],
    }
  }

  if (type === "section") {
    const content = asArray(value.content)
    return {
      key: summaryKey,
      typeLabel: "Section",
      title: asString(value.sectionKey) || "Section wrapper",
      body: `${content.length || 0} nested blocks`,
      tone: "standard",
      badges: asString(value.backgroundColor)
        ? [asString(value.backgroundColor)]
        : [],
    }
  }

  if (type === "container") {
    const content = readContainerContent(value)
    const slots = containerSlotMarkerIndexes(content)
    return {
      key: summaryKey,
      typeLabel: "Container",
      title: "Container layout",
      body: `${slots.length || 0} slots configured`,
      tone: "grid",
      badges: [`${slots.length || 0} slots`],
    }
  }

  if (type === "easterDates") {
    return {
      key: summaryKey,
      typeLabel: "Easter Dates",
      title: asString(value.easterDatesTitle) || "Easter dates",
      body: "Next calculated Easter and Passover dates",
      tone: "standard",
      badges: [],
    }
  }

  if (type === "adventCountdown") {
    return {
      key: summaryKey,
      typeLabel: "Advent Countdown",
      title: asString(value.title) || "Advent countdown",
      body:
        asString(value.scriptureReference) ||
        asString(value.scripture) ||
        "Seasonal countdown configuration",
      tone: "standard",
      badges: [],
    }
  }

  return {
    key: summaryKey,
    typeLabel: type,
    title:
      asString(value.title) ||
      asString(value.heading) ||
      asString(value.sectionKey) ||
      type,
    body:
      asString(value.description) ||
      asString(value.body) ||
      "Structured experience block",
    tone: "standard",
    badges: [],
  }
}

export function createTemplateBlock(
  template: BlockTemplateKey,
  index: number,
): BlockRecord {
  if (template === "videoHero") {
    return {
      t: "videoHero",
      sectionKey: `video-hero-${index}`,
      useRouteVideo: false,
      headingSource: "videoTitle",
      subheadingSource: "videoDescription",
      heading: "",
      subheading: "",
      ctaEnabled: true,
      ctaLabel: "Learn more",
      ctaLink: "/",
    }
  }

  if (template === "routeVideoHero") {
    return {
      t: "videoHero",
      sectionKey: `route-video-hero-${index}`,
      useRouteVideo: true,
      headingSource: "videoTitle",
      subheadingSource: "videoDescription",
      heading: "",
      subheading: "",
      ctaEnabled: true,
      ctaLabel: "Learn more",
      ctaLink: "/",
    }
  }

  if (template === "watchHomeHero") {
    return {
      t: "watchHomeHero",
      sectionKey: `watch-home-hero-${index}`,
    }
  }

  if (template === "video") {
    return {
      t: "video",
      sectionKey: `video-${index}`,
      useRouteVideo: false,
      titleSource: "videoTitle",
      subtitleSource: "videoDescription",
      streamingUrl: "",
      title: "",
      subtitle: "",
    }
  }

  if (template === "routeVideo") {
    return {
      t: "video",
      sectionKey: `route-video-${index}`,
      useRouteVideo: true,
      titleSource: "videoTitle",
      subtitleSource: "videoDescription",
      streamingUrl: "",
      title: "",
      subtitle: "",
    }
  }

  if (template === "videoCarousel") {
    return {
      t: "videoCarousel",
      sectionKey: `video-carousel-${index}`,
      itemsSource: "manual",
      items: [],
    }
  }

  if (template === "routeVideoCarousel") {
    return {
      t: "videoCarousel",
      sectionKey: `route-video-carousel-${index}`,
      itemsSource: "routeVideoChildren",
      items: [],
    }
  }

  if (template === "mediaCollection") {
    return {
      t: "mediaCollection",
      sectionKey: `media-collection-${index}`,
      categoryLabel: "Featured",
      variant: "grid",
      thumbnailOrientation: "vertical",
      itemsSource: "manual",
      title: "Media collection",
      subtitle: "Explore the collection",
      description: "Media collection description",
      ctaLabel: "See all",
      ctaLink: "/",
      showItemNumbers: false,
      footerText: "",
      items: [],
    }
  }

  if (template === "text") {
    return {
      t: "text",
      sectionKey: `text-${index}`,
      heading: "Rich text",
      subtitle: "Supporting subtitle",
      contentParagraphs: ["Write the next part of the story here."],
      variant: "default",
    }
  }

  if (template === "promotionalText") {
    return {
      t: "section",
      sectionKey: `promotional-story-${index}`,
      backgroundColor: "purple",
      backgroundOpacity: 1,
      dynamicBackgroundImage: false,
      staticOverlay: true,
      content: [
        {
          t: "text",
          sectionKey: `promotional-copy-${index}`,
          subtitle: "Promotional story",
          heading: "Tell the story behind this experience",
          headingLevel: "h2",
          contentParagraphs: [
            "### Add a descriptive subheading",
            "Write a substantial opening paragraph that explains what viewers will discover in this experience.",
            "Follow with the people, places, themes, or context that make this story distinct.",
            "- Add specific, useful details\n- Use natural language people search for\n- Link to a meaningful next step",
          ],
          variant: "promotional",
        },
      ],
    }
  }

  if (template === "cta") {
    return {
      t: "cta",
      sectionKey: `cta-${index}`,
      heading: "Ready to dive deeper?",
      body: "Guide the user to the next meaningful action.",
      buttonLabel: "Continue",
      buttonLink: "/",
      variant: "primary",
    }
  }

  if (template === "infoBlocks") {
    return {
      t: "infoBlocks",
      sectionKey: `info-blocks-${index}`,
      widthPercent: 100,
      intro: "Intro",
      heading: "Key details",
      description: "Supporting ideas for this section.",
      blocks: [
        {
          icon: "psychology",
          title: "First card",
          description: "Short support copy for the first card.",
        },
        {
          icon: "history_edu",
          title: "Second card",
          description: "Short support copy for the second card.",
        },
      ],
    }
  }

  if (template === "card") {
    return {
      t: "card",
      sectionKey: `card-${index}`,
      title: "Card title",
      description: "Card description",
      link: "/",
      variant: "default",
    }
  }

  if (template === "bibleQuotesCarousel") {
    return {
      t: "bibleQuotesCarousel",
      sectionKey: `bible-quotes-${index}`,
      heading: "Featured quote",
      quotes: [
        {
          reference: "John 3:16",
          text: "For God so loved the world...",
          attribution: "",
          backgroundColor: "#151515",
          ctaEnabled: false,
          ctaLabel: "Read more",
          ctaLink: "/",
        },
      ],
    }
  }

  if (template === "relatedQuestions") {
    return {
      t: "relatedQuestions",
      sectionKey: `related-questions-${index}`,
      heading: "Related questions",
      questionsSource: "manual",
      questions: [
        {
          question: "Why does this matter?",
          answer: "Because the next step should stay clear and actionable.",
        },
      ],
      ctaEnabled: true,
      ctaLabel: "Read more",
      ctaLink: "/",
    }
  }

  if (template === "routeRelatedQuestions") {
    return {
      t: "relatedQuestions",
      sectionKey: `route-related-questions-${index}`,
      heading: "Questions about this video",
      questionsSource: "routeVideoGeneratedQuestions",
      questions: [
        {
          question: "What is this video inviting me to consider?",
          answer:
            "This video invites you to reflect on its central message and what it could mean for your life.",
        },
      ],
      ctaEnabled: false,
      ctaLabel: "Ask a question",
      ctaLink: "/watch",
    }
  }

  if (template === "navigationCarousel") {
    return {
      t: "navigationCarousel",
      sectionKey: `navigation-carousel-${index}`,
      items: [],
    }
  }

  if (template === "promoBanner") {
    return {
      t: "promoBanner",
      sectionKey: `promo-banner-${index}`,
      widthPercent: 100,
      intro: "Promo",
      heading: "Promo heading",
      description: "Promotional support copy",
      ctaEnabled: true,
      ctaLabel: "Learn more",
      ctaLink: "/",
    }
  }

  if (template === "section") {
    return {
      t: "section",
      sectionKey: `section-${index}`,
      backgroundColor: "",
      blurHash: "",
      backgroundOpacity: 1,
      dynamicBackgroundImage: false,
      staticOverlay: false,
      content: [],
    }
  }

  if (template === "container") {
    return {
      t: "container",
      sectionKey: `container-${index}`,
      content: [createContainerSlotBlock(6), createContainerSlotBlock(6)],
    }
  }

  if (template === "easterDates") {
    return {
      t: "easterDates",
      sectionKey: `easter-dates-${index}`,
      easterDatesTitle: "Easter Dates",
      westernEasterLabel: "Catholic/Protestant Easter",
      orthodoxEasterLabel: "Orthodox Easter",
      passoverLabel: "Jewish Passover",
      westernEasterEnabled: true,
      orthodoxEasterEnabled: true,
      passoverEnabled: true,
    }
  }

  return {
    t: "adventCountdown",
    sectionKey: `advent-countdown-${index}`,
    title: "Christmas",
    scripture: "For unto us a child is born, unto us a son is given.",
    scriptureReference: "Isaiah 9:6",
  }
}
