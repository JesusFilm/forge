import type { CSSProperties } from "react"
import type { RouteVideo } from "@/lib/content"
import { Text } from "./Text"
import { AdventCountdown } from "./AdventCountdown"
import { EasterDates } from "./EasterDates"
import { MediaCollection } from "./MediaCollection"
import { CTASection } from "./CTASection"
import { Video } from "./Video"
import { RelatedQuestions } from "./RelatedQuestions"
import { BibleQuotesCarousel } from "./BibleQuotesCarousel"
import type {
  ContainerBlock,
  ContainerContentBlock,
  VideoMap,
} from "./block-types"

type ContainerProps = {
  data: ContainerBlock
  routeVideo?: RouteVideo | null
  videoMap?: VideoMap
}

type Slot = Extract<ContainerContentBlock, { t: "containerSlot" }> & {
  content: SlotContentItem[]
}
type SlotContentItem = Exclude<ContainerContentBlock, { t: "containerSlot" }>
type GridBreakpoint = "xs" | "sm" | "md" | "lg" | "xl"
type SlotSpanStyles = CSSProperties & Record<`--slot-${GridBreakpoint}`, number>

function clampSpan(value: unknown, fallback = 6) {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(12, Math.max(1, Math.round(parsed)))
}

function readSpans(slot: Slot) {
  const base = clampSpan(slot.gridSpan)
  const spans =
    slot.spans && typeof slot.spans === "object" && !Array.isArray(slot.spans)
      ? (slot.spans as Partial<Record<GridBreakpoint, unknown>>)
      : {}

  return {
    xs: clampSpan(spans.xs, 12),
    sm: clampSpan(spans.sm, 12),
    md: clampSpan(spans.md, base),
    lg: clampSpan(spans.lg, base),
    xl: clampSpan(spans.xl, base),
  }
}

function slotSpanStyle(slot: Slot): SlotSpanStyles {
  const spans = readSpans(slot)
  return {
    "--slot-xs": spans.xs,
    "--slot-sm": spans.sm,
    "--slot-md": spans.md,
    "--slot-lg": spans.lg,
    "--slot-xl": spans.xl,
  }
}

function SlotContentRenderer({
  item,
  routeVideo,
  videoMap,
}: {
  item: SlotContentItem
  routeVideo?: RouteVideo | null
  videoMap?: VideoMap
}) {
  switch (item.t) {
    case "text":
      return <Text data={item} />
    case "adventCountdown":
      return <AdventCountdown data={item} />
    case "easterDates":
      return <EasterDates data={item} />
    case "mediaCollection":
      return (
        <MediaCollection
          data={item}
          routeVideo={routeVideo}
          videoMap={videoMap}
        />
      )
    case "cta":
      return <CTASection data={item} />
    case "video":
      return <Video data={item} routeVideo={routeVideo} videoMap={videoMap} />
    case "relatedQuestions":
      return <RelatedQuestions data={item} />
    case "bibleQuotesCarousel":
      return <BibleQuotesCarousel data={item} />
    case "card":
      return null
    default:
      return null
  }
}

function buildSlots(content: ContainerContentBlock[]): Slot[] {
  const slots: Slot[] = []
  let current: Slot | null = null

  for (const item of content) {
    if (item.t === "containerSlot") {
      current = { ...item, content: [] }
      slots.push(current)
      continue
    }

    if (!current) {
      current = {
        t: "containerSlot",
        gridSpan: 12,
        content: [],
      }
      slots.push(current)
    }
    current.content.push(item)
  }

  return slots
}

export function Container({ data, routeVideo, videoMap }: ContainerProps) {
  const { sectionKey, content } = data
  const validSlots = buildSlots(content ?? [])
  if (!validSlots.length) return null

  return (
    <section
      id={sectionKey ?? undefined}
      data-section-key={sectionKey ?? undefined}
      className="grid w-full grid-cols-12 gap-10 py-8 text-stone-100 md:gap-6"
      data-testid="Container"
    >
      {validSlots.map((slot, slotIndex) => (
        <div
          key={`${sectionKey ?? "container"}-${slotIndex}`}
          className="min-w-0 space-y-10 [grid-column:span_var(--slot-xs)_/_span_var(--slot-xs)] sm:[grid-column:span_var(--slot-sm)_/_span_var(--slot-sm)] md:space-y-6 md:[grid-column:span_var(--slot-md)_/_span_var(--slot-md)] lg:[grid-column:span_var(--slot-lg)_/_span_var(--slot-lg)] xl:[grid-column:span_var(--slot-xl)_/_span_var(--slot-xl)]"
          style={slotSpanStyle(slot)}
        >
          {slot.content?.map((item, index) => {
            return (
              <SlotContentRenderer
                key={`${sectionKey ?? "slot"}-${slotIndex}-${index}`}
                item={item as SlotContentItem}
                routeVideo={routeVideo}
                videoMap={videoMap}
              />
            )
          })}
        </div>
      ))}
    </section>
  )
}
