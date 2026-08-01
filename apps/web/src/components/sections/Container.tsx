import type { FragmentOf } from "@/lib/legacy-fragment-types"
import type { CSSProperties } from "react"
import type { RouteVideo } from "@/lib/content"
import { containerFragment } from "@/lib/fragments/container"
import type { textSectionFragment } from "@/lib/fragments/text-section"
import type { adventCountdownFragment } from "@/lib/fragments/advent-countdown"
import type { easterDatesFragment } from "@/lib/fragments/easter-dates"
import type { mediaCollectionFragment } from "@/lib/fragments/media-collection"
import type { ctaSectionFragment } from "@/lib/fragments/cta-section"
import type { videoSectionFragment } from "@/lib/fragments/video-section"
import type { relatedQuestionsFragment } from "@/lib/fragments/related-questions"
import { Text } from "./Text"
import { AdventCountdown } from "./AdventCountdown"
import { BibleQuotesCarousel } from "./BibleQuotesCarousel"
import { EasterDates } from "./EasterDates"
import { MediaCollection } from "./MediaCollection"
import { CTASection } from "./CTASection"
import { Video } from "./Video"
import { RelatedQuestions } from "./RelatedQuestions"

import type { bibleQuotesCarouselFragment } from "@/lib/fragments/bible-quotes-carousel"

export { containerFragment }

type ContainerProps = {
  data: FragmentOf<typeof containerFragment>
  routeVideo?: RouteVideo | null
  languageSlug?: string | null
}

type ContainerData = FragmentOf<typeof containerFragment>
type Slot = NonNullable<NonNullable<ContainerData["slots"]>[number]>
type SlotContentItem = NonNullable<NonNullable<Slot["content"]>[number]>
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
  languageSlug,
}: {
  item: SlotContentItem
  routeVideo?: RouteVideo | null
  languageSlug?: string | null
}) {
  if (!item || item.__typename === "Error") return null
  // Cast to broader string so the admin typename cases below (which
  // are not in the Strapi-derived discriminated union) type-check.
  switch (item.__typename as string) {
    case "ComponentSectionsText":
      return (
        <Text
          data={item as unknown as FragmentOf<typeof textSectionFragment>}
        />
      )
    case "ComponentSectionsAdventCountdown":
      return (
        <AdventCountdown
          data={item as unknown as FragmentOf<typeof adventCountdownFragment>}
        />
      )
    case "ComponentSectionsEasterDates":
      return (
        <EasterDates
          data={item as unknown as FragmentOf<typeof easterDatesFragment>}
        />
      )
    case "ComponentSectionsMediaCollection":
      return (
        <MediaCollection
          data={item as unknown as FragmentOf<typeof mediaCollectionFragment>}
          routeVideo={routeVideo}
          languageSlug={languageSlug}
        />
      )
    case "ComponentSectionsCta":
      return (
        <CTASection
          data={item as unknown as FragmentOf<typeof ctaSectionFragment>}
        />
      )
    case "ComponentSectionsVideo":
      return (
        <Video
          data={item as unknown as FragmentOf<typeof videoSectionFragment>}
          routeVideo={routeVideo}
        />
      )
    case "ComponentSectionsRelatedQuestions":
      return (
        <RelatedQuestions
          data={item as unknown as FragmentOf<typeof relatedQuestionsFragment>}
          routeVideo={routeVideo}
        />
      )
    // Admin GraphQL typenames inlined directly (rather than bouncing
    // through `renderAdminBlock` in `./index`) to avoid an import cycle —
    // `index.tsx` already imports `Container.tsx`, so the reverse import
    // resolves undefined at module load.
    case "TextBlock":
      return (
        <Text
          data={item as unknown as FragmentOf<typeof textSectionFragment>}
        />
      )
    case "EasterDatesBlock":
      return (
        <EasterDates
          data={item as unknown as FragmentOf<typeof easterDatesFragment>}
        />
      )
    case "AdventCountdownBlock":
      return (
        <AdventCountdown
          data={item as unknown as FragmentOf<typeof adventCountdownFragment>}
        />
      )
    case "MediaCollectionBlock":
      return (
        <MediaCollection
          data={item as unknown as FragmentOf<typeof mediaCollectionFragment>}
          routeVideo={routeVideo}
          languageSlug={languageSlug}
        />
      )
    case "CtaBlock":
      return (
        <CTASection
          data={item as unknown as FragmentOf<typeof ctaSectionFragment>}
        />
      )
    case "VideoBlock":
      return (
        <Video
          data={item as unknown as FragmentOf<typeof videoSectionFragment>}
          routeVideo={routeVideo}
        />
      )
    case "RelatedQuestionsBlock":
      return (
        <RelatedQuestions
          data={item as unknown as FragmentOf<typeof relatedQuestionsFragment>}
          routeVideo={routeVideo}
        />
      )
    case "BibleQuotesCarouselBlock":
      return (
        <BibleQuotesCarousel
          data={
            item as unknown as FragmentOf<typeof bibleQuotesCarouselFragment>
          }
        />
      )
    default:
      return null
  }
}

/**
 * Group admin's flat `content[]` by `ContainerSlotBlock` markers.
 * Items appearing AFTER a slot marker (until the next marker) belong
 * to that slot. Items before the first marker are silently dropped —
 * admin's editor always emits a leading slot marker per the Zod
 * domain schema, and a stray leading orphan is malformed data.
 */
function groupAdminContentBySlot(
  content: readonly (Record<string, unknown> | null)[],
): { gridSpan: number; spans: unknown; items: Record<string, unknown>[] }[] {
  const groups: ReturnType<typeof groupAdminContentBySlot> = []
  let current: (typeof groups)[number] | null = null
  let droppedOrphans = 0
  for (const item of content) {
    if (!item) continue
    const typename = (item as { __typename?: string | null }).__typename
    const t = (item as { t?: string }).t
    if (typename === "ContainerSlotBlock" || t === "containerSlot") {
      const gridSpan = clampSpan((item as { gridSpan?: unknown }).gridSpan)
      current = {
        gridSpan,
        spans: (item as { spans?: unknown }).spans,
        items: [],
      }
      groups.push(current)
      continue
    }
    if (current) {
      current.items.push(item)
    } else {
      droppedOrphans += 1
    }
  }
  if (droppedOrphans > 0 && process.env.NODE_ENV === "development") {
    console.warn(
      `[Container] groupAdminContentBySlot dropped ${droppedOrphans} item(s) appearing before the first ContainerSlotBlock marker — admin content[] should start with a slot marker. The Zod schema does not enforce this; check admin's transform.`,
    )
  }
  return groups
}

type SlotGroup = {
  gridSpan: number
  spans: unknown
  items: unknown[]
}

export function Container({ data, routeVideo, languageSlug }: ContainerProps) {
  const id = (data as { id?: string | null }).id
  const legacySlots = (data as { slots?: readonly unknown[] | null }).slots
  const adminContent = (data as { content?: readonly unknown[] | null }).content

  // Strapi-era data has `slots[].content[]`; admin's flat shape is
  // `content[]` with `ContainerSlotBlock` markers. Normalize both into a
  // common `SlotGroup[]` so the rendering path is single.
  let groups: SlotGroup[]
  if (legacySlots && legacySlots.length > 0) {
    groups = legacySlots
      .filter((s): s is NonNullable<typeof s> => s != null)
      .map((s) => {
        const slot = s as {
          gridSpan?: unknown
          spans?: unknown
          content?: readonly unknown[]
          id?: string
        }
        return {
          gridSpan: clampSpan(slot.gridSpan),
          spans: slot.spans,
          items: (slot.content ?? []).filter(Boolean) as unknown[],
        }
      })
  } else if (adminContent) {
    groups = groupAdminContentBySlot(
      adminContent as readonly (Record<string, unknown> | null)[],
    )
  } else {
    groups = []
  }
  // Skip slot groups that have no items — two adjacent ContainerSlotBlock
  // markers in admin's content[] would otherwise render an empty grid cell
  // with `aspect-ratio` styling and confuse the layout.
  groups = groups.filter((g) => g.items.length > 0)
  if (!groups.length) return null

  return (
    <section
      id={id ?? undefined}
      className="grid w-full grid-cols-12 gap-x-0 gap-y-10 py-8 text-stone-100 md:gap-6"
      data-testid="Container"
    >
      {groups.map((group, idx) => (
        <div
          key={`slot-${idx}`}
          className="min-w-0 space-y-10 [grid-column:span_var(--slot-xs)_/_span_var(--slot-xs)] sm:[grid-column:span_var(--slot-sm)_/_span_var(--slot-sm)] md:space-y-6 md:[grid-column:span_var(--slot-md)_/_span_var(--slot-md)] lg:[grid-column:span_var(--slot-lg)_/_span_var(--slot-lg)] xl:[grid-column:span_var(--slot-xl)_/_span_var(--slot-xl)]"
          style={slotSpanStyle({
            gridSpan: group.gridSpan,
            spans: group.spans,
          } as unknown as Slot)}
        >
          {group.items.map((item, index) => {
            if (
              !item ||
              (item as { __typename?: string }).__typename === "Error"
            ) {
              return null
            }
            return (
              <SlotContentRenderer
                key={`slot-${idx}-${index}`}
                item={item as SlotContentItem}
                routeVideo={routeVideo}
                languageSlug={languageSlug}
              />
            )
          })}
        </div>
      ))}
    </section>
  )
}
