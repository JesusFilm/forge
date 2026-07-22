"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type DragEvent,
} from "react"
import { createPortal } from "react-dom"
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DraggableAttributes,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core"
import { arrayMove } from "@dnd-kit/sortable"
import { HDate, months } from "@hebcal/hdate"
import type { Route as NextRoute } from "next"
import { useRouter } from "next/navigation"
import {
  CalendarDays,
  Captions,
  Check,
  CirclePlay,
  ArrowLeft,
  BookMarked,
  BookOpen,
  Brain,
  Eye,
  EyeOff,
  Pause,
  Play,
  Volume2,
  VolumeX,
  ChevronRightSquare,
  Clapperboard,
  Columns2,
  Compass,
  Film,
  FileText,
  Globe2,
  GripVertical,
  HandHeart,
  Handshake,
  Heart,
  History,
  LayoutTemplate,
  Lightbulb,
  Link2,
  ListOrdered,
  MapPin,
  Maximize2,
  MessageSquareQuote,
  MessagesSquare,
  Minimize2,
  MousePointer2,
  Music,
  ImageIcon,
  MonitorPlay,
  Plus,
  RectangleHorizontal,
  Route,
  Save,
  Search,
  Shapes,
  Sparkles,
  Star,
  Trash2,
  UploadCloud,
  Users,
  X,
  Video,
  type LucideIcon,
} from "lucide-react"
import { cx } from "@/components/admin-ui"
import { ConfirmModal } from "@/components/confirm-modal"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import type { MediaLibraryBrowserData } from "@/app/dashboard/media/media-library-browser-data"
import type { UploadActionResult } from "@/app/dashboard/media/media-actions"
import {
  BackgroundColorPicker,
  normalizeHexColor,
} from "./experience-editor/background-color-picker"
import { ImagePickerBrowser } from "./experience-editor/image-picker-browser"
import {
  BibleQuoteCard,
  type BibleQuoteDragHandleState,
  type BibleQuoteDragState,
} from "./experience-editor/bible-quote-card"
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  clampNumber,
  containerSlotMarkerIndexes,
  createContainerSlotBlock,
  createContainerSlotLayout,
  createTemplateBlock,
  contentParagraphsFromEditorText,
  editorTextFromContentParagraphs,
  isContainerSlotBlock,
  normalizeEditorBlocks,
  parseClipInput,
  readContainerContent,
  readContainerSlotSpans,
  stringFromOptionalNumber,
  summarizeBlock,
  writeContainerSlotSpan,
  type BlockRecord,
  type BlockSummary,
  type BlockTemplateKey,
  type GridBreakpoint,
  type VideoBlockSubtitleSource,
  type VideoBlockTitleSource,
  type VideoHeroHeadingSource,
  type VideoHeroSubheadingSource,
  type VideoLibraryItem,
} from "./experience-editor/block-helpers"
import { CanvasBlockList } from "./experience-editor/canvas-block-list"
import { ContainerWorkspace } from "./experience-editor/container-workspace"

type EditorActionResult = {
  ok: boolean
  error?: string
}

type CreateLocaleActionResult = EditorActionResult & {
  href?: string
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

type MediaLibraryItem = MediaLibraryBrowserData["images"][number]

type ImagePickerUrlField = "backgroundImageUrl" | "imageUrl" | "mediaUrl"

type ImagePickerTarget = {
  label: string
  selectedAssetId: string | null
  canClear: boolean
  apply: (asset: MediaLibraryItem) => void
  clear: () => void
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

type BlockTemplateDefinition = {
  key: BlockTemplateKey
  label: string
  description: string
  category: string
  icon: LucideIcon
}

type NestedCanvasBlockLocation =
  | {
      kind: "container"
      containerIndex: number
      childIndex: number
    }
  | {
      kind: "section"
      sectionIndex: number
      childIndex: number
    }

const NESTED_CANVAS_INDEX_BASE = 1_000_000
const SECTION_NESTED_CANVAS_OFFSET = 500_000_000
const sectionContentBlockKeys = new WeakMap<object, string>()
let sectionContentBlockKeyCounter = 0

function stableSectionContentBlockKey(item: unknown, childIndex: number) {
  if (!item || typeof item !== "object") {
    return `section-content-primitive-${childIndex}`
  }

  const existing = sectionContentBlockKeys.get(item)
  if (existing) return existing

  const nextKey = `section-content-${sectionContentBlockKeyCounter}`
  sectionContentBlockKeyCounter += 1
  sectionContentBlockKeys.set(item, nextKey)
  return nextKey
}

type BlockCategoryFilter = "All" | BlockTemplateDefinition["category"]
type InsertedBlockAnimation = {
  key: string
  visible: boolean
}

type PendingContainerSlotDelete = {
  containerIndex: number
  slotIndex: number
  blockCount: number
}

type NavigationDestinationPickerPosition = {
  top: number
  left: number
  width: number
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

type VideoPickerMode = "block" | "carouselAppend" | "mediaCollectionAppend"

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
type InfoBlockDragState = {
  blockIndex: number
  itemIndex: number
}
type InfoBlockDragHandleState = {
  blockIndex: number
  itemIndex: number
  pointerOffsetX: number
  pointerOffsetY: number
}
type NavigationCarouselDragState = {
  blockIndex: number
  itemIndex: number
}
type NavigationCarouselDragHandleState = {
  blockIndex: number
  itemIndex: number
  pointerOffsetX: number
  pointerOffsetY: number
}
type MediaCollectionDragState = {
  blockIndex: number
  itemIndex: number
}
type MediaCollectionDragHandleState = {
  blockIndex: number
  itemIndex: number
  pointerOffsetX: number
  pointerOffsetY: number
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
    description: "Single manually selected video.",
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
    key: "watchHomeHero",
    label: "Watch Home Hero",
    description: "Static hero used at the top of the Watch homepage.",
    category: "Hero",
    icon: MonitorPlay,
  },
  {
    key: "languageGlobe",
    label: "Language Globe",
    description: "Spinning Earth with links to language video libraries.",
    category: "Navigation",
    icon: Globe2,
  },
  {
    key: "routeVideoHero",
    label: "Route Video Hero",
    description: "Hero bound to the current video route.",
    category: "Route",
    icon: Route,
  },
  {
    key: "routeVideo",
    label: "Route Video",
    description: "Player bound to the current video route.",
    category: "Route",
    icon: CirclePlay,
  },
  {
    key: "routeVideoCarousel",
    label: "Route Video Carousel",
    description: "Carousel of children from the current route video.",
    category: "Route",
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
    key: "promotionalText",
    label: "Promotional Story",
    description: "Long-form Markdown in a cinematic mission section.",
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
    label: "Key Details",
    description: "Intro copy with a grid of supporting detail cards.",
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

const SECTION_VISUAL_IDENTITY_BLOCK_TYPES = new Set([
  "adventCountdown",
  "bibleQuotesCarousel",
  "cta",
  "easterDates",
  "infoBlocks",
  "mediaCollection",
  "navigationCarousel",
  "promoBanner",
  "relatedQuestions",
  "section",
  "text",
  "videoCarousel",
  "languageGlobe",
])

const TOGGLEABLE_CTA_BLOCK_TYPES = new Set([
  "mediaCollection",
  "promoBanner",
  "relatedQuestions",
  "videoHero",
])

type SectionContentTemplateKey =
  | Exclude<
      BlockTemplateKey,
      | "adventCountdown"
      | "easterDates"
      | "promotionalText"
      | "section"
      | "videoHero"
      | "routeVideoHero"
      | "routeVideo"
      | "routeVideoCarousel"
    >
  | "quizButton"

type ContainerSlotContentTemplateKey =
  | "adventCountdown"
  | "bibleQuotesCarousel"
  | "card"
  | "cta"
  | "easterDates"
  | "mediaCollection"
  | "relatedQuestions"
  | "text"
  | "video"

const SECTION_CONTENT_TEMPLATES: SectionContentTemplateKey[] = [
  "text",
  "mediaCollection",
  "promoBanner",
  "infoBlocks",
  "cta",
  "container",
  "relatedQuestions",
  "bibleQuotesCarousel",
  "card",
  "video",
  "videoCarousel",
  "navigationCarousel",
  "quizButton",
]

const CONTAINER_SLOT_CONTENT_TEMPLATES: ContainerSlotContentTemplateKey[] = [
  "text",
  "mediaCollection",
  "relatedQuestions",
  "cta",
  "bibleQuotesCarousel",
  "card",
  "easterDates",
  "adventCountdown",
  "video",
]

function isRouteOnlyBlockPayload(block: unknown) {
  const record = asRecord(block)
  const type = asString(record?.t)
  return (
    ((type === "videoHero" || type === "video") &&
      asBoolean(record?.useRouteVideo)) ||
    (type === "videoCarousel" &&
      asString(record?.itemsSource) === "routeVideoChildren")
  )
}

function removeRouteOnlyBlocks(blocks: unknown[]) {
  return blocks.filter((block) => !isRouteOnlyBlockPayload(block))
}

const INFO_BLOCK_ICON_OPTIONS: {
  value: string
  label: string
  aliases: string[]
  icon: LucideIcon
}[] = [
  {
    value: "favorite",
    label: "Favorite",
    aliases: ["heart", "love", "like", "care"],
    icon: Heart,
  },
  {
    value: "star",
    label: "Star",
    aliases: ["featured", "special", "important"],
    icon: Star,
  },
  {
    value: "sparkles",
    label: "Highlight",
    aliases: ["sparkle", "magic", "new", "shine"],
    icon: Sparkles,
  },
  {
    value: "check",
    label: "Check",
    aliases: ["done", "complete", "confirmed", "yes"],
    icon: Check,
  },
  {
    value: "video_library",
    label: "Video",
    aliases: ["play", "watch", "media", "movie"],
    icon: CirclePlay,
  },
  {
    value: "film",
    label: "Film",
    aliases: ["movie", "cinema", "watch", "story"],
    icon: Film,
  },
  {
    value: "music",
    label: "Music",
    aliases: ["audio", "song", "worship", "sound"],
    icon: Music,
  },
  {
    value: "image",
    label: "Image",
    aliases: ["photo", "picture", "visual", "asset"],
    icon: ImageIcon,
  },
  {
    value: "menu_book",
    label: "Book",
    aliases: ["bible", "read", "scripture", "text"],
    icon: BookOpen,
  },
  {
    value: "bookmark",
    label: "Saved",
    aliases: ["bookmark", "keep", "remember", "mark"],
    icon: BookMarked,
  },
  {
    value: "file_text",
    label: "Notes",
    aliases: ["document", "article", "text", "details"],
    icon: FileText,
  },
  {
    value: "forum",
    label: "Quote",
    aliases: ["speech", "verse", "message", "saying"],
    icon: MessageSquareQuote,
  },
  {
    value: "messages",
    label: "Discuss",
    aliases: ["chat", "conversation", "questions", "talk"],
    icon: MessagesSquare,
  },
  {
    value: "users",
    label: "People",
    aliases: ["community", "group", "family", "audience"],
    icon: Users,
  },
  {
    value: "hand_heart",
    label: "Care",
    aliases: ["help", "support", "serve", "love"],
    icon: HandHeart,
  },
  {
    value: "handshake",
    label: "Connect",
    aliases: ["partner", "agreement", "welcome", "relationship"],
    icon: Handshake,
  },
  {
    value: "lightbulb",
    label: "Idea",
    aliases: ["tip", "insight", "learn", "understand"],
    icon: Lightbulb,
  },
  {
    value: "psychology",
    label: "Insight",
    aliases: ["mind", "thought", "understanding", "wisdom"],
    icon: Brain,
  },
  {
    value: "history_edu",
    label: "Learn",
    aliases: ["teaching", "education", "lesson", "study"],
    icon: BookOpen,
  },
  {
    value: "explore",
    label: "Explore",
    aliases: ["compass", "discover", "browse", "journey"],
    icon: Compass,
  },
  {
    value: "map_pin",
    label: "Place",
    aliases: ["location", "map", "destination", "where"],
    icon: MapPin,
  },
  {
    value: "globe",
    label: "World",
    aliases: ["global", "earth", "language", "international"],
    icon: Globe2,
  },
  {
    value: "route",
    label: "Path",
    aliases: ["journey", "steps", "route", "next"],
    icon: Route,
  },
  {
    value: "link",
    label: "Link",
    aliases: ["url", "external", "open", "connect"],
    icon: Link2,
  },
]

function fieldClassName() {
  return "h-10 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)] focus:bg-[var(--color-bg)]"
}

function resizeTextareaHeight(node: HTMLTextAreaElement) {
  node.style.height = "auto"
  node.style.height = `${node.scrollHeight}px`
}

export function cleanRoutePart(value: string, trimTrailing = false) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/g, "")

  return trimTrailing ? cleaned.replace(/-+$/g, "") : cleaned
}

export function cleanLocaleCode(value: string, trimTrailing = false) {
  const cleaned = value
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+/g, "")

  return trimTrailing ? cleaned.replace(/-+$/g, "") : cleaned
}

function switchTrackClass(checked: boolean) {
  return checked
    ? "justify-end border-[var(--color-brand)] bg-[color-mix(in_oklab,var(--color-brand)_28%,black)]"
    : "justify-start border-[var(--color-hairline-strong)] bg-[var(--color-surface-inset)]"
}

function calculateWesternEaster(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function calculateOrthodoxEaster(year: number): Date {
  const a = year % 4
  const b = year % 7
  const c = year % 19
  const d = (19 * c + 15) % 30
  const e = (2 * a + 4 * b - d + 34) % 7
  const month = Math.floor((d + e + 114) / 31)
  const day = ((d + e + 114) % 31) + 1
  const julianDate = new Date(year, month - 1, day)
  return new Date(julianDate.getTime() + 13 * 24 * 60 * 60 * 1000)
}

function calculatePassover(year: number): Date {
  const hebrewYear = new HDate(new Date(year, 3, 1)).getFullYear()
  return new HDate(15, months.NISAN, hebrewYear).greg()
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function currentLocalDateSnapshot() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseEditorDateSnapshot(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return startOfDay(new Date())

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function nextCalculatedDate(
  calculate: (year: number) => Date,
  today = new Date(),
) {
  const currentYear = today.getFullYear()
  const currentYearDate = startOfDay(calculate(currentYear))
  return currentYearDate >= startOfDay(today)
    ? currentYearDate
    : startOfDay(calculate(currentYear + 1))
}

function formatEditorDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function getDaysUntilChristmas(today = new Date()) {
  const currentYear = today.getFullYear()
  const christmas = startOfDay(new Date(currentYear, 11, 25))
  const currentDay = startOfDay(today)
  const targetDate =
    currentDay > christmas
      ? startOfDay(new Date(currentYear + 1, 11, 25))
      : christmas
  const dayMs = 24 * 60 * 60 * 1000
  return {
    days: Math.ceil((targetDate.getTime() - currentDay.getTime()) / dayMs),
    targetYear: targetDate.getFullYear(),
  }
}

function localeDotClass(tone: LocaleEntry["stateTone"]) {
  if (tone === "success") return "bg-[var(--color-success)]"
  if (tone === "danger") return "bg-[var(--color-danger)]"
  return "bg-[var(--color-warning)]"
}

const selectedMediaButtonClassName =
  "border-[rgba(110,231,183,0.48)] bg-[rgba(110,231,183,0.22)] text-[var(--color-text-primary)] hover:border-[rgba(110,231,183,0.68)] hover:bg-[rgba(110,231,183,0.3)]"
const idleMediaButtonClassName =
  "border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)] hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]"
const selectedOverlayMediaButtonClassName =
  "border-[rgba(110,231,183,0.54)] bg-[rgba(20,83,61,0.82)] text-white hover:border-[rgba(110,231,183,0.78)] hover:bg-[rgba(24,96,70,0.9)]"
const idleOverlayMediaButtonClassName =
  "border-white/18 bg-[#08090d] text-white hover:border-white/36 hover:bg-[#11131a]"

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

function createNestedTemplateBlock(
  template: SectionContentTemplateKey | ContainerSlotContentTemplateKey,
  index: number,
): BlockRecord {
  if (template === "quizButton") {
    return {
      t: "quizButton",
      sectionKey: `quiz-${index}`,
      buttonText: "Start quiz",
      iframeSrc: "https://demo.nextstep.is/q",
    }
  }

  return createTemplateBlock(template, index)
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

function inferLocalWatchBaseUrl() {
  // Local dev runs the watch site on :3000 next to admin on :3003; on
  // deployed hosts the server-provided watchOrigin is authoritative.
  if (typeof window === "undefined") return null

  const { protocol, hostname } = window.location
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:3000`
  }

  return null
}

function cleanWatchOrigin(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.origin
  } catch {
    return null
  }
}

// SYNC: mirrors PUBLIC_WATCH_AUDIO_LANGUAGE_SLUG_BY_UI_LOCALE in
// apps/web/src/lib/locale.ts — the watch site resolves the language path
// segment through that table, so entries here must stay aligned with web.
// Keys are lowercased to match cleanLocaleCode output.
const WATCH_AUDIO_LANGUAGE_SLUG_BY_LOCALE: Readonly<Record<string, string>> = {
  en: "english",
  es: "spanish-castilian",
  fr: "french",
  pt: "portuguese-brazil",
  de: "german-standard",
  ar: "arabic-modern-standard",
  id: "indonesian-isa",
  ja: "japanese",
  ko: "korean",
  ms: "malay",
  ne: "nepali",
  ru: "russian",
  th: "thai",
  tl: "tagalog",
  tr: "turkish",
  vi: "vietnamese",
  zh: "mandarin-china",
  "zh-hans": "chinese-simplified",
  "zh-hant": "chinese-traditional",
}

export function watchLanguageSlugForLocale(locale: string) {
  const normalized = cleanLocaleCode(locale, true)
  if (!normalized) return null

  return (
    WATCH_AUDIO_LANGUAGE_SLUG_BY_LOCALE[normalized] ??
    WATCH_AUDIO_LANGUAGE_SLUG_BY_LOCALE[normalized.split("-")[0] ?? ""] ??
    null
  )
}

// Public watch URLs are always two .html segments: {slug}.html/{language}.html.
// A bare slug expands to the broken {slug}.html/{slug}.html on the watch site.
// See docs/solutions/conventions/public-watch-url-two-segment-contract-20260608.md.
export function buildPublishedWatchUrl(
  slug: string,
  locale: string,
  watchOrigin: string,
) {
  const normalizedSlug = cleanRoutePart(slug)
  const languageSlug = watchLanguageSlugForLocale(locale)
  if (!normalizedSlug || !languageSlug) return null

  const baseUrl = inferLocalWatchBaseUrl() ?? cleanWatchOrigin(watchOrigin)
  if (!baseUrl) return null

  return `${baseUrl}/watch/${normalizedSlug}.html/${languageSlug}.html`
}

export function ExperienceEditor({
  canPublish,
  hasPublishedVersion,
  revisionEntries,
  localeEntries,
  videoLibrary,
  mediaLibrary,
  canUploadImages,
  calendarDate,
  watchOrigin,
  initialValues,
  saveAction,
  publishAction,
  createLocaleAction,
  restoreAction,
  uploadImageAction,
  searchVideoLibraryAction,
  onCanvasController,
}: {
  canPublish: boolean
  hasPublishedVersion: boolean
  revisionEntries: RevisionEntry[]
  localeEntries: LocaleEntry[]
  videoLibrary: VideoLibraryItem[]
  mediaLibrary: MediaLibraryBrowserData
  canUploadImages: boolean
  calendarDate: string
  /** Forge watch-app origin (env.WATCH_CANONICAL_ORIGIN) for preview links. */
  watchOrigin: string
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
    isTemplate: boolean
    blocksJson: string
  }
  saveAction: (formData: FormData) => Promise<EditorActionResult>
  publishAction: (localeId: string) => Promise<EditorActionResult>
  createLocaleAction: (formData: FormData) => Promise<CreateLocaleActionResult>
  restoreAction: (revisionId: string) => Promise<EditorActionResult>
  uploadImageAction: (formData: FormData) => Promise<UploadActionResult>
  searchVideoLibraryAction?: (query: string) => Promise<VideoLibraryItem[]>
  /**
   * Optional imperative bridge published once on mount so the chat panel
   * (sibling component at the page level) can read current canvas state
   * and apply / revert hybrid diffs without coupling its state into this
   * 10k-line component. See `experience-editor/experience-chat-panel.tsx`
   * for the consumer.
   */
  onCanvasController?: (controller: {
    getState: () => {
      title: string
      metaDescription: string | null
      ogImageUrl: string | null
      blocks: unknown[]
    }
    applyDiff: (diff: {
      scalars: {
        title?: { before: string; after: string }
        metaDescription?: {
          before: string | null
          after: string | null
        }
        ogImageUrl?: {
          before: string | null
          after: string | null
        }
      }
      blocks?: ReadonlyArray<unknown>
    }) => void
    revertDiff: (diff: {
      scalars: {
        title?: { before: string; after: string }
        metaDescription?: {
          before: string | null
          after: string | null
        }
        ogImageUrl?: {
          before: string | null
          after: string | null
        }
      }
      blocks?: ReadonlyArray<unknown>
    }) => void
  }) => void
}) {
  const router = useRouter()
  const { toasts, pushToast, dismissToast } = useToastStack()
  const [publishedSlug, setPublishedSlug] = useState<string | null>(
    hasPublishedVersion ? cleanRoutePart(initialValues.slug) : null,
  )
  const [editorDateSnapshot, setEditorDateSnapshot] = useState(calendarDate)
  const editorToday = parseEditorDateSnapshot(editorDateSnapshot)
  const [title, setTitle] = useState(initialValues.title)
  const [slug, setSlug] = useState(initialValues.slug)
  const [pathSegment, setPathSegment] = useState(initialValues.pathSegment)
  const [metaDescription, setMetaDescription] = useState(
    initialValues.metaDescription,
  )
  const [ogTitle] = useState(initialValues.ogTitle)
  const [ogDescription] = useState(initialValues.ogDescription)
  const [ogImageUrl, setOgImageUrl] = useState(initialValues.ogImageUrl)
  const [isHomepage] = useState(initialValues.isHomepage)
  const isTemplate = initialValues.isTemplate

  const [parsedBlocks, setParsedBlocks] = useState<unknown[]>(() => {
    try {
      const parsed = JSON.parse(initialValues.blocksJson)
      if (!Array.isArray(parsed)) return []
      return initialValues.isTemplate ? parsed : removeRouteOnlyBlocks(parsed)
    } catch {
      return []
    }
  })
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(
    parsedBlocks.length > 0 ? 0 : null,
  )
  // ---- Chat panel canvas bridge (U4) ----------------------------------
  // Refs always read the latest state without triggering reruns of the
  // publish effect. The controller object itself is stable for the
  // lifetime of the component.
  const canvasStateRef = useRef({
    title,
    metaDescription,
    ogImageUrl,
    blocks: parsedBlocks,
  })
  canvasStateRef.current = {
    title,
    metaDescription,
    ogImageUrl,
    blocks: parsedBlocks,
  }
  useEffect(() => {
    if (!onCanvasController) return
    const controller = {
      getState: () => ({
        title: canvasStateRef.current.title,
        metaDescription: canvasStateRef.current.metaDescription,
        ogImageUrl: canvasStateRef.current.ogImageUrl,
        blocks: canvasStateRef.current.blocks,
      }),
      applyDiff: (diff: {
        scalars: {
          title?: { before: string; after: string }
          metaDescription?: {
            before: string | null
            after: string | null
          }
          ogImageUrl?: {
            before: string | null
            after: string | null
          }
        }
        blocks?: ReadonlyArray<unknown>
      }) => {
        if (diff.scalars.title) setTitle(diff.scalars.title.after)
        if (diff.scalars.metaDescription) {
          setMetaDescription(diff.scalars.metaDescription.after ?? "")
        }
        if (diff.scalars.ogImageUrl) {
          setOgImageUrl(diff.scalars.ogImageUrl.after ?? "")
        }
        // Block patches are applied via the diff utility in the chat
        // panel; here we set the next blocks array directly when the
        // panel passes a fully-resolved next state via the canvas
        // context. The chat panel is the source of truth for hybrid
        // diff application — it reads `getState`, runs `applyDiff`
        // from the diff utility, and we trust the next blocks via a
        // separate setter not exposed here. Blocks live updates from
        // the chat path go through `setParsedBlocks` directly via the
        // controller's optional onBlocks hook (the chat panel currently
        // applies block patches client-side and re-publishes them by
        // calling `applyDiff` with `blocks` set; we honor that here).
        if (diff.blocks && Array.isArray(diff.blocks)) {
          // The chat panel sends ALREADY-applied next blocks under the
          // `blocks` key for live preview. Cast to unknown[] so the
          // editor's render machinery picks them up.
          setParsedBlocks((current) => {
            // If the chat panel passed a resolved array, use it; else
            // leave current. An RFC-6902 patch op array has objects
            // with `op` keys — distinguish by sniffing.
            const looksLikePatch =
              diff.blocks!.length > 0 &&
              typeof diff.blocks![0] === "object" &&
              diff.blocks![0] !== null &&
              "op" in (diff.blocks![0] as Record<string, unknown>)
            if (looksLikePatch) return current
            return diff.blocks as unknown[]
          })
        }
      },
      revertDiff: (diff: {
        scalars: {
          title?: { before: string; after: string }
          metaDescription?: {
            before: string | null
            after: string | null
          }
          ogImageUrl?: {
            before: string | null
            after: string | null
          }
        }
        blocks?: ReadonlyArray<unknown>
      }) => {
        if (diff.scalars.title) setTitle(diff.scalars.title.before)
        if (diff.scalars.metaDescription) {
          setMetaDescription(diff.scalars.metaDescription.before ?? "")
        }
        if (diff.scalars.ogImageUrl) {
          setOgImageUrl(diff.scalars.ogImageUrl.before ?? "")
        }
        // Block revert: the chat panel side runs `revertDiff` from the
        // diff utility against current state and sends us the resolved
        // before-image; same sniffing rule applies.
        if (diff.blocks && Array.isArray(diff.blocks)) {
          setParsedBlocks((current) => {
            const looksLikePatch =
              diff.blocks!.length > 0 &&
              typeof diff.blocks![0] === "object" &&
              diff.blocks![0] !== null &&
              "op" in (diff.blocks![0] as Record<string, unknown>)
            if (looksLikePatch) return current
            return diff.blocks as unknown[]
          })
        }
      },
    }
    onCanvasController(controller)
    // Publish whenever the parent's memoized callback identity changes
    // (in practice once per editor instance) — re-mounting on locale
    // switch (via the parent `key`) handles teardown.
  }, [onCanvasController])
  const [inlineBlockLibraryOpen, setInlineBlockLibraryOpen] = useState(false)
  const [revisionHistoryOpen, setRevisionHistoryOpen] = useState(false)
  const [localeDrawerOpen, setLocaleDrawerOpen] = useState(false)
  const [newLocaleCode, setNewLocaleCode] = useState("")
  const [newLocaleError, setNewLocaleError] = useState("")
  const [isCreatingLocale, setIsCreatingLocale] = useState(false)
  const [blockSearchQuery, setBlockSearchQuery] = useState("")
  const [blockCategoryFilter, setBlockCategoryFilter] =
    useState<BlockCategoryFilter>("All")
  const [containerGridViewport, setContainerGridViewport] =
    useState<GridBreakpoint>("md")
  const [focusedContainerIndex, setFocusedContainerIndex] = useState<
    number | null
  >(null)
  const [focusedContainerSlotIndex, setFocusedContainerSlotIndex] = useState<
    number | null
  >(null)
  const [focusedSectionIndex, setFocusedSectionIndex] = useState<number | null>(
    null,
  )
  const [customSectionOpacityIndex, setCustomSectionOpacityIndex] = useState<
    number | null
  >(null)
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
  const [videoLibraryQuery, setVideoLibraryQuery] = useState("")
  const [videoLibrarySearchPending, setVideoLibrarySearchPending] =
    useState(false)
  const [videoLibrarySearchError, setVideoLibrarySearchError] = useState(false)
  const [videoLibrarySearchResultKeys, setVideoLibrarySearchResultKeys] =
    useState<Set<string>>(new Set())
  const [videoLibrarySort, setVideoLibrarySort] = useState<
    "recent" | "title" | "duration"
  >("recent")
  const [imagePickerTarget, setImagePickerTarget] =
    useState<ImagePickerTarget | null>(null)
  const [imageLibraryQuery, setImageLibraryQuery] = useState("")
  const [imagePickerSelectedFolderId, setImagePickerSelectedFolderId] =
    useState<string | null>(null)
  const [lastImagePickerFolderId, setLastImagePickerFolderId] = useState<
    string | null
  >(null)
  const [carouselDragState, setCarouselDragState] =
    useState<CarouselDragState | null>(null)
  const [carouselDragHandleState, setCarouselDragHandleState] =
    useState<CarouselDragHandleState | null>(null)
  const [relatedQuestionDragState, setRelatedQuestionDragState] =
    useState<RelatedQuestionDragState | null>(null)
  const [relatedQuestionDragHandleState, setRelatedQuestionDragHandleState] =
    useState<RelatedQuestionDragHandleState | null>(null)
  const [infoBlockDragState, setInfoBlockDragState] =
    useState<InfoBlockDragState | null>(null)
  const [infoBlockDragHandleState, setInfoBlockDragHandleState] =
    useState<InfoBlockDragHandleState | null>(null)
  const [navigationCarouselDragState, setNavigationCarouselDragState] =
    useState<NavigationCarouselDragState | null>(null)
  const [
    navigationCarouselDragHandleState,
    setNavigationCarouselDragHandleState,
  ] = useState<NavigationCarouselDragHandleState | null>(null)
  const [mediaCollectionDragState, setMediaCollectionDragState] =
    useState<MediaCollectionDragState | null>(null)
  const [mediaCollectionDragHandleState, setMediaCollectionDragHandleState] =
    useState<MediaCollectionDragHandleState | null>(null)
  const [navigationDestinationPicker, setNavigationDestinationPicker] =
    useState<{
      blockIndex: number
      itemIndex: number
    } | null>(null)
  const [
    navigationDestinationPickerPosition,
    setNavigationDestinationPickerPosition,
  ] = useState<NavigationDestinationPickerPosition | null>(null)
  const [infoBlockIconPicker, setInfoBlockIconPicker] = useState<{
    blockIndex: number
    itemIndex: number
  } | null>(null)
  const [infoBlockIconQuery, setInfoBlockIconQuery] = useState("")
  const [cardBackgroundPickerIndex, setCardBackgroundPickerIndex] = useState<
    number | null
  >(null)
  const [ctaLinkModalBlockIndex, setCtaLinkModalBlockIndex] = useState<
    number | null
  >(null)
  const [ctaLinkModalVisible, setCtaLinkModalVisible] = useState(false)
  const [bibleQuoteDragState, setBibleQuoteDragState] =
    useState<BibleQuoteDragState | null>(null)
  const [bibleQuoteDragHandleState, setBibleQuoteDragHandleState] =
    useState<BibleQuoteDragHandleState | null>(null)
  const [restoreRevisionId, setRestoreRevisionId] = useState<string | null>(
    null,
  )
  const [deleteBlockIndex, setDeleteBlockIndex] = useState<number | null>(null)
  const [isContainerSlotDeleteOpen, setIsContainerSlotDeleteOpen] =
    useState(false)
  const [pendingContainerSlotDelete, setPendingContainerSlotDelete] =
    useState<PendingContainerSlotDelete | null>(null)
  const [scrollToBlockKey, setScrollToBlockKey] = useState<string | null>(null)
  const [insertedBlockAnimation, setInsertedBlockAnimation] =
    useState<InsertedBlockAnimation | null>(null)
  const [isPending, startTransition] = useTransition()
  const blockCardRefs = useRef(new Map<string, HTMLDivElement>())
  const navigationDestinationPopoverRef = useRef<HTMLDivElement | null>(null)
  const videoPickerPreviewContainerRef = useRef<HTMLDivElement | null>(null)
  const videoPickerPreviewRef = useRef<HTMLVideoElement | null>(null)
  const videoPickerPreviewProgressRef = useRef<HTMLDivElement | null>(null)
  const videoPickerClipTrackRef = useRef<HTMLDivElement | null>(null)
  const insertedBlockAnimationTimeout = useRef<number | null>(null)
  const previewControlsHideTimeout = useRef<number | null>(null)
  const previewFlashTimeout = useRef<number | null>(null)
  const videoPickerModeResetTimeout = useRef<number | null>(null)
  const ctaLinkModalOpenFrame = useRef<number | null>(null)
  const ctaLinkModalCloseTimeout = useRef<number | null>(null)
  const containerSlotDeleteCloseTimeout = useRef<number | null>(null)
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

  useEffect(() => {
    let timeoutId: number | null = null

    function scheduleNextLocalDay() {
      setEditorDateSnapshot(currentLocalDateSnapshot())
      const now = new Date()
      const nextDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        1,
      )
      timeoutId = window.setTimeout(
        scheduleNextLocalDay,
        nextDay.getTime() - now.getTime(),
      )
    }

    scheduleNextLocalDay()

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  function closeFloatingDrawers() {
    setInlineBlockLibraryOpen(false)
    setPendingInsertIndex(null)
    setRevisionHistoryOpen(false)
    setLocaleDrawerOpen(false)
  }

  const serializedBlocks = JSON.stringify(parsedBlocks)
  const normalizedParsedBlocks = normalizeEditorBlocks(parsedBlocks)
  const initialSerializedBlocks = JSON.stringify(
    JSON.parse(initialValues.blocksJson),
  )
  const hasChanges =
    title !== initialValues.title ||
    slug !== initialValues.slug ||
    pathSegment !== initialValues.pathSegment ||
    metaDescription !== initialValues.metaDescription ||
    serializedBlocks !== initialSerializedBlocks
  const routePrefixInputWidth = `${Math.min(
    Math.max((pathSegment.trim() || "prefix").length, 6),
    24,
  )}ch`
  const slugInputWidth = `${Math.min(
    Math.max((slug.trim() || "slug").length, 4),
    34,
  )}ch`
  const canPublishNow = canPublish && (!hasPublishedVersion || hasChanges)
  const activeLocaleCode =
    localeEntries.find((entry) => entry.active)?.code ?? ""
  const publishedRouteSlug = cleanRoutePart(publishedSlug ?? "")
  const canOpenPublishedPage =
    publishedRouteSlug !== "" && activeLocaleCode !== ""
  const shouldShowPreviewAction = canOpenPublishedPage && !hasChanges
  function openPublishedWatchPage(routeSlug = publishedRouteSlug) {
    const nextPublishedWatchUrl = buildPublishedWatchUrl(
      routeSlug,
      activeLocaleCode,
      watchOrigin,
    )
    if (!nextPublishedWatchUrl) {
      pushToast("Unable to build the published preview URL.", "error")
      return
    }
    window.open(nextPublishedWatchUrl, "_blank", "noopener,noreferrer")
  }
  const isFloatingDrawerOpen =
    inlineBlockLibraryOpen || revisionHistoryOpen || localeDrawerOpen
  const isAddingToContainerSlot = focusedContainerIndex !== null
  const isAddingToSection = focusedSectionIndex !== null
  const availableBlockLibrary = BLOCK_LIBRARY.filter((block) => {
    if (isAddingToContainerSlot) {
      return CONTAINER_SLOT_CONTENT_TEMPLATES.includes(
        block.key as ContainerSlotContentTemplateKey,
      )
    }

    if (isAddingToSection) {
      return SECTION_CONTENT_TEMPLATES.includes(
        block.key as SectionContentTemplateKey,
      )
    }

    if (block.key === "watchHomeHero") return isHomepage

    return isTemplate || block.category !== "Route"
  })
  const blockCategories = [
    "All",
    ...Array.from(
      new Set(availableBlockLibrary.map((block) => block.category)),
    ),
  ] as BlockCategoryFilter[]
  const effectiveBlockCategoryFilter = blockCategories.includes(
    blockCategoryFilter,
  )
    ? blockCategoryFilter
    : "All"
  const normalizedBlockQuery = blockSearchQuery.trim().toLowerCase()
  const filteredBlockLibrary = availableBlockLibrary.filter((block) => {
    const matchesCategory =
      effectiveBlockCategoryFilter === "All" ||
      block.category === effectiveBlockCategoryFilter
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
          : videoPickerMode === "mediaCollectionAppend"
            ? "media collection"
            : "block"
  const videoPickerDialogTitle =
    videoPickerMode === "carouselAppend"
      ? "Add carousel video"
      : videoPickerMode === "mediaCollectionAppend"
        ? "Add media collection video"
        : "Choose a video"
  const videoPickerDialogDescription =
    videoPickerMode === "carouselAppend"
      ? "Browse the current library, search by title or Core ID, and pick a video to add into this carousel."
      : videoPickerMode === "mediaCollectionAppend"
        ? "Browse the current library, search by title or Core ID, and pick a video to add into this media collection."
        : "Browse the current library, search by title or Core ID, and use the filters below to narrow the set before attaching a video to the selected block."
  const videoPickerCurrentAttachmentLabel = videoPickerCurrentVideo
    ? `Current ${videoPickerBlockLabel} video: ${videoPickerCurrentVideo.title}`
    : videoPickerMode === "carouselAppend" ||
        videoPickerMode === "mediaCollectionAppend"
      ? `Pick a video to add it to this ${videoPickerBlockLabel}.`
      : `No video currently attached to this ${videoPickerBlockLabel}.`
  const activeLocaleEntry = localeEntries.find((entry) => entry.active)
  const cleanedNewLocaleCode = cleanLocaleCode(newLocaleCode, true)
  const newLocaleAlreadyExists = localeEntries.some(
    (entry) => entry.code.toLowerCase() === cleanedNewLocaleCode,
  )
  const currentLocaleCode = activeLocaleEntry?.code ?? "en"
  const normalizedVideoLibraryQuery = videoLibraryQuery.trim().toLowerCase()
  const filteredVideoLibrary = useMemo(
    () =>
      [...videoLibrary]
        .filter((item) => {
          const carouselAlreadyIncludes =
            (videoPickerMode === "carouselAppend" ||
              videoPickerMode === "mediaCollectionAppend") &&
            asArray(videoPickerBlockRecord?.items).some(
              (entry) => asString(asRecord(entry)?.videoId) === item.key,
            )
          if (carouselAlreadyIncludes) return false
          const haystack =
            `${item.title} ${item.description ?? ""} ${item.id} ${
              item.labelLabel ?? ""
            } ${item.sourceLabel} ${item.dubs}`.toLowerCase()
          const matchesQuery =
            normalizedVideoLibraryQuery.length === 0 ||
            videoLibrarySearchResultKeys.has(item.key) ||
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
        }),
    [
      normalizedVideoLibraryQuery,
      videoLibrary,
      videoLibrarySearchResultKeys,
      videoLibrarySort,
      videoPickerBlockRecord,
      videoPickerMode,
    ],
  )

  useEffect(() => {
    if (videoPickerBlockIndex === null) return
    if (!searchVideoLibraryAction) return

    const query = videoLibraryQuery.trim()
    if (!query) {
      setVideoLibrarySearchPending(false)
      setVideoLibrarySearchError(false)
      setVideoLibrarySearchResultKeys(new Set())
      return
    }

    let ignore = false
    setVideoLibrarySearchPending(true)
    setVideoLibrarySearchError(false)
    const timeout = window.setTimeout(() => {
      searchVideoLibraryAction(query)
        .then((results) => {
          if (ignore) return
          setVideoLibrarySearchResultKeys(
            new Set(results.map((result) => result.key)),
          )
          setVideoLibrarySearchError(false)
        })
        .catch(() => {
          if (ignore) return
          setVideoLibrarySearchResultKeys(new Set())
          setVideoLibrarySearchError(true)
        })
        .finally(() => {
          if (ignore) return
          setVideoLibrarySearchPending(false)
        })
    }, 220)

    return () => {
      ignore = true
      window.clearTimeout(timeout)
    }
  }, [searchVideoLibraryAction, videoLibraryQuery, videoPickerBlockIndex])

  const videoPickerLibraryRows = useMemo(
    () => [
      ...(videoPickerMode === "block" && videoPickerCurrentVideo
        ? [videoPickerCurrentVideo]
        : []),
      ...filteredVideoLibrary.filter(
        (item) => item.key !== videoPickerCurrentVideo?.key,
      ),
    ],
    [filteredVideoLibrary, videoPickerCurrentVideo, videoPickerMode],
  )
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
  const infoIconPickerBlock =
    infoBlockIconPicker === null
      ? null
      : asRecord(parsedBlocks[infoBlockIconPicker.blockIndex])
  const infoIconPickerItem =
    infoBlockIconPicker === null || infoIconPickerBlock === null
      ? null
      : asRecord(
          asArray(infoIconPickerBlock.blocks)[infoBlockIconPicker.itemIndex],
        )
  const infoIconPickerOption =
    infoIconPickerItem === null
      ? null
      : resolveInfoBlockIcon(infoIconPickerItem.icon)
  const normalizedInfoIconQuery = infoBlockIconQuery.trim().toLowerCase()
  const infoIconQueryTerms = normalizedInfoIconQuery
    .split(/\s+/)
    .filter(Boolean)
  const filteredInfoIconOptions =
    infoIconQueryTerms.length === 0
      ? INFO_BLOCK_ICON_OPTIONS
      : INFO_BLOCK_ICON_OPTIONS.filter((option) => {
          const haystack = [option.label, option.value, ...option.aliases]
            .join(" ")
            .toLowerCase()
          return infoIconQueryTerms.every((term) => haystack.includes(term))
        })

  const updateNavigationDestinationPickerPosition = useCallback(() => {
    if (!navigationDestinationPicker || typeof window === "undefined") return

    const trigger = document.querySelector<HTMLButtonElement>(
      `[data-navigation-destination-trigger="${navigationDestinationPicker.blockIndex}-${navigationDestinationPicker.itemIndex}"]`,
    )
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const gutter = 12
    const width = Math.max(260, rect.width)
    const left = Math.min(
      Math.max(gutter, rect.left),
      window.innerWidth - width - gutter,
    )
    const maxListHeight = 240
    const opensAbove =
      rect.bottom + 8 + maxListHeight > window.innerHeight - gutter &&
      rect.top > maxListHeight + gutter
    const top = opensAbove
      ? Math.max(gutter, rect.top - maxListHeight - 8)
      : Math.min(rect.bottom + 8, window.innerHeight - gutter - maxListHeight)

    setNavigationDestinationPickerPosition({ top, left, width })
  }, [navigationDestinationPicker])

  useEffect(() => {
    if (parsedBlocks.length === 0) {
      setSelectedBlockIndex(null)
      setInfoBlockIconPicker(null)
      setCardBackgroundPickerIndex(null)
      setNavigationDestinationPicker(null)
      return
    }

    setSelectedBlockIndex((current) => {
      if (current === null) return 0
      return current >= parsedBlocks.length ? parsedBlocks.length - 1 : current
    })
  }, [parsedBlocks.length])

  useEffect(() => {
    if (!infoBlockIconPicker) return
    if (selectedBlockIndex === infoBlockIconPicker.blockIndex) return
    setInfoBlockIconPicker(null)
  }, [infoBlockIconPicker, selectedBlockIndex])

  useEffect(() => {
    if (cardBackgroundPickerIndex === null) return
    if (selectedBlockIndex === cardBackgroundPickerIndex) return
    setCardBackgroundPickerIndex(null)
  }, [cardBackgroundPickerIndex, selectedBlockIndex])

  useEffect(() => {
    if (!navigationDestinationPicker) return
    if (selectedBlockIndex === navigationDestinationPicker.blockIndex) return
    setNavigationDestinationPicker(null)
  }, [navigationDestinationPicker, selectedBlockIndex])

  useEffect(() => {
    if (infoBlockIconPicker !== null) return
    setInfoBlockIconQuery("")
  }, [infoBlockIconPicker])

  useEffect(() => {
    if (
      deleteBlockIndex !== null ||
      pendingContainerSlotDelete !== null ||
      restoreRevisionId !== null ||
      infoBlockIconPicker !== null ||
      ctaLinkModalVisible ||
      videoPickerBlockIndex !== null
    ) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        (event.key !== "Delete" && event.key !== "Backspace")
      ) {
        return
      }

      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest("input,textarea,select,[contenteditable=true]")
      ) {
        return
      }

      if (
        focusedContainerIndex !== null &&
        focusedContainerSlotIndex !== null
      ) {
        event.preventDefault()
        const container = asRecord(parsedBlocks[focusedContainerIndex])
        if (container?.t !== "container") return
        const content = readContainerContent(container)
        const markers = containerSlotMarkerIndexes(content)
        const startIndex = markers[focusedContainerSlotIndex]
        if (startIndex === undefined) return
        const endIndex =
          markers[focusedContainerSlotIndex + 1] ?? content.length
        if (containerSlotDeleteCloseTimeout.current !== null) {
          window.clearTimeout(containerSlotDeleteCloseTimeout.current)
          containerSlotDeleteCloseTimeout.current = null
        }
        setPendingContainerSlotDelete({
          containerIndex: focusedContainerIndex,
          slotIndex: focusedContainerSlotIndex,
          blockCount: content
            .slice(startIndex + 1, endIndex)
            .filter((item) => !isContainerSlotBlock(item)).length,
        })
        setIsContainerSlotDeleteOpen(true)
        return
      }

      if (selectedBlockIndex === null) return

      event.preventDefault()
      setDeleteBlockIndex(selectedBlockIndex)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    ctaLinkModalVisible,
    deleteBlockIndex,
    focusedContainerIndex,
    focusedContainerSlotIndex,
    infoBlockIconPicker,
    pendingContainerSlotDelete,
    parsedBlocks,
    pushToast,
    restoreRevisionId,
    selectedBlockIndex,
    videoPickerBlockIndex,
  ])

  useEffect(() => {
    if (infoBlockIconPicker === null) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setInfoBlockIconPicker(null)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [infoBlockIconPicker])

  useEffect(() => {
    if (!navigationDestinationPicker) {
      setNavigationDestinationPickerPosition(null)
      return
    }

    const activePicker = navigationDestinationPicker
    updateNavigationDestinationPickerPosition()
    let frameId: number | null = null
    const startedAt = performance.now()

    function trackLayoutAnimation(now: number) {
      updateNavigationDestinationPickerPosition()
      if (now - startedAt >= 360) {
        frameId = null
        return
      }
      frameId = window.requestAnimationFrame(trackLayoutAnimation)
    }

    frameId = window.requestAnimationFrame(trackLayoutAnimation)

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNavigationDestinationPicker(null)
      }
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (navigationDestinationPopoverRef.current?.contains(target)) return
      const trigger = document.querySelector<HTMLButtonElement>(
        `[data-navigation-destination-trigger="${activePicker.blockIndex}-${activePicker.itemIndex}"]`,
      )
      if (trigger?.contains(target)) return
      setNavigationDestinationPicker(null)
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", updateNavigationDestinationPickerPosition)
    window.addEventListener(
      "scroll",
      updateNavigationDestinationPickerPosition,
      true,
    )
    window.addEventListener("mousedown", handlePointerDown)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener(
        "resize",
        updateNavigationDestinationPickerPosition,
      )
      window.removeEventListener(
        "scroll",
        updateNavigationDestinationPickerPosition,
        true,
      )
      window.removeEventListener("mousedown", handlePointerDown)
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [navigationDestinationPicker, updateNavigationDestinationPickerPosition])

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
      if (ctaLinkModalOpenFrame.current !== null) {
        window.cancelAnimationFrame(ctaLinkModalOpenFrame.current)
      }
      if (ctaLinkModalCloseTimeout.current !== null) {
        window.clearTimeout(ctaLinkModalCloseTimeout.current)
      }
      if (containerSlotDeleteCloseTimeout.current !== null) {
        window.clearTimeout(containerSlotDeleteCloseTimeout.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!ctaLinkModalVisible) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        closeCtaLinkModal()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [ctaLinkModalVisible])

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
      videoPickerLibraryRows.some(
        (video) => video.key === videoPickerDraft.videoKey,
      )
    ) {
      return
    }

    setVideoPickerDraft((current) => {
      const nextVideoKey =
        videoPickerLibraryRows[0]?.key ?? videoPickerCurrentVideo?.key ?? null
      if (current.videoKey === nextVideoKey) {
        return current
      }
      return {
        ...current,
        videoKey: nextVideoKey,
      }
    })
  }, [
    videoPickerLibraryRows,
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

  const syncBlocks = useCallback(
    (nextBlocks: unknown[], nextSelected = selectedBlockIndex) => {
      setParsedBlocks(nextBlocks)
      setSelectedBlockIndex(nextSelected)
    },
    [selectedBlockIndex],
  )

  function nestedCanvasBlockIndex(location: NestedCanvasBlockLocation) {
    if (location.kind === "section") {
      return (
        -1 -
        SECTION_NESTED_CANVAS_OFFSET -
        location.sectionIndex * NESTED_CANVAS_INDEX_BASE -
        location.childIndex
      )
    }

    return (
      -1 -
      location.containerIndex * NESTED_CANVAS_INDEX_BASE -
      location.childIndex
    )
  }

  function nestedCanvasBlockLocation(
    index: number,
  ): NestedCanvasBlockLocation | null {
    if (index >= 0) return null

    const encoded = Math.abs(index + 1)
    if (encoded >= SECTION_NESTED_CANVAS_OFFSET) {
      const sectionEncoded = encoded - SECTION_NESTED_CANVAS_OFFSET
      const sectionIndex = Math.floor(sectionEncoded / NESTED_CANVAS_INDEX_BASE)
      const childIndex = sectionEncoded % NESTED_CANVAS_INDEX_BASE

      return { kind: "section", sectionIndex, childIndex }
    }

    const containerIndex = Math.floor(encoded / NESTED_CANVAS_INDEX_BASE)
    const childIndex = encoded % NESTED_CANVAS_INDEX_BASE

    return { kind: "container", containerIndex, childIndex }
  }

  function readBlockAt(index: number) {
    const location = nestedCanvasBlockLocation(index)
    if (!location) return asRecord(parsedBlocks[index])

    if (location.kind === "section") {
      const section = asRecord(parsedBlocks[location.sectionIndex])
      if (section?.t !== "section") return null
      return asRecord(asArray(section.content)[location.childIndex])
    }

    const container = asRecord(parsedBlocks[location.containerIndex])
    if (container?.t !== "container") return null
    const block = readContainerContent(container)[location.childIndex]
    if (isContainerSlotBlock(block)) return null
    return asRecord(block)
  }

  const activateBlock = useCallback((index: number) => {
    setPendingInsertIndex(null)
    setInfoBlockIconPicker((current) =>
      current && current.blockIndex !== index ? null : current,
    )
    if (nestedCanvasBlockLocation(index)) {
      setFocusedContainerSlotIndex(null)
    }
    setSelectedBlockIndex(index)
  }, [])

  function openContainerWorkspace(index: number) {
    activateBlock(index)
    setFocusedSectionIndex(null)
    setFocusedContainerIndex(index)
    setFocusedContainerSlotIndex(0)
  }

  function closeContainerWorkspace() {
    setFocusedContainerIndex(null)
    setFocusedContainerSlotIndex(null)
  }

  function openSectionWorkspace(index: number) {
    activateBlock(index)
    setFocusedContainerIndex(null)
    setFocusedContainerSlotIndex(null)
    setFocusedSectionIndex(index)
  }

  function closeSectionWorkspace() {
    if (focusedSectionIndex !== null) {
      setSelectedBlockIndex(focusedSectionIndex)
    }
    setPendingInsertIndex(null)
    setFocusedSectionIndex(null)
  }

  function selectedContainerSlotIndex(container: BlockRecord) {
    const markers = containerSlotMarkerIndexes(readContainerContent(container))
    if (markers.length === 0) return -1
    return Math.min(
      Math.max(focusedContainerSlotIndex ?? 0, 0),
      markers.length - 1,
    )
  }

  function containerInsertionIndexFromTarget(
    container: BlockRecord,
    targetIndex: number,
  ) {
    const content = readContainerContent(container)
    const explicitLocation = nestedCanvasBlockLocation(targetIndex)
    if (
      explicitLocation &&
      explicitLocation.kind === "container" &&
      explicitLocation.containerIndex === focusedContainerIndex
    ) {
      return Math.min(explicitLocation.childIndex + 1, content.length)
    }

    const selectedLocation =
      selectedBlockIndex === null
        ? null
        : nestedCanvasBlockLocation(selectedBlockIndex)
    if (
      selectedLocation &&
      selectedLocation.kind === "container" &&
      selectedLocation.containerIndex === focusedContainerIndex
    ) {
      return Math.min(selectedLocation.childIndex + 1, content.length)
    }

    const markers = containerSlotMarkerIndexes(content)
    const selectedSlot = selectedContainerSlotIndex(container)
    const markerIndex = markers[selectedSlot]
    if (markerIndex !== undefined) {
      return Math.min(markerIndex + 1, content.length)
    }

    return content.length
  }

  function containerInsertIndexForSlot(content: unknown[], slotIndex: number) {
    const markers = containerSlotMarkerIndexes(content)
    const markerIndex = markers[slotIndex]
    if (markerIndex === undefined) return content.length
    const nextMarkerIndex = markers[slotIndex + 1]
    return nextMarkerIndex === undefined ? content.length : nextMarkerIndex
  }

  function insertBlock(template: BlockTemplateKey, index: number) {
    if (focusedContainerIndex !== null) {
      const container = asRecord(parsedBlocks[focusedContainerIndex])
      if (
        container?.t !== "container" ||
        !CONTAINER_SLOT_CONTENT_TEMPLATES.includes(
          template as ContainerSlotContentTemplateKey,
        )
      ) {
        pushToast("Select a container position before adding a block.", "error")
        return
      }

      insertContainerContentBlock(
        focusedContainerIndex,
        containerInsertionIndexFromTarget(container, index),
        template as ContainerSlotContentTemplateKey,
      )
      setFocusedContainerSlotIndex(null)
      setPendingInsertIndex(null)
      pushToast("Block added to slot.", "success")
      return
    }

    if (focusedSectionIndex !== null) {
      const section = asRecord(parsedBlocks[focusedSectionIndex])
      if (
        section?.t !== "section" ||
        !SECTION_CONTENT_TEMPLATES.includes(
          template as SectionContentTemplateKey,
        )
      ) {
        pushToast("Select a section position before adding a block.", "error")
        return
      }

      insertSectionContentBlock(
        focusedSectionIndex,
        index,
        template as SectionContentTemplateKey,
      )
      setPendingInsertIndex(null)
      pushToast("Block added to section.", "success")
      return
    }

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
    pushToast("Block added.", "success")
  }

  function openAddBlockPicker(index: number) {
    setPendingInsertIndex(index)
    setInlineBlockLibraryOpen(true)
  }

  function containerAddTargetChildIndex(content: unknown[], slotIndex: number) {
    const markers = containerSlotMarkerIndexes(content)
    const markerIndex = markers[slotIndex]
    if (markerIndex === undefined) return null

    const nextMarkerIndex = markers[slotIndex + 1] ?? content.length
    let targetChildIndex = markerIndex
    for (
      let childIndex = markerIndex + 1;
      childIndex < nextMarkerIndex;
      childIndex += 1
    ) {
      if (!isContainerSlotBlock(content[childIndex])) {
        targetChildIndex = childIndex
      }
    }

    return targetChildIndex
  }

  function openToolbarAddBlockPicker() {
    setRevisionHistoryOpen(false)
    setLocaleDrawerOpen(false)

    if (
      isSectionWorkspaceOpen &&
      focusedSectionIndex !== null &&
      focusedSectionRecord
    ) {
      setPendingInsertIndex(asArray(focusedSectionRecord.content).length)
      setInlineBlockLibraryOpen(true)
      return
    }

    if (
      isContainerWorkspaceOpen &&
      focusedContainerIndex !== null &&
      focusedContainerRecord
    ) {
      const content = readContainerContent(focusedContainerRecord)
      const markers = containerSlotMarkerIndexes(content)
      if (markers.length === 0) {
        pushToast("Choose a slot layout before adding blocks.", "error")
        return
      }

      const slotIndex = Math.min(
        Math.max(focusedContainerSlotIndex ?? 0, 0),
        markers.length - 1,
      )
      const targetChildIndex = containerAddTargetChildIndex(content, slotIndex)
      if (targetChildIndex === null) return

      setFocusedContainerSlotIndex(slotIndex)
      setPendingInsertIndex(
        nestedCanvasBlockIndex({
          kind: "container",
          containerIndex: focusedContainerIndex,
          childIndex: targetChildIndex,
        }),
      )
      setInlineBlockLibraryOpen(true)
      return
    }

    setFocusedContainerIndex(null)
    setFocusedSectionIndex(null)
    setFocusedContainerSlotIndex(null)
    openAddBlockPicker(parsedBlocks.length)
  }

  function renderPendingInsertMarker() {
    return (
      <div className="flex h-full w-full animate-[pendingInsertIn_180ms_cubic-bezier(0.22,1,0.36,1)_both] items-center rounded-sm border border-dashed border-[var(--color-hairline-strong)] bg-[color-mix(in_oklab,var(--color-surface)_88%,black)] px-4 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.24)]">
        <div className="flex items-center gap-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)]">
            <Plus className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
              Insert position
            </div>
            <div className="mt-1 text-[12px] font-medium text-[var(--color-text-primary)]">
              New block will appear here
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderInlineBlockLibrary() {
    return (
      <div
        className={cx(
          "pointer-events-none fixed inset-y-0 right-0 z-40 transition-transform duration-[240ms] ease-out",
          inlineBlockLibraryOpen ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!inlineBlockLibraryOpen}
      >
        <aside
          className="pointer-events-auto flex h-full w-[min(420px,calc(100vw-1rem))] flex-col overflow-hidden border-l border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[0_24px_80px_rgba(0,0,0,0.42)]"
          aria-label="Add block"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-hairline)] px-4 py-3">
            <div>
              <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                Add block
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
                Choose a block for the selected insert position.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setInlineBlockLibraryOpen(false)
                setPendingInsertIndex(null)
              }}
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
              aria-label="Close block library"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]">
            <div className="grid gap-3">
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
                  strokeWidth={1.5}
                />
                <input
                  value={blockSearchQuery}
                  onChange={(event) => setBlockSearchQuery(event.target.value)}
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
                      effectiveBlockCategoryFilter === category
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
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.blocks.map((block) => (
                        <button
                          key={block.key}
                          type="button"
                          onClick={() => {
                            insertBlock(
                              block.key,
                              pendingInsertIndex ??
                                (selectedBlockIndex === null
                                  ? parsedBlocks.length
                                  : selectedBlockIndex + 1),
                            )
                            setInlineBlockLibraryOpen(false)
                          }}
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
        </aside>
      </div>
    )
  }

  function renderRevisionHistoryDrawer() {
    return (
      <div
        className={cx(
          "pointer-events-none fixed inset-y-0 right-0 z-40 transition-transform duration-[240ms] ease-out",
          revisionHistoryOpen ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!revisionHistoryOpen}
      >
        <aside
          className="pointer-events-auto flex h-full w-[min(420px,calc(100vw-1rem))] flex-col overflow-hidden border-l border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[0_24px_80px_rgba(0,0,0,0.42)]"
          aria-label="Revision timeline"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-hairline)] px-4 py-3">
            <div>
              <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                Revision Timeline
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
                {revisionEntries.length === 0
                  ? "No revisions yet"
                  : `${revisionEntries.length} ${revisionEntries.length === 1 ? "entry" : "entries"}`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRevisionHistoryOpen(false)}
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
              aria-label="Close revision timeline"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]">
            {revisionEntries.length === 0 ? (
              <div className="p-4 text-[13px] text-[var(--color-text-muted)]">
                No revision entries have been recorded for this locale yet.
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
        </aside>
      </div>
    )
  }

  async function handleCreateLocale(formData: FormData) {
    const locale = cleanLocaleCode(String(formData.get("locale") ?? ""), true)
    if (!locale) {
      setNewLocaleError("Enter a locale code.")
      return
    }
    if (localeEntries.some((entry) => entry.code.toLowerCase() === locale)) {
      setNewLocaleError("That locale already exists.")
      return
    }

    formData.set("locale", locale)
    setNewLocaleError("")
    setIsCreatingLocale(true)

    try {
      const result = await createLocaleAction(formData)
      if (!result.ok) {
        setNewLocaleError(result.error ?? "Unable to add locale.")
        return
      }

      setNewLocaleCode("")
      setLocaleDrawerOpen(false)
      pushToast(`Locale ${locale} added.`, "success")
      if (result.href) {
        router.push(result.href as NextRoute)
      }
      startTransition(() => {
        router.refresh()
      })
    } finally {
      setIsCreatingLocale(false)
    }
  }

  function renderLocaleDrawer() {
    return (
      <div
        className={cx(
          "pointer-events-none fixed inset-y-0 right-0 z-40 transition-transform duration-[240ms] ease-out",
          localeDrawerOpen ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!localeDrawerOpen}
      >
        <aside
          className="pointer-events-auto flex h-full w-[min(420px,calc(100vw-1rem))] flex-col overflow-hidden border-l border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[0_24px_80px_rgba(0,0,0,0.42)]"
          aria-label="Locales"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-hairline)] px-4 py-3">
            <div>
              <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                Locales
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
                Switch between language drafts for this experience.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLocaleDrawerOpen(false)}
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
              aria-label="Close locales"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]">
            <form
              action={handleCreateLocale}
              className="mb-4 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3"
            >
              <div className="flex items-center gap-2">
                <input
                  name="locale"
                  value={newLocaleCode}
                  onChange={(event) => {
                    setNewLocaleCode(cleanLocaleCode(event.target.value))
                    setNewLocaleError("")
                  }}
                  onBlur={() => setNewLocaleCode(cleanedNewLocaleCode)}
                  placeholder="Add locale"
                  aria-label="New locale code"
                  className="h-9 min-w-0 flex-1 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 font-mono text-[12px] text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-hairline-strong)]"
                />
                <button
                  type="submit"
                  disabled={
                    isCreatingLocale ||
                    !cleanedNewLocaleCode ||
                    newLocaleAlreadyExists
                  }
                  className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Add
                </button>
              </div>
              <input type="hidden" name="title" value={title} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="pathSegment" value={pathSegment} />
              <input
                type="hidden"
                name="metaDescription"
                value={metaDescription}
              />
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
              {newLocaleError ? (
                <div className="mt-2 text-[12px] text-[var(--color-danger)]">
                  {newLocaleError}
                </div>
              ) : (
                <div className="mt-2 text-[12px] text-[var(--color-text-muted)]">
                  Starts from the current locale.
                </div>
              )}
            </form>
            <div className="overflow-hidden rounded-sm border border-[var(--color-hairline)]">
              {localeEntries.map((locale) => (
                <a
                  key={locale.id}
                  href={locale.href}
                  className={cx(
                    "flex min-h-12 items-center justify-between gap-3 border-b border-[var(--color-hairline)] px-3 py-2 transition-all duration-[120ms] ease-out last:border-b-0",
                    locale.active
                      ? "border-l-2 border-l-[var(--color-text-primary)] bg-[var(--color-surface-raised)] pl-2.5 text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={cx(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          localeDotClass(locale.stateTone),
                        )}
                      />
                      <span className="font-mono text-[12px]">
                        {locale.code}
                      </span>
                      <span className="truncate text-[12px]">
                        {locale.title}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
                      {locale.stateLabel}
                    </div>
                  </div>
                  {locale.active ? (
                    <Check className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  ) : null}
                </a>
              ))}
            </div>
          </div>
        </aside>
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
    [activateBlock, blockSummaries],
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
    const location = nestedCanvasBlockLocation(index)
    if (location) {
      if (location.kind === "section") {
        const section = asRecord(parsedBlocks[location.sectionIndex])
        if (section?.t !== "section") return

        const nextBlocks = [...parsedBlocks]
        nextBlocks[location.sectionIndex] = {
          ...section,
          content: asArray(section.content).map((item, childIndex) => {
            if (childIndex !== location.childIndex) return item
            const itemRecord = asRecord(item)
            return itemRecord ? updater(itemRecord) : item
          }),
        }
        syncBlocks(nextBlocks, index)
        return
      }

      const container = asRecord(parsedBlocks[location.containerIndex])
      if (container?.t !== "container") return

      const nextBlocks = [...parsedBlocks]
      nextBlocks[location.containerIndex] = {
        ...container,
        content: readContainerContent(container).map((item, childIndex) => {
          if (childIndex !== location.childIndex) return item
          if (isContainerSlotBlock(item)) return item
          const itemRecord = asRecord(item)
          return itemRecord ? updater(itemRecord) : item
        }),
      }
      syncBlocks(nextBlocks, index)
      return
    }

    const current = asRecord(parsedBlocks[index])
    if (!current) return
    const nextBlocks = [...parsedBlocks]
    nextBlocks[index] = updater(current)
    syncBlocks(nextBlocks, index)
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

  function updateBlockNumberField(index: number, field: string, value: string) {
    const trimmed = value.trim()
    const parsed = Number(trimmed)
    const nextValue =
      trimmed.length === 0 || !Number.isFinite(parsed)
        ? undefined
        : field === "backgroundOpacity"
          ? clampNumber(parsed, 0, 1)
          : parsed

    updateBlockAt(index, (block) => ({
      ...block,
      [field]: nextValue,
    }))
  }

  function updateBlockBooleanField(
    index: number,
    field: string,
    checked: boolean,
  ) {
    updateBlockAt(index, (block) => ({
      ...block,
      [field]: checked,
    }))
  }

  function updateBlockParagraphsField(index: number, value: string) {
    updateBlockAt(index, (block) => ({
      ...block,
      contentParagraphs: contentParagraphsFromEditorText(value, block.variant),
    }))
  }

  function insertSectionContentBlock(
    index: number,
    insertIndex: number,
    template: SectionContentTemplateKey,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "section") return block
      const content = asArray(block.content)
      const nextContent = [...content]
      const targetIndex = Math.min(Math.max(insertIndex, 0), content.length)
      nextContent.splice(
        targetIndex,
        0,
        createNestedTemplateBlock(template, content.length),
      )
      return {
        ...block,
        content: nextContent,
      }
    })
  }

  function removeSectionContentBlock(index: number, childIndex: number) {
    updateBlockAt(index, (block) => {
      if (block.t !== "section") return block
      return {
        ...block,
        content: asArray(block.content).filter(
          (_, currentIndex) => currentIndex !== childIndex,
        ),
      }
    })
  }

  function moveSectionContentBlockToIndex(
    index: number,
    fromIndex: number,
    toIndex: number,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "section") return block
      const content = [...asArray(block.content)]
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= content.length ||
        toIndex >= content.length ||
        fromIndex === toIndex
      ) {
        return block
      }
      return { ...block, content: arrayMove(content, fromIndex, toIndex) }
    })
  }

  function updateContainerSlotSpan(
    index: number,
    slotIndex: number,
    viewport: GridBreakpoint,
    value: number,
  ) {
    const gridSpan = Math.round(clampNumber(value, 1, 12))
    updateBlockAt(index, (block) => {
      if (block.t !== "container") return block
      const content = readContainerContent(block)
      const markerIndex = containerSlotMarkerIndexes(content)[slotIndex]
      if (markerIndex === undefined) return block
      return {
        ...block,
        content: content.map((item, currentIndex) => {
          if (currentIndex !== markerIndex) return item
          const slotRecord = asRecord(item) ?? {}
          if (!isContainerSlotBlock(slotRecord)) return item
          return writeContainerSlotSpan(slotRecord, viewport, gridSpan)
        }),
      }
    })
  }

  function updateContainerSlotVisual(
    index: number,
    slotIndex: number,
    field: "backgroundColor" | "backgroundImageUrl",
    value: string,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "container") return block
      const content = readContainerContent(block)
      const markerIndex = containerSlotMarkerIndexes(content)[slotIndex]
      if (markerIndex === undefined) return block
      return {
        ...block,
        content: content.map((item, currentIndex) => {
          if (currentIndex !== markerIndex) return item
          const slotRecord = asRecord(item) ?? {}
          if (!isContainerSlotBlock(slotRecord)) return item
          return {
            ...slotRecord,
            [field]: value,
          }
        }),
      }
    })
  }

  function mediaAssetPreviewUrl(assetId: unknown) {
    const id = asString(assetId)
    if (!id) return ""
    return (
      mediaLibrary.images.find((asset) => asset.id === id)?.previewUrl ?? ""
    )
  }

  function chooseBackgroundImage(
    index: number,
    block: BlockRecord,
    field: ImagePickerUrlField,
  ) {
    openImagePicker(index, block, field)
  }

  function chooseContainerBackgroundImage(index: number, block: BlockRecord) {
    openImagePicker(index, block, "backgroundImageUrl")
  }

  function chooseVideoCarouselItemImage(index: number, itemIndex: number) {
    const blockRecord = asRecord(parsedBlocks[index])
    const itemRecord = asRecord(asArray(blockRecord?.items)[itemIndex])
    openImagePickerTarget({
      label: "carousel item image",
      selectedAssetId:
        asString(itemRecord?.imageOverrideAssetId) ||
        asString(itemRecord?.imageAssetId) ||
        null,
      canClear: Boolean(
        asString(itemRecord?.imageOverrideAssetId) ||
        asString(itemRecord?.imageAssetId),
      ),
      apply: (asset) => {
        updateBlockAt(index, (block) => {
          if (block.t !== "videoCarousel") return block
          return {
            ...block,
            items: asArray(block.items).map((item, currentIndex) =>
              currentIndex === itemIndex
                ? {
                    ...(asRecord(item) ?? {}),
                    imageOverrideUrl: "",
                    imageOverrideAssetId: asset.id,
                    imageUrl: "",
                    imageAssetId: "",
                  }
                : item,
            ),
          }
        })
      },
      clear: () => {
        updateBlockAt(index, (block) => {
          if (block.t !== "videoCarousel") return block
          return {
            ...block,
            items: asArray(block.items).map((item, currentIndex) =>
              currentIndex === itemIndex
                ? {
                    ...(asRecord(item) ?? {}),
                    imageOverrideUrl: "",
                    imageOverrideAssetId: "",
                    imageUrl: "",
                    imageAssetId: "",
                  }
                : item,
            ),
          }
        })
      },
    })
  }

  function chooseNavigationCarouselItemImage(index: number, itemIndex: number) {
    const blockRecord = asRecord(parsedBlocks[index])
    const itemRecord = asRecord(asArray(blockRecord?.items)[itemIndex])
    openImagePickerTarget({
      label: "navigation destination image",
      selectedAssetId: asString(itemRecord?.imageAssetId) || null,
      canClear: Boolean(asString(itemRecord?.imageAssetId)),
      apply: (asset) => {
        updateBlockAt(index, (block) => {
          if (block.t !== "navigationCarousel") return block
          return {
            ...block,
            items: asArray(block.items).map((item, currentIndex) =>
              currentIndex === itemIndex
                ? {
                    ...(asRecord(item) ?? {}),
                    imageUrl: "",
                    imageAssetId: asset.id,
                  }
                : item,
            ),
          }
        })
      },
      clear: () => {
        updateBlockAt(index, (block) => {
          if (block.t !== "navigationCarousel") return block
          return {
            ...block,
            items: asArray(block.items).map((item, currentIndex) =>
              currentIndex === itemIndex
                ? {
                    ...(asRecord(item) ?? {}),
                    imageUrl: "",
                    imageAssetId: "",
                  }
                : item,
            ),
          }
        })
      },
    })
  }

  function chooseMediaCollectionItemImage(index: number, itemIndex: number) {
    const blockRecord = asRecord(parsedBlocks[index])
    const itemRecord = asRecord(asArray(blockRecord?.items)[itemIndex])
    openImagePickerTarget({
      label: "media item image",
      selectedAssetId:
        asString(itemRecord?.imageOverrideAssetId) ||
        asString(itemRecord?.imageAssetId) ||
        null,
      canClear: Boolean(
        asString(itemRecord?.imageOverrideAssetId) ||
        asString(itemRecord?.imageAssetId),
      ),
      apply: (asset) => {
        updateBlockAt(index, (block) => {
          if (block.t !== "mediaCollection") return block
          return {
            ...block,
            items: asArray(block.items).map((item, currentIndex) =>
              currentIndex === itemIndex
                ? {
                    ...(asRecord(item) ?? {}),
                    imageOverrideUrl: "",
                    imageOverrideAssetId: asset.id,
                    imageUrl: "",
                    imageAssetId: "",
                  }
                : item,
            ),
          }
        })
      },
      clear: () => {
        updateBlockAt(index, (block) => {
          if (block.t !== "mediaCollection") return block
          return {
            ...block,
            items: asArray(block.items).map((item, currentIndex) =>
              currentIndex === itemIndex
                ? {
                    ...(asRecord(item) ?? {}),
                    imageOverrideUrl: "",
                    imageOverrideAssetId: "",
                    imageUrl: "",
                    imageAssetId: "",
                  }
                : item,
            ),
          }
        })
      },
    })
  }

  function chooseBibleQuoteImage(index: number, itemIndex: number) {
    const blockRecord = asRecord(parsedBlocks[index])
    const itemRecord = asRecord(asArray(blockRecord?.quotes)[itemIndex])
    openImagePickerTarget({
      label: "quote image",
      selectedAssetId:
        asString(itemRecord?.backgroundImageAssetId) ||
        asString(itemRecord?.imageAssetId) ||
        null,
      canClear: Boolean(
        asString(itemRecord?.backgroundImageAssetId) ||
        asString(itemRecord?.imageAssetId),
      ),
      apply: (asset) => {
        updateBlockAt(index, (block) => {
          if (block.t !== "bibleQuotesCarousel") return block
          return {
            ...block,
            quotes: asArray(block.quotes).map((item, currentIndex) =>
              currentIndex === itemIndex
                ? {
                    ...(asRecord(item) ?? {}),
                    backgroundImageUrl: "",
                    backgroundImageAssetId: asset.id,
                    imageUrl: "",
                    imageAssetId: asset.id,
                  }
                : item,
            ),
          }
        })
      },
      clear: () => {
        updateBlockAt(index, (block) => {
          if (block.t !== "bibleQuotesCarousel") return block
          return {
            ...block,
            quotes: asArray(block.quotes).map((item, currentIndex) =>
              currentIndex === itemIndex
                ? {
                    ...(asRecord(item) ?? {}),
                    backgroundImageUrl: "",
                    backgroundImageAssetId: "",
                    imageUrl: "",
                    imageAssetId: "",
                  }
                : item,
            ),
          }
        })
      },
    })
  }

  function openImagePicker(
    blockIndex: number,
    block: BlockRecord,
    urlField: ImagePickerUrlField,
  ) {
    const blockType = asString(block.t) || "block"
    const assetField = visualIdentityAssetField(urlField)
    openImagePickerTarget({
      label: blockType === "card" ? "card image" : `${blockType} image`,
      selectedAssetId: asString(block[assetField]) || null,
      canClear: Boolean(asString(block[assetField])),
      apply: (asset) => {
        updateBlockAt(blockIndex, (currentBlock) => ({
          ...currentBlock,
          [urlField]: "",
          [assetField]: asset.id,
        }))
      },
      clear: () => clearVisualIdentityImage(blockIndex, urlField),
    })
  }

  function openImagePickerTarget(target: ImagePickerTarget) {
    const selectedAsset = target.selectedAssetId
      ? mediaLibrary.images.find((asset) => asset.id === target.selectedAssetId)
      : null
    const rememberedFolderId =
      lastImagePickerFolderId === null ||
      mediaLibrary.folders.some(
        (folder) => folder.id === lastImagePickerFolderId,
      )
        ? lastImagePickerFolderId
        : null
    setImagePickerTarget({
      label: target.label,
      selectedAssetId: target.selectedAssetId,
      canClear: target.canClear,
      apply: target.apply,
      clear: target.clear,
    })
    setImageLibraryQuery("")
    setImagePickerSelectedFolderId(
      selectedAsset ? selectedAsset.folderId : rememberedFolderId,
    )
  }

  function closeImagePicker() {
    setImagePickerTarget(null)
    setImageLibraryQuery("")
    setImagePickerSelectedFolderId(null)
  }

  function selectImagePickerFolder(folderId: string | null) {
    setImagePickerSelectedFolderId(folderId)
    setLastImagePickerFolderId(folderId)
  }

  function applyImagePickerSelection(asset: MediaLibraryItem) {
    if (!imagePickerTarget || !asset.previewUrl) return

    imagePickerTarget.apply(asset)
    pushToast(`Attached ${asset.displayName}.`, "success")
    closeImagePicker()
  }

  function clearImagePickerSelection() {
    if (!imagePickerTarget) return

    imagePickerTarget.clear()
    pushToast(`Removed ${imagePickerTarget.label}.`, "success")
    closeImagePicker()
  }

  function clearVisualIdentityImage(
    index: number,
    urlField: ImagePickerUrlField,
  ) {
    const assetField = visualIdentityAssetField(urlField)
    updateBlockAt(index, (block) => ({
      ...block,
      [urlField]: "",
      [assetField]: "",
    }))
  }

  function appendContainerSlot(index: number) {
    updateBlockAt(index, (block) => {
      if (block.t !== "container") return block
      return {
        ...block,
        content: [...readContainerContent(block), createContainerSlotBlock(6)],
      }
    })
  }

  function applyContainerSlotPreset(index: number, spans: readonly number[]) {
    updateBlockAt(index, (block) => {
      if (block.t !== "container") return block
      const content = readContainerContent(block)
      return {
        ...block,
        content: [...createContainerSlotLayout(spans), ...content],
      }
    })
  }

  function containerSlotRange(container: BlockRecord, slotIndex: number) {
    const content = readContainerContent(container)
    const markers = containerSlotMarkerIndexes(content)
    const startIndex = markers[slotIndex]
    if (startIndex === undefined) return null
    return {
      content,
      startIndex,
      endIndex: markers[slotIndex + 1] ?? content.length,
    }
  }

  function countContainerSlotBlocks(container: BlockRecord, slotIndex: number) {
    const range = containerSlotRange(container, slotIndex)
    if (!range) return 0
    return range.content
      .slice(range.startIndex + 1, range.endIndex)
      .filter((item) => !isContainerSlotBlock(item)).length
  }

  function requestRemoveContainerSlot(index: number, slotIndex: number) {
    const container = asRecord(parsedBlocks[index])
    if (container?.t !== "container") return
    if (containerSlotDeleteCloseTimeout.current !== null) {
      window.clearTimeout(containerSlotDeleteCloseTimeout.current)
      containerSlotDeleteCloseTimeout.current = null
    }
    setPendingContainerSlotDelete({
      containerIndex: index,
      slotIndex,
      blockCount: countContainerSlotBlocks(container, slotIndex),
    })
    setIsContainerSlotDeleteOpen(true)
  }

  function removeContainerSlot(index: number, slotIndex: number) {
    updateBlockAt(index, (block) => {
      if (block.t !== "container") return block
      const range = containerSlotRange(block, slotIndex)
      if (!range) return block
      return {
        ...block,
        content: range.content.filter(
          (_, currentIndex) =>
            currentIndex < range.startIndex || currentIndex >= range.endIndex,
        ),
      }
    })
  }

  function insertContainerContentBlock(
    index: number,
    insertIndex: number,
    template: ContainerSlotContentTemplateKey,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "container") return block
      const content = readContainerContent(block)
      const safeInsertIndex = Math.min(Math.max(insertIndex, 0), content.length)
      return {
        ...block,
        content: [
          ...content.slice(0, safeInsertIndex),
          createNestedTemplateBlock(template, content.length),
          ...content.slice(safeInsertIndex),
        ],
      }
    })
  }

  function removeContainerContentBlock(index: number, childIndex: number) {
    updateBlockAt(index, (block) => {
      if (block.t !== "container") return block
      const content = readContainerContent(block)
      if (isContainerSlotBlock(content[childIndex])) return block
      return {
        ...block,
        content: content.filter(
          (_, currentIndex) => currentIndex !== childIndex,
        ),
      }
    })
  }

  function moveContainerContentBlock(
    index: number,
    fromIndex: number,
    toIndex: number,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "container") return block
      const content = readContainerContent(block)
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= content.length ||
        toIndex >= content.length ||
        fromIndex === toIndex ||
        isContainerSlotBlock(content[fromIndex]) ||
        isContainerSlotBlock(content[toIndex])
      ) {
        return block
      }
      return {
        ...block,
        content: arrayMove(content, fromIndex, toIndex),
      }
    })
  }

  function moveContainerContentBlockToSlot(
    index: number,
    fromIndex: number,
    slotIndex: number,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "container") return block
      const content = readContainerContent(block)
      const movedBlock = content[fromIndex]
      if (movedBlock === undefined || isContainerSlotBlock(movedBlock)) {
        return block
      }

      const withoutMoved = content.filter(
        (_, currentIndex) => currentIndex !== fromIndex,
      )
      const insertIndex = containerInsertIndexForSlot(withoutMoved, slotIndex)
      return {
        ...block,
        content: [
          ...withoutMoved.slice(0, insertIndex),
          movedBlock,
          ...withoutMoved.slice(insertIndex),
        ],
      }
    })
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

  function updateInfoBlockItemField(
    index: number,
    itemIndex: number,
    field: "icon" | "title" | "description",
    value: string,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "infoBlocks") return block
      const items = asArray(block.blocks)
      return {
        ...block,
        blocks: items.map((item, currentIndex) =>
          currentIndex === itemIndex
            ? { ...(asRecord(item) ?? {}), [field]: value }
            : item,
        ),
      }
    })
  }

  function appendInfoBlockItem(index: number) {
    updateBlockAt(index, (block) => {
      if (block.t !== "infoBlocks") return block
      return {
        ...block,
        blocks: [
          ...asArray(block.blocks),
          {
            icon: "favorite",
            title: "New card",
            description: "Add support copy for this card.",
          },
        ],
      }
    })
  }

  function removeInfoBlockItem(index: number, itemIndex: number) {
    updateBlockAt(index, (block) => {
      if (block.t !== "infoBlocks") return block
      return {
        ...block,
        blocks: asArray(block.blocks).filter(
          (_, currentIndex) => currentIndex !== itemIndex,
        ),
      }
    })
  }

  function reorderInfoBlockItems(
    index: number,
    fromIndex: number,
    toIndex: number,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "infoBlocks") return block
      const items = [...asArray(block.blocks)]
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
      return { ...block, blocks: items }
    })
  }

  function updateNavigationCarouselItemField(
    index: number,
    itemIndex: number,
    field:
      | "contentId"
      | "title"
      | "category"
      | "imageUrl"
      | "imageAssetId"
      | "backgroundColor",
    value: string,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "navigationCarousel") return block
      const items = asArray(block.items)
      return {
        ...block,
        items: items.map((item, currentIndex) =>
          currentIndex === itemIndex
            ? { ...(asRecord(item) ?? {}), [field]: value }
            : item,
        ),
      }
    })
  }

  function navigationDestinationOptions(index: number) {
    return parsedBlocks
      .map((block, blockIndex) => {
        if (blockIndex === index) return null
        const blockRecord = asRecord(block)
        const sectionKey = asString(blockRecord?.sectionKey)
        if (!sectionKey) return null
        const summary = summarizeBlock(block, blockIndex, videoLibrary)
        const visualIdentity = blockVisualIdentity(blockRecord)
        const selectedVideo = findVideoLibraryItem(blockRecord?.videoId)
        return {
          category: summary.typeLabel,
          backgroundColor: visualIdentity.backgroundColor,
          imageUrl:
            asString(blockRecord?.t) === "video" ||
            asString(blockRecord?.t) === "videoHero"
              ? (selectedVideo?.previewImageUrl ?? visualIdentity.imageUrl)
              : visualIdentity.imageUrl,
          sectionKey,
          title: summary.title || sectionKey,
        }
      })
      .filter(
        (
          option,
        ): option is {
          backgroundColor: string
          category: string
          imageUrl: string
          sectionKey: string
          title: string
        } => option !== null,
      )
  }

  function updateNavigationCarouselItemDestination(
    index: number,
    itemIndex: number,
    sectionKey: string,
  ) {
    const destination = navigationDestinationOptions(index).find(
      (option) => option.sectionKey === sectionKey,
    )

    updateBlockAt(index, (block) => {
      if (block.t !== "navigationCarousel") return block
      const items = asArray(block.items)
      return {
        ...block,
        items: items.map((item, currentIndex) =>
          currentIndex === itemIndex
            ? {
                ...(asRecord(item) ?? {}),
                contentId: sectionKey,
                backgroundColor: destination?.backgroundColor ?? "",
                imageUrl: destination?.imageUrl ?? "",
                title: destination?.title ?? asString(asRecord(item)?.title),
                category:
                  destination?.category ?? asString(asRecord(item)?.category),
              }
            : item,
        ),
      }
    })
  }

  function appendNavigationCarouselItem(index: number) {
    const firstDestination = navigationDestinationOptions(index)[0]
    if (!firstDestination) {
      pushToast(
        "Add another section before adding a navigation destination.",
        "error",
      )
      return
    }

    updateBlockAt(index, (block) => {
      if (block.t !== "navigationCarousel") return block
      return {
        ...block,
        items: [
          ...asArray(block.items),
          {
            contentId: firstDestination?.sectionKey ?? "",
            backgroundColor: firstDestination?.backgroundColor ?? "",
            imageUrl: firstDestination?.imageUrl ?? "",
            title: firstDestination?.title ?? "Choose a section",
            category: firstDestination?.category ?? "Section",
          },
        ],
      }
    })
  }

  function removeNavigationCarouselItem(index: number, itemIndex: number) {
    updateBlockAt(index, (block) => {
      if (block.t !== "navigationCarousel") return block
      return {
        ...block,
        items: asArray(block.items).filter(
          (_, currentIndex) => currentIndex !== itemIndex,
        ),
      }
    })
  }

  function reorderNavigationCarouselItems(
    index: number,
    fromIndex: number,
    toIndex: number,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "navigationCarousel") return block
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

  function updateMediaCollectionItemField(
    index: number,
    itemIndex: number,
    field:
      | "videoId"
      | "imageOverrideUrl"
      | "imageOverrideAssetId"
      | "imageUrl"
      | "imageAssetId"
      | "titleOverride"
      | "subtitleOverride"
      | "labelOverride"
      | "collectionSize"
      | "linkToSectionKey",
    value: string,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "mediaCollection") return block
      const items = asArray(block.items)
      return {
        ...block,
        items: items.map((item, currentIndex) =>
          currentIndex === itemIndex
            ? { ...(asRecord(item) ?? {}), [field]: value }
            : item,
        ),
      }
    })
  }

  function appendMediaCollectionVideoItem(index: number, videoKey: string) {
    const selectedVideo = findVideoLibraryItem(videoKey)
    if (!selectedVideo) return

    updateBlockAt(index, (block) => {
      if (block.t !== "mediaCollection") return block
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
            titleOverride: "",
            subtitleOverride: "",
            imageOverrideUrl: selectedVideo.previewImageUrl ?? "",
          },
        ],
      }
    })
  }

  function removeMediaCollectionItem(index: number, itemIndex: number) {
    updateBlockAt(index, (block) => {
      if (block.t !== "mediaCollection") return block
      return {
        ...block,
        items: asArray(block.items).filter(
          (_, currentIndex) => currentIndex !== itemIndex,
        ),
      }
    })
  }

  function reorderMediaCollectionItems(
    index: number,
    fromIndex: number,
    toIndex: number,
  ) {
    updateBlockAt(index, (block) => {
      if (block.t !== "mediaCollection") return block
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
      mediaAssetPreviewUrl(item?.imageOverrideAssetId) ||
      mediaAssetPreviewUrl(item?.imageAssetId) ||
      asString(item?.imageOverrideUrl) ||
      asString(item?.imageUrl) ||
      itemVideo?.previewImageUrl ||
      ""
    )
  }

  function resolveInfoBlockIcon(value: unknown) {
    const iconKey = asString(value)
    return (
      INFO_BLOCK_ICON_OPTIONS.find((option) => option.value === iconKey) ??
      INFO_BLOCK_ICON_OPTIONS[0]
    )
  }

  function supportsSectionVisualIdentity(type: string) {
    return (
      type === "container" ||
      type === "card" ||
      SECTION_VISUAL_IDENTITY_BLOCK_TYPES.has(type)
    )
  }

  function visualIdentityImageField(type: string) {
    if (type === "container" || type === "section") return "backgroundImageUrl"
    return type === "card" ? "mediaUrl" : "imageUrl"
  }

  function visualIdentityAssetField(field: ImagePickerUrlField) {
    if (field === "backgroundImageUrl") return "backgroundImageAssetId"
    if (field === "mediaUrl") return "mediaAssetId"
    return "imageAssetId"
  }

  function blockVisualIdentity(block: BlockRecord | null) {
    return {
      backgroundColor: asString(block?.backgroundColor),
      imageUrl:
        mediaAssetPreviewUrl(block?.imageAssetId) ||
        mediaAssetPreviewUrl(block?.backgroundImageAssetId) ||
        mediaAssetPreviewUrl(block?.mediaAssetId) ||
        asString(block?.imageUrl) ||
        asString(block?.backgroundImageUrl) ||
        asString(block?.mediaUrl),
    }
  }

  function renderVisualIdentityEar(
    imageUrl: string,
    backgroundColorValue: string,
  ) {
    if (!imageUrl && !backgroundColorValue) return null
    const backgroundColor = normalizeHexColor(backgroundColorValue)

    return (
      <div
        className="pointer-events-none absolute right-0 top-0 z-0 h-28 w-28 overflow-hidden rounded-tr-sm"
        aria-hidden="true"
      >
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(225deg, ${backgroundColor} 0%, ${backgroundColor} 32%, transparent 76%)`,
            clipPath: "polygon(100% 0, 0 0, 100% 100%)",
          }}
        />
        {imageUrl ? (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url("${imageUrl}")`,
              clipPath: "polygon(100% 0, 0 0, 100% 100%)",
              maskImage:
                "linear-gradient(225deg, black 0%, rgba(0,0,0,0.82) 36%, transparent 78%)",
            }}
          />
        ) : null}
      </div>
    )
  }

  function renderVisualIdentityWash(
    imageUrl: string,
    backgroundColorValue: string,
  ) {
    if (!backgroundColorValue) return null
    const backgroundColor = normalizeHexColor(backgroundColorValue)

    return (
      <div
        className="pointer-events-none absolute inset-0 z-0 rounded-sm"
        style={{
          background: `radial-gradient(circle at 88% 4%, ${backgroundColor} 0%, ${backgroundColor} 18%, transparent 48%), linear-gradient(145deg, transparent 8%, ${backgroundColor} 100%)`,
          opacity: imageUrl ? 0.12 : 0.16,
        }}
        aria-hidden="true"
      />
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

  function handleInfoBlockDragStart(
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) {
    event.stopPropagation()
    const dragPreview = event.currentTarget.cloneNode(true)
    if (dragPreview instanceof HTMLDivElement) {
      const pointerOffsetX =
        infoBlockDragHandleState?.blockIndex === blockIndex &&
        infoBlockDragHandleState.itemIndex === itemIndex
          ? infoBlockDragHandleState.pointerOffsetX
          : 24
      const pointerOffsetY =
        infoBlockDragHandleState?.blockIndex === blockIndex &&
        infoBlockDragHandleState.itemIndex === itemIndex
          ? infoBlockDragHandleState.pointerOffsetY
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
    setInfoBlockDragState({ blockIndex, itemIndex })
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", `${blockIndex}:${itemIndex}`)
  }

  function handleInfoBlockDragEnter(
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) {
    event.preventDefault()
    event.stopPropagation()
    setInfoBlockDragState((current) => {
      if (!current || current.blockIndex !== blockIndex) return current
      if (current.itemIndex === itemIndex) return current
      reorderInfoBlockItems(blockIndex, current.itemIndex, itemIndex)
      return { blockIndex, itemIndex }
    })
  }

  function clearInfoBlockDragState() {
    setInfoBlockDragState(null)
    setInfoBlockDragHandleState(null)
  }

  function handleNavigationCarouselItemDragStart(
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) {
    event.stopPropagation()
    const dragPreview = event.currentTarget.cloneNode(true)
    if (dragPreview instanceof HTMLDivElement) {
      const pointerOffsetX =
        navigationCarouselDragHandleState?.blockIndex === blockIndex &&
        navigationCarouselDragHandleState.itemIndex === itemIndex
          ? navigationCarouselDragHandleState.pointerOffsetX
          : 24
      const pointerOffsetY =
        navigationCarouselDragHandleState?.blockIndex === blockIndex &&
        navigationCarouselDragHandleState.itemIndex === itemIndex
          ? navigationCarouselDragHandleState.pointerOffsetY
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
    setNavigationCarouselDragState({ blockIndex, itemIndex })
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", `${blockIndex}:${itemIndex}`)
  }

  function handleNavigationCarouselItemDragEnter(
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) {
    event.preventDefault()
    event.stopPropagation()
    setNavigationCarouselDragState((current) => {
      if (!current || current.blockIndex !== blockIndex) return current
      if (current.itemIndex === itemIndex) return current
      reorderNavigationCarouselItems(blockIndex, current.itemIndex, itemIndex)
      return { blockIndex, itemIndex }
    })
  }

  function clearNavigationCarouselDragState() {
    setNavigationCarouselDragState(null)
    setNavigationCarouselDragHandleState(null)
  }

  function handleMediaCollectionItemDragStart(
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) {
    event.stopPropagation()
    const dragPreview = event.currentTarget.cloneNode(true)
    if (dragPreview instanceof HTMLDivElement) {
      const pointerOffsetX =
        mediaCollectionDragHandleState?.blockIndex === blockIndex &&
        mediaCollectionDragHandleState.itemIndex === itemIndex
          ? mediaCollectionDragHandleState.pointerOffsetX
          : 24
      const pointerOffsetY =
        mediaCollectionDragHandleState?.blockIndex === blockIndex &&
        mediaCollectionDragHandleState.itemIndex === itemIndex
          ? mediaCollectionDragHandleState.pointerOffsetY
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
    setMediaCollectionDragState({ blockIndex, itemIndex })
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", `${blockIndex}:${itemIndex}`)
  }

  function handleMediaCollectionItemDragEnter(
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) {
    event.preventDefault()
    event.stopPropagation()
    setMediaCollectionDragState((current) => {
      if (!current || current.blockIndex !== blockIndex) return current
      if (current.itemIndex === itemIndex) return current
      reorderMediaCollectionItems(blockIndex, current.itemIndex, itemIndex)
      return { blockIndex, itemIndex }
    })
  }

  function clearMediaCollectionDragState() {
    setMediaCollectionDragState(null)
    setMediaCollectionDragHandleState(null)
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

  function supportsToggleableBlockCta(type: string) {
    return TOGGLEABLE_CTA_BLOCK_TYPES.has(type)
  }

  function isToggleableBlockCtaEnabled(block: BlockRecord | null) {
    if (!block) return false
    const type = asString(block.t)
    if (type === "mediaCollection") {
      return asString(block.ctaLink).length > 0
    }
    return isBlockSwitchEnabled(block, "ctaEnabled")
  }

  function toggleBlockCta(index: number) {
    updateBlockAt(index, (block) => {
      const type = asString(block.t)
      const enabled = isToggleableBlockCtaEnabled(block)
      const nextEnabled = !enabled

      if (type === "mediaCollection") {
        return {
          ...block,
          ctaLink: nextEnabled ? asString(block.ctaLink) || "/" : "",
        }
      }

      return {
        ...block,
        ctaEnabled: nextEnabled,
        ctaLink: nextEnabled && !asString(block.ctaLink) ? "/" : block.ctaLink,
      }
    })
  }

  function blockCtaLinkFieldName(block: BlockRecord | null) {
    const type = asString(block?.t)
    if (type === "cta") return "buttonLink"
    if (type === "card") return "link"
    return "ctaLink"
  }

  function blockCtaLinkModalTitle(block: BlockRecord | null) {
    const type = asString(block?.t)
    if (type === "card") return "Card link"
    return "Call to action link"
  }

  function openCtaLinkModal(index: number) {
    if (ctaLinkModalCloseTimeout.current !== null) {
      window.clearTimeout(ctaLinkModalCloseTimeout.current)
      ctaLinkModalCloseTimeout.current = null
    }
    if (ctaLinkModalOpenFrame.current !== null) {
      window.cancelAnimationFrame(ctaLinkModalOpenFrame.current)
    }
    setCtaLinkModalBlockIndex(index)
    ctaLinkModalOpenFrame.current = window.requestAnimationFrame(() => {
      setCtaLinkModalVisible(true)
      ctaLinkModalOpenFrame.current = null
    })
  }

  function closeCtaLinkModal() {
    if (ctaLinkModalOpenFrame.current !== null) {
      window.cancelAnimationFrame(ctaLinkModalOpenFrame.current)
      ctaLinkModalOpenFrame.current = null
    }
    setCtaLinkModalVisible(false)
    if (ctaLinkModalCloseTimeout.current !== null) {
      window.clearTimeout(ctaLinkModalCloseTimeout.current)
    }
    ctaLinkModalCloseTimeout.current = window.setTimeout(() => {
      setCtaLinkModalBlockIndex(null)
      ctaLinkModalCloseTimeout.current = null
    }, 180)
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
    const block = readBlockAt(index)
    const currentVideo = findVideoLibraryItem(block?.videoId)
    setVideoPickerMode(mode)
    setVideoPickerBlockIndex(index)
    setVideoLibraryQuery("")
    setVideoLibrarySort("recent")
    setVideoPickerDraft({
      videoKey:
        mode === "carouselAppend" || mode === "mediaCollectionAppend"
          ? null
          : (currentVideo?.key ?? null),
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
    if (videoPickerMode === "mediaCollectionAppend") {
      appendMediaCollectionVideoItem(videoPickerBlockIndex, selectedVideo.key)
      closeVideoPicker()
      pushToast("Video added to media collection.", "success")
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

  function canvasMediaInputClassName(size: "title" | "body" = "body") {
    return cx(
      "w-full appearance-none border-0 bg-transparent px-0 outline-none placeholder:text-white/80",
      size === "title"
        ? "text-[20px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]"
        : "text-[13px] leading-6 text-[var(--color-text-secondary)]",
    )
  }

  function inlineTitlePlaceholder(type: string) {
    if (type === "languageGlobe") return "Invite people to explore languages"
    if (type === "infoBlocks") return "Add a details heading"
    if (type === "mediaCollection") return "Name this collection"
    if (type === "videoCarousel") return "Name this video collection"
    if (type === "navigationCarousel") return "Navigation carousel"
    if (type === "cta") return "Write the call to action"
    if (type === "promoBanner") return "Write the banner headline"
    if (type === "relatedQuestions") return "Frame the question set"
    if (type === "bibleQuotesCarousel") return "Introduce these verses"
    if (type === "easterDates") return "Name this date section"
    if (type === "text") return "Add a heading"
    if (type === "section") return "Set the section key"
    return "Add a title"
  }

  function inlineDescriptionPlaceholder(type: string) {
    if (type === "languageGlobe")
      return "Explain what happens when a language is selected"
    if (type === "infoBlocks") return "Explain what these details help clarify"
    if (type === "mediaCollection")
      return "Describe what this collection offers"
    if (type === "videoCarousel") return "Describe why these videos belong here"
    if (type === "cta") return "Give the user a reason to continue"
    if (type === "video") return "Add a short summary for this video"
    if (type === "promoBanner") return "Add the supporting banner message"
    if (type === "adventCountdown") return "Add the scripture text"
    if (type === "text") return "Add a short supporting line"
    return "Add supporting copy"
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
        className={cx(
          "flex w-full cursor-pointer justify-between gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 py-3 text-left transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]",
          description ? "items-start" : "items-center",
        )}
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
            "inline-flex h-6 w-11 shrink-0 rounded-pill border px-0.5 transition-all duration-[160ms] ease-out",
            description && "mt-0.5",
            switchTrackClass(checked),
          )}
        >
          <span className="h-5 w-5 rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.24)]" />
        </span>
      </button>
    )
  }

  function renderCanvasVariantControl({
    index,
    block,
    options,
    tone = "default",
    className = "mt-4",
  }: {
    index: number
    block: BlockRecord | null
    options: string[]
    tone?: "default" | "media"
    className?: string
  }) {
    const selected = selectedBlockIndex === index
    const currentValue = asString(block?.variant) || options[0] || "default"

    return (
      <div className={cx("flex", className)}>
        <div
          className={cx(
            "inline-flex w-fit overflow-hidden rounded-sm border p-0.5 transition-[max-width,background-color,border-color] duration-[220ms] ease-out",
            tone === "media"
              ? "border-white/18 bg-black/22"
              : "border-[var(--color-hairline)] bg-[var(--color-surface-inset)]",
          )}
        >
          {options.map((option) => {
            const active = currentValue === option
            return (
              <button
                key={option}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  activateBlock(index)
                  if (selected) {
                    updateBlockStringField(index, "variant", option)
                  }
                }}
                className={cx(
                  "h-8 cursor-pointer overflow-hidden rounded-[2px] text-[12px] font-medium capitalize transition-[background-color,color,max-width,opacity,padding] duration-[220ms] ease-out",
                  selected || active
                    ? "max-w-[96px] px-3 opacity-100"
                    : "max-w-0 px-0 opacity-0",
                  tone === "media"
                    ? active
                      ? "bg-black/58 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.24)]"
                      : "text-white/68 hover:bg-white/10 hover:text-white"
                    : active
                      ? "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)] shadow-[0_1px_0_rgba(255,255,255,0.06)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]",
                )}
                aria-pressed={active}
              >
                {option}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  function renderCanvasStringOptionControl({
    index,
    block,
    field,
    options,
    fallback,
    className = "mt-4",
    formatLabel = (value) => value,
  }: {
    index: number
    block: BlockRecord | null
    field: string
    options: string[]
    fallback: string
    className?: string
    formatLabel?: (value: string) => string
  }) {
    const selected = selectedBlockIndex === index
    const currentValue = asString(block?.[field]) || fallback

    return (
      <div className={cx("flex", className)}>
        <div className="inline-flex w-fit overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] p-0.5 transition-[max-width,background-color,border-color] duration-[220ms] ease-out">
          {options.map((option) => {
            const active = currentValue === option
            return (
              <button
                key={option}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  activateBlock(index)
                  if (selected) {
                    updateBlockStringField(index, field, option)
                  }
                }}
                className={cx(
                  "h-8 cursor-pointer overflow-hidden rounded-[2px] text-[12px] font-medium uppercase transition-[background-color,color,max-width,opacity,padding] duration-[220ms] ease-out",
                  selected || active
                    ? "max-w-[64px] px-3 opacity-100"
                    : "max-w-0 px-0 opacity-0",
                  active
                    ? "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)] shadow-[0_1px_0_rgba(255,255,255,0.06)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]",
                )}
                aria-pressed={active}
              >
                {formatLabel(option)}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  function renderCanvasLinkButton({
    index,
    tone = "default",
    ariaLabel,
  }: {
    index: number
    tone?: "default" | "media"
    ariaLabel: string
  }) {
    const isDetailed = selectedBlockIndex === index

    return (
      <button
        type="button"
        draggable={false}
        onClick={(event) => {
          event.stopPropagation()
          activateBlock(index)
          openCtaLinkModal(index)
        }}
        className={cx(
          "inline-flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-sm border transition-[background-color,border-color,color,opacity,transform] duration-[180ms] ease-out will-change-[opacity,transform]",
          isDetailed ? "opacity-100" : "pointer-events-none opacity-0",
          tone === "media"
            ? "border-white/18 bg-black/22 text-white/72 hover:border-white/34 hover:bg-black/36 hover:text-white"
            : "border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)]",
        )}
        style={{
          transform: isDetailed ? "translateX(0)" : "translateX(-10px)",
        }}
        aria-label={ariaLabel}
        aria-hidden={!isDetailed}
        tabIndex={isDetailed ? 0 : -1}
      >
        <Link2 className="h-4 w-4" strokeWidth={1.5} />
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

  function renderInlineBlockCta(index: number, block: BlockRecord | null) {
    const type = asString(block?.t)
    const enabled = isToggleableBlockCtaEnabled(block)
    const isHero = type === "videoHero"
    const isDetailed = selectedBlockIndex === index

    return (
      <div
        className={cx(
          "grid overflow-hidden transition-[grid-template-rows,opacity,margin-top] duration-[220ms] ease-out",
          enabled
            ? "mt-5 grid-rows-[1fr] opacity-100"
            : "mt-0 grid-rows-[0fr] opacity-0",
          isHero && enabled && "mt-6",
        )}
        aria-hidden={!enabled}
      >
        <div className="min-h-0">
          <div
            className={cx(
              "flex flex-wrap items-center gap-2 transition-[opacity,transform] duration-[220ms] ease-out",
              enabled
                ? "translate-y-0 opacity-100"
                : "-translate-y-2 opacity-0",
            )}
          >
            <div
              className={cx(
                "inline-flex min-h-10 min-w-[180px] max-w-full items-center justify-start rounded-pill px-5 transition-all duration-[120ms] ease-out",
                isHero
                  ? "border border-[rgba(255,255,255,0.26)] bg-[rgba(255,255,255,0.14)] shadow-[0_18px_40px_rgba(0,0,0,0.26)] backdrop-blur-[6px] hover:bg-[rgba(255,255,255,0.18)]"
                  : "border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] hover:bg-[var(--color-surface-inset)]",
              )}
            >
              <input
                value={asString(block?.ctaLabel)}
                onClick={(event) => {
                  event.stopPropagation()
                  activateBlock(index)
                }}
                onFocus={() => activateBlock(index)}
                onChange={(event) =>
                  updateBlockStringField(index, "ctaLabel", event.target.value)
                }
                className={cx(
                  "w-full border-0 bg-transparent px-0 text-[12px] font-medium outline-none",
                  isHero
                    ? "text-white placeholder:text-white/54"
                    : "text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]",
                )}
                placeholder="Button label"
                tabIndex={enabled ? 0 : -1}
              />
            </div>
            <button
              type="button"
              draggable={false}
              onClick={(event) => {
                event.stopPropagation()
                activateBlock(index)
                openCtaLinkModal(index)
              }}
              className={cx(
                "inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-sm border transition-[background-color,border-color,color,opacity,transform] duration-[180ms] ease-out will-change-[opacity,transform]",
                isDetailed ? "opacity-100" : "pointer-events-none opacity-0",
                isDetailed && isHero
                  ? "border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.08)] text-white/72 hover:border-white/42 hover:bg-[rgba(255,255,255,0.14)] hover:text-white"
                  : null,
                isDetailed && !isHero
                  ? "border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)]"
                  : null,
                !isDetailed
                  ? isHero
                    ? "border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.08)] text-white/72"
                    : "border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]"
                  : null,
              )}
              style={{
                transform: isDetailed ? "translateX(0)" : "translateX(-10px)",
              }}
              aria-label="Edit call to action link"
              aria-hidden={!isDetailed}
              tabIndex={enabled && isDetailed ? 0 : -1}
            >
              <Link2 className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderInlineRequiredCta(index: number, block: BlockRecord | null) {
    const isDetailed = selectedBlockIndex === index

    return (
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex min-h-10 min-w-[180px] max-w-full items-center justify-start rounded-pill border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-5 transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-inset)]">
          {renderInlineTextInput(
            index,
            "buttonLabel",
            asString(block?.buttonLabel),
            "Call to action label",
          )}
        </div>
        <button
          type="button"
          draggable={false}
          onClick={(event) => {
            event.stopPropagation()
            activateBlock(index)
            openCtaLinkModal(index)
          }}
          className={cx(
            "inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-sm border transition-[background-color,border-color,color,opacity,transform] duration-[180ms] ease-out will-change-[opacity,transform]",
            isDetailed ? "opacity-100" : "pointer-events-none opacity-0",
            isDetailed
              ? "border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)]"
              : "border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]",
          )}
          style={{
            transform: isDetailed ? "translateX(0)" : "translateX(-10px)",
          }}
          aria-label="Edit call to action link"
          aria-hidden={!isDetailed}
          tabIndex={isDetailed ? 0 : -1}
        >
          <Link2 className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
    )
  }

  function renderBlockCtaToggleButton(
    index: number,
    block: BlockRecord | null,
  ) {
    const enabled = isToggleableBlockCtaEnabled(block)

    return (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          activateBlock(index)
          toggleBlockCta(index)
          if (enabled && ctaLinkModalBlockIndex === index) {
            closeCtaLinkModal()
          }
        }}
        className={cx(
          "flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm border transition-[background-color,border-color,color] duration-[120ms] ease-out",
          enabled
            ? "border-[rgba(110,231,183,0.48)] bg-[rgba(110,231,183,0.22)] text-[var(--color-text-primary)] hover:border-[rgba(110,231,183,0.68)] hover:bg-[rgba(110,231,183,0.3)]"
            : "border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)] hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]",
        )}
        aria-pressed={enabled}
        aria-label="Toggle call to action"
      >
        <MousePointer2 className="h-4 w-4" strokeWidth={1.5} />
      </button>
    )
  }

  function renderMediaCollectionItemNumbersButton(
    index: number,
    block: BlockRecord | null,
  ) {
    const enabled = asBoolean(block?.showItemNumbers)

    return (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          activateBlock(index)
          updateBlockAt(index, (currentBlock) => ({
            ...currentBlock,
            showItemNumbers: !asBoolean(currentBlock.showItemNumbers),
          }))
        }}
        className={cx(
          "flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm border transition-[background-color,border-color,color] duration-[120ms] ease-out",
          enabled
            ? "border-[rgba(110,231,183,0.48)] bg-[rgba(110,231,183,0.22)] text-[var(--color-text-primary)] hover:border-[rgba(110,231,183,0.68)] hover:bg-[rgba(110,231,183,0.3)]"
            : "border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)] hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]",
        )}
        aria-pressed={enabled}
        aria-label="Toggle item numbers"
      >
        <ListOrdered className="h-4 w-4" strokeWidth={1.5} />
      </button>
    )
  }

  function renderInlineMediaTextInput(
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
        className={canvasMediaInputClassName(size)}
        placeholder={placeholder}
      />
    )
  }

  function renderInlineMediaTextarea(
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
        className={`${canvasMediaInputClassName("body")} resize-none`}
        style={autoResize ? { overflow: "hidden" } : undefined}
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

  function renderCanvasEmptyState({
    icon: EmptyIcon,
    title,
    description,
  }: {
    icon: LucideIcon
    title: string
    description: string
  }) {
    return (
      <div className="rounded-sm border border-dashed border-[var(--color-hairline)] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] px-5 py-8">
        <div className="flex max-w-[420px] items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]">
            <EmptyIcon className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[16px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
              {title}
            </div>
            <div className="mt-2 text-[12px] leading-6 text-[var(--color-text-secondary)]">
              {description}
            </div>
          </div>
        </div>
      </div>
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
    const hasItemImageOverride = Boolean(
      asString(itemRecord?.imageOverrideAssetId) ||
      asString(itemRecord?.imageAssetId),
    )
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
            : "h-full min-h-[180px]",
          isDraggingItem && "shadow-[0_18px_48px_rgba(0,0,0,0.24)]",
        )}
      >
        <div
          className={cx(
            "relative overflow-hidden bg-[linear-gradient(180deg,#1c2027,#121419)]",
            expanded ? "h-full self-stretch" : "h-full",
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
                chooseVideoCarouselItemImage(index, itemIndex)
              }}
              className={cx(
                "absolute right-3 top-3 z-10 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border shadow-[0_12px_28px_rgba(0,0,0,0.3)] backdrop-blur-[6px] transition-colors duration-[120ms] ease-out",
                hasItemImageOverride
                  ? selectedOverlayMediaButtonClassName
                  : "border-white/16 bg-[rgba(4,6,10,0.58)] text-white hover:bg-[rgba(4,6,10,0.72)]",
              )}
              aria-pressed={hasItemImageOverride}
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
                className="w-full border-0 bg-transparent px-0 text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
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
    variant: unknown,
    rows = 4,
    autoResize = false,
  ) {
    return (
      <textarea
        value={editorTextFromContentParagraphs(value, variant)}
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
              className="w-full border-0 bg-transparent px-0 text-[14px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] outline-none placeholder:font-normal placeholder:text-[var(--color-text-muted)]"
              placeholder="Write the question"
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

  function renderInfoBlockItemCard(
    index: number,
    item: unknown,
    itemIndex: number,
  ) {
    const itemRecord = asRecord(item)
    const iconOption = resolveInfoBlockIcon(itemRecord?.icon)
    const Icon = iconOption.icon
    const dragHandleActive =
      infoBlockDragHandleState?.blockIndex === index &&
      infoBlockDragHandleState.itemIndex === itemIndex
    const isDraggingItem =
      infoBlockDragState?.blockIndex === index &&
      infoBlockDragState.itemIndex === itemIndex
    const iconPickerOpen =
      infoBlockIconPicker?.blockIndex === index &&
      infoBlockIconPicker.itemIndex === itemIndex

    return (
      <div
        key={`${index}-info-block-${itemIndex}`}
        data-info-block-card
        draggable={dragHandleActive}
        onDragStart={(event) =>
          handleInfoBlockDragStart(index, itemIndex, event)
        }
        onDragEnter={(event) =>
          handleInfoBlockDragEnter(index, itemIndex, event)
        }
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onDragEnd={clearInfoBlockDragState}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          clearInfoBlockDragState()
        }}
        className={cx(
          "relative overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] p-4 transition-all duration-[180ms] ease-out focus-within:border-[var(--color-hairline-strong)]",
          isDraggingItem && "shadow-[0_18px_48px_rgba(0,0,0,0.24)]",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  activateBlock(index)
                  setInfoBlockIconPicker({ blockIndex: index, itemIndex })
                }}
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)]"
                aria-label="Choose info card icon"
                aria-expanded={iconPickerOpen}
              >
                <Icon className="h-5 w-5" strokeWidth={1.5} />
              </button>
              <div className="min-w-0 flex-1">
                <input
                  value={asString(itemRecord?.title)}
                  onClick={(event) => {
                    event.stopPropagation()
                    activateBlock(index)
                  }}
                  onFocus={() => activateBlock(index)}
                  onChange={(event) =>
                    updateInfoBlockItemField(
                      index,
                      itemIndex,
                      "title",
                      event.target.value,
                    )
                  }
                  className="w-full border-0 bg-transparent px-0 text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                  placeholder="Name this detail"
                />
                <textarea
                  value={asString(itemRecord?.description)}
                  rows={1}
                  onClick={(event) => {
                    event.stopPropagation()
                    activateBlock(index)
                  }}
                  onFocus={() => activateBlock(index)}
                  onChange={(event) =>
                    updateInfoBlockItemField(
                      index,
                      itemIndex,
                      "description",
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
                  placeholder="Explain the detail"
                />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              draggable={false}
              onPointerDown={(event) => {
                event.stopPropagation()
                const cardRect = event.currentTarget
                  .closest("[data-info-block-card]")
                  ?.getBoundingClientRect()
                setInfoBlockDragHandleState({
                  blockIndex: index,
                  itemIndex,
                  pointerOffsetX: cardRect ? event.clientX - cardRect.left : 24,
                  pointerOffsetY: cardRect ? event.clientY - cardRect.top : 24,
                })
              }}
              onPointerUp={(event) => {
                event.stopPropagation()
                if (!isDraggingItem) {
                  setInfoBlockDragHandleState(null)
                }
              }}
              onPointerLeave={() => {
                if (!isDraggingItem) {
                  setInfoBlockDragHandleState(null)
                }
              }}
              className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)] active:cursor-grabbing"
              aria-label="Drag info card"
            >
              <GripVertical className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              draggable={false}
              onClick={(event) => {
                event.stopPropagation()
                removeInfoBlockItem(index, itemIndex)
              }}
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[rgba(255,120,120,0.28)] hover:text-[var(--color-danger)]"
              aria-label="Remove info card"
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

  function renderNavigationCarouselItemCard(
    index: number,
    item: unknown,
    itemIndex: number,
  ) {
    const itemRecord = asRecord(item)
    const imageUrl =
      mediaAssetPreviewUrl(itemRecord?.imageAssetId) ||
      asString(itemRecord?.imageUrl)
    const imageAssetId = asString(itemRecord?.imageAssetId)
    const backgroundColor = normalizeHexColor(itemRecord?.backgroundColor)
    const destinationOptions = navigationDestinationOptions(index)
    const currentDestination = destinationOptions.find(
      (option) => option.sectionKey === asString(itemRecord?.contentId),
    )
    const destinationPickerOpen =
      navigationDestinationPicker?.blockIndex === index &&
      navigationDestinationPicker.itemIndex === itemIndex
    const dragHandleActive =
      navigationCarouselDragHandleState?.blockIndex === index &&
      navigationCarouselDragHandleState.itemIndex === itemIndex
    const isDraggingItem =
      navigationCarouselDragState?.blockIndex === index &&
      navigationCarouselDragState.itemIndex === itemIndex

    return (
      <div
        key={`${index}-navigation-item-${itemIndex}`}
        data-navigation-carousel-item-card
        draggable={dragHandleActive}
        onDragStart={(event) =>
          handleNavigationCarouselItemDragStart(index, itemIndex, event)
        }
        onDragEnter={(event) =>
          handleNavigationCarouselItemDragEnter(index, itemIndex, event)
        }
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onDragEnd={clearNavigationCarouselDragState}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          clearNavigationCarouselDragState()
        }}
        className={cx(
          "relative overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] transition-all duration-[180ms] ease-out focus-within:border-[var(--color-hairline-strong)]",
          isDraggingItem && "shadow-[0_18px_48px_rgba(0,0,0,0.24)]",
        )}
      >
        <div className="grid min-h-[156px] grid-cols-[128px_minmax(0,1fr)]">
          <div
            className="relative"
            style={{
              background: imageUrl
                ? backgroundColor
                : `radial-gradient(circle at top left, rgba(255,255,255,0.18), transparent 54%), linear-gradient(0deg, rgba(0,0,0,0.24) 0%, rgba(0,0,0,0.02) 62%, rgba(0,0,0,0) 100%), ${backgroundColor}`,
            }}
          >
            <div className="absolute inset-0 overflow-hidden">
              {imageUrl ? (
                <>
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url("${imageUrl}")` }}
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.84)_0%,rgba(0,0,0,0.58)_42%,rgba(0,0,0,0.16)_72%,rgba(0,0,0,0)_100%)]" />
                </>
              ) : (
                <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.34)_0%,rgba(0,0,0,0.1)_58%,rgba(0,0,0,0)_100%)]" />
              )}
            </div>
            <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
              <BackgroundColorPicker
                value={itemRecord?.backgroundColor}
                label="Choose navigation destination background color"
                description="Used behind this destination card."
                customLabel="Custom navigation destination background hex"
                onChange={(value) =>
                  updateNavigationCarouselItemField(
                    index,
                    itemIndex,
                    "backgroundColor",
                    value,
                  )
                }
                onTrigger={() => activateBlock(index)}
                triggerClassName="h-8 w-8 border-white/18 bg-[#08090d] text-white shadow-[0_12px_28px_rgba(0,0,0,0.34)] hover:-translate-y-0.5 hover:border-white/36 hover:bg-[#11131a] hover:text-white data-[open=true]:border-white/72"
                align="left"
              />
              <div className="inline-flex shadow-[0_12px_28px_rgba(0,0,0,0.34)]">
                <button
                  type="button"
                  draggable={false}
                  onClick={(event) => {
                    event.stopPropagation()
                    activateBlock(index)
                    chooseNavigationCarouselItemImage(index, itemIndex)
                  }}
                  className={cx(
                    "inline-flex h-8 w-8 cursor-pointer items-center justify-center border transition-[background-color,transform,border-color] duration-[160ms] ease-out hover:-translate-y-0.5",
                    imageAssetId
                      ? selectedOverlayMediaButtonClassName
                      : idleOverlayMediaButtonClassName,
                    "rounded-sm",
                  )}
                  aria-pressed={Boolean(imageAssetId)}
                  aria-label="Choose navigation destination image"
                >
                  <ImageIcon className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-col justify-between gap-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <input
                  value={asString(itemRecord?.title)}
                  onClick={(event) => {
                    event.stopPropagation()
                    activateBlock(index)
                  }}
                  onFocus={() => activateBlock(index)}
                  onChange={(event) =>
                    updateNavigationCarouselItemField(
                      index,
                      itemIndex,
                      "title",
                      event.target.value,
                    )
                  }
                  className="w-full border-0 bg-transparent px-0 text-[18px] font-semibold leading-7 tracking-[-0.03em] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                  placeholder="Destination title"
                />
                <input
                  value={asString(itemRecord?.category)}
                  onClick={(event) => {
                    event.stopPropagation()
                    activateBlock(index)
                  }}
                  onFocus={() => activateBlock(index)}
                  onChange={(event) =>
                    updateNavigationCarouselItemField(
                      index,
                      itemIndex,
                      "category",
                      event.target.value,
                    )
                  }
                  className="mt-2 w-full border-0 bg-transparent px-0 text-[12px] leading-5 text-[var(--color-text-muted)] outline-none placeholder:text-[var(--color-text-muted)]"
                  placeholder="Subtitle or category"
                />
              </div>
              <div className="flex shrink-0 items-start gap-2">
                <button
                  type="button"
                  draggable={false}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    const cardRect = event.currentTarget
                      .closest("[data-navigation-carousel-item-card]")
                      ?.getBoundingClientRect()
                    setNavigationCarouselDragHandleState({
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
                      setNavigationCarouselDragHandleState(null)
                    }
                  }}
                  onPointerLeave={() => {
                    if (!isDraggingItem) {
                      setNavigationCarouselDragHandleState(null)
                    }
                  }}
                  className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)] active:cursor-grabbing"
                  aria-label="Drag navigation destination"
                >
                  <GripVertical className="h-4 w-4" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  draggable={false}
                  onClick={(event) => {
                    event.stopPropagation()
                    removeNavigationCarouselItem(index, itemIndex)
                  }}
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[rgba(255,120,120,0.28)] hover:text-[var(--color-danger)]"
                  aria-label="Remove navigation item"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            </div>
            <div className="relative">
              <button
                type="button"
                data-navigation-destination-trigger={`${index}-${itemIndex}`}
                onClick={(event) => {
                  event.stopPropagation()
                  activateBlock(index)
                  setNavigationDestinationPicker((current) =>
                    current?.blockIndex === index &&
                    current.itemIndex === itemIndex
                      ? null
                      : { blockIndex: index, itemIndex },
                  )
                }}
                className="group flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 text-left transition-[background-color,border-color,transform] duration-[160ms] ease-out hover:-translate-y-0.5 hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                disabled={destinationOptions.length === 0}
                aria-expanded={destinationPickerOpen}
                aria-label="Choose navigation destination"
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)] transition-colors duration-[120ms] ease-out group-hover:text-[var(--color-text-primary)]">
                  <Route className="h-3.5 w-3.5" strokeWidth={1.5} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-[var(--color-text-primary)]">
                    {currentDestination?.title ??
                      (destinationOptions.length === 0
                        ? "No sections available"
                        : "Choose destination")}
                  </span>
                  <span className="block truncate text-[11px] leading-4 text-[var(--color-text-muted)]">
                    {currentDestination?.category ?? "Internal section link"}
                  </span>
                </span>
                <ChevronRightSquare
                  className={cx(
                    "h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform duration-[160ms] ease-out",
                    destinationPickerOpen && "rotate-90",
                  )}
                  strokeWidth={1.5}
                />
              </button>
            </div>
          </div>
        </div>
        {isDraggingItem ? (
          <div className="pointer-events-none absolute inset-0 bg-[rgba(255,255,255,0.05)] backdrop-blur-[7px]" />
        ) : null}
      </div>
    )
  }

  function renderMediaCollectionItemCard(
    index: number,
    item: unknown,
    itemIndex: number,
    expanded = true,
    showItemNumber = false,
  ) {
    const itemRecord = asRecord(item)
    const itemVideo = findVideoLibraryItem(itemRecord?.videoId)
    const itemImageUrl =
      mediaAssetPreviewUrl(itemRecord?.imageOverrideAssetId) ||
      mediaAssetPreviewUrl(itemRecord?.imageAssetId) ||
      asString(itemRecord?.imageOverrideUrl) ||
      asString(itemRecord?.imageUrl) ||
      itemVideo?.previewImageUrl ||
      ""
    const hasItemImageOverride = Boolean(
      asString(itemRecord?.imageOverrideAssetId) ||
      asString(itemRecord?.imageAssetId),
    )
    const itemTitle =
      asString(itemRecord?.titleOverride) || itemVideo?.title || "Media item"
    const itemSubtitle =
      asString(itemRecord?.subtitleOverride) ||
      asString(itemRecord?.collectionSize) ||
      itemVideo?.labelLabel ||
      "Selected media"
    const isDraggingItem =
      mediaCollectionDragState?.blockIndex === index &&
      mediaCollectionDragState.itemIndex === itemIndex
    const dragHandleActive =
      mediaCollectionDragHandleState?.blockIndex === index &&
      mediaCollectionDragHandleState.itemIndex === itemIndex

    return (
      <div
        key={`${index}-media-collection-item-${itemIndex}`}
        data-media-collection-item-card
        draggable={expanded && dragHandleActive}
        onDragStart={(event) =>
          handleMediaCollectionItemDragStart(index, itemIndex, event)
        }
        onDragEnter={(event) =>
          expanded
            ? handleMediaCollectionItemDragEnter(index, itemIndex, event)
            : null
        }
        onDragOver={(event) => {
          if (!expanded) return
          event.preventDefault()
          event.stopPropagation()
        }}
        onDragEnd={clearMediaCollectionDragState}
        onDrop={(event) => {
          if (!expanded) return
          event.preventDefault()
          event.stopPropagation()
          clearMediaCollectionDragState()
        }}
        className={cx(
          "group relative overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] transition-all duration-[180ms] ease-out",
          expanded
            ? "grid min-h-[72px] grid-cols-[128px_minmax(0,1fr)]"
            : "h-full min-h-[180px]",
          isDraggingItem && "shadow-[0_18px_48px_rgba(0,0,0,0.24)]",
        )}
      >
        <div
          className={cx(
            "relative overflow-hidden bg-[linear-gradient(180deg,#1c2027,#121419)]",
            expanded ? "h-full self-stretch" : "h-full",
          )}
        >
          {itemImageUrl ? (
            <>
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url("${itemImageUrl}")` }}
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
          {itemImageUrl ? null : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_50%)]" />
          )}
          {showItemNumber ? (
            <div
              className={cx(
                "pointer-events-none absolute font-semibold tabular-nums tracking-[-0.08em]",
                expanded
                  ? "bottom-0 left-3 text-[64px] leading-none text-white/45"
                  : "-bottom-5 right-4 text-[104px] leading-none text-white/32 md:text-[124px]",
              )}
              aria-hidden="true"
            >
              {itemIndex + 1}
            </div>
          ) : null}
          {expanded ? (
            <button
              type="button"
              draggable={false}
              onClick={(event) => {
                event.stopPropagation()
                chooseMediaCollectionItemImage(index, itemIndex)
              }}
              className={cx(
                "absolute right-3 top-3 z-10 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border shadow-[0_12px_28px_rgba(0,0,0,0.3)] backdrop-blur-[6px] transition-colors duration-[120ms] ease-out",
                hasItemImageOverride
                  ? selectedOverlayMediaButtonClassName
                  : "border-white/16 bg-[rgba(4,6,10,0.58)] text-white hover:bg-[rgba(4,6,10,0.72)]",
              )}
              aria-pressed={hasItemImageOverride}
              aria-label="Choose media item image"
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
                value={itemTitle}
                onClick={(event) => {
                  event.stopPropagation()
                  activateBlock(index)
                }}
                onFocus={() => activateBlock(index)}
                onChange={(event) =>
                  updateMediaCollectionItemField(
                    index,
                    itemIndex,
                    "titleOverride",
                    event.target.value,
                  )
                }
                className="w-full border-0 bg-transparent px-0 text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                placeholder={itemVideo?.title || "Media item title"}
              />
              <input
                value={itemSubtitle}
                onClick={(event) => {
                  event.stopPropagation()
                  activateBlock(index)
                }}
                onFocus={() => activateBlock(index)}
                onChange={(event) =>
                  updateMediaCollectionItemField(
                    index,
                    itemIndex,
                    "subtitleOverride",
                    event.target.value,
                  )
                }
                className="mt-1 w-full border-0 bg-transparent px-0 text-[12px] leading-5 text-[var(--color-text-muted)] outline-none placeholder:text-[var(--color-text-muted)]"
                placeholder={
                  itemVideo?.labelLabel ||
                  asString(itemRecord?.collectionSize) ||
                  "Media item subtitle"
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
                      .closest("[data-media-collection-item-card]")
                      ?.getBoundingClientRect()
                    setMediaCollectionDragHandleState({
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
                      setMediaCollectionDragHandleState(null)
                    }
                  }}
                  onPointerLeave={() => {
                    if (!isDraggingItem) {
                      setMediaCollectionDragHandleState(null)
                    }
                  }}
                  className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)] active:cursor-grabbing"
                  aria-label="Drag media item"
                >
                  <GripVertical className="h-4 w-4" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  draggable={false}
                  onClick={(event) => {
                    event.stopPropagation()
                    removeMediaCollectionItem(index, itemIndex)
                  }}
                  className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[rgba(255,120,120,0.28)] hover:text-[var(--color-danger)]"
                  aria-label="Remove media item"
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

  function renderSectionPreview(index: number, blockRecord: BlockRecord) {
    const content = asArray(blockRecord.content)
    const previewItems =
      content.length > 0
        ? content.slice(0, 3).map((item, childIndex) => {
            const visual =
              containerPreviewVisuals(item).find(
                (candidate) => candidate.imageUrl || candidate.backgroundColor,
              ) ?? null
            return {
              key: `${index}-section-preview-${childIndex}`,
              summary: summarizeBlock(item, childIndex, videoLibrary),
              backgroundColor: visual?.backgroundColor ?? "",
              imageUrl: visual?.imageUrl ?? "",
            }
          })
        : [
            {
              key: `${index}-section-preview-empty`,
              summary: null,
              backgroundColor: "",
              imageUrl: "",
            },
          ]
    const hiddenPreviewCount = Math.max(content.length - 3, 0)
    const isSectionPreviewEmpty = content.length === 0
    const previewGridClass =
      previewItems.length > 2
        ? "grid-cols-[minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(0,0.78fr)]"
        : previewItems.length === 2
          ? "grid-cols-2"
          : "grid-cols-1"

    const renderPreviewTile = (
      item: (typeof previewItems)[number],
      itemIndex: number,
    ) => (
      <div
        key={item.key}
        className={cx(
          "relative h-full overflow-hidden rounded-[2px] border border-[rgba(255,255,255,0.14)] bg-[rgba(8,10,14,0.42)]",
          itemIndex === 2 && "min-w-0",
        )}
        style={{
          background: item.backgroundColor
            ? normalizeHexColor(item.backgroundColor)
            : undefined,
        }}
      >
        {item.imageUrl ? (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-72"
            style={{ backgroundImage: `url("${item.imageUrl}")` }}
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_50%)]" />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.8)_0%,rgba(0,0,0,0.48)_42%,rgba(0,0,0,0.12)_72%,rgba(0,0,0,0)_100%)]" />
        {item.summary ? (
          <div className="relative flex h-full flex-col justify-end p-4 text-white">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/64">
              {item.summary.typeLabel}
            </div>
            <div
              className={cx(
                "mt-2 line-clamp-2 font-semibold leading-5",
                itemIndex === 2 ? "text-[12px]" : "text-[14px]",
              )}
            >
              {item.summary.title}
            </div>
          </div>
        ) : (
          <div className="relative flex h-full items-center justify-center px-4 text-center">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/58">
                Empty
              </div>
              <div className="mt-2 text-[13px] font-medium text-white/82">
                Add section blocks
              </div>
            </div>
          </div>
        )}
        {itemIndex === 2 && hiddenPreviewCount > 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[rgba(5,6,10,0.58)] text-center backdrop-blur-[1px]">
            <div>
              <div className="text-[24px] font-semibold tracking-[-0.04em] text-white">
                +{hiddenPreviewCount}
              </div>
              <div className="mt-1 text-[11px] leading-4 text-white/72">
                more
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )

    const rawBackgroundOpacity = asNumber(blockRecord.backgroundOpacity)
    const backgroundOpacity =
      rawBackgroundOpacity === null
        ? 1
        : clampNumber(rawBackgroundOpacity, 0, 1)
    const backgroundOpacityPercent = Math.round(backgroundOpacity * 100)
    const sectionSelected = selectedBlockIndex === index
    const opacityPresetOptions = [1, 0.75, 0.5]
    const matchingOpacityPreset = opacityPresetOptions.find(
      (option) => Math.abs(option - backgroundOpacity) < 0.001,
    )
    const customOpacitySelected =
      customSectionOpacityIndex === index || matchingOpacityPreset === undefined
    const opacitySliderVisible = sectionSelected && customOpacitySelected

    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            openSectionWorkspace(index)
          }}
          className="group/preview relative w-full cursor-pointer overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] p-3 text-left transition-colors duration-[160ms] ease-out hover:border-[var(--color-hairline-strong)]"
          aria-label="Edit section"
        >
          <div
            className={cx(
              "grid items-stretch gap-3",
              isSectionPreviewEmpty ? "h-[116px]" : "h-[180px]",
              previewGridClass,
            )}
          >
            {previewItems.map((item, itemIndex) =>
              renderPreviewTile(item, itemIndex),
            )}
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[rgba(5,6,10,0.58)] opacity-0 backdrop-blur-[2px] transition-opacity duration-[160ms] ease-out group-hover/preview:opacity-100">
            <span className="inline-flex items-center gap-2 rounded-pill border border-[rgba(255,255,255,0.2)] bg-[rgba(12,14,18,0.72)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] shadow-[0_12px_32px_rgba(0,0,0,0.36)]">
              <LayoutTemplate className="h-4 w-4" strokeWidth={1.5} />
              Edit Section
            </span>
          </div>
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div
            className={cx(
              "inline-flex h-9 w-fit max-w-full items-center overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] p-0.5 transition-[background-color,border-color] duration-[180ms] ease-out hover:border-[var(--color-hairline-strong)]",
            )}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                activateBlock(index)
              }}
              className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-[2px] px-2.5 text-left transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface)]"
              aria-expanded={sectionSelected}
            >
              <span className="text-[12px] font-medium text-[var(--color-text-primary)]">
                Opacity
              </span>
            </button>
            {opacityPresetOptions.map((option) => {
              const active =
                !customOpacitySelected &&
                Math.abs(option - backgroundOpacity) < 0.001
              return (
                <button
                  key={option}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    activateBlock(index)
                    if (sectionSelected) {
                      setCustomSectionOpacityIndex((currentIndex) =>
                        currentIndex === index ? null : currentIndex,
                      )
                      updateBlockNumberField(
                        index,
                        "backgroundOpacity",
                        String(option),
                      )
                    }
                  }}
                  className={cx(
                    "h-8 cursor-pointer overflow-hidden rounded-[2px] text-[12px] font-medium transition-[background-color,color,max-width,opacity,padding] duration-[220ms] ease-out",
                    sectionSelected || active
                      ? "max-w-[48px] px-2 opacity-100"
                      : "max-w-0 px-0 opacity-0",
                    active
                      ? "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)] shadow-[0_1px_0_rgba(255,255,255,0.06)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]",
                  )}
                  aria-pressed={active}
                >
                  {Math.round(option * 100)}%
                </button>
              )
            })}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                activateBlock(index)
                if (sectionSelected) {
                  setCustomSectionOpacityIndex(index)
                }
              }}
              className={cx(
                "h-8 cursor-pointer overflow-hidden rounded-[2px] text-[12px] font-medium transition-[background-color,color,max-width,opacity,padding] duration-[220ms] ease-out",
                sectionSelected || customOpacitySelected
                  ? customOpacitySelected && !sectionSelected
                    ? "max-w-[48px] px-2 opacity-100"
                    : "max-w-[74px] px-2 opacity-100"
                  : "max-w-0 px-0 opacity-0",
                customOpacitySelected
                  ? "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)] shadow-[0_1px_0_rgba(255,255,255,0.06)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]",
              )}
              aria-pressed={customOpacitySelected}
            >
              {customOpacitySelected && !sectionSelected
                ? `${backgroundOpacityPercent}%`
                : "Custom"}
            </button>
            <div
              className={cx(
                "flex h-8 min-w-0 items-center gap-2 overflow-hidden transition-[max-width,opacity,padding] duration-[180ms] ease-out",
                opacitySliderVisible
                  ? "max-w-[178px] px-2 opacity-100"
                  : "max-w-0 px-0 opacity-0",
              )}
              aria-hidden={!opacitySliderVisible}
            >
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={backgroundOpacity}
                onFocus={() => activateBlock(index)}
                tabIndex={opacitySliderVisible ? 0 : -1}
                disabled={!opacitySliderVisible}
                onChange={(event) =>
                  updateBlockNumberField(
                    index,
                    "backgroundOpacity",
                    event.target.value,
                  )
                }
                className="h-2 min-w-[120px] flex-1 cursor-pointer accent-[var(--color-brand)]"
                aria-label="Custom background opacity"
              />
              <span className="w-10 shrink-0 text-right font-mono text-[11px] text-[var(--color-text-muted)]">
                {backgroundOpacityPercent}%
              </span>
            </div>
          </div>
          <div className="inline-flex w-fit overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] p-0.5 transition-[max-width,background-color,border-color] duration-[220ms] ease-out">
            {[
              { label: "Dynamic", value: false },
              { label: "Static", value: true },
            ].map((option) => {
              const active =
                asBoolean(blockRecord.staticOverlay) === option.value
              return (
                <button
                  key={option.label}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    activateBlock(index)
                    if (sectionSelected) {
                      updateBlockBooleanField(
                        index,
                        "staticOverlay",
                        option.value,
                      )
                    }
                  }}
                  className={cx(
                    "h-8 cursor-pointer overflow-hidden rounded-[2px] text-[12px] font-medium transition-[background-color,color,max-width,opacity,padding] duration-[220ms] ease-out",
                    sectionSelected || active
                      ? "max-w-[74px] px-3 opacity-100"
                      : "max-w-0 px-0 opacity-0",
                    active
                      ? "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)] shadow-[0_1px_0_rgba(255,255,255,0.06)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]",
                  )}
                  aria-pressed={active}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  function renderSectionWorkspace(index: number, blockRecord: BlockRecord) {
    const content = asArray(blockRecord.content)
    const sectionBlocks = content.map((item, childIndex) => {
      const summary = summarizeBlock(item, childIndex, videoLibrary)
      return {
        ...summary,
        key: stableSectionContentBlockKey(item, childIndex),
      }
    })
    const activeSectionSummary =
      activeDragKey === null
        ? null
        : (sectionBlocks.find((block) => block.key === activeDragKey) ?? null)

    const reorderSectionContentByKey = (fromKey: string, toKey: string) => {
      if (fromKey === toKey) return false
      const fromIndex = sectionBlocks.findIndex(
        (block) => block.key === fromKey,
      )
      const toIndex = sectionBlocks.findIndex((block) => block.key === toKey)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return false
      moveSectionContentBlockToIndex(index, fromIndex, toIndex)
      return true
    }

    return (
      <div className="mx-auto flex min-h-full max-w-7xl flex-col px-6 py-6 xl:px-10 xl:py-7">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-hairline)] pb-5">
          <button
            type="button"
            onClick={closeSectionWorkspace}
            className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface)]"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
            Back to page
          </button>
          <button
            type="button"
            onClick={() => {
              setFocusedSectionIndex(index)
              setPendingInsertIndex(content.length)
              setInlineBlockLibraryOpen(true)
            }}
            className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Add block
          </button>
        </div>

        <div className="mt-6">
          {sectionBlocks.length > 0 ? (
            <CanvasBlockList
              activeDragKey={activeDragKey}
              activeDragSummary={activeSectionSummary}
              blockCardRefs={blockCardRefs}
              blocks={sectionBlocks}
              insertedBlockAnimation={null}
              pendingInsertIndex={pendingInsertIndex}
              sensors={sensors}
              onBlockDragCancel={() => handleDragCleanup(false)}
              onBlockDragStart={(event) => {
                const key = String(event.active.id)
                const childIndex = sectionBlocks.findIndex(
                  (block) => block.key === key,
                )
                setPendingInsertIndex(null)
                setActiveDragKey(key)
                if (childIndex >= 0) {
                  activateBlock(
                    nestedCanvasBlockIndex({
                      kind: "section",
                      sectionIndex: index,
                      childIndex,
                    }),
                  )
                }
              }}
              onBlockDragOver={(event) => {
                const overKey = event.over ? String(event.over.id) : null
                if (!overKey) return
                if (
                  reorderSectionContentByKey(String(event.active.id), overKey)
                ) {
                  dragDidReorder.current = true
                }
              }}
              onBlockDragEnd={(event) => {
                const overKey = event.over ? String(event.over.id) : null
                if (
                  overKey &&
                  reorderSectionContentByKey(String(event.active.id), overKey)
                ) {
                  dragDidReorder.current = true
                }
                handleDragCleanup(true)
              }}
              onOpenAddBlockPicker={(insertIndex) => {
                setFocusedSectionIndex(index)
                setPendingInsertIndex(insertIndex)
                setInlineBlockLibraryOpen(true)
              }}
              renderBlock={(block, childIndex, options) =>
                renderCanvasCard(
                  block,
                  nestedCanvasBlockIndex({
                    kind: "section",
                    sectionIndex: index,
                    childIndex,
                  }),
                  options,
                )
              }
              renderPendingInsertMarker={renderPendingInsertMarker}
            />
          ) : (
            <div className="rounded-sm border border-dashed border-[var(--color-hairline)] px-4 py-10 text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                Empty Section
              </div>
              <div className="mt-2 text-[18px] font-semibold text-[var(--color-text-primary)]">
                Add blocks to this section
              </div>
              <button
                type="button"
                onClick={() => {
                  setFocusedSectionIndex(index)
                  setPendingInsertIndex(0)
                  setInlineBlockLibraryOpen(true)
                }}
                className="mt-5 inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface)]"
              >
                <Plus className="h-4 w-4" strokeWidth={1.5} />
                Add block
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  function containerPreviewVisuals(value: unknown) {
    const record = asRecord(value)
    if (!record) return []

    const type = asString(record.t)
    if (type === "video" || type === "videoHero") {
      return [
        {
          backgroundColor: asString(record.backgroundColor),
          imageUrl:
            mediaAssetPreviewUrl(record.imageOverrideAssetId) ||
            mediaAssetPreviewUrl(record.imageAssetId) ||
            asString(record.imageOverrideUrl) ||
            asString(record.imageUrl) ||
            findVideoLibraryItem(record.videoId)?.previewImageUrl ||
            "",
        },
      ]
    }

    if (type === "videoCarousel" || type === "mediaCollection") {
      return asArray(record.items).map((item) => {
        const itemRecord = asRecord(item)
        return {
          backgroundColor:
            asString(itemRecord?.backgroundColor) ||
            asString(record.backgroundColor),
          imageUrl:
            mediaAssetPreviewUrl(itemRecord?.imageOverrideAssetId) ||
            mediaAssetPreviewUrl(itemRecord?.imageAssetId) ||
            asString(itemRecord?.imageOverrideUrl) ||
            asString(itemRecord?.imageUrl) ||
            findVideoLibraryItem(itemRecord?.videoId)?.previewImageUrl ||
            "",
        }
      })
    }

    const visual = blockVisualIdentity(record)
    return [
      {
        backgroundColor: visual.backgroundColor,
        imageUrl: visual.imageUrl,
      },
    ]
  }

  function renderContainerPreview(index: number, blockRecord: BlockRecord) {
    const content = readContainerContent(blockRecord)
    const slotMarkers = containerSlotMarkerIndexes(content)
    const contentEntries = content
      .map((item, childIndex) => ({ childIndex, item }))
      .filter(({ item }) => !isContainerSlotBlock(item))
    const previewVisual =
      contentEntries
        .flatMap(({ item }) => containerPreviewVisuals(item))
        .find((visual) => visual.imageUrl || visual.backgroundColor) ?? null
    const hasContainerContent = contentEntries.length > 0
    const slotGroups =
      slotMarkers.length > 0
        ? slotMarkers.map((markerIndex, slotIndex) => {
            const nextMarkerIndex = slotMarkers[slotIndex + 1] ?? content.length
            const slotRecord = asRecord(content[markerIndex]) ?? {}
            const slotItems = content
              .slice(markerIndex + 1, nextMarkerIndex)
              .filter((item) => !isContainerSlotBlock(item))
            const slotVisual =
              slotItems
                .flatMap((item) => containerPreviewVisuals(item))
                .find((visual) => visual.imageUrl || visual.backgroundColor) ??
              null
            return {
              backgroundColor: slotVisual?.backgroundColor ?? "",
              key: `${markerIndex}-${slotIndex}`,
              span: readContainerSlotSpans(slotRecord)[containerGridViewport],
              imageUrl: slotVisual?.imageUrl ?? "",
            }
          })
        : [
            {
              backgroundColor: previewVisual?.backgroundColor ?? "",
              key: "empty-container-preview",
              span: 12,
              imageUrl: previewVisual?.imageUrl ?? "",
            },
          ]
    const containerBackgroundImageUrl =
      mediaAssetPreviewUrl(blockRecord.backgroundImageAssetId) ||
      asString(blockRecord.backgroundImageUrl)

    return (
      <div className="mt-4">
        <div className="group/preview relative overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] transition-colors duration-[160ms] ease-out hover:border-[var(--color-hairline-strong)]">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              if (index >= 0) {
                openContainerWorkspace(index)
                return
              }
              activateBlock(index)
            }}
            className="relative w-full cursor-pointer overflow-hidden p-3 text-left"
            aria-label="Edit container"
          >
            {containerBackgroundImageUrl ? (
              <div
                className="absolute inset-0 bg-cover bg-center opacity-70"
                style={{
                  backgroundImage: `url("${containerBackgroundImageUrl}")`,
                }}
              />
            ) : null}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,6,10,0.1),rgba(5,6,10,0.36))]" />
            <div className="relative grid grid-cols-12 gap-2">
              {slotGroups.map((slot) => (
                <div
                  key={slot.key}
                  className="relative h-24 overflow-hidden rounded-[2px] border border-[rgba(255,255,255,0.16)] bg-[rgba(8,10,14,0.42)]"
                  style={{
                    background: slot.backgroundColor
                      ? normalizeHexColor(slot.backgroundColor)
                      : undefined,
                    gridColumn: `span ${slot.span} / span ${slot.span}`,
                  }}
                >
                  {slot.imageUrl ? (
                    <div
                      className="absolute inset-0 bg-cover bg-center"
                      style={{ backgroundImage: `url("${slot.imageUrl}")` }}
                    />
                  ) : (
                    <div
                      className={
                        slot.backgroundColor
                          ? "absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.1),rgba(255,255,255,0.025))]"
                          : "absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.025))]"
                      }
                    />
                  )}
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,6,10,0.04),rgba(5,6,10,0.44))]" />
                </div>
              ))}
            </div>
            {hasContainerContent ? null : (
              <div className="pointer-events-none absolute inset-3 flex items-center justify-center text-center">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/58">
                    Empty Container
                  </div>
                  <div className="mt-1 text-[13px] font-medium text-white/82">
                    Add blocks to a slot
                  </div>
                </div>
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[rgba(5,6,10,0.58)] opacity-0 backdrop-blur-[2px] transition-opacity duration-[160ms] ease-out group-hover/preview:opacity-100">
              <span className="inline-flex items-center gap-2 rounded-pill border border-[rgba(255,255,255,0.2)] bg-[rgba(12,14,18,0.72)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] shadow-[0_12px_32px_rgba(0,0,0,0.36)]">
                <Columns2 className="h-4 w-4" strokeWidth={1.5} />
                {index >= 0 ? "Edit Container" : "Select Container"}
              </span>
            </div>
          </button>
        </div>
      </div>
    )
  }

  function renderContainerWorkspace(index: number, blockRecord: BlockRecord) {
    const selectContainerSlot = (slotIndex: number) => {
      setSelectedBlockIndex(null)
      setFocusedContainerSlotIndex(slotIndex)
      setPendingInsertIndex(null)
      setInlineBlockLibraryOpen(true)
    }

    return (
      <div className="min-h-full">
        <ContainerWorkspace
          activeViewport={containerGridViewport}
          blockIndex={index}
          blockRecord={blockRecord}
          videoLibrary={videoLibrary}
          onAddSlot={() => {
            const nextSlotIndex = containerSlotMarkerIndexes(
              readContainerContent(blockRecord),
            ).length
            appendContainerSlot(index)
            setFocusedContainerSlotIndex(nextSlotIndex)
          }}
          onApplySlotPreset={(spans) => {
            applyContainerSlotPreset(index, spans)
            selectContainerSlot(0)
          }}
          onClose={closeContainerWorkspace}
          onMoveContent={(fromIndex, toIndex) => {
            moveContainerContentBlock(index, fromIndex, toIndex)
          }}
          onMoveContentToSlot={(fromIndex, slotIndex) => {
            moveContainerContentBlockToSlot(index, fromIndex, slotIndex)
            selectContainerSlot(slotIndex)
          }}
          onRemoveSlot={(slotIndex) => {
            requestRemoveContainerSlot(index, slotIndex)
          }}
          onOpenAddBlockPicker={(childIndex) => {
            setFocusedContainerIndex(index)
            setFocusedSectionIndex(null)
            setFocusedContainerSlotIndex(null)
            setPendingInsertIndex(
              nestedCanvasBlockIndex({
                kind: "container",
                containerIndex: index,
                childIndex,
              }),
            )
            setInlineBlockLibraryOpen(true)
          }}
          onSelectSlot={selectContainerSlot}
          onSlotSpanChange={(slotIndex, viewport, span) =>
            updateContainerSlotSpan(index, slotIndex, viewport, span)
          }
          onSlotVisualChange={(slotIndex, field, value) =>
            updateContainerSlotVisual(index, slotIndex, field, value)
          }
          onViewportChange={setContainerGridViewport}
          pendingInsertIndex={pendingInsertIndex}
          renderBlock={(block, virtualIndex, options) =>
            renderCanvasCard(block, virtualIndex, options)
          }
          renderPendingInsertMarker={renderPendingInsertMarker}
          selectedSlotIndex={focusedContainerSlotIndex}
          virtualBlockIndex={(childIndex) =>
            nestedCanvasBlockIndex({
              kind: "container",
              containerIndex: index,
              childIndex,
            })
          }
        />
      </div>
    )
  }

  function renderBibleQuoteCard(
    index: number,
    item: unknown,
    itemIndex: number,
  ) {
    const itemRecord = asRecord(item)
    const mediaLibraryPreviewUrl =
      mediaAssetPreviewUrl(itemRecord?.backgroundImageAssetId) ||
      mediaAssetPreviewUrl(itemRecord?.imageAssetId)
    const previewItem =
      itemRecord && mediaLibraryPreviewUrl
        ? {
            ...itemRecord,
            backgroundImageUrl: mediaLibraryPreviewUrl,
            imageUrl: mediaLibraryPreviewUrl,
          }
        : item

    return (
      <BibleQuoteCard
        key={`${index}-bible-quote-${itemIndex}`}
        blockIndex={index}
        item={previewItem}
        itemIndex={itemIndex}
        dragState={bibleQuoteDragState}
        dragHandleState={bibleQuoteDragHandleState}
        onActivateBlock={activateBlock}
        onUpdateField={updateBibleQuoteField}
        onRemove={removeBibleQuote}
        onDragStart={handleBibleQuoteDragStart}
        onDragEnter={handleBibleQuoteDragEnter}
        onChooseImage={chooseBibleQuoteImage}
        onClearDragState={clearBibleQuoteDragState}
        onSetDragHandleState={setBibleQuoteDragHandleState}
      />
    )
  }

  function isEasterDateEnabled(block: BlockRecord | null, field: string) {
    if (!block) return true
    return block[field] === undefined ? true : asBoolean(block[field])
  }

  function renderEasterDateCards(index: number, block: BlockRecord | null) {
    const isActiveBlock = selectedBlockIndex === index
    const cards = [
      {
        key: "western",
        field: "westernEasterLabel",
        enabledField: "westernEasterEnabled",
        fallbackLabel: "Catholic/Protestant Easter",
        date: nextCalculatedDate(calculateWesternEaster, editorToday),
      },
      {
        key: "orthodox",
        field: "orthodoxEasterLabel",
        enabledField: "orthodoxEasterEnabled",
        fallbackLabel: "Orthodox Easter",
        date: nextCalculatedDate(calculateOrthodoxEaster, editorToday),
      },
      {
        key: "passover",
        field: "passoverLabel",
        enabledField: "passoverEnabled",
        fallbackLabel: "Jewish Passover",
        date: nextCalculatedDate(calculatePassover, editorToday),
      },
    ]

    return (
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {cards.map((card, cardIndex) => {
          const enabled = isEasterDateEnabled(block, card.enabledField)
          const VisibilityIcon = enabled ? Eye : EyeOff
          const visibilityDelay = isActiveBlock
            ? cardIndex * 110
            : (cards.length - 1 - cardIndex) * 110

          return (
            <div
              key={card.key}
              className={cx(
                "relative min-h-[148px] overflow-hidden rounded-sm border bg-[#151515] transition-[border-color,opacity] duration-[160ms] ease-out",
                enabled
                  ? "border-[var(--color-hairline)] opacity-100"
                  : "border-[var(--color-hairline)] opacity-55",
              )}
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_50%)]" />
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  activateBlock(index)
                  updateBlockAt(index, (currentBlock) => ({
                    ...currentBlock,
                    [card.enabledField]: !enabled,
                  }))
                }}
                className={cx(
                  "absolute right-3 top-3 z-10 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border bg-[rgba(4,6,10,0.58)] text-white shadow-[0_12px_28px_rgba(0,0,0,0.3)] backdrop-blur-[6px] transition-[background-color,border-color,opacity] duration-[180ms] ease-out hover:bg-[rgba(4,6,10,0.72)]",
                  isActiveBlock
                    ? "opacity-100"
                    : "pointer-events-none opacity-0",
                  enabled
                    ? "border-white/16 hover:border-white/32"
                    : "border-[rgba(255,255,255,0.28)]",
                )}
                style={{
                  transitionDelay: `${visibilityDelay}ms`,
                }}
                aria-hidden={!isActiveBlock}
                aria-label={
                  enabled
                    ? `Hide ${card.fallbackLabel}`
                    : `Show ${card.fallbackLabel}`
                }
                aria-pressed={enabled}
                tabIndex={isActiveBlock ? 0 : -1}
              >
                <VisibilityIcon className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <div className="relative flex min-h-[148px] flex-col justify-end p-4 text-white">
                <div>
                  <div className="mb-2">
                    <textarea
                      value={asString(block?.[card.field])}
                      rows={1}
                      onClick={(event) => {
                        event.stopPropagation()
                        activateBlock(index)
                      }}
                      onFocus={() => activateBlock(index)}
                      onChange={(event) =>
                        updateBlockStringField(
                          index,
                          card.field,
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
                      className="w-full resize-none border-0 bg-transparent px-0 text-[13px] font-medium leading-5 text-white outline-none placeholder:text-white/58"
                      style={{ overflow: "hidden" }}
                      placeholder={card.fallbackLabel}
                    />
                  </div>
                  <div className="text-[18px] font-semibold leading-6 tracking-[-0.03em] text-white">
                    {formatEditorDate(card.date)}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  function renderAdventCountdownCard(index: number, block: BlockRecord | null) {
    const { days } = getDaysUntilChristmas(editorToday)
    const countdownTitle =
      days === 0
        ? "Merry Christmas"
        : `${days} ${days === 1 ? "day" : "days"} until Christmas`

    return (
      <div className="flex min-h-[200px] flex-col justify-end">
        <div>
          <div className="mb-4 text-[26px] font-semibold leading-8 tracking-[-0.04em] text-white">
            {countdownTitle}
          </div>
          <textarea
            value={asString(block?.scripture)}
            rows={1}
            onClick={(event) => {
              event.stopPropagation()
              activateBlock(index)
            }}
            onFocus={() => activateBlock(index)}
            onChange={(event) =>
              updateBlockStringField(index, "scripture", event.target.value)
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
            className="w-full resize-none border-0 bg-transparent px-0 text-[20px] font-semibold leading-8 tracking-[-0.03em] text-white outline-none placeholder:text-white/54"
            style={{ overflow: "hidden" }}
            placeholder="Add a Christmas scripture quote"
          />
          <input
            value={asString(block?.scriptureReference)}
            onClick={(event) => {
              event.stopPropagation()
              activateBlock(index)
            }}
            onFocus={() => activateBlock(index)}
            onChange={(event) =>
              updateBlockStringField(
                index,
                "scriptureReference",
                event.target.value,
              )
            }
            className="mt-3 w-full border-0 bg-transparent px-0 text-[13px] leading-5 text-white/68 outline-none placeholder:text-white/42"
            placeholder="Scripture reference"
          />
        </div>
      </div>
    )
  }

  function renderCanvasCard(
    block: BlockSummary,
    index: number,
    options?: {
      dragHandleProps?: {
        attributes: DraggableAttributes
        listeners: DraggableSyntheticListeners | undefined
        setActivatorNodeRef?: (node: HTMLElement | null) => void
      }
      isDragging?: boolean
      isOverlay?: boolean
    },
  ) {
    const isSelected = selectedBlockIndex === index
    const isDragged = options?.isDragging === true
    const dragHandleProps = options?.dragHandleProps
    const blockRecord = readBlockAt(index)
    const type = asString(blockRecord?.t)
    const selectedVideo = findVideoLibraryItem(blockRecord?.videoId)
    const usesRouteVideo = asBoolean(blockRecord?.useRouteVideo)
    const heroPreviewImageUrl = usesRouteVideo
      ? null
      : (selectedVideo?.previewImageUrl ?? null)
    const cardMediaUrl = asString(blockRecord?.mediaUrl)
    const cardBackgroundColor = normalizeHexColor(blockRecord?.backgroundColor)
    const supportsVisualIdentity = supportsSectionVisualIdentity(type)
    const supportsVisualIdentityImage =
      supportsVisualIdentity && type !== "languageGlobe"
    const visualIdentity = blockVisualIdentity(blockRecord)
    const visualIdentityImageUrl = visualIdentity.imageUrl
    const visualIdentityBackgroundColor = normalizeHexColor(
      visualIdentity.backgroundColor,
    )
    const visualIdentityImageFieldName = visualIdentityImageField(type)
    const visualIdentityImageAssetId = asString(
      blockRecord?.[
        visualIdentityAssetField(
          visualIdentityImageFieldName as ImagePickerUrlField,
        )
      ],
    )
    const visualIdentityLabel = type === "card" ? "card" : block.typeLabel
    const isCardBackgroundPickerOpen = cardBackgroundPickerIndex === index

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
        {supportsVisualIdentity
          ? renderVisualIdentityWash(
              visualIdentityImageUrl,
              visualIdentity.backgroundColor,
            )
          : null}
        {supportsVisualIdentity
          ? renderVisualIdentityEar(
              visualIdentityImageUrl,
              visualIdentity.backgroundColor,
            )
          : null}
        <div
          className={cx(
            "absolute right-3 top-3 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-[120ms] ease-out group-hover:opacity-100",
            (isSelected ||
              isCardBackgroundPickerOpen ||
              visualIdentity.backgroundColor ||
              visualIdentityImageUrl) &&
              "opacity-100",
          )}
        >
          {supportsToggleableBlockCta(type)
            ? renderBlockCtaToggleButton(index, blockRecord)
            : null}
          {type === "mediaCollection"
            ? renderMediaCollectionItemNumbersButton(index, blockRecord)
            : null}
          {supportsVisualIdentity ? (
            <>
              <BackgroundColorPicker
                value={blockRecord?.backgroundColor}
                label={`Choose ${visualIdentityLabel} background color`}
                description={
                  type === "container"
                    ? "Used behind the slots in this container."
                    : "Used for this section identity and navigation cards."
                }
                customLabel={`Custom ${visualIdentityLabel} background hex`}
                onChange={(value) =>
                  updateBlockStringField(index, "backgroundColor", value)
                }
                onTrigger={() => activateBlock(index)}
                onOpenChange={(open) =>
                  setCardBackgroundPickerIndex(open ? index : null)
                }
              />
              {supportsVisualIdentityImage ? (
                <div className="inline-flex">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      activateBlock(index)
                      if (type === "container") {
                        chooseContainerBackgroundImage(index, blockRecord ?? {})
                        return
                      }
                      chooseBackgroundImage(
                        index,
                        blockRecord ?? {},
                        visualIdentityImageFieldName as ImagePickerUrlField,
                      )
                    }}
                    className={cx(
                      "flex h-6 w-6 cursor-pointer items-center justify-center border transition-all duration-[120ms] ease-out",
                      visualIdentityImageAssetId
                        ? selectedMediaButtonClassName
                        : idleMediaButtonClassName,
                      "rounded-sm",
                    )}
                    aria-pressed={Boolean(visualIdentityImageAssetId)}
                    aria-label={
                      type === "container"
                        ? "Choose container background image"
                        : `Choose ${visualIdentityLabel} image from asset library`
                    }
                  >
                    <ImageIcon className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
          <button
            ref={dragHandleProps?.setActivatorNodeRef}
            type="button"
            {...dragHandleProps?.attributes}
            {...dragHandleProps?.listeners}
            onClick={(event) => event.stopPropagation()}
            className={cx(
              "flex h-6 w-6 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)]",
              options?.isOverlay
                ? "cursor-grabbing"
                : "cursor-grab touch-none active:cursor-grabbing",
            )}
            aria-label="Drag block"
          >
            <GripVertical className="h-4 w-4" strokeWidth={1.5} />
          </button>
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
                  {renderInlineMediaTextInput(
                    index,
                    "heading",
                    resolveVideoHeroHeading(blockRecord ?? {}),
                    "Add the hero headline",
                    "title",
                  )}
                </div>
                <div className="mt-3 max-w-xl">
                  {renderInlineMediaTextarea(
                    index,
                    "subheading",
                    resolveVideoHeroSubheading(blockRecord ?? {}),
                    "Add a short hero summary",
                    1,
                    true,
                  )}
                </div>
                {renderInlineBlockCta(index, blockRecord)}
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
                  {renderInlineMediaTextInput(
                    index,
                    "title",
                    resolveVideoBlockTitle(blockRecord ?? {}),
                    "Add the video title",
                    "title",
                  )}
                </div>
                <div className="mt-3 max-w-xl">
                  {renderInlineMediaTextarea(
                    index,
                    "subtitle",
                    resolveVideoBlockSubtitle(blockRecord ?? {}),
                    "Add a short video summary",
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
                inlineTitlePlaceholder(type),
                "title",
              )}
            </div>
            <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">
              {block.body}
            </p>
          </div>
        ) : block.tone === "grid" &&
          type !== "infoBlocks" &&
          type !== "navigationCarousel" &&
          type !== "mediaCollection" ? (
          <div className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                  {block.typeLabel}
                </div>
                {type === "container" ? null : (
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
                      inlineTitlePlaceholder(type),
                      "title",
                    )}
                  </div>
                )}
                {type !== "container" ? (
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
                        ? "Add a short supporting line"
                        : inlineDescriptionPlaceholder(type),
                      type === "videoCarousel" ? 1 : 3,
                      type === "videoCarousel",
                    )}
                  </div>
                ) : null}
                {type === "container"
                  ? renderContainerPreview(index, blockRecord ?? {})
                  : null}
                {type === "videoCarousel" ? (
                  <div className="mt-2">
                    {renderInlineTextarea(
                      index,
                      "description",
                      asString(blockRecord?.description),
                      inlineDescriptionPlaceholder(type),
                      1,
                      true,
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            {type === "videoCarousel" ? (
              <div className="space-y-3">
                {asString(blockRecord?.itemsSource) !== "routeVideoChildren" ? (
                  <div
                    className={cx(
                      "flex items-center justify-between gap-3 transition-[max-height,opacity,transform,margin] duration-[180ms] ease-out",
                      selectedBlockIndex === index
                        ? "mb-0 max-h-12 translate-y-0 opacity-100"
                        : "-mt-1 max-h-0 -translate-y-1 opacity-0",
                    )}
                  >
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      Carousel videos
                    </div>
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
                  </div>
                ) : null}
                {asString(blockRecord?.itemsSource) === "routeVideoChildren" ? (
                  <div className="flex w-full items-start gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-4 py-3 text-left">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[rgba(255,255,255,0.04)] text-[var(--color-text-secondary)]">
                      <Link2 className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                        Route video children enabled
                      </div>
                      <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                        Pulls descendant videos from the current route video
                        instead of using a manually curated list.
                      </p>
                    </div>
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
                        <div
                          className={cx(
                            "grid h-[180px] items-stretch gap-3",
                            asArray(blockRecord?.items).length > 2
                              ? "grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)]"
                              : asArray(blockRecord?.items).length === 2
                                ? "grid-cols-2"
                                : "max-w-[320px] grid-cols-1",
                          )}
                        >
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
                              className="flex h-full cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-5 text-center"
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
                  renderCanvasEmptyState({
                    icon: Clapperboard,
                    title: "Build this carousel from the media library",
                    description:
                      "Add feature films or other videos, then reorder them and tailor each title, subtitle, and image directly on the canvas.",
                  })
                )}
              </div>
            ) : type === "container" ? null : (
              <div className="grid gap-3 md:grid-cols-3">
                {[0, 1, 2].map((item) => (
                  <div
                    key={`${block.key}-${item}`}
                    className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-3 py-6"
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            className={cx(
              type === "card"
                ? "relative min-h-[200px] overflow-hidden"
                : type === "adventCountdown"
                  ? "relative min-h-[200px] overflow-hidden"
                  : "relative z-10 space-y-4 p-5",
            )}
          >
            {type === "card" || type === "adventCountdown" ? (
              <div
                className="absolute inset-0 overflow-hidden rounded-sm"
                style={{
                  background:
                    type === "adventCountdown"
                      ? visualIdentityImageUrl
                        ? visualIdentityBackgroundColor
                        : `radial-gradient(circle at top left, rgba(255,255,255,0.18), transparent 52%), linear-gradient(0deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.08) 64%, rgba(0,0,0,0) 100%), ${visualIdentityBackgroundColor}`
                      : cardMediaUrl
                        ? cardBackgroundColor
                        : `radial-gradient(circle at top left, rgba(255,255,255,0.18), transparent 52%), linear-gradient(0deg, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0.06) 62%, rgba(0,0,0,0) 100%), ${cardBackgroundColor}`,
                }}
              >
                {type === "adventCountdown" ? (
                  visualIdentityImageUrl ? (
                    <>
                      <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{
                          backgroundImage: `url("${visualIdentityImageUrl}")`,
                        }}
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.82)_0%,rgba(0,0,0,0.54)_46%,rgba(0,0,0,0.12)_76%,rgba(0,0,0,0)_100%)]" />
                    </>
                  ) : (
                    <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0)_52%)]" />
                  )
                ) : cardMediaUrl ? (
                  <>
                    <div
                      className="absolute inset-0 bg-cover bg-center"
                      style={{ backgroundImage: `url("${cardMediaUrl}")` }}
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.82)_0%,rgba(0,0,0,0.56)_44%,rgba(0,0,0,0.14)_74%,rgba(0,0,0,0)_100%)]" />
                  </>
                ) : (
                  <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0)_52%)]" />
                )}
              </div>
            ) : null}
            <div
              className={cx(
                "relative z-10 flex items-start justify-between gap-4",
                type === "card" && "relative min-h-[200px] flex-col gap-0 p-5",
                type === "adventCountdown" &&
                  "relative min-h-[200px] flex-col gap-0 p-5",
              )}
            >
              <div
                className={cx(
                  "min-w-0 flex-1",
                  type === "card" && "flex w-full flex-col",
                  type === "adventCountdown" && "flex w-full flex-col",
                )}
              >
                <div
                  className={cx(
                    "font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]",
                    type === "card" && "text-white/64",
                    type === "adventCountdown" && "text-white/64",
                  )}
                >
                  {block.typeLabel}
                </div>
                {type === "infoBlocks" || type === "promoBanner" ? (
                  <div className="mt-2 max-w-xs">
                    {renderInlineTextInput(
                      index,
                      "intro",
                      asString(blockRecord?.intro),
                      type === "promoBanner"
                        ? "Add a short promo label"
                        : "Add a short label above the details",
                    )}
                  </div>
                ) : null}
                {type === "mediaCollection" ? (
                  <div className="mt-2 max-w-xs">
                    {renderInlineTextInput(
                      index,
                      "categoryLabel",
                      asString(blockRecord?.categoryLabel),
                      "Add a collection label",
                    )}
                  </div>
                ) : null}
                {type === "navigationCarousel" ||
                type === "adventCountdown" ||
                type === "section" ? null : (
                  <div className={type === "card" ? "mt-auto" : "mt-2"}>
                    {type === "text"
                      ? renderInlineTextInput(
                          index,
                          "heading",
                          asString(blockRecord?.heading),
                          inlineTitlePlaceholder(type),
                          "title",
                        )
                      : type === "card"
                        ? renderInlineMediaTextInput(
                            index,
                            "title",
                            asString(blockRecord?.title),
                            inlineTitlePlaceholder(type),
                            "title",
                          )
                        : renderInlineTextInput(
                            index,
                            type === "languageGlobe"
                              ? "heading"
                              : type === "infoBlocks"
                                ? "heading"
                                : type === "mediaCollection"
                                  ? "title"
                                  : type === "cta"
                                    ? "heading"
                                    : type === "promoBanner"
                                      ? "heading"
                                      : type === "relatedQuestions"
                                        ? "heading"
                                        : type === "bibleQuotesCarousel"
                                          ? "heading"
                                          : type === "easterDates"
                                            ? "easterDatesTitle"
                                            : type === "section"
                                              ? "sectionKey"
                                              : "title",
                            type === "languageGlobe"
                              ? asString(blockRecord?.heading)
                              : type === "infoBlocks"
                                ? asString(blockRecord?.heading)
                                : type === "mediaCollection"
                                  ? asString(blockRecord?.title)
                                  : type === "cta"
                                    ? asString(blockRecord?.heading)
                                    : type === "promoBanner"
                                      ? asString(blockRecord?.heading)
                                      : type === "relatedQuestions"
                                        ? asString(blockRecord?.heading)
                                        : type === "bibleQuotesCarousel"
                                          ? asString(blockRecord?.heading)
                                          : type === "easterDates"
                                            ? asString(
                                                blockRecord?.easterDatesTitle,
                                              )
                                            : type === "section"
                                              ? asString(
                                                  blockRecord?.sectionKey,
                                                )
                                              : asString(blockRecord?.title),
                            inlineTitlePlaceholder(type),
                            "title",
                          )}
                  </div>
                )}
                {type === "mediaCollection" ? (
                  <div className="mt-2">
                    {renderInlineTextarea(
                      index,
                      "subtitle",
                      asString(blockRecord?.subtitle),
                      "Add a short supporting line",
                      1,
                      true,
                    )}
                  </div>
                ) : null}
                <div className="mt-2">
                  {type === "text" ? (
                    renderInlineTextarea(
                      index,
                      "subtitle",
                      asString(blockRecord?.subtitle),
                      inlineDescriptionPlaceholder(type),
                      1,
                      true,
                    )
                  ) : type === "languageGlobe" ? (
                    renderInlineTextarea(
                      index,
                      "description",
                      asString(blockRecord?.description),
                      inlineDescriptionPlaceholder(type),
                      2,
                      true,
                    )
                  ) : type === "infoBlocks" ? (
                    renderInlineTextarea(
                      index,
                      "description",
                      asString(blockRecord?.description),
                      inlineDescriptionPlaceholder(type),
                      1,
                      true,
                    )
                  ) : type === "mediaCollection" ? (
                    renderInlineTextarea(
                      index,
                      "description",
                      asString(blockRecord?.description),
                      inlineDescriptionPlaceholder(type),
                      1,
                      true,
                    )
                  ) : type === "cta" ? (
                    renderInlineTextarea(
                      index,
                      "body",
                      asString(blockRecord?.body),
                      inlineDescriptionPlaceholder(type),
                      1,
                      true,
                    )
                  ) : type === "video" ? (
                    renderInlineTextarea(
                      index,
                      "subtitle",
                      asString(blockRecord?.subtitle),
                      inlineDescriptionPlaceholder(type),
                      2,
                    )
                  ) : type === "promoBanner" ? (
                    renderInlineTextarea(
                      index,
                      "description",
                      asString(blockRecord?.description),
                      "Banner copy",
                      1,
                      true,
                    )
                  ) : type === "card" ? (
                    renderInlineMediaTextarea(
                      index,
                      "description",
                      asString(blockRecord?.description),
                      inlineDescriptionPlaceholder(type),
                      1,
                      true,
                    )
                  ) : type === "relatedQuestions" ||
                    type === "adventCountdown" ||
                    type === "bibleQuotesCarousel" ||
                    type === "easterDates" ||
                    type === "navigationCarousel" ||
                    type === "section" ? null : (
                    <p className="text-[13px] leading-6 text-[var(--color-text-secondary)]">
                      {block.body}
                    </p>
                  )}
                </div>
                {type === "mediaCollection" ? (
                  <div className="mt-2">
                    {renderInlineTextarea(
                      index,
                      "footerText",
                      asString(blockRecord?.footerText),
                      "Add footer copy",
                      1,
                      true,
                    )}
                  </div>
                ) : null}
                {type === "languageGlobe" ? (
                  <label className="mt-4 block max-w-[220px] text-[12px] text-[var(--color-text-secondary)]">
                    <span className="mb-2 block font-medium text-[var(--color-text-primary)]">
                      Languages shown
                    </span>
                    <input
                      type="number"
                      min={4}
                      max={24}
                      value={asNumber(blockRecord?.languageLimit) ?? 12}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        updateBlockAt(index, (currentBlock) => ({
                          ...currentBlock,
                          languageLimit: Math.round(
                            clampNumber(
                              Number(event.target.value) || 12,
                              4,
                              24,
                            ),
                          ),
                        }))
                      }
                      className="h-10 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-text-primary)]"
                    />
                  </label>
                ) : null}
                {type === "easterDates"
                  ? renderEasterDateCards(index, blockRecord ?? null)
                  : null}
                {type === "adventCountdown"
                  ? renderAdventCountdownCard(index, blockRecord ?? null)
                  : null}
                {type === "card" ? (
                  <div className="mt-4 flex items-center gap-2">
                    {renderCanvasVariantControl({
                      index,
                      block: blockRecord,
                      options: ["default", "featured"],
                      tone: "media",
                      className: "",
                    })}
                    {renderCanvasLinkButton({
                      index,
                      tone: "media",
                      ariaLabel: "Edit card link",
                    })}
                  </div>
                ) : null}
                {type === "text" ? (
                  <div className="mt-2">
                    {renderInlineParagraphsTextarea(
                      index,
                      asArray(blockRecord?.contentParagraphs).filter(
                        (item): item is string => typeof item === "string",
                      ),
                      asString(blockRecord?.variant) === "promotional"
                        ? "Markdown: use blank lines between paragraphs; start subheadings with ###"
                        : "Paragraphs, one per line",
                      blockRecord?.variant,
                      asString(blockRecord?.variant) === "promotional" ? 8 : 1,
                      true,
                    )}
                  </div>
                ) : null}
                {type === "text" ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {renderCanvasVariantControl({
                      index,
                      block: blockRecord,
                      options: ["default", "lead", "small", "promotional"],
                      className: "",
                    })}
                    {renderCanvasStringOptionControl({
                      index,
                      block: blockRecord,
                      field: "headingLevel",
                      options: ["h1", "h2", "h3", "h4", "h5", "h6"],
                      fallback: "h2",
                      className: "",
                      formatLabel: (value) => value.toUpperCase(),
                    })}
                  </div>
                ) : null}
                {type === "mediaCollection"
                  ? renderInlineBlockCta(index, blockRecord)
                  : null}
                {type === "section"
                  ? renderSectionPreview(index, blockRecord ?? {})
                  : null}
                {type === "infoBlocks" ? (
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
                        Support cards
                      </div>
                      {selectedBlockIndex === index ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            appendInfoBlockItem(index)
                          }}
                          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]"
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.5} />
                          Add card
                        </button>
                      ) : null}
                    </div>
                    <div className="grid">
                      <div
                        className={cx(
                          "grid transition-[grid-template-rows,opacity,transform] duration-[260ms] ease-out",
                          selectedBlockIndex === index
                            ? "grid-rows-[1fr] translate-y-0 overflow-visible opacity-100"
                            : "grid-rows-[0fr] -translate-y-1 overflow-hidden opacity-0",
                        )}
                      >
                        <div
                          className={cx(
                            "min-h-0",
                            selectedBlockIndex === index
                              ? "overflow-visible"
                              : "overflow-hidden",
                          )}
                        >
                          {asArray(blockRecord?.blocks).length > 0 ? (
                            <div className="space-y-3">
                              {asArray(blockRecord?.blocks).map(
                                (item, itemIndex) =>
                                  renderInfoBlockItemCard(
                                    index,
                                    item,
                                    itemIndex,
                                  ),
                              )}
                            </div>
                          ) : null}
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
                          {asArray(blockRecord?.blocks).length > 0 ? (
                            <div
                              className={cx(
                                "grid items-stretch gap-3",
                                asArray(blockRecord?.blocks).length > 3
                                  ? "md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)]"
                                  : "md:grid-cols-3",
                              )}
                            >
                              {asArray(blockRecord?.blocks)
                                .slice(
                                  0,
                                  asArray(blockRecord?.blocks).length > 3
                                    ? 2
                                    : 3,
                                )
                                .map((item, itemIndex) => {
                                  const itemRecord = asRecord(item)
                                  const itemIcon = resolveInfoBlockIcon(
                                    itemRecord?.icon,
                                  )
                                  const ItemIcon = itemIcon.icon
                                  return (
                                    <div
                                      key={`${block.key}-info-preview-${itemIndex}`}
                                      className="relative min-h-[132px] overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[#151515]"
                                    >
                                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_48%)]" />
                                      <div className="relative flex min-h-[132px] flex-col px-3 py-4 text-white">
                                        <div className="flex h-9 w-9 items-center justify-center rounded-sm border border-white/16 bg-white/8 text-white">
                                          <ItemIcon
                                            className="h-4 w-4"
                                            strokeWidth={1.5}
                                          />
                                        </div>
                                        <div className="mt-3 text-[13px] font-semibold text-white">
                                          {asString(itemRecord?.title) ||
                                            "Untitled card"}
                                        </div>
                                        <div className="mt-2 line-clamp-3 text-[12px] leading-5 text-white/68">
                                          {asString(itemRecord?.description) ||
                                            "Card description"}
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })}
                              {asArray(blockRecord?.blocks).length > 3 ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    activateBlock(index)
                                  }}
                                  className="flex min-h-[132px] cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-5 text-center md:h-full"
                                >
                                  <span className="text-[26px] font-semibold tracking-[-0.04em] text-[var(--color-text-primary)]">
                                    +{asArray(blockRecord?.blocks).length - 2}
                                  </span>
                                  <span className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
                                    more cards
                                  </span>
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    {asArray(blockRecord?.blocks).length === 0
                      ? renderCanvasEmptyState({
                          icon: Lightbulb,
                          title: "Build this section from key details",
                          description:
                            "Add support cards to explain key ideas, choose icons, and reorder the details directly on the canvas.",
                        })
                      : null}
                  </div>
                ) : null}
                {type === "navigationCarousel" ? (
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
                        Destinations
                      </div>
                      {selectedBlockIndex === index ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            appendNavigationCarouselItem(index)
                          }}
                          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]"
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.5} />
                          Add destination
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
                          {asArray(blockRecord?.items).length > 0 ? (
                            <div className="space-y-3">
                              {asArray(blockRecord?.items).map(
                                (item, itemIndex) =>
                                  renderNavigationCarouselItemCard(
                                    index,
                                    item,
                                    itemIndex,
                                  ),
                              )}
                            </div>
                          ) : null}
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
                          {asArray(blockRecord?.items).length > 0 ? (
                            <div
                              className={cx(
                                "grid h-[180px] items-stretch gap-3",
                                asArray(blockRecord?.items).length > 2
                                  ? "grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)]"
                                  : asArray(blockRecord?.items).length === 2
                                    ? "grid-cols-2"
                                    : "max-w-[320px] grid-cols-1",
                              )}
                            >
                              {asArray(blockRecord?.items)
                                .slice(0, 2)
                                .map((item, itemIndex) => {
                                  const itemRecord = asRecord(item)
                                  const imageUrl = asString(
                                    itemRecord?.imageUrl,
                                  )
                                  const backgroundColor =
                                    asString(itemRecord?.backgroundColor) ||
                                    "#151515"
                                  return (
                                    <div
                                      key={`${block.key}-navigation-preview-${itemIndex}`}
                                      className="relative h-full overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)]"
                                      style={{ backgroundColor }}
                                    >
                                      {imageUrl ? (
                                        <>
                                          <div
                                            className="absolute inset-0 bg-cover bg-center opacity-62"
                                            style={{
                                              backgroundImage: `url("${imageUrl}")`,
                                            }}
                                          />
                                          <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.84)_0%,rgba(0,0,0,0.58)_42%,rgba(0,0,0,0.16)_72%,rgba(0,0,0,0)_100%)]" />
                                        </>
                                      ) : (
                                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_50%)]" />
                                      )}
                                      <div className="relative flex h-full flex-col justify-end p-4 text-white">
                                        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/68">
                                          {asString(itemRecord?.category) ||
                                            "Category"}
                                        </div>
                                        <div className="mt-2 line-clamp-2 text-[14px] font-semibold leading-5 tracking-[-0.02em]">
                                          {asString(itemRecord?.title) ||
                                            "Untitled destination"}
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })}
                              {asArray(blockRecord?.items).length > 2 ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    activateBlock(index)
                                  }}
                                  className="flex h-full cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-5 text-center"
                                >
                                  <span className="text-[26px] font-semibold tracking-[-0.04em] text-[var(--color-text-primary)]">
                                    +{asArray(blockRecord?.items).length - 2}
                                  </span>
                                  <span className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
                                    more destinations
                                  </span>
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    {asArray(blockRecord?.items).length === 0
                      ? renderCanvasEmptyState({
                          icon: Route,
                          title: "Build this carousel from page sections",
                          description:
                            "Add destinations, choose the section each card opens, and the card artwork will follow the selected section.",
                        })
                      : null}
                  </div>
                ) : null}
                {type === "mediaCollection" ? (
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
                        Media items
                      </div>
                      {selectedBlockIndex === index ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openVideoPicker(index, "mediaCollectionAppend")
                          }}
                          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]"
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.5} />
                          Add video
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
                          {asArray(blockRecord?.items).length > 0 ? (
                            <div className="space-y-3">
                              {asArray(blockRecord?.items).map(
                                (item, itemIndex) =>
                                  renderMediaCollectionItemCard(
                                    index,
                                    item,
                                    itemIndex,
                                    true,
                                    asBoolean(blockRecord?.showItemNumbers),
                                  ),
                              )}
                            </div>
                          ) : null}
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
                          {asArray(blockRecord?.items).length > 0 ? (
                            <div
                              className={cx(
                                "grid h-[180px] items-stretch gap-3",
                                asArray(blockRecord?.items).length > 2
                                  ? "grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)]"
                                  : asArray(blockRecord?.items).length === 2
                                    ? "grid-cols-2"
                                    : "max-w-[320px] grid-cols-1",
                              )}
                            >
                              {asArray(blockRecord?.items)
                                .slice(0, 2)
                                .map((item, itemIndex) =>
                                  renderMediaCollectionItemCard(
                                    index,
                                    item,
                                    itemIndex,
                                    false,
                                    asBoolean(blockRecord?.showItemNumbers),
                                  ),
                                )}
                              {asArray(blockRecord?.items).length > 2 ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    activateBlock(index)
                                  }}
                                  className="flex h-full cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-5 text-center"
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
                          ) : null}
                        </div>
                      </div>
                    </div>
                    {asArray(blockRecord?.items).length === 0
                      ? renderCanvasEmptyState({
                          icon: Clapperboard,
                          title: "Build this collection from the media library",
                          description:
                            "Add videos from the media library, then reorder them and tailor each title, subtitle, and image directly on the canvas.",
                        })
                      : null}
                    {renderCanvasVariantControl({
                      index,
                      block: blockRecord,
                      options: [
                        "carousel",
                        "grid",
                        "collection",
                        "hero",
                        "player",
                      ],
                      className: "mt-4",
                    })}
                  </div>
                ) : null}
                {type === "cta"
                  ? renderInlineRequiredCta(index, blockRecord)
                  : null}
                {type === "cta"
                  ? renderCanvasVariantControl({
                      index,
                      block: blockRecord,
                      options: ["primary", "secondary"],
                    })
                  : null}
                {type === "promoBanner"
                  ? renderInlineBlockCta(index, blockRecord)
                  : null}
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
                        Quote cards
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
                          ) : null}
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
                            <div
                              className={cx(
                                "grid h-[180px] items-stretch gap-3",
                                asArray(blockRecord?.quotes).length > 2
                                  ? "grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)]"
                                  : asArray(blockRecord?.quotes).length === 2
                                    ? "grid-cols-2"
                                    : "max-w-[320px] grid-cols-1",
                              )}
                            >
                              {asArray(blockRecord?.quotes)
                                .slice(0, 2)
                                .map((item, itemIndex) => {
                                  const itemRecord = asRecord(item)
                                  const previewImageUrl =
                                    mediaAssetPreviewUrl(
                                      itemRecord?.backgroundImageAssetId,
                                    ) ||
                                    mediaAssetPreviewUrl(
                                      itemRecord?.imageAssetId,
                                    ) ||
                                    asString(itemRecord?.backgroundImageUrl) ||
                                    asString(itemRecord?.imageUrl)
                                  const backgroundColor =
                                    asString(itemRecord?.backgroundColor) ||
                                    "#151515"
                                  return (
                                    <div
                                      key={`${block.key}-quote-preview-${itemIndex}`}
                                      className="relative h-full overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)]"
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
                                          <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.84)_0%,rgba(0,0,0,0.58)_42%,rgba(0,0,0,0.16)_72%,rgba(0,0,0,0)_100%)]" />
                                        </>
                                      ) : (
                                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_48%)]" />
                                      )}
                                      <div className="relative flex h-full flex-col justify-end p-4 text-white">
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
                                  className="flex h-full cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-5 text-center"
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
                          ) : null}
                        </div>
                      </div>
                    </div>
                    {asArray(blockRecord?.quotes).length === 0
                      ? renderCanvasEmptyState({
                          icon: MessageSquareQuote,
                          title: "Build this carousel from featured quotes",
                          description:
                            "Add scripture references, quote text, attribution, backgrounds, and optional call-to-action buttons.",
                        })
                      : null}
                  </div>
                ) : null}
                {type === "relatedQuestions"
                  ? renderInlineBlockCta(index, blockRecord)
                  : null}
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
                          {asArray(blockRecord?.questions).length > 0 ? (
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
                          ) : null}
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
                          {asArray(blockRecord?.questions).length > 0 ? (
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
                          ) : null}
                        </div>
                      </div>
                    </div>
                    {asArray(blockRecord?.questions).length === 0
                      ? renderCanvasEmptyState({
                          icon: MessagesSquare,
                          title: "Build this section from related questions",
                          description:
                            "Add questions and answers to help visitors understand the next step before they act.",
                        })
                      : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  const navigationDestinationPickerBlockIndex =
    navigationDestinationPicker?.blockIndex ?? null
  const navigationDestinationPickerItemIndex =
    navigationDestinationPicker?.itemIndex ?? null
  const navigationDestinationPickerBlock =
    navigationDestinationPickerBlockIndex === null
      ? null
      : asRecord(parsedBlocks[navigationDestinationPickerBlockIndex])
  const navigationDestinationPickerItem =
    navigationDestinationPickerBlock === null ||
    navigationDestinationPickerItemIndex === null
      ? null
      : asRecord(
          asArray(navigationDestinationPickerBlock.items)[
            navigationDestinationPickerItemIndex
          ],
        )
  const navigationDestinationPickerOptions =
    navigationDestinationPickerBlockIndex === null
      ? []
      : navigationDestinationOptions(navigationDestinationPickerBlockIndex)

  const navigationDestinationPortal =
    navigationDestinationPicker !== null &&
    navigationDestinationPickerPosition !== null &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            ref={navigationDestinationPopoverRef}
            className="fixed z-[90] grid max-h-[240px] gap-1 overflow-y-auto rounded-sm border border-[var(--color-hairline-strong)] bg-[color-mix(in_oklab,var(--color-surface)_96%,black)] p-1 shadow-[0_18px_48px_rgba(0,0,0,0.42)]"
            style={{
              top: navigationDestinationPickerPosition.top,
              left: navigationDestinationPickerPosition.left,
              width: navigationDestinationPickerPosition.width,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {navigationDestinationPickerOptions.map((option) => {
              const selected =
                option.sectionKey ===
                asString(navigationDestinationPickerItem?.contentId)
              return (
                <button
                  key={option.sectionKey}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    updateNavigationCarouselItemDestination(
                      navigationDestinationPicker.blockIndex,
                      navigationDestinationPicker.itemIndex,
                      option.sectionKey,
                    )
                    setNavigationDestinationPicker(null)
                  }}
                  className={cx(
                    "flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 text-left transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]",
                    selected && "bg-[var(--color-surface-raised)]",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-[var(--color-text-primary)]">
                      {option.title}
                    </span>
                    <span className="block truncate text-[11px] leading-4 text-[var(--color-text-muted)]">
                      {option.category}
                    </span>
                  </span>
                  {selected ? (
                    <Check
                      className="h-4 w-4 shrink-0 text-[var(--color-brand)]"
                      strokeWidth={1.5}
                    />
                  ) : null}
                </button>
              )
            })}
          </div>,
          document.body,
        )
      : null

  const ctaLinkModalBlock =
    ctaLinkModalBlockIndex === null ? null : readBlockAt(ctaLinkModalBlockIndex)
  const ctaLinkModalBlockTitle =
    ctaLinkModalBlock === null
      ? "Call to action"
      : summarizeBlock(
          ctaLinkModalBlock,
          ctaLinkModalBlockIndex ?? 0,
          videoLibrary,
        ).typeLabel
  const ctaLinkModalFieldName = blockCtaLinkFieldName(ctaLinkModalBlock)
  const ctaLinkModal =
    ctaLinkModalBlockIndex !== null &&
    ctaLinkModalBlock !== null &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            className={cx(
              "fixed inset-0 z-[120] flex items-center justify-center px-4 transition-all duration-180 ease-out sm:px-6",
              ctaLinkModalVisible
                ? "pointer-events-auto bg-[rgba(4,6,10,0.78)] backdrop-blur-[8px]"
                : "pointer-events-none bg-[rgba(4,6,10,0)] backdrop-blur-0",
            )}
            onClick={(event) => {
              event.stopPropagation()
              closeCtaLinkModal()
            }}
            role="presentation"
            aria-hidden={!ctaLinkModalVisible}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="block-cta-link-title"
              className={cx(
                "w-full max-w-[440px] rounded-sm border border-[var(--color-hairline-strong)] bg-[color-mix(in_oklab,var(--color-surface)_96%,black)] p-5 shadow-[0_32px_120px_rgba(0,0,0,0.58)] transition-all duration-180 ease-out",
                ctaLinkModalVisible
                  ? "translate-y-0 scale-100 opacity-100"
                  : "translate-y-2 scale-[0.98] opacity-0",
              )}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="label-text">{ctaLinkModalBlockTitle}</p>
                  <h3
                    id="block-cta-link-title"
                    className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]"
                  >
                    {blockCtaLinkModalTitle(ctaLinkModalBlock)}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={closeCtaLinkModal}
                  className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)]"
                  aria-label="Close call to action link editor"
                >
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
              <label className="mt-5 grid gap-2">
                <span className="label-text">Destination link</span>
                <input
                  value={asString(ctaLinkModalBlock[ctaLinkModalFieldName])}
                  onChange={(event) =>
                    updateBlockStringField(
                      ctaLinkModalBlockIndex,
                      ctaLinkModalFieldName,
                      event.target.value,
                    )
                  }
                  className="h-11 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-hairline-strong)] focus:bg-[var(--color-bg)]"
                  placeholder="/next-step"
                  autoFocus
                />
              </label>
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={closeCtaLinkModal}
                  className="inline-flex h-9 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface-raised)] px-4 text-[12px] font-medium text-[var(--color-text-primary)] transition-[background-color,border-color,transform] duration-[160ms] ease-out hover:-translate-y-0.5 hover:border-[var(--color-text-primary)] hover:bg-[var(--color-surface)]"
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  function handleRestoreRevision(revisionId: string) {
    setRestoreRevisionId(revisionId)
  }

  function handleDeleteBlock(index: number) {
    if (focusedContainerIndex === index && focusedContainerSlotIndex !== null) {
      requestRemoveContainerSlot(index, focusedContainerSlotIndex)
      return
    }
    setDeleteBlockIndex(index)
  }

  function confirmDeleteBlock() {
    if (deleteBlockIndex === null) return
    const location = nestedCanvasBlockLocation(deleteBlockIndex)
    if (location) {
      if (location.kind === "section") {
        removeSectionContentBlock(location.sectionIndex, location.childIndex)
      } else {
        removeContainerContentBlock(
          location.containerIndex,
          location.childIndex,
        )
      }
      setSelectedBlockIndex(null)
      setDeleteBlockIndex(null)
      pushToast("Block removed.", "success")
      return
    }
    removeBlock(deleteBlockIndex)
    setDeleteBlockIndex(null)
  }

  function confirmDeleteContainerSlot() {
    if (pendingContainerSlotDelete === null) return
    const { containerIndex, slotIndex } = pendingContainerSlotDelete
    removeContainerSlot(containerIndex, slotIndex)
    setFocusedContainerSlotIndex((current) => {
      if (current === null) return null
      if (current === slotIndex) return Math.max(0, slotIndex - 1)
      return current > slotIndex ? current - 1 : current
    })
    closeContainerSlotDeleteDialog()
    setSelectedBlockIndex(containerIndex)
    pushToast("Slot removed.", "success")
  }

  function closeContainerSlotDeleteDialog() {
    setIsContainerSlotDeleteOpen(false)
    if (containerSlotDeleteCloseTimeout.current !== null) {
      window.clearTimeout(containerSlotDeleteCloseTimeout.current)
    }
    containerSlotDeleteCloseTimeout.current = window.setTimeout(() => {
      setPendingContainerSlotDelete(null)
      containerSlotDeleteCloseTimeout.current = null
    }, 180)
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

  const focusedContainerRecord =
    focusedContainerIndex === null
      ? null
      : asRecord(parsedBlocks[focusedContainerIndex])
  const isContainerWorkspaceOpen =
    focusedContainerIndex !== null && focusedContainerRecord?.t === "container"
  const focusedSectionRecord =
    focusedSectionIndex === null
      ? null
      : asRecord(parsedBlocks[focusedSectionIndex])
  const isSectionWorkspaceOpen =
    focusedSectionIndex !== null && focusedSectionRecord?.t === "section"

  return (
    <div className="relative flex h-[calc(100vh-3rem)] overflow-hidden bg-[var(--color-surface)]">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {navigationDestinationPortal}
      {ctaLinkModal}
      {isFloatingDrawerOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-[35] cursor-default bg-transparent"
          onClick={closeFloatingDrawers}
          aria-label="Close drawer"
        />
      ) : null}
      {renderInlineBlockLibrary()}
      {renderRevisionHistoryDrawer()}
      {renderLocaleDrawer()}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 z-[29] h-32 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,0.52)_62%,rgba(0,0,0,0.92)_100%)]" />
      </div>
      <div className="pointer-events-none absolute bottom-4 left-0 right-0 z-30">
        <div className="mx-auto w-full max-w-4xl px-6">
          <div className="pointer-events-auto flex items-center justify-between gap-2 rounded-sm border border-[var(--color-hairline)] bg-[color-mix(in_oklab,var(--color-surface)_94%,black)] p-1.5 shadow-[0_18px_56px_rgba(0,0,0,0.36)]">
            <button
              type="button"
              onClick={openToolbarAddBlockPicker}
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[2px] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
            >
              <Plus className="h-4 w-4" strokeWidth={1.5} />
              Add block
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setInlineBlockLibraryOpen(false)
                  setPendingInsertIndex(null)
                  setRevisionHistoryOpen(false)
                  setLocaleDrawerOpen((open) => !open)
                }}
                className={cx(
                  "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[2px] border border-[var(--color-hairline)] px-3 font-mono text-[12px] text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)]",
                  localeDrawerOpen
                    ? "bg-[var(--color-surface-raised)]"
                    : "bg-transparent",
                )}
                aria-label="Open locales"
                title="Locales"
                aria-pressed={localeDrawerOpen}
              >
                <Globe2 className="h-4 w-4" strokeWidth={1.5} />
                {currentLocaleCode}
              </button>
              <button
                type="button"
                onClick={() => {
                  setInlineBlockLibraryOpen(false)
                  setPendingInsertIndex(null)
                  setLocaleDrawerOpen(false)
                  setRevisionHistoryOpen((open) => !open)
                }}
                className={cx(
                  "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[2px] border border-[var(--color-hairline)] text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)]",
                  revisionHistoryOpen
                    ? "bg-[var(--color-surface-raised)]"
                    : "bg-transparent",
                )}
                aria-label="Open revision timeline"
                title="Revision timeline"
                aria-pressed={revisionHistoryOpen}
              >
                <History className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="submit"
                form={`experience-editor-${initialValues.localeId}`}
                name="intent"
                value="save"
                disabled={isPending || !hasChanges}
                className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[2px] border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save className="h-4 w-4" strokeWidth={1.5} />
                Save Draft
              </button>
              {shouldShowPreviewAction ? (
                <button
                  type="button"
                  onClick={() => {
                    openPublishedWatchPage()
                  }}
                  disabled={isPending}
                  className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[2px] bg-[var(--color-brand)] px-3 text-[12px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)] disabled:cursor-not-allowed disabled:opacity-60"
                  title="Open published page"
                >
                  <Eye className="h-4 w-4" strokeWidth={1.5} />
                  Preview
                </button>
              ) : (
                <button
                  type="submit"
                  form={`experience-editor-${initialValues.localeId}`}
                  name="intent"
                  value="publish"
                  disabled={isPending || !canPublishNow}
                  className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[2px] bg-[var(--color-brand)] px-3 text-[12px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <UploadCloud className="h-4 w-4" strokeWidth={1.5} />
                  Publish
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

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
      <ConfirmModal
        open={isContainerSlotDeleteOpen}
        title="Delete This Slot?"
        description={
          pendingContainerSlotDelete === null
            ? ""
            : pendingContainerSlotDelete.blockCount === 0
              ? "This will remove the slot divider. No blocks are inside this slot."
              : `This will remove the slot divider and ${pendingContainerSlotDelete.blockCount} ${pendingContainerSlotDelete.blockCount === 1 ? "block" : "blocks"} inside it.`
        }
        confirmLabel="Delete Slot"
        pending={isPending}
        onCancel={closeContainerSlotDeleteDialog}
        onConfirm={confirmDeleteContainerSlot}
      />
      {infoBlockIconPicker !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,6,10,0.72)] px-4 backdrop-blur-[6px] transition-all duration-180 ease-out sm:px-6"
          onClick={(event) => {
            if (event.target !== event.currentTarget) return
            setInfoBlockIconPicker(null)
          }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="info-icon-picker-title"
            className="flex max-h-[min(82vh,640px)] w-full max-w-[760px] translate-y-0 scale-100 flex-col overflow-hidden rounded-sm border border-[var(--color-hairline-strong)] bg-[color-mix(in_oklab,var(--color-surface)_96%,black)] p-5 opacity-100 shadow-[0_32px_120px_rgba(0,0,0,0.58)] transition-[opacity,transform] duration-180 ease-out"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                  Key Details
                </div>
                <h2
                  id="info-icon-picker-title"
                  className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]"
                >
                  Choose icon
                </h2>
                <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--color-text-secondary)]">
                  {infoIconPickerItem
                    ? `Choose the icon for ${asString(infoIconPickerItem.title) || "this detail"}.`
                    : "Choose an icon for this detail."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInfoBlockIconPicker(null)}
                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
                aria-label="Close icon picker"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <label className="mt-5 grid gap-1.5">
              <span className="label-text">Search icons</span>
              <div className="flex h-10 items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3">
                <Search className="h-4 w-4 text-[var(--color-text-muted)]" />
                <input
                  value={infoBlockIconQuery}
                  onChange={(event) =>
                    setInfoBlockIconQuery(event.target.value)
                  }
                  className="w-full border-0 bg-transparent text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]"
                  placeholder="Search love, teaching, journey, video..."
                />
              </div>
            </label>

            <div className="mt-4 h-[279.5px] max-h-[calc(82vh-220px)] min-h-[184px] overflow-y-auto pr-1 [scrollbar-color:rgba(255,255,255,0.24)_transparent] [scrollbar-width:thin]">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {filteredInfoIconOptions.map((option) => {
                  const OptionIcon = option.icon
                  const isSelected =
                    infoIconPickerOption !== null &&
                    option.value === infoIconPickerOption.value

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        updateInfoBlockItemField(
                          infoBlockIconPicker.blockIndex,
                          infoBlockIconPicker.itemIndex,
                          "icon",
                          option.value,
                        )
                        setInfoBlockIconPicker(null)
                      }}
                      className={cx(
                        "flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-sm border text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
                        isSelected
                          ? "border-[var(--color-text-primary)] bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                          : "border-[var(--color-hairline)] bg-[var(--color-surface-inset)]",
                      )}
                      aria-label={`Use ${option.label} icon`}
                      aria-pressed={isSelected}
                    >
                      <OptionIcon className="h-5 w-5" strokeWidth={1.5} />
                      <span className="mt-2 text-[10px] leading-4">
                        {option.label}
                      </span>
                    </button>
                  )
                })}
              </div>
              {filteredInfoIconOptions.length === 0 ? (
                <div className="rounded-sm border border-dashed border-[var(--color-hairline)] px-4 py-5 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                  No icons match that search.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <ImagePickerBrowser
        key={
          imagePickerTarget
            ? `${imagePickerTarget.label}:${imagePickerTarget.selectedAssetId ?? ""}`
            : "closed"
        }
        open={imagePickerTarget !== null}
        mediaLibrary={mediaLibrary}
        query={imageLibraryQuery}
        selectedFolderId={imagePickerSelectedFolderId}
        selectedAssetId={imagePickerTarget?.selectedAssetId ?? null}
        canClearImage={imagePickerTarget?.canClear ?? false}
        canUpload={canUploadImages}
        uploadAction={uploadImageAction}
        onQueryChange={setImageLibraryQuery}
        onSelectFolder={selectImagePickerFolder}
        onSelectImage={applyImagePickerSelection}
        onClearImage={clearImagePickerSelection}
        onClose={closeImagePicker}
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
            videoPickerMode === "carouselAppend" ||
              videoPickerMode === "mediaCollectionAppend"
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
                videoPickerMode === "carouselAppend" ||
                  videoPickerMode === "mediaCollectionAppend"
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
                    {videoLibrarySearchPending
                      ? "Searching the full video library..."
                      : videoLibrarySearchError
                        ? "Search failed. Try again or clear the query."
                        : videoPickerMode === "carouselAppend"
                          ? "Choose a media item to preview and add to this carousel."
                          : videoPickerMode === "mediaCollectionAppend"
                            ? "Choose a video to preview and add to this media collection."
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
                      videoPickerMode === "carouselAppend" ||
                        videoPickerMode === "mediaCollectionAppend"
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
                          : videoPickerMode === "mediaCollectionAppend"
                            ? "Pick a result on the left to preview the video and add it to this media collection."
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
                  : videoPickerMode === "mediaCollectionAppend"
                    ? "Add video"
                    : "Apply video"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <section className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-[var(--color-bg)] pb-32 [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]">
        {isContainerWorkspaceOpen && focusedContainerIndex !== null ? (
          renderContainerWorkspace(
            focusedContainerIndex,
            focusedContainerRecord!,
          )
        ) : isSectionWorkspaceOpen && focusedSectionIndex !== null ? (
          renderSectionWorkspace(focusedSectionIndex, focusedSectionRecord!)
        ) : (
          <div className="mx-auto max-w-5xl px-6 py-6 xl:px-12 xl:py-7">
            <div className="space-y-3 pb-10">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="block min-h-[3.75rem] w-full appearance-none border-0 bg-transparent px-0 py-0 text-[38px] font-semibold leading-[1.04] tracking-[-0.05em] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)] md:text-[44px] xl:min-h-[4.25rem] xl:text-[50px]"
                placeholder="Untitled Experience"
              />
              <div
                className="inline-flex max-w-full flex-wrap items-baseline gap-0 font-mono text-[15px] leading-6 text-[var(--color-text-muted)]"
                role="group"
                aria-label="Route"
                onBlur={(event) => {
                  if (
                    event.relatedTarget instanceof Node &&
                    event.currentTarget.contains(event.relatedTarget)
                  ) {
                    return
                  }
                  setPathSegment((current) => cleanRoutePart(current, true))
                  setSlug((current) => cleanRoutePart(current, true))
                }}
              >
                <span aria-hidden="true">/</span>
                <input
                  value={pathSegment}
                  onChange={(event) =>
                    setPathSegment(cleanRoutePart(event.target.value))
                  }
                  className="min-w-0 max-w-[220px] border-0 bg-transparent p-0 font-mono text-[15px] leading-6 text-[var(--color-text-secondary)] outline-none placeholder:text-[var(--color-text-disabled)]"
                  style={{ width: routePrefixInputWidth }}
                  placeholder="prefix"
                  aria-label="Route prefix"
                />
                <span aria-hidden="true">/</span>
                <input
                  value={slug}
                  onChange={(event) =>
                    setSlug(cleanRoutePart(event.target.value))
                  }
                  className="min-w-0 max-w-[320px] border-0 bg-transparent p-0 font-mono text-[15px] leading-6 text-[var(--color-text-secondary)] outline-none placeholder:text-[var(--color-text-disabled)]"
                  style={{ width: slugInputWidth }}
                  placeholder="slug"
                  aria-label="Slug"
                />
              </div>
              <textarea
                value={metaDescription}
                onChange={(event) => setMetaDescription(event.target.value)}
                onInput={(event) => resizeTextareaHeight(event.currentTarget)}
                ref={(node) => {
                  if (!node) return
                  resizeTextareaHeight(node)
                }}
                rows={1}
                className="block max-h-32 min-h-7 w-full resize-none overflow-hidden border-0 bg-transparent px-0 py-0 text-[16px] leading-7 text-[var(--color-text-secondary)] outline-none placeholder:text-[var(--color-text-disabled)] focus:text-[var(--color-text-primary)]"
                placeholder="Description"
                aria-label="Description"
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
                        Use AI Chat to generate a first draft from a prompt, or
                        pick a starter block below if you want to build
                        manually.
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
                              <block.icon
                                className="h-4 w-4"
                                strokeWidth={1.5}
                              />
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

            <CanvasBlockList
              activeDragKey={activeDragKey}
              activeDragSummary={activeDragSummary}
              blockCardRefs={blockCardRefs}
              blocks={blockSummaries}
              insertedBlockAnimation={insertedBlockAnimation}
              pendingInsertIndex={pendingInsertIndex}
              sensors={sensors}
              onBlockDragCancel={() => handleDragCleanup(false)}
              onBlockDragEnd={handleBlockDragEnd}
              onBlockDragOver={handleBlockDragOver}
              onBlockDragStart={handleBlockDragStart}
              onOpenAddBlockPicker={openAddBlockPicker}
              renderBlock={renderCanvasCard}
              renderPendingInsertMarker={renderPendingInsertMarker}
            />
          </div>
        )}
      </section>

      <section className="hidden">
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
              const nextPublishedSlug = cleanRoutePart(slug)
              setPublishedSlug(nextPublishedSlug)
              openPublishedWatchPage(nextPublishedSlug)
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
            name="isTemplate"
            value={isTemplate ? "on" : ""}
          />
          <input
            type="hidden"
            name="blocks"
            value={JSON.stringify(normalizedParsedBlocks, null, 2)}
          />
        </form>
      </section>
    </div>
  )
}
