import type { FragmentOf } from "@forge/graphql"
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
import { EasterDates } from "./EasterDates"
import { MediaCollection } from "./MediaCollection"
import { CTASection } from "./CTASection"
import { Video } from "./Video"
import { RelatedQuestions } from "./RelatedQuestions"
import { ADMIN_BLOCK_TYPENAMES, renderAdminBlock } from "./index"

type AnyBlock = {
  readonly __typename?: string | null
} & Record<string, unknown>

export { containerFragment }

type ContainerProps = {
  data: FragmentOf<typeof containerFragment>
  routeVideo?: RouteVideo | null
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
}: {
  item: SlotContentItem
  routeVideo?: RouteVideo | null
}) {
  if (!item || item.__typename === "Error") return null
  switch (item.__typename) {
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
        />
      )
    default: {
      // Admin typenames (TextBlock, EasterDatesBlock, VideoBlock, etc.)
      // arrive here when a ContainerSlot composes admin-shape blocks.
      // Strapi-era cases above only know `ComponentSections*` typenames;
      // fall back to the top-level admin dispatch so nested admin blocks
      // render correctly inside container slots.
      const typename = (item as { __typename?: string | null }).__typename
      if (typename != null && ADMIN_BLOCK_TYPENAMES.has(typename)) {
        return renderAdminBlock(item as unknown as AnyBlock, routeVideo)
      }
      return null
    }
  }
}

export function Container({ data, routeVideo }: ContainerProps) {
  const { id, slots } = data
  const validSlots =
    slots?.filter((s): s is NonNullable<typeof s> => s != null) ?? []
  if (!validSlots.length) return null

  return (
    <section
      id={id ?? undefined}
      className="grid w-full grid-cols-12 gap-10 py-8 text-stone-100 md:gap-6"
      data-testid="Container"
    >
      {validSlots.map((slot) => (
        <div
          key={slot.id}
          className="min-w-0 space-y-10 [grid-column:span_var(--slot-xs)_/_span_var(--slot-xs)] sm:[grid-column:span_var(--slot-sm)_/_span_var(--slot-sm)] md:space-y-6 md:[grid-column:span_var(--slot-md)_/_span_var(--slot-md)] lg:[grid-column:span_var(--slot-lg)_/_span_var(--slot-lg)] xl:[grid-column:span_var(--slot-xl)_/_span_var(--slot-xl)]"
          style={slotSpanStyle(slot)}
        >
          {slot.content?.map((item, index) => {
            if (
              !item ||
              (item as { __typename?: string }).__typename === "Error"
            ) {
              return null
            }
            return (
              <SlotContentRenderer
                key={`${slot.id}-${index}`}
                item={item as SlotContentItem}
                routeVideo={routeVideo}
              />
            )
          })}
        </div>
      ))}
    </section>
  )
}
