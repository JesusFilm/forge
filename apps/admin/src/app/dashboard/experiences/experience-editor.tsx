"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DraggableAttributes,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useRouter } from "next/navigation"
import {
  CalendarDays,
  Captions,
  Check,
  CirclePlay,
  Eye,
  Pause,
  Play,
  Volume2,
  VolumeX,
  ChevronRightSquare,
  Clapperboard,
  Columns2,
  Film,
  FileText,
  GripVertical,
  LayoutTemplate,
  Link2,
  Maximize2,
  MessageSquareQuote,
  Minimize2,
  MousePointer2,
  ImageIcon,
  Plus,
  RectangleHorizontal,
  Save,
  Search,
  Shapes,
  Trash2,
  UploadCloud,
  X,
  Video,
  type LucideIcon,
} from "lucide-react"
import { cx } from "@/components/admin-ui"
import { ConfirmModal } from "@/components/confirm-modal"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import {
  BibleQuoteCard,
  type BibleQuoteDragHandleState,
  type BibleQuoteDragState,
} from "./experience-editor/bible-quote-card"

type EditorActionResult = {
  ok: boolean
  error?: string
}

type RevisionEntry = {
  id: string
  statusLabel: string
  statusTone: "success" | "warning" | "danger" | "info" | "muted"
  reason: string
  summary: string
  revisedAt: string
  revisedBy: string
  isActive: boolean
}

type LocaleEntry = {
  id: string
  code: string
  title: string
  href: string
  stateLabel: string
  stateTone: "success" | "warning" | "danger"
  active: boolean
}

type BlockTone = "hero" | "quote" | "grid" | "standard"

type BlockSummary = {
  key: string
  typeLabel: string
  title: string
  body: string
  tone: BlockTone
  badges: string[]
}

type BlockTemplateKey =
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
  | "relatedQuestions"
  | "section"
  | "text"
  | "video"
  | "videoCarousel"
  | "videoHero"

type BlockTemplateDefinition = {
  key: BlockTemplateKey
  label: string
  description: string
  category: string
  icon: LucideIcon
}

type BlockRecord = Record<string, unknown>
type RailTab = "add" | "inspector" | "settings"
type BlockCategoryFilter = "All" | BlockTemplateDefinition["category"]
type InsertedBlockAnimation = {
  key: string
  visible: boolean
}

type RouteVideoHelpPosition = {
  top: number
  left: number
}

type VideoLibraryItem = {
  key: string
  title: string
  description: string | null
  id: string
  label: string | null
  labelLabel: string | null
  sourceLabel: string
  sourceTone: "success" | "warning" | "danger" | "info" | "muted"
  dubs: string
  updated: string
  duration: string
  durationSeconds: number | null
  previewImageUrl: string | null
  previewStreamUrl: string | null
}

type VideoPickerDraft = {
  videoKey: string | null
  clipStartSeconds: string
  clipEndSeconds: string
  autoplay: boolean
  muted: boolean
  loop: boolean
  showControls: boolean
}

type VideoPickerMode = "block" | "carouselAppend"

type ClipHandle = "start" | "end"
type PreviewFlashIcon = "play" | "pause" | null
type CarouselDragState = {
  blockIndex: number
  itemIndex: number
}
type CarouselDragHandleState = {
  blockIndex: number
  itemIndex: number
  pointerOffsetX: number
  pointerOffsetY: number
}
type RelatedQuestionDragState = {
  blockIndex: number
  itemIndex: number
}
type RelatedQuestionDragHandleState = {
  blockIndex: number
  itemIndex: number
  pointerOffsetX: number
  pointerOffsetY: number
}
type SortableCanvasBlockProps = {
  id: string
  isDraggingOverlay: boolean
  insertedState: InsertedBlockAnimation | null
  onWrapperRef: (node: HTMLDivElement | null) => void
  children: (dragHandleProps: {
    attributes: DraggableAttributes
    listeners: DraggableSyntheticListeners | undefined
    isDragging: boolean
  }) => ReactNode
  addSlot: ReactNode
}

type VideoHeroHeadingSource = "manual" | "videoTitle"
type VideoHeroSubheadingSource = "manual" | "videoDescription"
type VideoBlockTitleSource = "manual" | "videoTitle"
type VideoBlockSubtitleSource = "manual" | "videoDescription"

function SortableCanvasBlock({
  id,
  isDraggingOverlay,
  insertedState,
  onWrapperRef,
  children,
  addSlot,
}: SortableCanvasBlockProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
  })

  return (
    <div
      ref={(node) => {
        setNodeRef(node)
        onWrapperRef(node)
      }}
      className={cx(
        "relative",
        isDragging && "z-20",
        insertedState?.key === id && !insertedState.visible
          ? "translate-y-3 scale-[0.985] opacity-0"
          : "translate-y-0 scale-100 opacity-100",
      )}
      style={{
        transform: CSS.Transform.toString(
          transform
            ? {
                ...transform,
                x: 0,
                scaleX: 1,
                scaleY: 1,
              }
            : null,
        ),
        transition: isDraggingOverlay ? undefined : transition,
      }}
    >
      <div className="relative">
        {isDragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-sm border border-white/70 bg-[rgba(8,8,10,0.28)] backdrop-blur-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(0,0,0,0.12))]" />
          </div>
        ) : null}
        <div className={cx(isDragging && "select-none")}>
          {children({
            attributes,
            listeners,
            isDragging,
          })}
        </div>
      </div>
      {addSlot}
    </div>
  )
}

const BLOCK_LIBRARY: BlockTemplateDefinition[] = [
  {
    key: "videoHero",
    label: "Video Hero",
    description: "Full-width hero with video and primary action.",
    category: "Hero",
    icon: Clapperboard,
  },
  {
    key: "video",
    label: "Video",
    description: "Single embedded or route-driven video.",
    category: "Media",
    icon: Video,
  },
  {
    key: "videoCarousel",
    label: "Video Carousel",
    description: "Scrollable set of selectable videos.",
    category: "Media",
    icon: Clapperboard,
  },
  {
    key: "mediaCollection",
    label: "Media Collection",
    description: "Grid or carousel of related media items.",
    category: "Media",
    icon: LayoutTemplate,
  },
  {
    key: "text",
    label: "Text",
    description: "Rich editorial copy with heading and body.",
    category: "Content",
    icon: FileText,
  },
  {
    key: "cta",
    label: "Call to Action",
    description: "Prompt the next step with copy and a link.",
    category: "Action",
    icon: ChevronRightSquare,
  },
  {
    key: "infoBlocks",
    label: "Info Grid",
    description: "Intro copy with repeatable supporting cards.",
    category: "Content",
    icon: Shapes,
  },
  {
    key: "card",
    label: "Card",
    description: "Single card with title, copy, and link.",
    category: "Content",
    icon: RectangleHorizontal,
  },
  {
    key: "bibleQuotesCarousel",
    label: "Quote Carousel",
    description: "Scripture quotes with references and heading.",
    category: "Quotes",
    icon: MessageSquareQuote,
  },
  {
    key: "relatedQuestions",
    label: "Questions",
    description: "Related questions with answers and follow-up link.",
    category: "Content",
    icon: Captions,
  },
  {
    key: "navigationCarousel",
    label: "Navigation",
    description: "Card-based links to other destinations.",
    category: "Navigation",
    icon: Columns2,
  },
  {
    key: "promoBanner",
    label: "Promo Banner",
    description: "Promotional banner with copy and link.",
    category: "Banner",
    icon: RectangleHorizontal,
  },
  {
    key: "section",
    label: "Section",
    description: "Background wrapper for grouped content.",
    category: "Layout",
    icon: LayoutTemplate,
  },
  {
    key: "container",
    label: "Container",
    description: "Slot layout for structured compositions.",
    category: "Layout",
    icon: Columns2,
  },
  {
    key: "easterDates",
    label: "Easter Dates",
    description: "Seasonal date callout for Easter and Passover.",
    category: "Seasonal",
    icon: CalendarDays,
  },
  {
    key: "adventCountdown",
    label: "Advent Countdown",
    description: "Countdown card with scripture context.",
    category: "Seasonal",
    icon: CalendarDays,
  },
]

const EMPTY_CANVAS_STARTERS: BlockTemplateKey[] = [
  "videoHero",
  "text",
  "mediaCollection",
]

function fieldClassName() {
  return "h-10 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)] focus:bg-[var(--color-bg)]"
}

function textAreaClassName(rows = 3) {
  return `${rows >= 10 ? "font-mono text-[12px] leading-6" : "text-[13px]"} rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 py-2 text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)] focus:bg-[var(--color-bg)]`
}

function switchTrackClass(checked: boolean) {
  return checked
    ? "justify-end border-[var(--color-brand)] bg-[color-mix(in_oklab,var(--color-brand)_28%,black)]"
    : "justify-start border-[var(--color-hairline-strong)] bg-[var(--color-surface-inset)]"
}

function localeDotClass(tone: LocaleEntry["stateTone"]) {
  if (tone === "success") return "bg-[var(--color-success)]"
  if (tone === "danger") return "bg-[var(--color-danger)]"
  return "bg-[var(--color-warning)]"
}

function asRecord(value: unknown): BlockRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as BlockRecord)
    : null
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function asBoolean(value: unknown) {
  return value === true
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function formatSeconds(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--:--"
  const totalSeconds = Math.max(0, Math.floor(value))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function stringFromOptionalNumber(value: unknown) {
  const number = asNumber(value)
  return number === null ? "" : String(number)
}

function parseClipInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function ownerInitials(label: string) {
  const trimmed = label.trim()
  if (!trimmed) return "SY"
  const compact = trimmed.replace(/\s+/g, "")
  if (compact.length === 1) return compact.toUpperCase()
  return `${compact[0]}${compact[compact.length - 1]}`.toUpperCase()
}

function findVideoLibraryItemInList(
  videoLibrary: VideoLibraryItem[],
  value: unknown,
) {
  const key = asString(value)
  if (!key) return null

  return (
    videoLibrary.find((item) => item.key === key || item.id === key) ?? null
  )
}

function localizedVideoLabelFallback(label: string | null, localeCode: string) {
  if (!label) return ""
  const isSpanish = localeCode.startsWith("es")
  const labels = isSpanish
    ? {
        COLLECTION: "Coleccion",
        EPISODE: "Episodio",
        FEATURE_FILM: "Largometraje",
        SEGMENT: "Segmento",
        SERIES: "Serie",
        SHORT_FILM: "Cortometraje",
        TRAILER: "Tráiler",
        BEHIND_THE_SCENES: "Detrás de cámaras",
      }
    : {
        COLLECTION: "Collection",
        EPISODE: "Episode",
        FEATURE_FILM: "Feature Film",
        SEGMENT: "Segment",
        SERIES: "Series",
        SHORT_FILM: "Short Film",
        TRAILER: "Trailer",
        BEHIND_THE_SCENES: "Behind the Scenes",
      }

  return labels[label as keyof typeof labels] ?? ""
}

function normalizeOptionalUrlFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeOptionalUrlFields(item))
  }
  if (!value || typeof value !== "object") {
    return value
  }

  const record = value as BlockRecord
  const normalizedEntries = Object.entries(record)
    .map(([key, item]) => [key, normalizeOptionalUrlFields(item)] as const)
    .filter(([key, item]) => {
      if (typeof item !== "string") return true
      if (!key.endsWith("Url")) return true
      return item.trim().length > 0
    })

  return Object.fromEntries(normalizedEntries)
}

function summarizeBlock(
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
      typeLabel: "Video Hero",
      title: resolvedHeading || "Video Hero",
      body: resolvedSubheading || "Hero block",
      tone: "hero",
      badges: [
        asBoolean(value.useRouteVideo) ? "ROUTE_VIDEO" : "AUTHORED_VIDEO",
      ],
    }
  }

  if (type === "bibleQuotesCarousel") {
    const quotes = asArray(value.quotes)
    const firstQuote = asRecord(quotes[0])
    return {
      key: summaryKey,
      typeLabel: "Bible Quotes",
      title:
        asString(value.heading) ||
        asString(firstQuote?.text) ||
        "Bible quotes carousel",
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
      typeLabel: "Info Blocks",
      title: asString(value.heading) || "Info blocks",
      body:
        itemTitles.join(" | ") ||
        asString(value.description) ||
        "Structured support cards",
      tone: "grid",
      badges: [`${items.length || 0} cards`],
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
      badges: [
        (asString(value.variant) || "grid").toUpperCase(),
        `${items.length || 0} items`,
      ],
    }
  }

  if (type === "videoCarousel") {
    const items = asArray(value.items)
    const itemsSource = asString(value.itemsSource) || "manual"
    return {
      key: summaryKey,
      typeLabel: "Video Carousel",
      title: asString(value.title) || "Video carousel",
      body:
        asString(value.description) ||
        (itemsSource === "routeVideoChildren"
          ? "Pulls from the current route video's descendants"
          : `${items.length || 0} carousel items`),
      tone: "grid",
      badges:
        itemsSource === "routeVideoChildren"
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
      body: `${items.length || 0} navigation destinations`,
      tone: "grid",
      badges: [`${items.length || 0} cards`],
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
      badges: [asString(value.widthPercent) || "auto"],
    }
  }

  if (type === "relatedQuestions") {
    const questions = asArray(value.questions)
    return {
      key: summaryKey,
      typeLabel: "Related Questions",
      title: asString(value.heading) || "Related questions",
      body: `${questions.length || 0} questions configured`,
      tone: "standard",
      badges: [],
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
      typeLabel: "Video",
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
      badges: [asString(value.backgroundColor) || "default"],
    }
  }

  if (type === "container") {
    const slots = asArray(value.slots)
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
      body:
        asString(value.locale) ||
        "Current-year Easter, Orthodox, and Passover labels",
      tone: "standard",
      badges: ["SEASONAL"],
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
      badges: ["SEASONAL"],
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

function createTemplateBlock(
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

  if (template === "videoCarousel") {
    return {
      t: "videoCarousel",
      sectionKey: `video-carousel-${index}`,
      itemsSource: "manual",
      title: "Video carousel",
      subtitle: "Choose a story to watch",
      description: "Carousel description",
      items: [],
    }
  }

  if (template === "mediaCollection") {
    return {
      t: "mediaCollection",
      sectionKey: `media-collection-${index}`,
      categoryLabel: "Featured",
      variant: "grid",
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
      heading: "Info blocks",
      description: "Structured supporting ideas.",
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

  if (template === "navigationCarousel") {
    return {
      t: "navigationCarousel",
      sectionKey: `navigation-carousel-${index}`,
      items: [
        {
          contentId: "destination-1",
          title: "Destination One",
          category: "Category",
        },
      ],
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
      ctaLink: "/",
    }
  }

  if (template === "section") {
    return {
      t: "section",
      sectionKey: `section-${index}`,
      backgroundColor: "default",
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
      slots: [
        {
          gridSpan: 6,
          content: [],
        },
        {
          gridSpan: 6,
          content: [],
        },
      ],
    }
  }

  if (template === "easterDates") {
    return {
      t: "easterDates",
      sectionKey: `easter-dates-${index}`,
      easterDatesTitle: "Easter Dates",
      westernEasterLabel: "Western Easter",
      orthodoxEasterLabel: "Orthodox Easter",
      passoverLabel: "Passover",
      locale: "en",
    }
  }

  return {
    t: "adventCountdown",
    sectionKey: `advent-countdown-${index}`,
    title: "Advent Countdown",
    scripture: "Isaiah 9:6",
    scriptureReference: "Isaiah 9:6",
    locale: "en",
  }
}

export function ExperienceEditor({
  canPublish,
  hasPublishedVersion,
  ownerLabel,
  publishedAtLabel,
  revisionEntries,
  localeEntries,
  videoLibrary,
  initialValues,
  saveAction,
  publishAction,
  restoreAction,
}: {
  canPublish: boolean
  hasPublishedVersion: boolean
  ownerLabel: string
  publishedAtLabel: string
  revisionEntries: RevisionEntry[]
  localeEntries: LocaleEntry[]
  videoLibrary: VideoLibraryItem[]
  initialValues: {
    localeId: string
    title: string
    slug: string
    metaDescription: string
    ogTitle: string
    ogDescription: string
    ogImageUrl: string
    pathSegment: string
    isHomepage: boolean
    blocksJson: string
  }
  saveAction: (formData: FormData) => Promise<EditorActionResult>
  publishAction: (localeId: string) => Promise<EditorActionResult>
  restoreAction: (revisionId: string) => Promise<EditorActionResult>
}) {
  const router = useRouter()
  const { toasts, pushToast, dismissToast } = useToastStack()
  const [title, setTitle] = useState(initialValues.title)
  const [slug, setSlug] = useState(initialValues.slug)
  const [pathSegment, setPathSegment] = useState(initialValues.pathSegment)
  const [metaDescription, setMetaDescription] = useState(
    initialValues.metaDescription,
  )
  const [ogTitle] = useState(initialValues.ogTitle)
  const [ogDescription] = useState(initialValues.ogDescription)
  const [ogImageUrl] = useState(initialValues.ogImageUrl)
  const [isHomepage] = useState(initialValues.isHomepage)
  const [parsedBlocks, setParsedBlocks] = useState<unknown[]>(() => {
    try {
      const parsed = JSON.parse(initialValues.blocksJson)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(
    parsedBlocks.length > 0 ? 0 : null,
  )
  const [railTab, setRailTab] = useState<RailTab>("inspector")
  const [blockSearchQuery, setBlockSearchQuery] = useState("")
  const [blockCategoryFilter, setBlockCategoryFilter] =
    useState<BlockCategoryFilter>("All")
  const [pendingInsertIndex, setPendingInsertIndex] = useState<number | null>(
    null,
  )
  const [activeDragKey, setActiveDragKey] = useState<string | null>(null)
  const [videoPickerBlockIndex, setVideoPickerBlockIndex] = useState<
    number | null
  >(null)
  const [videoPickerMode, setVideoPickerMode] =
    useState<VideoPickerMode>("block")
  const [videoPickerDraft, setVideoPickerDraft] = useState<VideoPickerDraft>({
    videoKey: null,
    clipStartSeconds: "",
    clipEndSeconds: "",
    autoplay: true,
    muted: true,
    loop: false,
    showControls: true,
  })
  const [activeClipHandle, setActiveClipHandle] = useState<ClipHandle | null>(
    null,
  )
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0)
  const [previewIsPlaying, setPreviewIsPlaying] = useState(false)
  const [previewControlsVisible, setPreviewControlsVisible] = useState(true)
  const [previewFlashIcon, setPreviewFlashIcon] =
    useState<PreviewFlashIcon>(null)
  const [previewMuted, setPreviewMuted] = useState(true)
  const [previewIsLoading, setPreviewIsLoading] = useState(false)
  const [previewIsFullscreen, setPreviewIsFullscreen] = useState(false)
  const [routeVideoHelpBlockKey, setRouteVideoHelpBlockKey] = useState<
    string | null
  >(null)
  const [routeVideoHelpRendered, setRouteVideoHelpRendered] = useState(false)
  const [routeVideoHelpVisible, setRouteVideoHelpVisible] = useState(false)
  const [routeVideoHelpPosition, setRouteVideoHelpPosition] =
    useState<RouteVideoHelpPosition | null>(null)
  const [videoLibraryQuery, setVideoLibraryQuery] = useState("")
  const [videoLibrarySort, setVideoLibrarySort] = useState<
    "recent" | "title" | "duration"
  >("recent")
  const [carouselDragState, setCarouselDragState] =
    useState<CarouselDragState | null>(null)
  const [carouselDragHandleState, setCarouselDragHandleState] =
    useState<CarouselDragHandleState | null>(null)
  const [relatedQuestionDragState, setRelatedQuestionDragState] =
    useState<RelatedQuestionDragState | null>(null)
  const [relatedQuestionDragHandleState, setRelatedQuestionDragHandleState] =
    useState<RelatedQuestionDragHandleState | null>(null)
  const [bibleQuoteDragState, setBibleQuoteDragState] =
    useState<BibleQuoteDragState | null>(null)
  const [bibleQuoteDragHandleState, setBibleQuoteDragHandleState] =
    useState<BibleQuoteDragHandleState | null>(null)
  const [restoreRevisionId, setRestoreRevisionId] = useState<string | null>(
    null,
  )
  const [deleteBlockIndex, setDeleteBlockIndex] = useState<number | null>(null)
  const [scrollToBlockKey, setScrollToBlockKey] = useState<string | null>(null)
  const [insertedBlockAnimation, setInsertedBlockAnimation] =
    useState<InsertedBlockAnimation | null>(null)
  const [isPending, startTransition] = useTransition()
  const blockCardRefs = useRef(new Map<string, HTMLDivElement>())
  const routeVideoHelpButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const videoPickerPreviewContainerRef = useRef<HTMLDivElement | null>(null)
  const videoPickerPreviewRef = useRef<HTMLVideoElement | null>(null)
  const videoPickerPreviewProgressRef = useRef<HTMLDivElement | null>(null)
  const videoPickerClipTrackRef = useRef<HTMLDivElement | null>(null)
  const insertedBlockAnimationTimeout = useRef<number | null>(null)
  const previewControlsHideTimeout = useRef<number | null>(null)
  const previewFlashTimeout = useRef<number | null>(null)
  const routeVideoHelpCloseTimeout = useRef<number | null>(null)
  const routeVideoHelpEnterFrame = useRef<number | null>(null)
  const videoPickerModeResetTimeout = useRef<number | null>(null)
  const dragDidReorder = useRef(false)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  )

  const blockSummaries = parsedBlocks.map((block, index) =>
    summarizeBlock(block, index, videoLibrary),
  )
  const selectedBlock =
    selectedBlockIndex !== null ? parsedBlocks[selectedBlockIndex] : null
  const selectedBlockRecord = asRecord(selectedBlock)
  const selectedBlockType = asString(selectedBlockRecord?.t) || ""
  const selectedBlockSummary =
    selectedBlockIndex !== null ? blockSummaries[selectedBlockIndex] : null
  const serializedBlocks = JSON.stringify(parsedBlocks)
  const normalizedParsedBlocks = normalizeOptionalUrlFields(
    parsedBlocks,
  ) as unknown[]
  const initialSerializedBlocks = JSON.stringify(
    JSON.parse(initialValues.blocksJson),
  )
  const hasChanges =
    title !== initialValues.title ||
    slug !== initialValues.slug ||
    pathSegment !== initialValues.pathSegment ||
    metaDescription !== initialValues.metaDescription ||
    serializedBlocks !== initialSerializedBlocks
  const canPublishNow = canPublish && (!hasPublishedVersion || hasChanges)
  const blockCategories = [
    "All",
    ...Array.from(new Set(BLOCK_LIBRARY.map((block) => block.category))),
  ] as BlockCategoryFilter[]
  const normalizedBlockQuery = blockSearchQuery.trim().toLowerCase()
  const filteredBlockLibrary = BLOCK_LIBRARY.filter((block) => {
    const matchesCategory =
      blockCategoryFilter === "All" || block.category === blockCategoryFilter
    const matchesQuery =
      normalizedBlockQuery.length === 0 ||
      block.label.toLowerCase().includes(normalizedBlockQuery) ||
      block.description.toLowerCase().includes(normalizedBlockQuery) ||
      block.category.toLowerCase().includes(normalizedBlockQuery)

    return matchesCategory && matchesQuery
  })
  const groupedFilteredBlockLibrary = blockCategories
    .filter((category) => category !== "All")
    .map((category) => ({
      category,
      blocks: filteredBlockLibrary.filter(
        (block) => block.category === category,
      ),
    }))
    .filter((group) => group.blocks.length > 0)
  const videoPickerBlockRecord =
    videoPickerBlockIndex === null
      ? null
      : asRecord(parsedBlocks[videoPickerBlockIndex])
  const videoPickerCurrentVideo = findVideoLibraryItem(
    videoPickerBlockRecord?.videoId,
  )
  const videoPickerBlockType = asString(videoPickerBlockRecord?.t)
  const videoPickerBlockLabel =
    videoPickerBlockType === "videoHero"
      ? "hero"
      : videoPickerBlockType === "video"
        ? "video block"
        : videoPickerMode === "carouselAppend"
          ? "carousel"
          : "block"
  const videoPickerDialogTitle =
    videoPickerMode === "carouselAppend"
      ? "Add carousel video"
      : "Choose a video"
  const videoPickerDialogDescription =
    videoPickerMode === "carouselAppend"
      ? "Browse the current library, search by title or Core ID, and pick a video to add into this carousel."
      : "Browse the current library, search by title or Core ID, and use the filters below to narrow the set before attaching a video to the selected block."
  const videoPickerCurrentAttachmentLabel = videoPickerCurrentVideo
    ? `Current ${videoPickerBlockLabel} video: ${videoPickerCurrentVideo.title}`
    : videoPickerMode === "carouselAppend"
      ? "Pick a video to append it to this carousel."
      : `No video currently attached to this ${videoPickerBlockLabel}.`
  const currentLocaleCode =
    localeEntries.find((entry) => entry.active)?.code ?? "en"
  const normalizedVideoLibraryQuery = videoLibraryQuery.trim().toLowerCase()
  const filteredVideoLibrary = [...videoLibrary]
    .filter((item) => {
      const carouselAlreadyIncludes =
        videoPickerMode === "carouselAppend" &&
        asArray(videoPickerBlockRecord?.items).some(
          (entry) => asString(asRecord(entry)?.videoId) === item.key,
        )
      if (carouselAlreadyIncludes) return false
      const haystack =
        `${item.title} ${item.id} ${item.sourceLabel} ${item.dubs}`.toLowerCase()
      const matchesQuery =
        normalizedVideoLibraryQuery.length === 0 ||
        haystack.includes(normalizedVideoLibraryQuery)
      return matchesQuery
    })
    .sort((left, right) => {
      if (videoLibrarySort === "title") {
        return left.title.localeCompare(right.title)
      }
      if (videoLibrarySort === "duration") {
        return right.duration.localeCompare(left.duration)
      }
      return right.updated.localeCompare(left.updated)
    })
  const videoPickerLibraryRows = [
    ...(videoPickerMode === "block" && videoPickerCurrentVideo
      ? [videoPickerCurrentVideo]
      : []),
    ...filteredVideoLibrary.filter(
      (item) => item.key !== videoPickerCurrentVideo?.key,
    ),
  ]
  const videoPickerSelectedVideo = findVideoLibraryItem(
    videoPickerDraft.videoKey,
  )
  const videoPickerDurationSeconds =
    videoPickerSelectedVideo?.durationSeconds ?? 0
  const videoPickerClipStart = clampNumber(
    parseClipInput(videoPickerDraft.clipStartSeconds) ?? 0,
    0,
    videoPickerDurationSeconds,
  )
  const videoPickerClipEnd = clampNumber(
    parseClipInput(videoPickerDraft.clipEndSeconds) ??
      videoPickerDurationSeconds,
    0,
    videoPickerDurationSeconds,
  )
  const videoPickerClipStartPercent =
    videoPickerDurationSeconds > 0
      ? (videoPickerClipStart / videoPickerDurationSeconds) * 100
      : 0
  const videoPickerClipEndPercent =
    videoPickerDurationSeconds > 0
      ? (videoPickerClipEnd / videoPickerDurationSeconds) * 100
      : 0
  const videoPickerClipChanged =
    videoPickerDurationSeconds > 0 &&
    (videoPickerClipStart > 0 ||
      videoPickerClipEnd < videoPickerDurationSeconds)
  const previewTrimDuration = Math.max(
    videoPickerClipEnd - videoPickerClipStart,
    0,
  )
  const previewRelativeCurrentTime = clampNumber(
    previewCurrentTime - videoPickerClipStart,
    0,
    previewTrimDuration,
  )
  const previewProgressPercent =
    previewTrimDuration > 0
      ? (previewRelativeCurrentTime / previewTrimDuration) * 100
      : 0
  const activeDragSummary =
    activeDragKey === null
      ? null
      : (blockSummaries.find((block) => block.key === activeDragKey) ?? null)

  useEffect(() => {
    if (parsedBlocks.length === 0) {
      setSelectedBlockIndex(null)
      return
    }

    setSelectedBlockIndex((current) => {
      if (current === null) return 0
      return current >= parsedBlocks.length ? parsedBlocks.length - 1 : current
    })
  }, [parsedBlocks.length])

  useEffect(() => {
    if (scrollToBlockKey === null) return

    const blockCard = blockCardRefs.current.get(scrollToBlockKey)
    if (!blockCard) return

    blockCard.scrollIntoView({
      behavior: "smooth",
      block: "center",
    })
    setScrollToBlockKey(null)
  }, [blockSummaries, scrollToBlockKey])

  useEffect(() => {
    return () => {
      if (previewControlsHideTimeout.current !== null) {
        window.clearTimeout(previewControlsHideTimeout.current)
      }
      if (previewFlashTimeout.current !== null) {
        window.clearTimeout(previewFlashTimeout.current)
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (insertedBlockAnimationTimeout.current !== null) {
        window.clearTimeout(insertedBlockAnimationTimeout.current)
      }
      if (videoPickerModeResetTimeout.current !== null) {
        window.clearTimeout(videoPickerModeResetTimeout.current)
      }
      if (routeVideoHelpCloseTimeout.current !== null) {
        window.clearTimeout(routeVideoHelpCloseTimeout.current)
      }
      if (routeVideoHelpEnterFrame.current !== null) {
        window.cancelAnimationFrame(routeVideoHelpEnterFrame.current)
      }
    }
  }, [])

  useEffect(() => {
    if (videoPickerBlockIndex === null) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeVideoPicker()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [videoPickerBlockIndex])

  useEffect(() => {
    if (videoPickerBlockIndex === null) return

    if (
      videoPickerDraft.videoKey &&
      videoLibrary.some((video) => video.key === videoPickerDraft.videoKey)
    ) {
      return
    }

    setVideoPickerDraft((current) => ({
      ...current,
      videoKey:
        videoPickerCurrentVideo?.key ?? filteredVideoLibrary[0]?.key ?? null,
    }))
  }, [
    filteredVideoLibrary,
    videoLibrary,
    videoPickerBlockIndex,
    videoPickerCurrentVideo?.key,
    videoPickerDraft.videoKey,
  ])

  useEffect(() => {
    if (videoPickerBlockIndex === null) return
    setPreviewMuted(true)
  }, [videoPickerBlockIndex, videoPickerDraft.videoKey])

  useEffect(() => {
    function handleFullscreenChange() {
      const previewContainer = videoPickerPreviewContainerRef.current
      setPreviewIsFullscreen(
        !!previewContainer && document.fullscreenElement === previewContainer,
      )
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange)
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
  }, [])

  useEffect(() => {
    const previewEl = videoPickerPreviewRef.current
    const selectedVideo = videoPickerSelectedVideo
    if (!previewEl || !selectedVideo?.previewStreamUrl) return
    const preview = previewEl
    setPreviewIsLoading(true)

    function revealPreviewControls() {
      setPreviewControlsVisible(true)
      if (previewControlsHideTimeout.current !== null) {
        window.clearTimeout(previewControlsHideTimeout.current)
        previewControlsHideTimeout.current = null
      }
      if (!preview.paused) {
        previewControlsHideTimeout.current = window.setTimeout(() => {
          setPreviewControlsVisible(false)
          previewControlsHideTimeout.current = null
        }, 1400)
      }
    }

    function syncPreviewWindow() {
      if (preview.readyState < 1) return
      if (
        Math.abs(preview.currentTime - videoPickerClipStart) > 0.35 &&
        (preview.currentTime < videoPickerClipStart ||
          preview.currentTime > videoPickerClipEnd)
      ) {
        preview.currentTime = videoPickerClipStart
      }
      setPreviewCurrentTime(preview.currentTime)
      preview.pause()
      setPreviewIsPlaying(false)
      setPreviewControlsVisible(true)
    }

    function handleLoadedMetadata() {
      setPreviewIsLoading(false)
      syncPreviewWindow()
    }

    function handleCanPlay() {
      setPreviewIsLoading(false)
    }

    function handleWaiting() {
      setPreviewIsLoading(true)
    }

    function handlePlay() {
      setPreviewIsLoading(false)
      setPreviewIsPlaying(true)
      revealPreviewControls()
    }

    function handlePause() {
      setPreviewIsPlaying(false)
      setPreviewControlsVisible(true)
    }

    function handleTimeUpdate() {
      setPreviewIsLoading(false)
      setPreviewCurrentTime(preview.currentTime)
      if (preview.paused) return
      if (preview.currentTime < videoPickerClipEnd) return
      preview.pause()
      preview.currentTime = videoPickerClipStart
      setPreviewCurrentTime(videoPickerClipStart)
    }

    function handlePointerMove() {
      revealPreviewControls()
    }

    preview.addEventListener("loadedmetadata", handleLoadedMetadata)
    preview.addEventListener("canplay", handleCanPlay)
    preview.addEventListener("waiting", handleWaiting)
    preview.addEventListener("play", handlePlay)
    preview.addEventListener("pause", handlePause)
    preview.addEventListener("timeupdate", handleTimeUpdate)
    preview.addEventListener("pointermove", handlePointerMove)
    setPreviewCurrentTime(videoPickerClipStart)
    setPreviewControlsVisible(true)
    setPreviewIsPlaying(!preview.paused)
    syncPreviewWindow()

    return () => {
      preview.removeEventListener("loadedmetadata", handleLoadedMetadata)
      preview.removeEventListener("canplay", handleCanPlay)
      preview.removeEventListener("waiting", handleWaiting)
      preview.removeEventListener("play", handlePlay)
      preview.removeEventListener("pause", handlePause)
      preview.removeEventListener("timeupdate", handleTimeUpdate)
      preview.removeEventListener("pointermove", handlePointerMove)
    }
  }, [
    videoPickerDraft.clipEndSeconds,
    videoPickerDraft.clipStartSeconds,
    videoPickerClipEnd,
    videoPickerClipStart,
    videoPickerSelectedVideo,
  ])

  function togglePreviewPlayback() {
    const preview = videoPickerPreviewRef.current
    if (!preview) return
    if (preview.paused) {
      void preview.play().catch(() => {})
      setPreviewFlashIcon("play")
    } else {
      preview.pause()
      setPreviewFlashIcon("pause")
    }

    if (previewFlashTimeout.current !== null) {
      window.clearTimeout(previewFlashTimeout.current)
    }
    previewFlashTimeout.current = window.setTimeout(() => {
      setPreviewFlashIcon(null)
      previewFlashTimeout.current = null
    }, 520)
  }

  async function togglePreviewFullscreen() {
    const previewContainer = videoPickerPreviewContainerRef.current
    if (!previewContainer) return

    if (document.fullscreenElement === previewContainer) {
      await document.exitFullscreen().catch(() => {})
      return
    }

    await previewContainer.requestFullscreen().catch(() => {})
  }

  useEffect(() => {
    if (activeClipHandle === null) return

    function updateClipFromPointer(clientX: number) {
      const track = videoPickerClipTrackRef.current
      const preview = videoPickerPreviewRef.current
      if (!track || videoPickerDurationSeconds <= 0) return

      const rect = track.getBoundingClientRect()
      const ratio = clampNumber((clientX - rect.left) / rect.width, 0, 1)
      const nextValue = Math.round(ratio * videoPickerDurationSeconds)

      setVideoPickerDraft((current) => {
        const currentStart = clampNumber(
          parseClipInput(current.clipStartSeconds) ?? 0,
          0,
          videoPickerDurationSeconds,
        )
        const currentEnd = clampNumber(
          parseClipInput(current.clipEndSeconds) ?? videoPickerDurationSeconds,
          0,
          videoPickerDurationSeconds,
        )

        if (activeClipHandle === "start") {
          if (nextValue <= currentEnd) {
            if (preview) {
              preview.pause()
              preview.currentTime = nextValue
              setPreviewCurrentTime(nextValue)
            }
            return {
              ...current,
              clipStartSeconds: String(nextValue),
            }
          }

          setActiveClipHandle("end")
          if (preview) {
            preview.pause()
            preview.currentTime = currentEnd
            setPreviewCurrentTime(currentEnd)
          }
          return {
            ...current,
            clipStartSeconds: String(currentEnd),
            clipEndSeconds: String(nextValue),
          }
        }

        if (nextValue >= currentStart) {
          if (preview) {
            preview.pause()
            preview.currentTime = nextValue
            setPreviewCurrentTime(nextValue)
          }
          return {
            ...current,
            clipEndSeconds: String(nextValue),
          }
        }

        setActiveClipHandle("start")
        if (preview) {
          preview.pause()
          preview.currentTime = currentStart
          setPreviewCurrentTime(currentStart)
        }
        return {
          ...current,
          clipStartSeconds: String(nextValue),
          clipEndSeconds: String(currentStart),
        }
      })
    }

    function handlePointerMove(event: PointerEvent) {
      updateClipFromPointer(event.clientX)
    }

    function handlePointerUp() {
      setActiveClipHandle(null)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }
  }, [activeClipHandle, videoPickerDurationSeconds])

  useEffect(() => {
    if (activeClipHandle === null) return

    const preview = videoPickerPreviewRef.current
    if (!preview) return

    const targetTime =
      activeClipHandle === "start" ? videoPickerClipStart : videoPickerClipEnd

    preview.pause()
    preview.currentTime = targetTime
    setPreviewCurrentTime(targetTime)
  }, [activeClipHandle, videoPickerClipEnd, videoPickerClipStart])

  useEffect(() => {
    if (routeVideoHelpEnterFrame.current !== null) {
      window.cancelAnimationFrame(routeVideoHelpEnterFrame.current)
      routeVideoHelpEnterFrame.current = null
    }
    if (routeVideoHelpCloseTimeout.current !== null) {
      window.clearTimeout(routeVideoHelpCloseTimeout.current)
      routeVideoHelpCloseTimeout.current = null
    }

    if (routeVideoHelpBlockKey !== null) {
      setRouteVideoHelpRendered(true)
      setRouteVideoHelpVisible(false)
      routeVideoHelpEnterFrame.current = window.requestAnimationFrame(() => {
        routeVideoHelpEnterFrame.current = window.requestAnimationFrame(() => {
          setRouteVideoHelpVisible(true)
          routeVideoHelpEnterFrame.current = null
        })
      })
      return
    }

    setRouteVideoHelpVisible(false)
    routeVideoHelpCloseTimeout.current = window.setTimeout(() => {
      setRouteVideoHelpRendered(false)
      setRouteVideoHelpPosition(null)
      routeVideoHelpCloseTimeout.current = null
    }, 180)
  }, [routeVideoHelpBlockKey])

  useEffect(() => {
    if (routeVideoHelpBlockKey === null) return
    const activeHelpKey = routeVideoHelpBlockKey

    function updatePosition() {
      const button = routeVideoHelpButtonRefs.current.get(activeHelpKey)
      if (!button) {
        setRouteVideoHelpPosition(null)
        return
      }

      const rect = button.getBoundingClientRect()
      const tooltipWidth = 240
      const viewportPadding = 16
      const preferredLeft = rect.right - tooltipWidth
      setRouteVideoHelpPosition({
        top: rect.bottom + 8,
        left: Math.min(
          Math.max(viewportPadding, preferredLeft),
          window.innerWidth - tooltipWidth - viewportPadding,
        ),
      })
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest("[data-route-video-help]")) return
      setRouteVideoHelpBlockKey(null)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setRouteVideoHelpBlockKey(null)
      }
    }

    updatePosition()
    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [routeVideoHelpBlockKey])

  const syncBlocks = useCallback(
    (nextBlocks: unknown[], nextSelected = selectedBlockIndex) => {
      setParsedBlocks(nextBlocks)
      setSelectedBlockIndex(nextSelected)
    },
    [selectedBlockIndex],
  )

  function activateBlock(index: number) {
    setPendingInsertIndex(null)
    setSelectedBlockIndex(index)
    setRailTab("inspector")
  }

  function insertBlock(template: BlockTemplateKey, index: number) {
    const nextBlocks = [...parsedBlocks]
    const nextBlock = createTemplateBlock(template, nextBlocks.length)
    const nextBlockSummary = summarizeBlock(nextBlock, index, videoLibrary)
    nextBlocks.splice(index, 0, nextBlock)
    syncBlocks(nextBlocks, index)
    setPendingInsertIndex(null)
    setScrollToBlockKey(nextBlockSummary.key)
    setInsertedBlockAnimation({ key: nextBlockSummary.key, visible: false })
    window.requestAnimationFrame(() => {
      setInsertedBlockAnimation((current) =>
        current && current.key === nextBlockSummary.key
          ? { ...current, visible: true }
          : current,
      )
    })
    if (insertedBlockAnimationTimeout.current !== null) {
      window.clearTimeout(insertedBlockAnimationTimeout.current)
    }
    insertedBlockAnimationTimeout.current = window.setTimeout(() => {
      setInsertedBlockAnimation((current) =>
        current && current.key === nextBlockSummary.key ? null : current,
      )
    }, 320)
    setRailTab("inspector")
    pushToast("Block added.", "success")
  }

  function openAddBlockPicker(index: number) {
    setPendingInsertIndex(index)
    setRailTab("add")
  }

  function renderPendingInsertMarker() {
    return (
      <div className="flex items-center gap-3 rounded-pill border border-[var(--color-brand)] bg-[color-mix(in_oklab,var(--color-brand)_10%,var(--color-surface))] px-3 py-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
        <span className="h-2 w-2 rounded-full bg-[var(--color-brand)]" />
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-primary)]">
          New block inserts here
        </span>
      </div>
    )
  }

  function removeBlock(index: number) {
    const nextBlocks = parsedBlocks.filter(
      (_, currentIndex) => currentIndex !== index,
    )
    const nextSelected =
      nextBlocks.length === 0 ? null : Math.min(index, nextBlocks.length - 1)
    syncBlocks(nextBlocks, nextSelected)
    pushToast("Block removed.", "success")
  }

  const reorderBlocksByKey = useCallback(
    (fromKey: string, toKey: string) => {
      if (fromKey === toKey) return false

      const fromIndex = blockSummaries.findIndex(
        (block) => block.key === fromKey,
      )
      const toIndex = blockSummaries.findIndex((block) => block.key === toKey)

      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
        return false
      }

      const nextBlocks = arrayMove(parsedBlocks, fromIndex, toIndex)
      const selectedKey =
        selectedBlockIndex !== null
          ? blockSummaries[selectedBlockIndex]?.key
          : null
      const nextSummaries = nextBlocks.map((block, index) =>
        summarizeBlock(block, index, videoLibrary),
      )
      const nextSelected =
        selectedKey === null
          ? null
          : nextSummaries.findIndex((block) => block.key === selectedKey)

      syncBlocks(nextBlocks, nextSelected === -1 ? null : nextSelected)
      return true
    },
    [
      blockSummaries,
      parsedBlocks,
      selectedBlockIndex,
      syncBlocks,
      videoLibrary,
    ],
  )

  const handleDragCleanup = useCallback(
    (showToast: boolean) => {
      if (showToast && dragDidReorder.current) {
        pushToast("Block reordered.", "success")
      }
      dragDidReorder.current = false
      setActiveDragKey(null)
    },
    [pushToast],
  )

  const handleBlockDragStart = useCallback(
    (event: DragStartEvent) => {
      const key = String(event.active.id)
      setPendingInsertIndex(null)
      setActiveDragKey(key)
      const index = blockSummaries.findIndex((block) => block.key === key)
      if (index >= 0) {
        activateBlock(index)
      }
    },
    [blockSummaries],
  )

  const handleBlockDragOver = useCallback(
    (event: DragOverEvent) => {
      const overKey = event.over ? String(event.over.id) : null
      if (!overKey) return

      const activeKey = String(event.active.id)
      if (reorderBlocksByKey(activeKey, overKey)) {
        dragDidReorder.current = true
      }
    },
    [reorderBlocksByKey],
  )

  const handleBlockDragEnd = useCallback(
    (event: DragEndEvent) => {
      const overKey = event.over ? String(event.over.id) : null
      if (overKey) {
        const activeKey = String(event.active.id)
        if (reorderBlocksByKey(activeKey, overKey)) {
          dragDidReorder.current = true
        }
      }

      handleDragCleanup(true)
    },
    [handleDragCleanup, reorderBlocksByKey],
  )

  function updateBlockAt(
    index: number,
    updater: (block: BlockRecord) => BlockRecord,
  ) {
    const current = asRecord(parsedBlocks[index])
    if (!current) return
    const nextBlocks = [...parsedBlocks]
    nextBlocks[index] = updater(current)
    syncBlocks(nextBlocks, index)
  }

  function updateSelectedStringField(field: string, value: string) {
    if (selectedBlockIndex === null) return
    updateBlockAt(selectedBlockIndex, (block) => {
      if (block.t === "videoHero" && field === "heading") {
        return {
          ...block,
          headingSource: "manual",
          [field]: value,
        }
      }
      if (block.t === "videoHero" && field === "subheading") {
        return {
          ...block,
          subheadingSource: "manual",
          [field]: value,
        }
      }
      if (block.t === "video" && field === "title") {
        return {
          ...block,
          titleSource: "manual",
          [field]: value,
        }
      }
      if (block.t === "video" && field === "subtitle") {
        return {
          ...block,
          subtitleSource: "manual",
          [field]: value,
        }
      }
      return { ...block, [field]: value }
    })
  }

  function updateSelectedNumberField(field: string, value: string) {
    if (selectedBlockIndex === null) return
    updateBlockAt(selectedBlockIndex, (block) => ({
      ...block,
      [field]: value.trim() ? Number(value) : null,
    }))
  }

  function updateSelectedBooleanField(field: string, checked: boolean) {
    if (selectedBlockIndex === null) return
    updateBlockAt(selectedBlockIndex, (block) => ({
      ...block,
      [field]: checked,
    }))
  }

  function updateBlockStringField(index: number, field: string, value: string) {
    updateBlockAt(index, (block) => {
      if (block.t === "videoHero" && field === "heading") {
        return {
          ...block,
          headingSource: "manual",
          [field]: value,
        }
      }
      if (block.t === "videoHero" && field === "subheading") {
        return {
          ...block,
          subheadingSource: "manual",
          [field]: value,
        }
      }
      if (block.t === "video" && field === "title") {
        return {
          ...block,
          titleSource: "manual",
          [field]: value,
        }
      }
      if (block.t === "video" && field === "subtitle") {
        return {
          ...block,
          subtitleSource: "manual",
          [field]: value,
        }
      }
      return { ...block, [field]: value }
    })
  }

  function updateBlockParagraphsField(index: number, value: string) {
    updateBlockAt(index, (block) => ({
      ...block,
      contentParagraphs: value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    }))
  }

  function appendVideoCarouselItem(index: number, videoKey: string) {
    const selectedVideo = findVideoLibraryItem(videoKey)
    if (!selectedVideo) return

    updateBlockAt(index, (block) => {
      if (block.t !== "videoCarousel") return block
      const currentItems = asArray(block.items)
      const alreadyIncluded = currentItems.some(
        (item) => asString(asRecord(item)?.videoId) === selectedVideo.key,
      )
      if (alreadyIncluded) return block

      return {
        ...block,
        items: [
          ...currentItems,
          {
            videoId: selectedVideo.key,
            streamingUrl: selectedVideo.previewStreamUrl ?? "",
            titleOverride: "",
            subtitleOverride: "",
          },
        ],
      }
    })
  }

  function updateVideoCarouselItemField(
    index: number,
    itemIndex: number,
    field: string,
    value: string,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "videoCarousel") return block
      const currentItems = asArray(block.items)
      return {
        ...block,
        items: currentItems.map((item, currentIndex) =>
          currentIndex === itemIndex
            ? { ...(asRecord(item) ?? {}), [field]: value }
            : item,
        ),
      }
    })
  }

  function removeVideoCarouselItem(index: number, itemIndex: number) {
    updateBlockAt(index, (block) => {
      if (block.t !== "videoCarousel") return block
      return {
        ...block,
        items: asArray(block.items).filter(
          (_, currentIndex) => currentIndex !== itemIndex,
        ),
      }
    })
  }

  function reorderVideoCarouselItems(
    index: number,
    fromIndex: number,
    toIndex: number,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "videoCarousel") return block
      const items = [...asArray(block.items)]
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= items.length ||
        toIndex >= items.length ||
        fromIndex === toIndex
      ) {
        return block
      }
      const [moved] = items.splice(fromIndex, 1)
      items.splice(toIndex, 0, moved)
      return { ...block, items }
    })
  }

  function updateRelatedQuestionField(
    index: number,
    itemIndex: number,
    field: "question" | "answer",
    value: string,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "relatedQuestions") return block
      const questions = asArray(block.questions)
      return {
        ...block,
        questions: questions.map((item, currentIndex) =>
          currentIndex === itemIndex
            ? { ...(asRecord(item) ?? {}), [field]: value }
            : item,
        ),
      }
    })
  }

  function appendRelatedQuestion(index: number) {
    updateBlockAt(index, (block) => {
      if (block.t !== "relatedQuestions") return block
      return {
        ...block,
        questions: [
          ...asArray(block.questions),
          {
            question: "New question",
            answer: "Add the answer here.",
          },
        ],
      }
    })
  }

  function removeRelatedQuestion(index: number, itemIndex: number) {
    updateBlockAt(index, (block) => {
      if (block.t !== "relatedQuestions") return block
      return {
        ...block,
        questions: asArray(block.questions).filter(
          (_, currentIndex) => currentIndex !== itemIndex,
        ),
      }
    })
  }

  function reorderRelatedQuestions(
    index: number,
    fromIndex: number,
    toIndex: number,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "relatedQuestions") return block
      const questions = [...asArray(block.questions)]
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= questions.length ||
        toIndex >= questions.length ||
        fromIndex === toIndex
      ) {
        return block
      }
      const [moved] = questions.splice(fromIndex, 1)
      questions.splice(toIndex, 0, moved)
      return { ...block, questions }
    })
  }

  function updateBibleQuoteField(
    index: number,
    itemIndex: number,
    field: string,
    value: string | boolean,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "bibleQuotesCarousel") return block
      const quotes = asArray(block.quotes)
      return {
        ...block,
        quotes: quotes.map((item, currentIndex) =>
          currentIndex === itemIndex
            ? { ...(asRecord(item) ?? {}), [field]: value }
            : item,
        ),
      }
    })
  }

  function appendBibleQuote(index: number) {
    updateBlockAt(index, (block) => {
      if (block.t !== "bibleQuotesCarousel") return block
      return {
        ...block,
        quotes: [
          ...asArray(block.quotes),
          {
            reference: "Reference",
            text: "Add the quote text here.",
            attribution: "",
            backgroundColor: "#151515",
            ctaEnabled: false,
            ctaLabel: "Read more",
            ctaLink: "/",
          },
        ],
      }
    })
  }

  function removeBibleQuote(index: number, itemIndex: number) {
    updateBlockAt(index, (block) => {
      if (block.t !== "bibleQuotesCarousel") return block
      return {
        ...block,
        quotes: asArray(block.quotes).filter(
          (_, currentIndex) => currentIndex !== itemIndex,
        ),
      }
    })
  }

  function reorderBibleQuotes(
    index: number,
    fromIndex: number,
    toIndex: number,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "bibleQuotesCarousel") return block
      const quotes = [...asArray(block.quotes)]
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= quotes.length ||
        toIndex >= quotes.length ||
        fromIndex === toIndex
      ) {
        return block
      }
      const [moved] = quotes.splice(fromIndex, 1)
      quotes.splice(toIndex, 0, moved)
      return { ...block, quotes }
    })
  }

  function resolveVideoCarouselItemTitle(item: BlockRecord | null) {
    const itemVideo = findVideoLibraryItem(item?.videoId)
    return asString(item?.titleOverride) || itemVideo?.title || "Selected video"
  }

  function resolveVideoCarouselItemSubtitle(item: BlockRecord | null) {
    const itemVideo = findVideoLibraryItem(item?.videoId)
    return (
      asString(item?.subtitleOverride) ||
      itemVideo?.labelLabel ||
      localizedVideoLabelFallback(
        itemVideo?.label ?? null,
        currentLocaleCode,
      ) ||
      itemVideo?.id ||
      ""
    )
  }

  function resolveVideoCarouselItemImage(item: BlockRecord | null) {
    const itemVideo = findVideoLibraryItem(item?.videoId)
    return (
      asString(item?.imageOverrideUrl) ||
      asString(item?.imageUrl) ||
      itemVideo?.previewImageUrl ||
      ""
    )
  }

  function handleCarouselItemDragStart(
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) {
    event.stopPropagation()
    const dragPreview = event.currentTarget.cloneNode(true)
    if (dragPreview instanceof HTMLDivElement) {
      const pointerOffsetX =
        carouselDragHandleState?.blockIndex === blockIndex &&
        carouselDragHandleState.itemIndex === itemIndex
          ? carouselDragHandleState.pointerOffsetX
          : 24
      const pointerOffsetY =
        carouselDragHandleState?.blockIndex === blockIndex &&
        carouselDragHandleState.itemIndex === itemIndex
          ? carouselDragHandleState.pointerOffsetY
          : 24
      dragPreview.style.position = "fixed"
      dragPreview.style.top = "-9999px"
      dragPreview.style.left = "-9999px"
      dragPreview.style.width = `${event.currentTarget.offsetWidth}px`
      dragPreview.style.pointerEvents = "none"
      dragPreview.style.transform = "none"
      dragPreview.style.opacity = "1"
      document.body.appendChild(dragPreview)
      event.dataTransfer.setDragImage(
        dragPreview,
        pointerOffsetX,
        pointerOffsetY,
      )
      window.setTimeout(() => {
        dragPreview.remove()
      }, 0)
    }
    activateBlock(blockIndex)
    setCarouselDragState({ blockIndex, itemIndex })
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", `${blockIndex}:${itemIndex}`)
  }

  function handleCarouselItemDragEnter(
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) {
    event.preventDefault()
    event.stopPropagation()
    setCarouselDragState((current) => {
      if (!current || current.blockIndex !== blockIndex) return current
      if (current.itemIndex === itemIndex) return current
      reorderVideoCarouselItems(blockIndex, current.itemIndex, itemIndex)
      return { blockIndex, itemIndex }
    })
  }

  function clearCarouselDragState() {
    setCarouselDragState(null)
    setCarouselDragHandleState(null)
  }

  function handleRelatedQuestionDragStart(
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) {
    event.stopPropagation()
    const dragPreview = event.currentTarget.cloneNode(true)
    if (dragPreview instanceof HTMLDivElement) {
      const pointerOffsetX =
        relatedQuestionDragHandleState?.blockIndex === blockIndex &&
        relatedQuestionDragHandleState.itemIndex === itemIndex
          ? relatedQuestionDragHandleState.pointerOffsetX
          : 24
      const pointerOffsetY =
        relatedQuestionDragHandleState?.blockIndex === blockIndex &&
        relatedQuestionDragHandleState.itemIndex === itemIndex
          ? relatedQuestionDragHandleState.pointerOffsetY
          : 24
      dragPreview.style.position = "fixed"
      dragPreview.style.top = "-9999px"
      dragPreview.style.left = "-9999px"
      dragPreview.style.width = `${event.currentTarget.offsetWidth}px`
      dragPreview.style.pointerEvents = "none"
      dragPreview.style.transform = "none"
      dragPreview.style.opacity = "1"
      document.body.appendChild(dragPreview)
      event.dataTransfer.setDragImage(
        dragPreview,
        pointerOffsetX,
        pointerOffsetY,
      )
      window.setTimeout(() => {
        dragPreview.remove()
      }, 0)
    }
    activateBlock(blockIndex)
    setRelatedQuestionDragState({ blockIndex, itemIndex })
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", `${blockIndex}:${itemIndex}`)
  }

  function handleRelatedQuestionDragEnter(
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) {
    event.preventDefault()
    event.stopPropagation()
    setRelatedQuestionDragState((current) => {
      if (!current || current.blockIndex !== blockIndex) return current
      if (current.itemIndex === itemIndex) return current
      reorderRelatedQuestions(blockIndex, current.itemIndex, itemIndex)
      return { blockIndex, itemIndex }
    })
  }

  function clearRelatedQuestionDragState() {
    setRelatedQuestionDragState(null)
    setRelatedQuestionDragHandleState(null)
  }

  function handleBibleQuoteDragStart(
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) {
    event.stopPropagation()
    const dragPreview = event.currentTarget.cloneNode(true)
    if (dragPreview instanceof HTMLDivElement) {
      const pointerOffsetX =
        bibleQuoteDragHandleState?.blockIndex === blockIndex &&
        bibleQuoteDragHandleState.itemIndex === itemIndex
          ? bibleQuoteDragHandleState.pointerOffsetX
          : 24
      const pointerOffsetY =
        bibleQuoteDragHandleState?.blockIndex === blockIndex &&
        bibleQuoteDragHandleState.itemIndex === itemIndex
          ? bibleQuoteDragHandleState.pointerOffsetY
          : 24
      dragPreview.style.position = "fixed"
      dragPreview.style.top = "-9999px"
      dragPreview.style.left = "-9999px"
      dragPreview.style.width = `${event.currentTarget.offsetWidth}px`
      dragPreview.style.pointerEvents = "none"
      dragPreview.style.transform = "none"
      dragPreview.style.opacity = "1"
      document.body.appendChild(dragPreview)
      event.dataTransfer.setDragImage(
        dragPreview,
        pointerOffsetX,
        pointerOffsetY,
      )
      window.setTimeout(() => {
        dragPreview.remove()
      }, 0)
    }
    activateBlock(blockIndex)
    setBibleQuoteDragState({ blockIndex, itemIndex })
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", `${blockIndex}:${itemIndex}`)
  }

  function handleBibleQuoteDragEnter(
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) {
    event.preventDefault()
    event.stopPropagation()
    setBibleQuoteDragState((current) => {
      if (!current || current.blockIndex !== blockIndex) return current
      if (current.itemIndex === itemIndex) return current
      reorderBibleQuotes(blockIndex, current.itemIndex, itemIndex)
      return { blockIndex, itemIndex }
    })
  }

  function clearBibleQuoteDragState() {
    setBibleQuoteDragState(null)
    setBibleQuoteDragHandleState(null)
  }

  function isBlockSwitchEnabled(block: BlockRecord | null, field: string) {
    if (!block) return false
    const value = block[field]
    if (value === undefined && field === "ctaEnabled") return true
    return value === true
  }

  function findVideoLibraryItem(value: unknown) {
    const key = asString(value)
    if (!key) return null

    return (
      videoLibrary.find((item) => item.key === key || item.id === key) ?? null
    )
  }

  function resolveVideoHeroHeading(block: BlockRecord) {
    const source =
      (asString(block.headingSource) as VideoHeroHeadingSource) || "manual"
    if (source !== "videoTitle") {
      return asString(block.heading)
    }

    return findVideoLibraryItem(block.videoId)?.title || asString(block.heading)
  }

  function resolveVideoHeroSubheading(block: BlockRecord) {
    const source =
      (asString(block.subheadingSource) as VideoHeroSubheadingSource) ||
      "manual"
    if (source !== "videoDescription") {
      return asString(block.subheading)
    }

    return (
      findVideoLibraryItem(block.videoId)?.description ||
      asString(block.subheading)
    )
  }

  function resolveVideoBlockTitle(block: BlockRecord) {
    const source =
      (asString(block.titleSource) as VideoBlockTitleSource) || "manual"
    if (source !== "videoTitle") {
      return asString(block.title)
    }

    return findVideoLibraryItem(block.videoId)?.title || asString(block.title)
  }

  function resolveVideoBlockSubtitle(block: BlockRecord) {
    const source =
      (asString(block.subtitleSource) as VideoBlockSubtitleSource) || "manual"
    if (source !== "videoDescription") {
      return asString(block.subtitle)
    }

    return (
      findVideoLibraryItem(block.videoId)?.description ||
      asString(block.subtitle)
    )
  }

  function shouldUseVideoHeroHeadingMetadata(block: BlockRecord) {
    const source = asString(block.headingSource)
    if (source === "videoTitle") return true
    if (source === "manual") return false
    return asString(block.heading).trim().length === 0
  }

  function shouldUseVideoHeroSubheadingMetadata(block: BlockRecord) {
    const source = asString(block.subheadingSource)
    if (source === "videoDescription") return true
    if (source === "manual") return false
    return asString(block.subheading).trim().length === 0
  }

  function shouldUseVideoBlockTitleMetadata(block: BlockRecord) {
    const source = asString(block.titleSource)
    if (source === "videoTitle") return true
    if (source === "manual") return false
    return asString(block.title).trim().length === 0
  }

  function shouldUseVideoBlockSubtitleMetadata(block: BlockRecord) {
    const source = asString(block.subtitleSource)
    if (source === "videoDescription") return true
    if (source === "manual") return false
    return asString(block.subtitle).trim().length === 0
  }

  function openVideoPicker(index: number, mode: VideoPickerMode = "block") {
    const block = asRecord(parsedBlocks[index])
    const currentVideo = findVideoLibraryItem(block?.videoId)
    setVideoPickerMode(mode)
    setVideoPickerBlockIndex(index)
    setVideoLibraryQuery("")
    setVideoLibrarySort("recent")
    setVideoPickerDraft({
      videoKey: mode === "carouselAppend" ? null : (currentVideo?.key ?? null),
      clipStartSeconds: stringFromOptionalNumber(block?.clipStartSeconds),
      clipEndSeconds: stringFromOptionalNumber(block?.clipEndSeconds),
      autoplay:
        block?.autoplay === undefined ? true : asBoolean(block?.autoplay),
      muted: block?.muted === undefined ? true : asBoolean(block?.muted),
      loop: asBoolean(block?.loop),
      showControls:
        block?.showControls === undefined
          ? true
          : asBoolean(block?.showControls),
    })
  }

  function closeVideoPicker() {
    const preview = videoPickerPreviewRef.current
    if (preview) {
      preview.pause()
      preview.currentTime = 0
    }

    if (document.fullscreenElement === videoPickerPreviewContainerRef.current) {
      void document.exitFullscreen().catch(() => {})
    }

    setActiveClipHandle(null)
    setPreviewCurrentTime(0)
    setPreviewIsPlaying(false)
    setPreviewControlsVisible(true)
    setPreviewFlashIcon(null)
    setPreviewMuted(true)
    setPreviewIsLoading(false)
    setPreviewIsFullscreen(false)
    setVideoPickerBlockIndex(null)
    if (videoPickerModeResetTimeout.current !== null) {
      window.clearTimeout(videoPickerModeResetTimeout.current)
    }
    videoPickerModeResetTimeout.current = window.setTimeout(() => {
      setVideoPickerMode("block")
      videoPickerModeResetTimeout.current = null
    }, 180)
    setVideoPickerDraft({
      videoKey: null,
      clipStartSeconds: "",
      clipEndSeconds: "",
      autoplay: true,
      muted: true,
      loop: false,
      showControls: true,
    })
  }

  function applyVideoPickerSelection() {
    if (videoPickerBlockIndex === null) return
    const selectedVideo = findVideoLibraryItem(videoPickerDraft.videoKey)
    if (!selectedVideo) return
    if (videoPickerMode === "carouselAppend") {
      appendVideoCarouselItem(videoPickerBlockIndex, selectedVideo.key)
      closeVideoPicker()
      pushToast("Video added to carousel.", "success")
      return
    }
    const clipStart = parseClipInput(videoPickerDraft.clipStartSeconds)
    const clipEnd = parseClipInput(videoPickerDraft.clipEndSeconds)
    const normalizedClipEnd =
      clipStart !== null && clipEnd !== null && clipEnd <= clipStart
        ? null
        : clipEnd

    updateBlockAt(videoPickerBlockIndex, (block) => ({
      ...block,
      videoId: selectedVideo.key,
      streamingUrl: selectedVideo.previewStreamUrl ?? "",
      useRouteVideo: false,
      headingSource:
        block.t === "videoHero" && shouldUseVideoHeroHeadingMetadata(block)
          ? "videoTitle"
          : block.headingSource,
      subheadingSource:
        block.t === "videoHero" && shouldUseVideoHeroSubheadingMetadata(block)
          ? "videoDescription"
          : block.subheadingSource,
      titleSource:
        block.t === "video" && shouldUseVideoBlockTitleMetadata(block)
          ? "videoTitle"
          : block.titleSource,
      subtitleSource:
        block.t === "video" && shouldUseVideoBlockSubtitleMetadata(block)
          ? "videoDescription"
          : block.subtitleSource,
      clipStartSeconds: clipStart ?? undefined,
      clipEndSeconds: normalizedClipEnd ?? undefined,
      autoplay: videoPickerDraft.autoplay,
      muted: videoPickerDraft.muted,
      loop: videoPickerDraft.loop,
      showControls: videoPickerDraft.showControls,
    }))
    closeVideoPicker()
    pushToast("Video selected.", "success")
  }

  function canvasInputClassName(size: "title" | "body" = "body") {
    return cx(
      "w-full appearance-none border-0 bg-transparent px-0 outline-none placeholder:text-[var(--color-text-disabled)]",
      size === "title"
        ? "text-[20px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]"
        : "text-[13px] leading-6 text-[var(--color-text-secondary)]",
    )
  }

  function renderSwitch({
    label,
    description,
    checked,
    onChange,
  }: {
    label: string
    description?: string
    checked: boolean
    onChange: (checked: boolean) => void
  }) {
    return (
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="flex w-full cursor-pointer items-start justify-between gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 py-3 text-left transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]"
      >
        <span className="min-w-0">
          <span className="block text-[12px] font-medium text-[var(--color-text-primary)]">
            {label}
          </span>
          {description ? (
            <span className="mt-1 block text-[12px] leading-5 text-[var(--color-text-muted)]">
              {description}
            </span>
          ) : null}
        </span>
        <span
          className={cx(
            "mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-pill border px-0.5 transition-all duration-[160ms] ease-out",
            switchTrackClass(checked),
          )}
        >
          <span className="h-5 w-5 rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.24)]" />
        </span>
      </button>
    )
  }

  function renderInlineTextInput(
    index: number,
    field: string,
    value: string,
    placeholder: string,
    size: "title" | "body" = "body",
  ) {
    return (
      <input
        value={value}
        onClick={(event) => {
          event.stopPropagation()
          activateBlock(index)
        }}
        onFocus={() => activateBlock(index)}
        onChange={(event) =>
          updateBlockStringField(index, field, event.target.value)
        }
        className={canvasInputClassName(size)}
        placeholder={placeholder}
      />
    )
  }

  function renderInlineTextarea(
    index: number,
    field: string,
    value: string,
    placeholder: string,
    rows = 3,
    autoResize = false,
  ) {
    return (
      <textarea
        value={value}
        rows={rows}
        onClick={(event) => {
          event.stopPropagation()
          activateBlock(index)
        }}
        onFocus={() => activateBlock(index)}
        onChange={(event) =>
          updateBlockStringField(index, field, event.target.value)
        }
        onInput={(event) => {
          if (!autoResize) return
          const node = event.currentTarget
          node.style.height = "auto"
          node.style.height = `${node.scrollHeight}px`
        }}
        ref={(node) => {
          if (!autoResize || !node) return
          node.style.height = "auto"
          node.style.height = `${node.scrollHeight}px`
        }}
        className={`${canvasInputClassName("body")} resize-none`}
        style={autoResize ? { overflow: "hidden" } : undefined}
        placeholder={placeholder}
      />
    )
  }

  function renderVideoCarouselItemCard(
    index: number,
    item: unknown,
    itemIndex: number,
    expanded: boolean,
  ) {
    const itemRecord = asRecord(item)
    const itemVideo = findVideoLibraryItem(itemRecord?.videoId)
    const itemImageUrl = resolveVideoCarouselItemImage(itemRecord)
    const itemTitle = resolveVideoCarouselItemTitle(itemRecord)
    const itemSubtitle = resolveVideoCarouselItemSubtitle(itemRecord)
    const titleOverride = asString(itemRecord?.titleOverride)
    const subtitleOverride = asString(itemRecord?.subtitleOverride)
    const isDraggingItem =
      carouselDragState?.blockIndex === index &&
      carouselDragState.itemIndex === itemIndex
    const dragHandleActive =
      carouselDragHandleState?.blockIndex === index &&
      carouselDragHandleState.itemIndex === itemIndex

    return (
      <div
        key={`${index}-video-carousel-item-${itemIndex}`}
        data-carousel-item-card
        draggable={expanded && dragHandleActive}
        onDragStart={(event) =>
          handleCarouselItemDragStart(index, itemIndex, event)
        }
        onDragEnter={(event) =>
          expanded ? handleCarouselItemDragEnter(index, itemIndex, event) : null
        }
        onDragOver={(event) => {
          if (!expanded) return
          event.preventDefault()
          event.stopPropagation()
        }}
        onDragEnd={clearCarouselDragState}
        onDrop={(event) => {
          if (!expanded) return
          event.preventDefault()
          event.stopPropagation()
          clearCarouselDragState()
        }}
        className={cx(
          "group relative overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] transition-all duration-[180ms] ease-out",
          expanded
            ? "grid min-h-[72px] grid-cols-[128px_minmax(0,1fr)]"
            : "min-h-[148px]",
          isDraggingItem && "shadow-[0_18px_48px_rgba(0,0,0,0.24)]",
        )}
      >
        <div
          className={cx(
            "relative overflow-hidden bg-[linear-gradient(180deg,#1c2027,#121419)]",
            expanded ? "h-full self-stretch" : "aspect-video",
          )}
        >
          {itemImageUrl ? (
            <>
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{
                  backgroundImage: `url("${itemImageUrl}")`,
                }}
              />
              <div
                className={cx(
                  "absolute inset-0",
                  expanded
                    ? "bg-transparent"
                    : "bg-[linear-gradient(180deg,rgba(6,8,12,0.02),rgba(6,8,12,0.08)_42%,rgba(4,6,10,0.82)_100%)]",
                )}
              />
            </>
          ) : null}
          {expanded ? (
            <button
              type="button"
              draggable={false}
              onClick={(event) => {
                event.stopPropagation()
                pushToast(
                  "Asset library image picker is coming next.",
                  "success",
                )
              }}
              className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-white/16 bg-[rgba(4,6,10,0.58)] text-white shadow-[0_12px_28px_rgba(0,0,0,0.3)] backdrop-blur-[6px] transition-colors duration-[120ms] ease-out hover:bg-[rgba(4,6,10,0.72)]"
              aria-label="Choose carousel image"
            >
              <ImageIcon className="h-4 w-4" strokeWidth={1.5} />
            </button>
          ) : (
            <div className="absolute inset-x-0 bottom-0 p-4">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold tracking-[-0.02em] text-white">
                  {itemTitle}
                </div>
                <div className="mt-1 truncate text-[12px] leading-5 text-white/74">
                  {itemSubtitle || "Selected video"}
                </div>
              </div>
            </div>
          )}
        </div>
        <div
          className={cx(
            "flex min-w-0 flex-col justify-center p-4",
            !expanded && "hidden",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <input
                value={titleOverride || itemVideo?.title || ""}
                onClick={(event) => {
                  event.stopPropagation()
                  activateBlock(index)
                }}
                onFocus={() => activateBlock(index)}
                onChange={(event) =>
                  updateVideoCarouselItemField(
                    index,
                    itemIndex,
                    "titleOverride",
                    event.target.value,
                  )
                }
                className="w-full border-0 bg-transparent px-0 text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-primary)]"
                placeholder={itemVideo?.title || "Carousel item title"}
              />
              <input
                value={subtitleOverride || itemSubtitle}
                onClick={(event) => {
                  event.stopPropagation()
                  activateBlock(index)
                }}
                onFocus={() => activateBlock(index)}
                onChange={(event) =>
                  updateVideoCarouselItemField(
                    index,
                    itemIndex,
                    "subtitleOverride",
                    event.target.value,
                  )
                }
                className="mt-1 w-full border-0 bg-transparent px-0 text-[12px] leading-5 text-[var(--color-text-muted)] outline-none placeholder:text-[var(--color-text-muted)]"
                placeholder={
                  itemVideo?.labelLabel ||
                  localizedVideoLabelFallback(
                    itemVideo?.label ?? null,
                    currentLocaleCode,
                  ) ||
                  "Carousel item subtitle"
                }
              />
            </div>
            {expanded ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  draggable={false}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    const cardRect = event.currentTarget
                      .closest("[data-carousel-item-card]")
                      ?.getBoundingClientRect()
                    setCarouselDragHandleState({
                      blockIndex: index,
                      itemIndex,
                      pointerOffsetX: cardRect
                        ? event.clientX - cardRect.left
                        : 24,
                      pointerOffsetY: cardRect
                        ? event.clientY - cardRect.top
                        : 24,
                    })
                  }}
                  onPointerUp={(event) => {
                    event.stopPropagation()
                    if (!isDraggingItem) {
                      setCarouselDragHandleState(null)
                    }
                  }}
                  onPointerLeave={() => {
                    if (!isDraggingItem) {
                      setCarouselDragHandleState(null)
                    }
                  }}
                  className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)] active:cursor-grabbing"
                  aria-label="Drag carousel item"
                >
                  <GripVertical className="h-4 w-4" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  draggable={false}
                  onClick={(event) => {
                    event.stopPropagation()
                    removeVideoCarouselItem(index, itemIndex)
                  }}
                  className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[rgba(255,120,120,0.28)] hover:text-[var(--color-danger)]"
                  aria-label="Remove carousel video"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {expanded && isDraggingItem ? (
          <div className="pointer-events-none absolute inset-0 bg-[rgba(255,255,255,0.05)] backdrop-blur-[7px]" />
        ) : null}
      </div>
    )
  }

  function renderInlineParagraphsTextarea(
    index: number,
    value: string[],
    placeholder: string,
    rows = 4,
    autoResize = false,
  ) {
    return (
      <textarea
        value={value.join("\n")}
        rows={rows}
        onClick={(event) => {
          event.stopPropagation()
          activateBlock(index)
        }}
        onFocus={() => activateBlock(index)}
        onChange={(event) =>
          updateBlockParagraphsField(index, event.target.value)
        }
        onInput={(event) => {
          if (!autoResize) return
          const node = event.currentTarget
          node.style.height = "auto"
          node.style.height = `${node.scrollHeight}px`
        }}
        ref={(node) => {
          if (!autoResize || !node) return
          node.style.height = "auto"
          node.style.height = `${node.scrollHeight}px`
        }}
        className={`${canvasInputClassName("body")} resize-none`}
        style={autoResize ? { overflow: "hidden" } : undefined}
        placeholder={placeholder}
      />
    )
  }

  function renderRelatedQuestionCard(
    index: number,
    item: unknown,
    itemIndex: number,
  ) {
    const itemRecord = asRecord(item)
    const dragHandleActive =
      relatedQuestionDragHandleState?.blockIndex === index &&
      relatedQuestionDragHandleState.itemIndex === itemIndex
    const isDraggingItem =
      relatedQuestionDragState?.blockIndex === index &&
      relatedQuestionDragState.itemIndex === itemIndex

    return (
      <div
        key={`${index}-related-question-${itemIndex}`}
        data-related-question-card
        draggable={dragHandleActive}
        onDragStart={(event) =>
          handleRelatedQuestionDragStart(index, itemIndex, event)
        }
        onDragEnter={(event) =>
          handleRelatedQuestionDragEnter(index, itemIndex, event)
        }
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onDragEnd={clearRelatedQuestionDragState}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          clearRelatedQuestionDragState()
        }}
        className={cx(
          "relative rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] p-4 transition-all duration-[180ms] ease-out",
          isDraggingItem && "shadow-[0_18px_48px_rgba(0,0,0,0.24)]",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <input
              value={asString(itemRecord?.question)}
              onClick={(event) => {
                event.stopPropagation()
                activateBlock(index)
              }}
              onFocus={() => activateBlock(index)}
              onChange={(event) =>
                updateRelatedQuestionField(
                  index,
                  itemIndex,
                  "question",
                  event.target.value,
                )
              }
              className="w-full border-0 bg-transparent px-0 text-[14px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-primary)]"
              placeholder="Question"
            />
            <textarea
              value={asString(itemRecord?.answer)}
              rows={1}
              onClick={(event) => {
                event.stopPropagation()
                activateBlock(index)
              }}
              onFocus={() => activateBlock(index)}
              onChange={(event) =>
                updateRelatedQuestionField(
                  index,
                  itemIndex,
                  "answer",
                  event.target.value,
                )
              }
              onInput={(event) => {
                const node = event.currentTarget
                node.style.height = "auto"
                node.style.height = `${node.scrollHeight}px`
              }}
              ref={(node) => {
                if (!node) return
                node.style.height = "auto"
                node.style.height = `${node.scrollHeight}px`
              }}
              className="mt-2 w-full resize-none border-0 bg-transparent px-0 text-[12px] leading-6 text-[var(--color-text-secondary)] outline-none placeholder:text-[var(--color-text-muted)]"
              style={{ overflow: "hidden" }}
              placeholder="Answer"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              draggable={false}
              onPointerDown={(event) => {
                event.stopPropagation()
                const cardRect = event.currentTarget
                  .closest("[data-related-question-card]")
                  ?.getBoundingClientRect()
                setRelatedQuestionDragHandleState({
                  blockIndex: index,
                  itemIndex,
                  pointerOffsetX: cardRect ? event.clientX - cardRect.left : 24,
                  pointerOffsetY: cardRect ? event.clientY - cardRect.top : 24,
                })
              }}
              onPointerUp={(event) => {
                event.stopPropagation()
                if (!isDraggingItem) {
                  setRelatedQuestionDragHandleState(null)
                }
              }}
              onPointerLeave={() => {
                if (!isDraggingItem) {
                  setRelatedQuestionDragHandleState(null)
                }
              }}
              className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)] active:cursor-grabbing"
              aria-label="Drag related question"
            >
              <GripVertical className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              draggable={false}
              onClick={(event) => {
                event.stopPropagation()
                removeRelatedQuestion(index, itemIndex)
              }}
              className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[rgba(255,120,120,0.28)] hover:text-[var(--color-danger)]"
              aria-label="Remove related question"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
        {isDraggingItem ? (
          <div className="pointer-events-none absolute inset-0 bg-[rgba(255,255,255,0.05)] backdrop-blur-[7px]" />
        ) : null}
      </div>
    )
  }

  function renderBibleQuoteCard(
    index: number,
    item: unknown,
    itemIndex: number,
  ) {
    return (
      <BibleQuoteCard
        key={`${index}-bible-quote-${itemIndex}`}
        blockIndex={index}
        item={item}
        itemIndex={itemIndex}
        dragState={bibleQuoteDragState}
        dragHandleState={bibleQuoteDragHandleState}
        onActivateBlock={activateBlock}
        onUpdateField={updateBibleQuoteField}
        onRemove={removeBibleQuote}
        onDragStart={handleBibleQuoteDragStart}
        onDragEnter={handleBibleQuoteDragEnter}
        onClearDragState={clearBibleQuoteDragState}
        onSetDragHandleState={setBibleQuoteDragHandleState}
        onPushToast={pushToast}
      />
    )
  }

  function renderCanvasCard(
    block: BlockSummary,
    index: number,
    options?: {
      dragHandleProps?: {
        attributes: DraggableAttributes
        listeners: DraggableSyntheticListeners | undefined
      }
      isDragging?: boolean
      isOverlay?: boolean
    },
  ) {
    const isSelected = selectedBlockIndex === index
    const isDragged = options?.isDragging === true
    const dragHandleProps = options?.dragHandleProps
    const blockRecord = asRecord(parsedBlocks[index])
    const type = asString(blockRecord?.t)
    const selectedVideo = findVideoLibraryItem(blockRecord?.videoId)
    const usesRouteVideo = asBoolean(blockRecord?.useRouteVideo)
    const heroPreviewImageUrl = usesRouteVideo
      ? null
      : (selectedVideo?.previewImageUrl ?? null)
    const ctaEnabled = isBlockSwitchEnabled(blockRecord, "ctaEnabled")
    const isRouteVideoHelpOpen = routeVideoHelpBlockKey === block.key

    return (
      <div
        key={block.key}
        onClick={() => activateBlock(index)}
        className={cx(
          "group relative block w-full rounded-sm border text-left transition-[border-color,background-color,box-shadow] duration-[120ms] ease-out",
          isSelected
            ? "border-[var(--color-text-primary)] bg-[var(--color-surface)] shadow-[0_0_0_1px_rgba(255,255,255,0.15)]"
            : "border-[var(--color-hairline)] bg-[var(--color-surface)] hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)]",
          isDragged &&
            "border-[var(--color-brand)] shadow-[0_22px_48px_rgba(0,0,0,0.36)]",
        )}
      >
        <div className="absolute right-3 top-3 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-[120ms] ease-out group-hover:opacity-100">
          <span
            {...dragHandleProps?.attributes}
            {...dragHandleProps?.listeners}
            onClick={(event) => event.stopPropagation()}
            className={cx(
              "flex h-6 w-6 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)]",
              options?.isOverlay
                ? "cursor-grabbing"
                : "cursor-grab touch-none active:cursor-grabbing",
            )}
          >
            <GripVertical className="h-4 w-4" strokeWidth={1.5} />
          </span>
          <span
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              handleDeleteBlock(index)
            }}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:text-[var(--color-danger)]"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          </span>
        </div>

        {block.tone === "hero" ? (
          <div className="overflow-hidden rounded-sm bg-[linear-gradient(160deg,#141110_0%,#221d1b_48%,#100e0d_100%)] p-1">
            <div className="relative rounded-sm border border-[var(--color-hairline-soft)] p-5 text-left">
              <div className="absolute inset-0 overflow-hidden rounded-sm">
                <div
                  className={cx(
                    "absolute inset-0 transition-opacity duration-[220ms] ease-out",
                    heroPreviewImageUrl ? "opacity-100" : "opacity-0",
                  )}
                >
                  {heroPreviewImageUrl ? (
                    <>
                      <div
                        className="absolute inset-0 scale-[1.03] bg-cover bg-center bg-no-repeat opacity-78 blur-md transition-transform duration-[220ms] ease-out"
                        style={{
                          backgroundImage: `url("${heroPreviewImageUrl}")`,
                        }}
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,12,0.22),rgba(6,6,8,0.58))] transition-opacity duration-[220ms] ease-out" />
                    </>
                  ) : null}
                </div>
                <div
                  className={cx(
                    "absolute inset-0 bg-[radial-gradient(circle_at_top,#3a3633_0%,transparent_55%)] transition-opacity duration-[220ms] ease-out",
                    heroPreviewImageUrl ? "opacity-0" : "opacity-100",
                  )}
                />
              </div>
              <div className="relative w-full max-w-xl">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
                  {block.typeLabel}
                </div>
                <div className="mt-3">
                  {renderInlineTextInput(
                    index,
                    "heading",
                    resolveVideoHeroHeading(blockRecord ?? {}),
                    "Hero heading",
                    "title",
                  )}
                </div>
                <div className="mt-3 max-w-xl">
                  {renderInlineTextarea(
                    index,
                    "subheading",
                    resolveVideoHeroSubheading(blockRecord ?? {}),
                    "Hero subheading",
                    1,
                    true,
                  )}
                </div>
                <div
                  className={cx(
                    "flex justify-start overflow-hidden transition-[max-height,opacity,transform,margin] duration-[220ms] ease-out",
                    ctaEnabled
                      ? "mt-6 max-h-20 translate-y-0 opacity-100"
                      : "mt-0 max-h-0 -translate-y-1 opacity-0",
                  )}
                >
                  <div className="inline-flex min-h-10 min-w-[180px] items-center justify-start rounded-pill border border-[rgba(255,255,255,0.26)] bg-[rgba(255,255,255,0.14)] px-5 shadow-[0_18px_40px_rgba(0,0,0,0.26)] backdrop-blur-[6px] transition-all duration-[120ms] ease-out hover:bg-[rgba(255,255,255,0.18)]">
                    {ctaEnabled
                      ? renderInlineTextInput(
                          index,
                          "ctaLabel",
                          asString(blockRecord?.ctaLabel),
                          "Call to action label",
                        )
                      : null}
                  </div>
                </div>
                <div className="mt-6 max-w-2xl">
                  {asBoolean(blockRecord?.useRouteVideo) ? (
                    <div className="flex w-full items-center justify-between gap-4 rounded-sm border border-[var(--color-hairline)] bg-[rgba(8,8,10,0.34)] px-4 py-3 text-left">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[rgba(255,255,255,0.04)] text-[var(--color-text-secondary)]">
                          <Link2 className="h-4 w-4" strokeWidth={1.5} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                            Route video enabled
                          </div>
                          <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                            Uses the video that matches the video slug in the
                            current route.
                          </p>
                        </div>
                      </div>
                      <div
                        className="relative shrink-0"
                        data-route-video-help={block.key}
                      >
                        <button
                          type="button"
                          ref={(node) => {
                            if (node) {
                              routeVideoHelpButtonRefs.current.set(
                                block.key,
                                node,
                              )
                              return
                            }
                            routeVideoHelpButtonRefs.current.delete(block.key)
                          }}
                          onClick={(event) => {
                            event.stopPropagation()
                            setRouteVideoHelpBlockKey((current) =>
                              current === block.key ? null : block.key,
                            )
                          }}
                          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[rgba(255,255,255,0.04)] text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[rgba(255,255,255,0.08)]"
                          aria-label="Route video help"
                          aria-expanded={isRouteVideoHelpOpen}
                          aria-haspopup="dialog"
                        >
                          <Eye className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full items-center justify-between gap-3 rounded-sm border border-[var(--color-hairline)] bg-[rgba(8,8,10,0.34)] px-4 py-3 text-left transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[rgba(12,12,16,0.42)]">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          openVideoPicker(index)
                        }}
                        className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-4 text-left"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[rgba(255,255,255,0.04)] text-[var(--color-text-secondary)]">
                            <Film className="h-4 w-4" strokeWidth={1.5} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                              {selectedVideo
                                ? selectedVideo.title
                                : "Choose video from media library"}
                            </div>
                            <div className="mt-1 truncate text-[12px] leading-5 text-[var(--color-text-secondary)]">
                              {selectedVideo
                                ? `${selectedVideo.id} • ${selectedVideo.sourceLabel} • ${selectedVideo.duration}`
                                : "Browse the library and attach a video to this hero."}
                            </div>
                          </div>
                        </div>
                        <span className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[rgba(255,255,255,0.04)] px-3 text-[12px] font-medium text-[var(--color-text-primary)]">
                          {selectedVideo ? "Video settings" : "Browse library"}
                        </span>
                      </button>
                      {selectedVideo ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            updateBlockAt(index, (currentBlock) => ({
                              ...currentBlock,
                              videoId: "",
                              streamingUrl: "",
                            }))
                          }}
                          className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[rgba(255,255,255,0.04)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[rgba(255,120,120,0.28)] hover:text-[var(--color-danger)]"
                          aria-label="Remove selected video"
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : type === "video" ? (
          <div className="overflow-hidden rounded-sm bg-[linear-gradient(160deg,#141110_0%,#221d1b_48%,#100e0d_100%)] p-1">
            <div className="relative rounded-sm border border-[var(--color-hairline-soft)] p-5 text-left">
              <div className="absolute inset-0 overflow-hidden rounded-sm">
                <div
                  className={cx(
                    "absolute inset-0 transition-opacity duration-[220ms] ease-out",
                    heroPreviewImageUrl ? "opacity-100" : "opacity-0",
                  )}
                >
                  {heroPreviewImageUrl ? (
                    <>
                      <div
                        className="absolute inset-0 scale-[1.03] bg-cover bg-center bg-no-repeat opacity-78 blur-md transition-transform duration-[220ms] ease-out"
                        style={{
                          backgroundImage: `url("${heroPreviewImageUrl}")`,
                        }}
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,12,0.22),rgba(6,6,8,0.58))] transition-opacity duration-[220ms] ease-out" />
                    </>
                  ) : null}
                </div>
                <div
                  className={cx(
                    "absolute inset-0 bg-[radial-gradient(circle_at_top,#3a3633_0%,transparent_55%)] transition-opacity duration-[220ms] ease-out",
                    heroPreviewImageUrl ? "opacity-0" : "opacity-100",
                  )}
                />
              </div>
              <div className="relative w-full max-w-xl">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
                  {block.typeLabel}
                </div>
                <div className="mt-3">
                  {renderInlineTextInput(
                    index,
                    "title",
                    resolveVideoBlockTitle(blockRecord ?? {}),
                    "Video title",
                    "title",
                  )}
                </div>
                <div className="mt-3 max-w-xl">
                  {renderInlineTextarea(
                    index,
                    "subtitle",
                    resolveVideoBlockSubtitle(blockRecord ?? {}),
                    "Video subtitle",
                    1,
                    true,
                  )}
                </div>
                <div className="mt-6 max-w-2xl">
                  {usesRouteVideo ? (
                    <div className="flex w-full items-center justify-between gap-4 rounded-sm border border-[var(--color-hairline)] bg-[rgba(8,8,10,0.34)] px-4 py-3 text-left">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[rgba(255,255,255,0.04)] text-[var(--color-text-secondary)]">
                          <Link2 className="h-4 w-4" strokeWidth={1.5} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                            Route video enabled
                          </div>
                          <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                            Uses the video that matches the video slug in the
                            current route.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full items-center justify-between gap-3 rounded-sm border border-[var(--color-hairline)] bg-[rgba(8,8,10,0.34)] px-4 py-3 text-left transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[rgba(12,12,16,0.42)]">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          openVideoPicker(index)
                        }}
                        className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-4 text-left"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[rgba(255,255,255,0.04)] text-[var(--color-text-secondary)]">
                            <Film className="h-4 w-4" strokeWidth={1.5} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                              {selectedVideo
                                ? selectedVideo.title
                                : "Choose video from media library"}
                            </div>
                            <div className="mt-1 truncate text-[12px] leading-5 text-[var(--color-text-secondary)]">
                              {selectedVideo
                                ? `${selectedVideo.id} • ${selectedVideo.sourceLabel} • ${selectedVideo.duration}`
                                : "Browse the library and attach a video to this block."}
                            </div>
                          </div>
                        </div>
                        <span className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[rgba(255,255,255,0.04)] px-3 text-[12px] font-medium text-[var(--color-text-primary)]">
                          {selectedVideo ? "Video settings" : "Browse library"}
                        </span>
                      </button>
                      {selectedVideo ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            updateBlockAt(index, (currentBlock) => ({
                              ...currentBlock,
                              videoId: "",
                              streamingUrl: "",
                            }))
                          }}
                          className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[rgba(255,255,255,0.04)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[rgba(255,120,120,0.28)] hover:text-[var(--color-danger)]"
                          aria-label="Remove selected video"
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : block.tone === "quote" ? (
          <div className="border-l-2 border-white/20 px-6 py-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
              {block.typeLabel}
            </div>
            <div className="mt-3">
              {renderInlineTextInput(
                index,
                "heading",
                asString(blockRecord?.heading),
                "Quotes heading",
                "title",
              )}
            </div>
            <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">
              {block.body}
            </p>
          </div>
        ) : block.tone === "grid" ? (
          <div className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                  {block.typeLabel}
                </div>
                <div className="mt-2">
                  {renderInlineTextInput(
                    index,
                    type === "infoBlocks"
                      ? "heading"
                      : type === "mediaCollection" || type === "videoCarousel"
                        ? "title"
                        : "title",
                    type === "infoBlocks"
                      ? asString(blockRecord?.heading)
                      : asString(blockRecord?.title),
                    `${block.typeLabel} title`,
                    "title",
                  )}
                </div>
                <div className="mt-2">
                  {renderInlineTextarea(
                    index,
                    type === "mediaCollection" || type === "videoCarousel"
                      ? type === "videoCarousel"
                        ? "subtitle"
                        : "description"
                      : type === "infoBlocks"
                        ? "description"
                        : "description",
                    type === "mediaCollection" || type === "videoCarousel"
                      ? type === "videoCarousel"
                        ? asString(blockRecord?.subtitle)
                        : asString(blockRecord?.description)
                      : asString(blockRecord?.description),
                    type === "videoCarousel"
                      ? `${block.typeLabel} subtitle`
                      : `${block.typeLabel} description`,
                    type === "videoCarousel" ? 1 : 3,
                    type === "videoCarousel",
                  )}
                </div>
                {type === "videoCarousel" ? (
                  <div className="mt-2">
                    {renderInlineTextarea(
                      index,
                      "description",
                      asString(blockRecord?.description),
                      `${block.typeLabel} description`,
                      1,
                      true,
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            {type === "videoCarousel" ? (
              <div className="space-y-3">
                <div
                  className={cx(
                    "flex items-center justify-between gap-3 transition-[max-height,opacity,transform,margin] duration-[180ms] ease-out",
                    selectedBlockIndex === index
                      ? "mb-0 max-h-12 translate-y-0 opacity-100"
                      : "-mt-1 max-h-0 -translate-y-1 opacity-0",
                  )}
                >
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                    {asString(blockRecord?.itemsSource) === "routeVideoChildren"
                      ? "Source: Route video children"
                      : "Carousel videos"}
                  </div>
                  {asString(blockRecord?.itemsSource) !==
                  "routeVideoChildren" ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        openVideoPicker(index, "carouselAppend")
                      }}
                      className={cx(
                        "inline-flex h-9 items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-[180ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]",
                        selectedBlockIndex === index
                          ? "translate-y-0 cursor-pointer opacity-100"
                          : "pointer-events-none -translate-y-1 opacity-0",
                      )}
                    >
                      <Plus className="h-4 w-4" strokeWidth={1.5} />
                      Add from media library
                    </button>
                  ) : null}
                </div>
                {asString(blockRecord?.itemsSource) === "routeVideoChildren" ? (
                  <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-4 py-4 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                    This carousel will pull descendant videos from the current
                    route video instead of using a manually curated list.
                  </div>
                ) : asArray(blockRecord?.items).length > 0 ? (
                  <div className="grid">
                    <div
                      className={cx(
                        "grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-[260ms] ease-out",
                        selectedBlockIndex === index
                          ? "grid-rows-[1fr] translate-y-0 opacity-100"
                          : "grid-rows-[0fr] -translate-y-1 opacity-0",
                      )}
                    >
                      <div className="min-h-0">
                        <div className="space-y-3">
                          {asArray(blockRecord?.items).map((item, itemIndex) =>
                            renderVideoCarouselItemCard(
                              index,
                              item,
                              itemIndex,
                              true,
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                    <div
                      className={cx(
                        "grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-[260ms] ease-out",
                        selectedBlockIndex === index
                          ? "grid-rows-[0fr] translate-y-1 opacity-0"
                          : "grid-rows-[1fr] translate-y-0 opacity-100",
                      )}
                    >
                      <div className="min-h-0">
                        <div className="grid gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))_auto]">
                          {asArray(blockRecord?.items)
                            .slice(0, 2)
                            .map((item, itemIndex) =>
                              renderVideoCarouselItemCard(
                                index,
                                item,
                                itemIndex,
                                false,
                              ),
                            )}
                          {asArray(blockRecord?.items).length > 2 ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                activateBlock(index)
                              }}
                              className="flex min-h-[148px] cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-5 text-center"
                            >
                              <span className="text-[26px] font-semibold tracking-[-0.04em] text-[var(--color-text-primary)]">
                                +{asArray(blockRecord?.items).length - 2}
                              </span>
                              <span className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
                                more videos
                              </span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-sm border border-dashed border-[var(--color-hairline)] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] px-5 py-8">
                    <div className="flex max-w-[420px] items-start gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]">
                        <Clapperboard className="h-5 w-5" strokeWidth={1.5} />
                      </div>
                      <div>
                        <div className="text-[16px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
                          Build this carousel from the media library
                        </div>
                        <div className="mt-2 text-[12px] leading-6 text-[var(--color-text-secondary)]">
                          Add feature films or other videos, then reorder them
                          and tailor each title, subtitle, and image directly on
                          the canvas.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                {block.badges.length > 0
                  ? block.badges.map((badge) => (
                      <div
                        key={`${block.key}-${badge}`}
                        className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-3 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)]"
                      >
                        {badge}
                      </div>
                    ))
                  : [0, 1, 2].map((item) => (
                      <div
                        key={`${block.key}-${item}`}
                        className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-3 py-6"
                      />
                    ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                  {block.typeLabel}
                </div>
                <div className="mt-2">
                  {type === "text"
                    ? renderInlineTextInput(
                        index,
                        "heading",
                        asString(blockRecord?.heading),
                        "Text heading",
                        "title",
                      )
                    : renderInlineTextInput(
                        index,
                        type === "cta"
                          ? "heading"
                          : type === "promoBanner"
                            ? "heading"
                            : type === "relatedQuestions"
                              ? "heading"
                              : type === "bibleQuotesCarousel"
                                ? "heading"
                                : type === "easterDates"
                                  ? "easterDatesTitle"
                                  : "title",
                        type === "cta"
                          ? asString(blockRecord?.heading)
                          : type === "promoBanner"
                            ? asString(blockRecord?.heading)
                            : type === "relatedQuestions"
                              ? asString(blockRecord?.heading)
                              : type === "bibleQuotesCarousel"
                                ? asString(blockRecord?.heading)
                                : type === "easterDates"
                                  ? asString(blockRecord?.easterDatesTitle)
                                  : asString(blockRecord?.title),
                        `${block.typeLabel} title`,
                        "title",
                      )}
                </div>
                <div className="mt-2">
                  {type === "text" ? (
                    renderInlineTextarea(
                      index,
                      "subtitle",
                      asString(blockRecord?.subtitle),
                      "Subtitle",
                      1,
                      true,
                    )
                  ) : type === "cta" ? (
                    renderInlineTextarea(
                      index,
                      "body",
                      asString(blockRecord?.body),
                      "Supporting description",
                      1,
                      true,
                    )
                  ) : type === "video" ? (
                    renderInlineTextarea(
                      index,
                      "subtitle",
                      asString(blockRecord?.subtitle),
                      "Subtitle",
                      2,
                    )
                  ) : type === "promoBanner" ? (
                    renderInlineTextarea(
                      index,
                      "description",
                      asString(blockRecord?.description),
                      "Banner copy",
                      3,
                    )
                  ) : type === "adventCountdown" ? (
                    renderInlineTextarea(
                      index,
                      "scripture",
                      asString(blockRecord?.scripture),
                      "Scripture",
                      3,
                    )
                  ) : type === "relatedQuestions" ||
                    type === "bibleQuotesCarousel" ? null : (
                    <p className="text-[13px] leading-6 text-[var(--color-text-secondary)]">
                      {block.body}
                    </p>
                  )}
                </div>
                {type === "text" ? (
                  <div className="mt-2">
                    {renderInlineParagraphsTextarea(
                      index,
                      asArray(blockRecord?.contentParagraphs).filter(
                        (item): item is string => typeof item === "string",
                      ),
                      "Paragraphs, one per line",
                      1,
                      true,
                    )}
                  </div>
                ) : null}
                {type === "cta" ? (
                  <div className="mt-5">
                    <div className="inline-flex min-h-10 min-w-[180px] items-center justify-start rounded-pill border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-5 transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-inset)]">
                      {renderInlineTextInput(
                        index,
                        "buttonLabel",
                        asString(blockRecord?.buttonLabel),
                        "Call to action label",
                      )}
                    </div>
                  </div>
                ) : null}
                {type === "bibleQuotesCarousel" ? (
                  <div className="mt-4">
                    <div
                      className={cx(
                        "mb-3 flex items-center justify-between gap-3 transition-[max-height,opacity,transform,margin] duration-[180ms] ease-out",
                        selectedBlockIndex === index
                          ? "max-h-12 translate-y-0 opacity-100"
                          : "-mb-1 max-h-0 -translate-y-1 opacity-0",
                      )}
                    >
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Featured quotes
                      </div>
                      {selectedBlockIndex === index ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            appendBibleQuote(index)
                          }}
                          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]"
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.5} />
                          Add another quote
                        </button>
                      ) : null}
                    </div>
                    <div className="grid">
                      <div
                        className={cx(
                          "grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-[260ms] ease-out",
                          selectedBlockIndex === index
                            ? "grid-rows-[1fr] translate-y-0 opacity-100"
                            : "grid-rows-[0fr] -translate-y-1 opacity-0",
                        )}
                      >
                        <div className="min-h-0">
                          {asArray(blockRecord?.quotes).length > 0 ? (
                            <div className="space-y-3">
                              {asArray(blockRecord?.quotes).map(
                                (item, itemIndex) =>
                                  renderBibleQuoteCard(index, item, itemIndex),
                              )}
                            </div>
                          ) : (
                            <div className="rounded-sm border border-dashed border-[var(--color-hairline)] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] px-5 py-8">
                              <div className="flex max-w-[420px] items-start gap-4">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]">
                                  <MessageSquareQuote
                                    className="h-5 w-5"
                                    strokeWidth={1.5}
                                  />
                                </div>
                                <div>
                                  <div className="text-[16px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
                                    Build this section from featured quotes
                                  </div>
                                  <div className="mt-2 text-[12px] leading-6 text-[var(--color-text-secondary)]">
                                    Add scripture references, quote text,
                                    attribution, backgrounds, and optional
                                    call-to-action buttons.
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div
                        className={cx(
                          "grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-[260ms] ease-out",
                          selectedBlockIndex === index
                            ? "grid-rows-[0fr] translate-y-1 opacity-0"
                            : "grid-rows-[1fr] translate-y-0 opacity-100",
                        )}
                      >
                        <div className="min-h-0">
                          {asArray(blockRecord?.quotes).length > 0 ? (
                            <div className="grid gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))_auto]">
                              {asArray(blockRecord?.quotes)
                                .slice(0, 2)
                                .map((item, itemIndex) => {
                                  const itemRecord = asRecord(item)
                                  const previewImageUrl =
                                    asString(itemRecord?.backgroundImageUrl) ||
                                    asString(itemRecord?.imageUrl)
                                  const backgroundColor =
                                    asString(itemRecord?.backgroundColor) ||
                                    "#151515"
                                  return (
                                    <div
                                      key={`${block.key}-quote-preview-${itemIndex}`}
                                      className="relative min-h-[180px] overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)]"
                                      style={{ backgroundColor }}
                                    >
                                      {previewImageUrl ? (
                                        <>
                                          <div
                                            className="absolute inset-0 bg-cover bg-center opacity-70"
                                            style={{
                                              backgroundImage: `url("${previewImageUrl}")`,
                                            }}
                                          />
                                          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.32),rgba(0,0,0,0.72))]" />
                                        </>
                                      ) : (
                                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_48%)]" />
                                      )}
                                      <div className="relative flex min-h-[180px] flex-col justify-end p-4 text-white">
                                        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">
                                          {asString(itemRecord?.reference) ||
                                            "Reference"}
                                        </div>
                                        <div className="mt-2 line-clamp-3 text-[15px] font-medium leading-6 tracking-[-0.02em]">
                                          {asString(itemRecord?.text) ||
                                            "Quote text"}
                                        </div>
                                        {asString(itemRecord?.attribution) ? (
                                          <div className="mt-3 text-[12px] text-white/72">
                                            {asString(itemRecord?.attribution)}
                                          </div>
                                        ) : null}
                                        {isBlockSwitchEnabled(
                                          itemRecord,
                                          "ctaEnabled",
                                        ) ? (
                                          <div className="mt-4 inline-flex h-8 w-fit items-center rounded-pill border border-white/22 bg-white/14 px-3 text-[11px] font-medium text-white backdrop-blur-[4px]">
                                            {asString(itemRecord?.ctaLabel) ||
                                              "Read more"}
                                          </div>
                                        ) : null}
                                      </div>
                                    </div>
                                  )
                                })}
                              {asArray(blockRecord?.quotes).length > 2 ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    activateBlock(index)
                                  }}
                                  className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-5 text-center"
                                >
                                  <span className="text-[26px] font-semibold tracking-[-0.04em] text-[var(--color-text-primary)]">
                                    +{asArray(blockRecord?.quotes).length - 2}
                                  </span>
                                  <span className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
                                    more quotes
                                  </span>
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <div className="rounded-sm border border-dashed border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-4 py-5 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                              Select this block to add featured Bible quotes.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                {type === "relatedQuestions" ? (
                  <div className="mt-4">
                    <div
                      className={cx(
                        "mb-3 flex items-center justify-between gap-3 transition-[max-height,opacity,transform,margin] duration-[180ms] ease-out",
                        selectedBlockIndex === index
                          ? "max-h-12 translate-y-0 opacity-100"
                          : "-mb-1 max-h-0 -translate-y-1 opacity-0",
                      )}
                    >
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Questions and answers
                      </div>
                      {selectedBlockIndex === index ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            appendRelatedQuestion(index)
                          }}
                          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]"
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.5} />
                          Add another question
                        </button>
                      ) : null}
                    </div>
                    <div className="grid">
                      <div
                        className={cx(
                          "grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-[260ms] ease-out",
                          selectedBlockIndex === index
                            ? "grid-rows-[1fr] translate-y-0 opacity-100"
                            : "grid-rows-[0fr] -translate-y-1 opacity-0",
                        )}
                      >
                        <div className="min-h-0">
                          <div className="space-y-3">
                            {asArray(blockRecord?.questions).map(
                              (item, itemIndex) =>
                                renderRelatedQuestionCard(
                                  index,
                                  item,
                                  itemIndex,
                                ),
                            )}
                          </div>
                        </div>
                      </div>
                      <div
                        className={cx(
                          "grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-[260ms] ease-out",
                          selectedBlockIndex === index
                            ? "grid-rows-[0fr] translate-y-1 opacity-0"
                            : "grid-rows-[1fr] translate-y-0 opacity-100",
                        )}
                      >
                        <div className="min-h-0">
                          <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)]">
                            <div className="divide-y divide-[var(--color-hairline)]">
                              {asArray(blockRecord?.questions)
                                .slice(0, 3)
                                .map((item, itemIndex) => {
                                  const itemRecord = asRecord(item)
                                  return (
                                    <div
                                      key={`${block.key}-question-preview-${itemIndex}`}
                                      className="px-4 py-3 text-[13px] font-medium text-[var(--color-text-primary)]"
                                    >
                                      {asString(itemRecord?.question) ||
                                        "Untitled question"}
                                    </div>
                                  )
                                })}
                            </div>
                            {asArray(blockRecord?.questions).length > 3 ? (
                              <div className="border-t border-[var(--color-hairline)] px-4 py-3 text-[12px] leading-5 text-[var(--color-text-muted)]">
                                There are{" "}
                                {asArray(blockRecord?.questions).length - 3}{" "}
                                other questions in this block.
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                {type === "relatedQuestions" &&
                isBlockSwitchEnabled(blockRecord, "ctaEnabled") ? (
                  <div className="mt-5">
                    <div className="inline-flex min-h-10 min-w-[180px] items-center justify-start rounded-pill border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-5 transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-inset)]">
                      {renderInlineTextInput(
                        index,
                        "ctaLabel",
                        asString(blockRecord?.ctaLabel),
                        "Call to action label",
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            {block.badges.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {block.badges.map((badge) => (
                  <span
                    key={`${block.key}-${badge}`}
                    className="inline-flex rounded-pill border border-[var(--color-hairline)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  const routeVideoHelpPopover =
    routeVideoHelpRendered &&
    routeVideoHelpPosition !== null &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            className={cx(
              "pointer-events-none fixed z-[80] w-[240px] rounded-sm border border-[var(--color-hairline)] bg-[color-mix(in_oklab,var(--color-surface)_96%,black)] px-3 py-2 text-[12px] leading-5 text-[var(--color-text-secondary)] shadow-[0_18px_48px_rgba(0,0,0,0.42)] transition-all duration-[180ms] ease-out",
              routeVideoHelpVisible
                ? "translate-y-0 scale-100 opacity-100"
                : "-translate-y-1 scale-[0.98] opacity-0",
            )}
            style={{
              top: routeVideoHelpPosition.top,
              left: routeVideoHelpPosition.left,
            }}
          >
            The hero will use whichever video matches the slug in the current
            video route instead of the manually picked library video.
          </div>,
          document.body,
        )
      : null

  function renderInspectorFields() {
    if (!selectedBlockRecord || selectedBlockIndex === null) {
      return (
        <div className="rounded-sm border border-dashed border-[var(--color-hairline)] p-4 text-[13px] text-[var(--color-text-muted)]">
          Select a block in the canvas to edit its settings here.
        </div>
      )
    }

    const type = selectedBlockType
    const selectClass = `${fieldClassName()} pr-8`

    const input = (label: string, field: string) => (
      <label className="grid gap-1.5">
        <span className="label-text">{label}</span>
        <input
          value={asString(selectedBlockRecord[field])}
          onChange={(event) =>
            updateSelectedStringField(field, event.target.value)
          }
          className={fieldClassName()}
        />
      </label>
    )

    const numberInput = (label: string, field: string) => (
      <label className="grid gap-1.5">
        <span className="label-text">{label}</span>
        <input
          value={
            selectedBlockRecord[field] === null ||
            selectedBlockRecord[field] === undefined
              ? ""
              : String(selectedBlockRecord[field])
          }
          onChange={(event) =>
            updateSelectedNumberField(field, event.target.value)
          }
          className={fieldClassName()}
          inputMode="numeric"
        />
      </label>
    )

    const checkbox = (
      label: string,
      field: string,
      description?: string,
      defaultChecked = false,
    ) =>
      renderSwitch({
        label,
        description,
        checked:
          selectedBlockRecord[field] === undefined
            ? defaultChecked
            : asBoolean(selectedBlockRecord[field]),
        onChange: (checked) => updateSelectedBooleanField(field, checked),
      })

    const select = (label: string, field: string, options: string[]) => (
      <label className="grid gap-1.5">
        <span className="label-text">{label}</span>
        <select
          value={asString(selectedBlockRecord[field])}
          onChange={(event) =>
            updateSelectedStringField(field, event.target.value)
          }
          className={selectClass}
        >
          <option value="">Select</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    )

    const optionList = (label: string, field: string, options: string[]) => (
      <div className="grid gap-1.5">
        <span className="label-text">{label}</span>
        <div className="overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)]">
          {options.map((option, optionIndex) => {
            const selected = asString(selectedBlockRecord[field]) === option
            return (
              <button
                key={option}
                type="button"
                onClick={() => updateSelectedStringField(field, option)}
                className={cx(
                  "flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left text-[12px] transition-colors duration-[120ms] ease-out",
                  optionIndex > 0 && "border-t border-[var(--color-hairline)]",
                  selected
                    ? "bg-[color-mix(in_oklab,var(--color-brand)_10%,var(--color-surface))] text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]",
                )}
              >
                <span className="font-medium capitalize text-inherit">
                  {option}
                </span>
                <span
                  className={cx(
                    "h-2.5 w-2.5 rounded-full transition-colors duration-[120ms] ease-out",
                    selected
                      ? "bg-[var(--color-brand)]"
                      : "bg-[var(--color-hairline-strong)]",
                  )}
                />
              </button>
            )
          })}
        </div>
      </div>
    )

    return (
      <div className="space-y-3">
        {type === "videoHero" ? (
          <>
            {findVideoLibraryItem(selectedBlockRecord.videoId) &&
            (asString(selectedBlockRecord.headingSource) === "manual" ||
              asString(selectedBlockRecord.subheadingSource) === "manual") ? (
              <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3">
                <button
                  type="button"
                  onClick={() =>
                    updateBlockAt(selectedBlockIndex, (block) => ({
                      ...block,
                      headingSource: "videoTitle",
                      subheadingSource: "videoDescription",
                      heading: "",
                      subheading: "",
                    }))
                  }
                  className="flex w-full cursor-pointer items-start justify-between gap-3 text-left transition-colors duration-[120ms] ease-out hover:text-[var(--color-text-primary)]"
                >
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-[var(--color-text-primary)]">
                      Restore video metadata
                    </span>
                    <span className="mt-1 block text-[12px] leading-5 text-[var(--color-text-muted)]">
                      Use the selected video&apos;s localized title and
                      description again for this hero.
                    </span>
                  </span>
                  <span className="inline-flex h-8 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-3 text-[12px] font-medium text-[var(--color-text-primary)]">
                    Restore
                  </span>
                </button>
              </div>
            ) : null}
            <div className="overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)]">
              <button
                type="button"
                onClick={() =>
                  updateSelectedBooleanField(
                    "ctaEnabled",
                    !isBlockSwitchEnabled(selectedBlockRecord, "ctaEnabled"),
                  )
                }
                className="flex w-full cursor-pointer items-start justify-between gap-3 px-3 py-3 text-left transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)]"
              >
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium text-[var(--color-text-primary)]">
                    Show call to action
                  </span>
                  <span className="mt-1 block text-[12px] leading-5 text-[var(--color-text-muted)]">
                    Display a call-to-action button inside the hero using the
                    inline label and destination link.
                  </span>
                </span>
                <span
                  className={cx(
                    "mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-pill border px-0.5 transition-all duration-[160ms] ease-out",
                    switchTrackClass(
                      isBlockSwitchEnabled(selectedBlockRecord, "ctaEnabled"),
                    ),
                  )}
                >
                  <span className="h-5 w-5 rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.24)]" />
                </span>
              </button>
              <div
                className={cx(
                  "overflow-hidden border-t border-[var(--color-hairline)] bg-[color-mix(in_oklab,var(--color-surface-inset)_72%,black)] transition-[grid-template-rows,opacity] duration-[220ms] ease-out grid",
                  isBlockSwitchEnabled(selectedBlockRecord, "ctaEnabled")
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0",
                )}
              >
                <div className="min-h-0">
                  <div className="p-3">
                    {input("Call to Action Link", "ctaLink")}
                  </div>
                </div>
              </div>
            </div>
            {checkbox(
              "Use route video",
              "useRouteVideo",
              "When this experience is mounted on a video slug route, the hero uses that route's video instead of a manually selected library item.",
            )}
            {asBoolean(selectedBlockRecord.useRouteVideo) ? (
              <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 py-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                Route video is best for reusable experience templates that sit
                on top of pre-existing video paths. If the route does not
                provide a video context, this hero will not have a manually
                selected fallback here.
              </div>
            ) : (
              <div className="flex w-full items-center justify-between gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 py-3 text-left transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]">
                <button
                  type="button"
                  onClick={() => openVideoPicker(selectedBlockIndex)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-[var(--color-text-primary)]">
                      Selected video
                    </span>
                    <span className="mt-1 block text-[12px] leading-5 text-[var(--color-text-muted)]">
                      {findVideoLibraryItem(selectedBlockRecord.videoId)
                        ? `${findVideoLibraryItem(selectedBlockRecord.videoId)?.title} · ${findVideoLibraryItem(selectedBlockRecord.videoId)?.id}`
                        : "Choose a video from the media library for this hero."}
                    </span>
                  </span>
                  <span className="inline-flex h-8 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-3 text-[12px] font-medium text-[var(--color-text-primary)]">
                    {findVideoLibraryItem(selectedBlockRecord.videoId)
                      ? "Video settings"
                      : "Browse"}
                  </span>
                </button>
                {findVideoLibraryItem(selectedBlockRecord.videoId) ? (
                  <button
                    type="button"
                    onClick={() => {
                      updateSelectedStringField("videoId", "")
                      updateSelectedStringField("streamingUrl", "")
                    }}
                    className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[rgba(255,120,120,0.28)] hover:text-[var(--color-danger)]"
                    aria-label="Remove selected video"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                ) : null}
              </div>
            )}
          </>
        ) : null}

        {type === "video" ? (
          <>
            {findVideoLibraryItem(selectedBlockRecord.videoId) &&
            (asString(selectedBlockRecord.titleSource) === "manual" ||
              asString(selectedBlockRecord.subtitleSource) === "manual") ? (
              <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3">
                <button
                  type="button"
                  onClick={() =>
                    updateBlockAt(selectedBlockIndex, (block) => ({
                      ...block,
                      titleSource: "videoTitle",
                      subtitleSource: "videoDescription",
                      title: "",
                      subtitle: "",
                    }))
                  }
                  className="flex w-full cursor-pointer items-start justify-between gap-3 text-left transition-colors duration-[120ms] ease-out hover:text-[var(--color-text-primary)]"
                >
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-[var(--color-text-primary)]">
                      Restore video metadata
                    </span>
                    <span className="mt-1 block text-[12px] leading-5 text-[var(--color-text-muted)]">
                      Use the selected video&apos;s localized title and
                      description again for this block.
                    </span>
                  </span>
                  <span className="inline-flex h-8 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-3 text-[12px] font-medium text-[var(--color-text-primary)]">
                    Restore
                  </span>
                </button>
              </div>
            ) : null}
            {checkbox(
              "Use route video",
              "useRouteVideo",
              "When this experience is mounted on a video slug route, the block uses that route's video instead of a manually selected library item.",
            )}
            {asBoolean(selectedBlockRecord.useRouteVideo) ? (
              <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 py-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                Route video is best for reusable experience templates that sit
                on top of pre-existing video paths. If the route does not
                provide a video context, this block will not have a manually
                selected fallback here.
              </div>
            ) : (
              <div className="flex w-full items-center justify-between gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 py-3 text-left transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]">
                <button
                  type="button"
                  onClick={() => openVideoPicker(selectedBlockIndex)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-[var(--color-text-primary)]">
                      Selected video
                    </span>
                    <span className="mt-1 block text-[12px] leading-5 text-[var(--color-text-muted)]">
                      {findVideoLibraryItem(selectedBlockRecord.videoId)
                        ? `${findVideoLibraryItem(selectedBlockRecord.videoId)?.title} · ${findVideoLibraryItem(selectedBlockRecord.videoId)?.id}`
                        : "Choose a video from the media library for this block."}
                    </span>
                  </span>
                  <span className="inline-flex h-8 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-3 text-[12px] font-medium text-[var(--color-text-primary)]">
                    {findVideoLibraryItem(selectedBlockRecord.videoId)
                      ? "Video settings"
                      : "Browse"}
                  </span>
                </button>
                {findVideoLibraryItem(selectedBlockRecord.videoId) ? (
                  <button
                    type="button"
                    onClick={() => {
                      updateSelectedStringField("videoId", "")
                      updateSelectedStringField("streamingUrl", "")
                    }}
                    className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[rgba(255,120,120,0.28)] hover:text-[var(--color-danger)]"
                    aria-label="Remove selected video"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                ) : null}
              </div>
            )}
          </>
        ) : null}

        {type === "videoCarousel" ? (
          <>
            <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3">
              <button
                type="button"
                onClick={() =>
                  updateBlockAt(selectedBlockIndex, (block) => ({
                    ...block,
                    itemsSource:
                      asString(block.itemsSource) === "routeVideoChildren"
                        ? "manual"
                        : "routeVideoChildren",
                  }))
                }
                className="flex w-full cursor-pointer items-start justify-between gap-3 text-left transition-colors duration-[120ms] ease-out hover:text-[var(--color-text-primary)]"
              >
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium text-[var(--color-text-primary)]">
                    Use route video children
                  </span>
                  <span className="mt-1 block text-[12px] leading-5 text-[var(--color-text-muted)]">
                    Pull descendant videos from the current route video instead
                    of curating the carousel manually.
                  </span>
                </span>
                <span
                  className={cx(
                    "mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-pill border px-0.5 transition-all duration-[160ms] ease-out",
                    switchTrackClass(
                      asString(selectedBlockRecord.itemsSource) ===
                        "routeVideoChildren",
                    ),
                  )}
                >
                  <span className="h-5 w-5 rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.24)]" />
                </span>
              </button>
            </div>
          </>
        ) : null}

        {type === "mediaCollection" ? (
          <>
            {input("Category Label", "categoryLabel")}
            {input("Subtitle", "subtitle")}
            {input("CTA Label", "ctaLabel")}
            {input("CTA Link", "ctaLink")}
            {input("Footer Text", "footerText")}
            {select("Variant", "variant", [
              "carousel",
              "grid",
              "collection",
              "hero",
              "player",
            ])}
            {select("Items Source", "itemsSource", [
              "manual",
              "routeVideoChildren",
            ])}
            {checkbox("Show Item Numbers", "showItemNumbers")}
          </>
        ) : null}

        {type === "text" ? (
          <>
            {optionList("Style", "variant", ["default", "lead", "small"])}
            {select("Heading Level", "headingLevel", [
              "h1",
              "h2",
              "h3",
              "h4",
              "h5",
              "h6",
            ])}
          </>
        ) : null}

        {type === "cta" ? (
          <>
            {input("Call to Action Link", "buttonLink")}
            {optionList("Style", "variant", ["primary", "secondary"])}
          </>
        ) : null}

        {type === "infoBlocks" ? (
          <>
            {input("Intro", "intro")}
            {numberInput("Width Percent", "widthPercent")}
          </>
        ) : null}

        {type === "card" ? (
          <>
            {input("Link", "link")}
            {input("Media Url", "mediaUrl")}
            {optionList("Layout", "variant", ["default", "featured"])}
          </>
        ) : null}

        {type === "relatedQuestions" ? (
          <>
            <div className="overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)]">
              <button
                type="button"
                onClick={() =>
                  updateSelectedBooleanField(
                    "ctaEnabled",
                    !isBlockSwitchEnabled(selectedBlockRecord, "ctaEnabled"),
                  )
                }
                className="flex w-full cursor-pointer items-start justify-between gap-3 px-3 py-3 text-left transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)]"
              >
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium text-[var(--color-text-primary)]">
                    Show call to action
                  </span>
                  <span className="mt-1 block text-[12px] leading-5 text-[var(--color-text-muted)]">
                    Display a call-to-action button inside the related questions
                    block using the inline label and destination link.
                  </span>
                </span>
                <span
                  className={cx(
                    "mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-pill border px-0.5 transition-all duration-[160ms] ease-out",
                    switchTrackClass(
                      isBlockSwitchEnabled(selectedBlockRecord, "ctaEnabled"),
                    ),
                  )}
                >
                  <span className="h-5 w-5 rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.24)]" />
                </span>
              </button>
              <div
                className={cx(
                  "grid overflow-hidden border-t border-[var(--color-hairline)] bg-[color-mix(in_oklab,var(--color-surface-inset)_72%,black)] transition-[grid-template-rows,opacity] duration-[220ms] ease-out",
                  isBlockSwitchEnabled(selectedBlockRecord, "ctaEnabled")
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0",
                )}
              >
                <div className="min-h-0">
                  <div className="space-y-3 p-3">
                    {input("Call to Action Link", "ctaLink")}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {type === "navigationCarousel" ? (
          <div className="rounded-sm border border-[var(--color-hairline)] px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
            Navigation items are edited in the JSON field below.
          </div>
        ) : null}

        {type === "promoBanner" ? (
          <>
            {input("Intro", "intro")}
            {input("CTA Link", "ctaLink")}
            {numberInput("Width Percent", "widthPercent")}
          </>
        ) : null}

        {type === "section" ? (
          <>
            {select("Background Color", "backgroundColor", [
              "default",
              "light",
              "dark",
              "primary",
              "cosmic",
              "purple",
            ])}
            {input("Blur Hash", "blurHash")}
            {numberInput("Background Opacity", "backgroundOpacity")}
            {checkbox("Dynamic Background Image", "dynamicBackgroundImage")}
            {checkbox("Static Overlay", "staticOverlay")}
          </>
        ) : null}

        {type === "container" ? (
          <div className="rounded-sm border border-[var(--color-hairline)] px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
            Container slot composition is edited in the JSON field below.
          </div>
        ) : null}

        {type === "easterDates" ? (
          <>
            {input("Western Easter Label", "westernEasterLabel")}
            {input("Orthodox Easter Label", "orthodoxEasterLabel")}
            {input("Passover Label", "passoverLabel")}
            {input("Locale", "locale")}
          </>
        ) : null}

        {type === "adventCountdown" ? (
          <>
            {input("Scripture Reference", "scriptureReference")}
            {input("Locale", "locale")}
          </>
        ) : null}
      </div>
    )
  }

  function handleRestoreRevision(revisionId: string) {
    setRestoreRevisionId(revisionId)
  }

  function handleDeleteBlock(index: number) {
    setDeleteBlockIndex(index)
  }

  function confirmDeleteBlock() {
    if (deleteBlockIndex === null) return
    removeBlock(deleteBlockIndex)
    setDeleteBlockIndex(null)
  }

  function confirmRestoreRevision() {
    if (!restoreRevisionId) return

    startTransition(() => {
      void (async () => {
        const result = await restoreAction(restoreRevisionId)
        if (!result.ok) {
          pushToast(result.error ?? "Unable to restore revision.", "error")
          return
        }
        setRestoreRevisionId(null)
        pushToast("Revision restored.", "success")
        router.refresh()
      })()
    })
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] overflow-hidden bg-[var(--color-surface)]">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {routeVideoHelpPopover}

      <ConfirmModal
        open={restoreRevisionId !== null}
        title="Restore This Revision?"
        description="This will replace your current draft with the selected revision. Any unsaved changes in the editor will be lost."
        confirmLabel="Restore Revision"
        pending={isPending}
        onCancel={() => setRestoreRevisionId(null)}
        onConfirm={confirmRestoreRevision}
      />
      <ConfirmModal
        open={deleteBlockIndex !== null}
        title="Delete This Block?"
        description="This will remove the selected block from the current draft."
        confirmLabel="Delete Block"
        pending={isPending}
        onCancel={() => setDeleteBlockIndex(null)}
        onConfirm={confirmDeleteBlock}
      />
      <div
        className={cx(
          "fixed inset-0 z-50 flex items-center justify-center px-4 transition-all duration-180 ease-out sm:px-6",
          videoPickerBlockIndex !== null
            ? "pointer-events-auto bg-[rgba(4,6,10,0.78)] backdrop-blur-[8px]"
            : "pointer-events-none bg-[rgba(4,6,10,0)] backdrop-blur-0",
        )}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return
          closeVideoPicker()
        }}
        role="presentation"
        aria-hidden={videoPickerBlockIndex === null}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="video-library-title"
          className={cx(
            "flex h-[min(86vh,860px)] w-full flex-col overflow-hidden rounded-sm border border-[var(--color-hairline-strong)] bg-[color-mix(in_oklab,var(--color-surface)_96%,black)] p-5 shadow-[0_32px_120px_rgba(0,0,0,0.58)] transition-[opacity,transform] duration-180 ease-out",
            videoPickerMode === "carouselAppend"
              ? "max-w-[1040px]"
              : "max-w-[1280px]",
            videoPickerBlockIndex !== null
              ? "translate-y-0 scale-100 opacity-100"
              : "translate-y-2 scale-[0.98] opacity-0",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                Media Library
              </div>
              <h2
                id="video-library-title"
                className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]"
              >
                {videoPickerDialogTitle}
              </h2>
              <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--color-text-secondary)]">
                {videoPickerDialogDescription}
              </p>
            </div>
            <button
              type="button"
              onClick={closeVideoPicker}
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>

          <div className="mt-5 grid gap-3 border-b border-[var(--color-hairline)] pb-4 md:grid-cols-[minmax(0,1fr)_160px]">
            <label className="grid gap-1.5">
              <span className="label-text">Search</span>
              <div className="flex h-10 items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3">
                <Search className="h-4 w-4 text-[var(--color-text-muted)]" />
                <input
                  value={videoLibraryQuery}
                  onChange={(event) => setVideoLibraryQuery(event.target.value)}
                  className="w-full border-0 bg-transparent text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]"
                  placeholder="Search title, Core ID, source, or dub coverage"
                />
              </div>
            </label>
            <label className="grid gap-1.5">
              <span className="label-text">Sort</span>
              <select
                value={videoLibrarySort}
                onChange={(event) =>
                  setVideoLibrarySort(
                    event.target.value as "recent" | "title" | "duration",
                  )
                }
                className={`${fieldClassName()} pr-8`}
              >
                <option value="recent">Recently updated</option>
                <option value="title">Title</option>
                <option value="duration">Duration</option>
              </select>
            </label>
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-hidden">
            <div
              className={cx(
                "grid h-full gap-5",
                videoPickerMode === "carouselAppend"
                  ? "lg:grid-cols-[360px_minmax(0,1fr)]"
                  : "lg:grid-cols-[380px_minmax(0,1fr)]",
              )}
            >
              <div className="flex min-h-0 flex-col overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)]">
                <div className="border-b border-[var(--color-hairline)] px-4 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                    Results
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                    {videoPickerMode === "carouselAppend"
                      ? "Choose a media item to preview and add to this carousel."
                      : "Choose a media item to preview and configure on the right."}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-2 [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]">
                  <div className="grid pb-12">
                    {videoPickerLibraryRows.length === 0 ? (
                      <div className="rounded-sm border border-dashed border-[var(--color-hairline)] px-4 py-8 text-center">
                        <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                          No videos match these filters
                        </div>
                        <div className="mt-2 text-[12px] leading-5 text-[var(--color-text-muted)]">
                          Try widening the search or clearing the current query.
                        </div>
                      </div>
                    ) : (
                      videoPickerLibraryRows.map((video) => {
                        const isCurrent =
                          videoPickerSelectedVideo?.key === video.key
                        const isAttachedCurrent =
                          videoPickerCurrentVideo?.key === video.key

                        return (
                          <button
                            key={video.key}
                            type="button"
                            onClick={() =>
                              setVideoPickerDraft((current) => ({
                                ...current,
                                videoKey: video.key,
                              }))
                            }
                            className={cx(
                              "grid w-full min-w-0 cursor-pointer grid-cols-[128px_minmax(0,1fr)] gap-3 overflow-hidden border-b px-4 py-3 text-left transition-all duration-[120ms] ease-out",
                              isCurrent
                                ? "border-[var(--color-brand)] bg-[color-mix(in_oklab,var(--color-brand)_8%,var(--color-surface))]"
                                : "border-[var(--color-hairline)] bg-transparent hover:bg-[color-mix(in_oklab,var(--color-surface)_92%,white)]",
                            )}
                          >
                            <div className="relative aspect-video w-full overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[linear-gradient(180deg,#1c2027,#121419)]">
                              {video.previewImageUrl ? (
                                <div
                                  className="absolute inset-0 bg-cover bg-center"
                                  style={{
                                    backgroundImage: `url("${video.previewImageUrl}")`,
                                  }}
                                />
                              ) : null}
                              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,12,18,0.04),rgba(6,8,12,0.56))]" />
                              <div className="absolute bottom-2 left-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-[rgba(4,6,10,0.56)] text-white backdrop-blur-[4px]">
                                <CirclePlay
                                  className="h-3.5 w-3.5"
                                  strokeWidth={1.5}
                                />
                              </div>
                            </div>
                            <div className="min-w-0 overflow-hidden">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="truncate text-[14px] font-medium text-[var(--color-text-primary)]">
                                  {video.title}
                                </div>
                                {isAttachedCurrent ? (
                                  <span className="inline-flex h-5 shrink-0 items-center rounded-pill border border-[var(--color-brand)]/45 bg-[color-mix(in_oklab,var(--color-brand)_14%,transparent)] px-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--color-brand)]">
                                    Current
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-1 truncate text-[12px] leading-5 text-[var(--color-text-muted)]">
                                {video.id} • {video.duration}
                              </div>
                              <div className="mt-0.5 truncate text-[12px] leading-5 text-[var(--color-text-muted)]">
                                {video.dubs}
                              </div>
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>

              <div className="min-h-0 overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)]">
                {videoPickerSelectedVideo ? (
                  <div
                    className={cx(
                      "h-full p-5",
                      videoPickerMode === "carouselAppend"
                        ? ""
                        : "grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_320px]",
                    )}
                  >
                    <div className="min-w-0 space-y-4">
                      <div className="overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)]">
                        <div
                          ref={videoPickerPreviewContainerRef}
                          className="relative aspect-video cursor-pointer bg-[linear-gradient(180deg,#181c25,#0b0d12)]"
                          onClick={togglePreviewPlayback}
                        >
                          {videoPickerSelectedVideo.previewStreamUrl ? (
                            <>
                              <video
                                key={videoPickerSelectedVideo.key}
                                ref={videoPickerPreviewRef}
                                className="h-full w-full object-cover"
                                src={videoPickerSelectedVideo.previewStreamUrl}
                                poster={
                                  videoPickerSelectedVideo.previewImageUrl ??
                                  undefined
                                }
                                controls={false}
                                muted={previewMuted}
                                loop={false}
                                playsInline
                              />
                              <div
                                className={cx(
                                  "pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-[160ms] ease-out",
                                  previewIsLoading
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              >
                                <div className="flex items-center gap-2 rounded-pill border border-white/15 bg-[rgba(4,6,10,0.58)] px-3 py-1.5 text-[12px] text-white shadow-[0_16px_40px_rgba(0,0,0,0.36)] backdrop-blur-[6px]">
                                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                  Loading preview
                                </div>
                              </div>
                              <div
                                className={cx(
                                  "pointer-events-none absolute inset-0 flex items-center justify-center transition-all duration-[220ms] ease-out",
                                  previewFlashIcon
                                    ? "opacity-100"
                                    : "scale-[0.96] opacity-0",
                                )}
                              >
                                {previewFlashIcon ? (
                                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(4,6,10,0.58)] text-white shadow-[0_20px_48px_rgba(0,0,0,0.4)] backdrop-blur-[6px]">
                                    {previewFlashIcon === "pause" ? (
                                      <Pause
                                        className="h-7 w-7"
                                        strokeWidth={1.8}
                                      />
                                    ) : (
                                      <Play
                                        className="ml-0.5 h-7 w-7"
                                        strokeWidth={1.8}
                                      />
                                    )}
                                  </div>
                                ) : null}
                              </div>
                              <div
                                className={cx(
                                  "absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,rgba(4,6,10,0),rgba(4,6,10,0.82))] px-4 pb-3 pt-10 transition-opacity duration-[180ms] ease-out",
                                  previewControlsVisible || !previewIsPlaying
                                    ? "opacity-100"
                                    : "pointer-events-none opacity-0",
                                )}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      togglePreviewPlayback()
                                    }}
                                    className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-[rgba(255,255,255,0.08)] text-white transition-colors duration-[120ms] ease-out hover:bg-[rgba(255,255,255,0.14)]"
                                    aria-label={
                                      previewIsPlaying
                                        ? "Pause preview"
                                        : "Play preview"
                                    }
                                  >
                                    {previewIsPlaying ? (
                                      <Pause
                                        className="h-4 w-4"
                                        strokeWidth={1.8}
                                      />
                                    ) : (
                                      <Play
                                        className="ml-0.5 h-4 w-4"
                                        strokeWidth={1.8}
                                      />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPreviewMuted((current) => !current)
                                    }
                                    className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-[rgba(255,255,255,0.08)] text-white transition-colors duration-[120ms] ease-out hover:bg-[rgba(255,255,255,0.14)]"
                                    aria-label={
                                      previewMuted
                                        ? "Unmute preview"
                                        : "Mute preview"
                                    }
                                  >
                                    {previewMuted ? (
                                      <VolumeX
                                        className="h-4 w-4"
                                        strokeWidth={1.8}
                                      />
                                    ) : (
                                      <Volume2
                                        className="h-4 w-4"
                                        strokeWidth={1.8}
                                      />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      void togglePreviewFullscreen()
                                    }}
                                    className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-[rgba(255,255,255,0.08)] text-white transition-colors duration-[120ms] ease-out hover:bg-[rgba(255,255,255,0.14)]"
                                    aria-label={
                                      previewIsFullscreen
                                        ? "Exit fullscreen preview"
                                        : "Enter fullscreen preview"
                                    }
                                  >
                                    {previewIsFullscreen ? (
                                      <Minimize2
                                        className="h-4 w-4"
                                        strokeWidth={1.8}
                                      />
                                    ) : (
                                      <Maximize2
                                        className="h-4 w-4"
                                        strokeWidth={1.8}
                                      />
                                    )}
                                  </button>
                                  <span className="w-[44px] shrink-0 font-mono text-[11px] text-white">
                                    {formatSeconds(previewRelativeCurrentTime)}
                                  </span>
                                  <div
                                    ref={videoPickerPreviewProgressRef}
                                    className="relative h-6 flex-1 cursor-pointer"
                                    onClick={(event) => {
                                      const track =
                                        videoPickerPreviewProgressRef.current
                                      const preview =
                                        videoPickerPreviewRef.current
                                      if (
                                        !track ||
                                        !preview ||
                                        previewTrimDuration <= 0
                                      ) {
                                        return
                                      }
                                      const rect = track.getBoundingClientRect()
                                      const ratio = clampNumber(
                                        (event.clientX - rect.left) /
                                          rect.width,
                                        0,
                                        1,
                                      )
                                      const nextRelative =
                                        ratio * previewTrimDuration
                                      preview.currentTime =
                                        videoPickerClipStart + nextRelative
                                      setPreviewCurrentTime(preview.currentTime)
                                    }}
                                  >
                                    <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/20" />
                                    <div
                                      className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white"
                                      style={{
                                        width: `${previewProgressPercent}%`,
                                      }}
                                    />
                                    <div
                                      className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-white shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
                                      style={{
                                        left: `${previewProgressPercent}%`,
                                      }}
                                    />
                                  </div>
                                  <span className="w-[44px] shrink-0 text-right font-mono text-[11px] text-white/82">
                                    {formatSeconds(previewTrimDuration)}
                                  </span>
                                </div>
                              </div>
                            </>
                          ) : videoPickerSelectedVideo.previewImageUrl ? (
                            <div
                              className="absolute inset-0 bg-cover bg-center"
                              style={{
                                backgroundImage: `linear-gradient(180deg,rgba(10,12,18,0.06),rgba(6,8,12,0.56)), url("${videoPickerSelectedVideo.previewImageUrl}")`,
                              }}
                            />
                          ) : null}
                          {!videoPickerSelectedVideo.previewStreamUrl ? (
                            <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white">
                              Preview image only
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="text-[22px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
                          {videoPickerSelectedVideo.title}
                        </div>
                        <div className="mt-2 text-[13px] leading-6 text-[var(--color-text-secondary)]">
                          {videoPickerSelectedVideo.id} •{" "}
                          {videoPickerSelectedVideo.duration}
                        </div>
                        <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
                          Dubs: {videoPickerSelectedVideo.dubs}
                        </div>
                        {videoPickerSelectedVideo.description ? (
                          <div className="mt-3 max-w-2xl text-[13px] leading-6 text-[var(--color-text-secondary)]">
                            {videoPickerSelectedVideo.description}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {videoPickerMode === "block" ? (
                      <div className="space-y-4">
                        <div>
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                              Clip
                            </div>
                            <div className="flex h-5 min-w-[44px] items-center justify-end">
                              <button
                                type="button"
                                onClick={() =>
                                  setVideoPickerDraft((current) => ({
                                    ...current,
                                    clipStartSeconds: "0",
                                    clipEndSeconds: "",
                                  }))
                                }
                                className={cx(
                                  "text-[11px] font-medium transition-colors duration-[120ms] ease-out",
                                  videoPickerClipChanged
                                    ? "cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                                    : "pointer-events-none text-transparent",
                                )}
                              >
                                Reset
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-4 py-4">
                            <div className="flex items-center justify-between text-[12px] text-[var(--color-text-secondary)]">
                              <span>Trim range</span>
                              <span className="font-mono text-[var(--color-text-primary)]">
                                {formatSeconds(videoPickerClipStart)} to{" "}
                                {formatSeconds(videoPickerClipEnd)}
                              </span>
                            </div>
                            <div
                              ref={videoPickerClipTrackRef}
                              className="relative mt-4 h-8 touch-none"
                            >
                              <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--color-surface-inset)]" />
                              <div
                                className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--color-brand)]"
                                style={{
                                  left: `${Math.min(videoPickerClipStartPercent, videoPickerClipEndPercent)}%`,
                                  width: `${Math.abs(
                                    videoPickerClipEndPercent -
                                      videoPickerClipStartPercent,
                                  )}%`,
                                }}
                              />
                              <button
                                type="button"
                                onPointerDown={(event) => {
                                  event.preventDefault()
                                  setActiveClipHandle("start")
                                }}
                                className="absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white bg-[var(--color-brand)] shadow-[0_6px_18px_rgba(0,0,0,0.32)] active:cursor-grabbing"
                                style={{
                                  left: `${videoPickerClipStartPercent}%`,
                                }}
                                aria-label="Clip start"
                              />
                              <button
                                type="button"
                                onPointerDown={(event) => {
                                  event.preventDefault()
                                  setActiveClipHandle("end")
                                }}
                                className="absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white bg-[var(--color-brand)] shadow-[0_6px_18px_rgba(0,0,0,0.32)] active:cursor-grabbing"
                                style={{
                                  left: `${videoPickerClipEndPercent}%`,
                                }}
                                aria-label="Clip end"
                              />
                            </div>

                            <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--color-text-muted)]">
                              <span>00:00</span>
                              <span>
                                {formatSeconds(
                                  videoPickerSelectedVideo.durationSeconds,
                                )}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                            Playback
                          </div>
                          <div className="mt-2 space-y-3">
                            {renderSwitch({
                              label: "Autoplay",
                              description:
                                "Start playback when the hero appears. Clients can still fall back to muted playback when browser policy requires it.",
                              checked: videoPickerDraft.autoplay,
                              onChange: (checked) =>
                                setVideoPickerDraft((current) => ({
                                  ...current,
                                  autoplay: checked,
                                })),
                            })}
                            {renderSwitch({
                              label: "Automatic audio",
                              description:
                                "When enabled, clients can play with sound if policy and prior user interaction allow it; otherwise they can fall back to muted playback. Turn this off to force mute.",
                              checked: !videoPickerDraft.muted,
                              onChange: (checked) =>
                                setVideoPickerDraft((current) => ({
                                  ...current,
                                  muted: !checked,
                                })),
                            })}
                            {renderSwitch({
                              label: "Loop",
                              description:
                                "Restart from the chosen clip start when playback ends.",
                              checked: videoPickerDraft.loop,
                              onChange: (checked) =>
                                setVideoPickerDraft((current) => ({
                                  ...current,
                                  loop: checked,
                                })),
                            })}
                            {renderSwitch({
                              label: "Show controls",
                              description:
                                "Display browser playback controls inside the hero player.",
                              checked: videoPickerDraft.showControls,
                              onChange: (checked) =>
                                setVideoPickerDraft((current) => ({
                                  ...current,
                                  showControls: checked,
                                })),
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center p-8">
                    <div className="max-w-md text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-muted)]">
                        <Film className="h-5 w-5" strokeWidth={1.5} />
                      </div>
                      <div className="mt-4 text-[18px] font-semibold text-[var(--color-text-primary)]">
                        Select a video to preview
                      </div>
                      <p className="mt-2 text-[13px] leading-6 text-[var(--color-text-secondary)]">
                        {videoPickerMode === "carouselAppend"
                          ? "Pick a result on the left to preview the media and add it to this carousel."
                          : "Pick a result on the left to preview the media, trim the clip, and configure playback behavior before applying it to the hero."}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--color-hairline)] pt-4">
            <div className="text-[12px] leading-5 text-[var(--color-text-muted)]">
              {videoPickerCurrentAttachmentLabel}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={closeVideoPicker}
                className="inline-flex h-9 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyVideoPickerSelection}
                disabled={!videoPickerSelectedVideo}
                className="inline-flex h-9 cursor-pointer items-center justify-center rounded-sm bg-[var(--color-brand)] px-4 text-[12px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {videoPickerMode === "carouselAppend"
                  ? "Add video"
                  : "Apply video"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <section className="hidden min-h-0 w-[200px] shrink-0 border-r border-[var(--color-hairline)] bg-[var(--color-surface)] xl:flex xl:flex-col">
        <div className="border-b border-[var(--color-hairline)] p-3">
          <span className="label-text">Locales</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {localeEntries.map((locale) => (
            <a
              key={locale.id}
              href={locale.href}
              className={cx(
                "flex h-10 items-center justify-between px-3 transition-all duration-[120ms] ease-out",
                locale.active
                  ? "border-l-2 border-[var(--color-text-primary)] bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cx(
                      "h-1.5 w-1.5 rounded-full",
                      localeDotClass(locale.stateTone),
                    )}
                  />
                  <span className="font-mono text-[12px]">{locale.code}</span>
                </div>
                <div className="truncate text-[12px]">{locale.title}</div>
              </div>
              {locale.active ? (
                <Check className="h-4 w-4" strokeWidth={1.5} />
              ) : null}
            </a>
          ))}
        </div>
      </section>

      <section className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-[var(--color-bg)] [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]">
        <div className="mx-auto max-w-4xl px-6 py-6 xl:px-12 xl:py-7">
          <div className="space-y-3 pb-10">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
              Entry Title
            </div>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="block min-h-[3.75rem] w-full appearance-none border-0 bg-transparent px-0 py-0 text-[38px] font-semibold leading-[1.04] tracking-[-0.05em] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)] md:text-[44px] xl:min-h-[4.25rem] xl:text-[50px]"
              placeholder="Untitled Experience"
            />
          </div>

          {blockSummaries.length === 0 ? (
            <div className="rounded-sm border border-[var(--color-hairline)] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-surface)_94%,black),var(--color-surface))] p-8">
              <div className="mx-auto max-w-2xl">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)]">
                    <LayoutTemplate className="h-5 w-5" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      Empty Canvas
                    </div>
                    <div className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
                      Start with a first block
                    </div>
                    <p className="mt-2 max-w-xl text-[13px] leading-6 text-[var(--color-text-secondary)]">
                      Pick a starter block below, or open the full block library
                      if you want to build from a different pattern.
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  {EMPTY_CANVAS_STARTERS.map((starterKey) => {
                    const block = BLOCK_LIBRARY.find(
                      (item) => item.key === starterKey,
                    )
                    if (!block) return null

                    return (
                      <button
                        key={block.key}
                        type="button"
                        onClick={() => insertBlock(block.key, 0)}
                        className="flex min-h-[112px] cursor-pointer flex-col rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-4 py-3 text-left transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]"
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)]">
                            <block.icon className="h-4 w-4" strokeWidth={1.5} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                              {block.label}
                            </div>
                            <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
                              {block.description}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => openAddBlockPicker(0)}
                    className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)]"
                  >
                    <Plus className="h-4 w-4" strokeWidth={1.5} />
                    Browse All Blocks
                  </button>
                  <div className="text-[12px] text-[var(--color-text-muted)]">
                    Recommended first picks: hero, text, or media.
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleBlockDragStart}
            onDragOver={handleBlockDragOver}
            onDragEnd={handleBlockDragEnd}
            onDragCancel={() => handleDragCleanup(false)}
          >
            <SortableContext
              items={blockSummaries.map((block) => block.key)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-0">
                {blockSummaries.map((block, index) => (
                  <SortableCanvasBlock
                    key={block.key}
                    id={block.key}
                    isDraggingOverlay={activeDragKey === block.key}
                    insertedState={insertedBlockAnimation}
                    onWrapperRef={(node) => {
                      if (node) {
                        blockCardRefs.current.set(block.key, node)
                        return
                      }

                      blockCardRefs.current.delete(block.key)
                    }}
                    addSlot={
                      <div
                        className={cx(
                          "group relative flex items-center justify-center transition-[height] duration-[160ms] ease-out",
                          pendingInsertIndex === index + 1
                            ? "h-14"
                            : "h-10 hover:h-14",
                        )}
                      >
                        {pendingInsertIndex === index + 1 ? (
                          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                            {renderPendingInsertMarker()}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => openAddBlockPicker(index + 1)}
                          className={cx(
                            "absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center gap-2 rounded-pill border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-1 font-mono text-[11px] text-[var(--color-text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.4)] transition-all duration-[120ms] ease-out",
                            pendingInsertIndex === index + 1
                              ? "opacity-0"
                              : "opacity-0 group-hover:opacity-100",
                          )}
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.5} />
                          Add Block
                        </button>
                      </div>
                    }
                  >
                    {({ attributes, listeners, isDragging }) =>
                      renderCanvasCard(block, index, {
                        dragHandleProps: { attributes, listeners },
                        isDragging,
                      })
                    }
                  </SortableCanvasBlock>
                ))}
              </div>
            </SortableContext>

            <DragOverlay dropAnimation={null}>
              {activeDragSummary ? (
                <div className="rotate-[0.35deg] scale-[1.015]">
                  {renderCanvasCard(
                    activeDragSummary,
                    blockSummaries.findIndex(
                      (block) => block.key === activeDragSummary.key,
                    ),
                    {
                      isDragging: true,
                      isOverlay: true,
                    },
                  )}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </section>

      <section className="hidden min-h-0 w-[360px] shrink-0 border-l border-[var(--color-hairline)] bg-[var(--color-surface)] xl:flex xl:flex-col">
        <form
          id={`experience-editor-${initialValues.localeId}`}
          action={async (formData) => {
            const intent = String(formData.get("intent") ?? "save")
            const result = await saveAction(formData)
            if (!result.ok) {
              pushToast(result.error ?? "Unable to save locale.", "error")
              return
            }
            if (intent === "publish") {
              const publishResult = await publishAction(initialValues.localeId)
              if (!publishResult.ok) {
                pushToast(
                  publishResult.error ?? "Unable to publish locale.",
                  "error",
                )
                return
              }
              pushToast("Locale published.", "success")
            } else {
              pushToast("Locale saved.", "success")
            }
            startTransition(() => {
              router.refresh()
            })
          }}
          className="hidden"
        >
          <input type="hidden" name="id" value={initialValues.localeId} />
          <input type="hidden" name="title" value={title} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="pathSegment" value={pathSegment} />
          <input type="hidden" name="metaDescription" value={metaDescription} />
          <input type="hidden" name="ogTitle" value={ogTitle} />
          <input type="hidden" name="ogDescription" value={ogDescription} />
          <input type="hidden" name="ogImageUrl" value={ogImageUrl} />
          <input
            type="hidden"
            name="isHomepage"
            value={isHomepage ? "on" : ""}
          />
          <input
            type="hidden"
            name="blocks"
            value={JSON.stringify(normalizedParsedBlocks, null, 2)}
          />
        </form>

        <div className="space-y-3 border-b border-[var(--color-hairline)] p-4">
          <div className="grid gap-3">
            <button
              type="submit"
              form={`experience-editor-${initialValues.localeId}`}
              name="intent"
              value="save"
              disabled={isPending || !hasChanges}
              className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save className="h-4 w-4" strokeWidth={1.5} />
              Save Draft
            </button>
            <button
              type="submit"
              form={`experience-editor-${initialValues.localeId}`}
              name="intent"
              value="publish"
              disabled={isPending || !canPublishNow}
              className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-sm bg-[var(--color-brand)] px-4 text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <UploadCloud className="h-4 w-4" strokeWidth={1.5} />
              Publish
            </button>
          </div>
        </div>

        <div className="flex border-b border-[var(--color-hairline)]">
          <button
            type="button"
            onClick={() => setRailTab("add")}
            className={cx(
              "w-12 cursor-pointer border-b border-transparent px-0 py-3 text-center text-[14px] font-medium transition-all duration-[120ms] ease-out",
              railTab === "add"
                ? "border-[var(--color-text-primary)] bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]",
            )}
            aria-label="Add block"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setRailTab("inspector")}
            className={cx(
              "flex-1 cursor-pointer border-b border-transparent px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] transition-all duration-[120ms] ease-out",
              railTab === "inspector"
                ? "border-[var(--color-text-primary)] bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]",
            )}
          >
            Inspector
          </button>
          <button
            type="button"
            onClick={() => setRailTab("settings")}
            className={cx(
              "flex-1 cursor-pointer border-b border-transparent px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] transition-all duration-[120ms] ease-out",
              railTab === "settings"
                ? "border-[var(--color-text-primary)] bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]",
            )}
          >
            Settings
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]">
          <div className="flex min-h-0 flex-col p-4">
            {railTab === "add" ? (
              <div className="space-y-3">
                <div className="space-y-3 border-b border-[var(--color-hairline)] pb-4">
                  <label className="relative block">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
                      strokeWidth={1.5}
                    />
                    <input
                      value={blockSearchQuery}
                      onChange={(event) =>
                        setBlockSearchQuery(event.target.value)
                      }
                      placeholder="Search blocks"
                      className={`${fieldClassName()} w-full pl-9`}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {blockCategories.map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setBlockCategoryFilter(category)}
                        className={cx(
                          "inline-flex h-8 cursor-pointer items-center rounded-pill border px-3 font-mono text-[10px] uppercase tracking-[0.08em] transition-all duration-[120ms] ease-out",
                          blockCategoryFilter === category
                            ? "border-[var(--color-text-primary)] bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                            : "border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)]",
                        )}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </div>

                {groupedFilteredBlockLibrary.length === 0 ? (
                  <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-4 py-5 text-[12px] text-[var(--color-text-muted)]">
                    No blocks match the current filter.
                  </div>
                ) : (
                  <div className="space-y-5">
                    {groupedFilteredBlockLibrary.map((group) => (
                      <div key={group.category} className="space-y-2">
                        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                          {group.category}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {group.blocks.map((block) => (
                            <button
                              key={block.key}
                              type="button"
                              onClick={() =>
                                insertBlock(
                                  block.key,
                                  pendingInsertIndex ??
                                    (selectedBlockIndex === null
                                      ? parsedBlocks.length
                                      : selectedBlockIndex + 1),
                                )
                              }
                              className="flex min-h-[82px] cursor-pointer flex-col rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 py-2.5 text-left transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]"
                            >
                              <div className="flex items-start gap-2.5">
                                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)]">
                                  <block.icon
                                    className="h-4 w-4"
                                    strokeWidth={1.5}
                                  />
                                </div>
                                <div className="min-w-0">
                                  <div className="text-[13px] font-medium leading-5 text-[var(--color-text-primary)]">
                                    {block.label}
                                  </div>
                                  <div className="mt-0.5 text-[11px] leading-4 text-[var(--color-text-muted)]">
                                    {block.description}
                                  </div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : railTab === "inspector" ? (
              selectedBlockSummary ? (
                <div className="space-y-4">
                  <div>
                    <div className="text-[15px] font-medium text-[var(--color-text-primary)]">
                      {selectedBlockSummary.typeLabel}
                    </div>
                    <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                      {selectedBlockSummary.title}
                    </div>
                  </div>
                  {renderInspectorFields()}
                </div>
              ) : (
                <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-4 py-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)]">
                      <MousePointer2 className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div>
                      <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                        {parsedBlocks.length === 0
                          ? "Add your first block"
                          : "Select a block"}
                      </div>
                      <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
                        {parsedBlocks.length === 0
                          ? "Use the + tab to add a block, then its settings will appear here."
                          : "Choose a block on the canvas to edit its settings here."}
                      </div>
                      {parsedBlocks.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => setRailTab("add")}
                          className="mt-3 inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-inset)]"
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.5} />
                          Add your first block
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div className="space-y-8">
                <div className="space-y-3">
                  <label className="grid gap-1.5">
                    <span className="label-text">Slug</span>
                    <input
                      value={slug}
                      onChange={(event) => setSlug(event.target.value)}
                      className={`${fieldClassName()} font-mono`}
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="label-text">Route Prefix</span>
                    <input
                      value={pathSegment}
                      onChange={(event) => setPathSegment(event.target.value)}
                      className={`${fieldClassName()} font-mono`}
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="label-text">Meta Description</span>
                    <textarea
                      value={metaDescription}
                      onChange={(event) =>
                        setMetaDescription(event.target.value)
                      }
                      rows={3}
                      className={textAreaClassName()}
                    />
                  </label>
                </div>

                <div className="space-y-3 pb-2">
                  <span className="label-text mb-2 block">Owner</span>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] font-mono text-[12px] text-[var(--color-text-primary)]">
                      {ownerInitials(ownerLabel)}
                    </div>
                    <div>
                      <p className="mb-1.5 text-[13px] font-medium text-[var(--color-text-primary)]">
                        {ownerLabel}
                      </p>
                      <p className="text-[11px] text-[var(--color-text-muted)]">
                        {hasPublishedVersion
                          ? `Published ${publishedAtLabel}`
                          : "Not yet published"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <span className="label-text mb-2 block">
                    Revision Timeline
                  </span>
                  <div className="overflow-hidden rounded-sm border border-[var(--color-hairline)]">
                    {revisionEntries.length === 0 ? (
                      <div className="p-4 text-[13px] text-[var(--color-text-muted)]">
                        No revision entries have been recorded for this locale
                        yet.
                      </div>
                    ) : (
                      revisionEntries.map((entry) => (
                        <div
                          key={entry.id}
                          className={cx(
                            "group flex items-start justify-between gap-4 border-b border-white/10 px-4 py-3 last:border-b-0",
                            entry.isActive &&
                              "border-l-2 border-l-[var(--color-text-primary)] bg-[var(--color-surface-raised)] pl-3",
                          )}
                        >
                          <div className="min-w-0">
                            <div className="text-[12px] text-[var(--color-text-secondary)]">
                              {entry.summary}
                            </div>
                            <div className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
                              {entry.revisedAt}
                            </div>
                            <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                              {entry.revisedBy}
                            </div>
                          </div>
                          {entry.isActive ? (
                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-success)]" />
                          ) : null}
                          {!entry.isActive ? (
                            <button
                              type="button"
                              onClick={() => handleRestoreRevision(entry.id)}
                              disabled={isPending}
                              className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] opacity-0 transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)] group-hover:opacity-100 group-focus-within:opacity-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Restore
                            </button>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
