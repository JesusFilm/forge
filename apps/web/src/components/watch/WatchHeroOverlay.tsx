import type { CSSProperties, ReactNode } from "react"

import { WATCH_PAGE_LEFT_RAIL_CLASSES } from "@/lib/content-width"
import { cn } from "@/lib/utils"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"

/**
 * The copy block a Watch hero lays over its video: eyebrow, title, an actions
 * row, and an optional metadata row.
 *
 * Shared so the watch page's hero and the home intro cannot drift apart — they
 * are the same surface at the same size, and every difference between them so
 * far has been an accident rather than a decision. What varies legitimately is
 * passed in: the watch page's title is the page `h1` while the home intro's is
 * a `p` under a screen-reader `h1`, and the actions differ (a button driving
 * the player on this page, a link to it on the home page).
 */

/** Pill geometry for both hero actions. Callers add the colour treatment. */
export const WATCH_HERO_ACTION_CLASS =
  "inline-flex cursor-pointer items-center gap-3 rounded-full px-5 py-2.5 text-base font-medium shadow-lg transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/90 focus-visible:ring-2 focus-visible:ring-brand-red/70 md:py-3 md:text-lg compact-landscape:min-h-11 compact-landscape:py-2 compact-landscape:text-base"

export const WATCH_HERO_PRIMARY_ACTION_CLASS = `${WATCH_HERO_ACTION_CLASS} bg-brand-red text-white hover:bg-brand-red`

export const WATCH_HERO_SECONDARY_ACTION_CLASS = `${WATCH_HERO_ACTION_CLASS} border border-transparent bg-transparent text-white hover:border-white/50 hover:bg-white/12`

export const WATCH_HERO_TITLE_CLASS =
  "max-w-[calc(100vw-5rem)] text-2xl leading-[1.08] font-bold text-balance break-words text-white drop-shadow-lg sm:text-4xl md:max-w-[18ch] md:text-6xl xl:max-w-[20ch] xl:text-7xl compact-landscape:max-w-[min(56vw,30rem)] compact-landscape:text-2xl"

/** The copy stack itself. Each surface positions it with `className`. */
const WATCH_HERO_OVERLAY_STACK_CLASS =
  "flex flex-col items-start gap-3 compact-landscape:gap-1"

/** Where the watch page hangs the stack: bottom-left of the hero. */
export const WATCH_HERO_OVERLAY_CLASS = `absolute right-6 bottom-0 ${WATCH_PAGE_LEFT_RAIL_CLASSES} pb-12 md:right-auto compact-landscape:relative compact-landscape:inset-x-auto compact-landscape:bottom-auto compact-landscape:w-full compact-landscape:pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]`

export type WatchHeroOverlaySlot = {
  className?: string
  style?: CSSProperties
}

export type WatchHeroOverlayProps = {
  /** Eyebrow above the title. Omitted when the surface has no label. */
  label?: ReactNode
  title?: ReactNode
  /** `h1` on the watch page; `p` where a heading would duplicate one. */
  titleAs?: "h1" | "h2" | "p"
  /** Primary action first, then any secondary ones. */
  actions?: ReactNode
  /** Duration / quality / language tags. */
  metadata?: ReactNode
  className?: string
  /** The carousel's outgoing copy is inert while it animates away. */
  ariaHidden?: boolean
  testId?: string
  titleTestId?: string
  labelTestId?: string
  /** Per-slot hooks for the home intro's staggered enter/exit animation. */
  labelSlot?: WatchHeroOverlaySlot
  titleSlot?: WatchHeroOverlaySlot
  actionsSlot?: WatchHeroOverlaySlot
}

export function WatchHeroOverlay({
  actions,
  actionsSlot,
  ariaHidden,
  className,
  label,
  labelSlot,
  labelTestId,
  metadata,
  testId,
  title,
  titleAs = "h1",
  titleSlot,
  titleTestId,
}: WatchHeroOverlayProps) {
  const TitleTag = titleAs

  return (
    <div
      aria-hidden={ariaHidden}
      data-testid={testId}
      className={cn(WATCH_HERO_OVERLAY_STACK_CLASS, className)}
    >
      {label ? (
        <span
          data-testid={labelTestId}
          className={cn(WATCH_SECTION_EYEBROW_CLASS, labelSlot?.className)}
          style={labelSlot?.style}
        >
          {label}
        </span>
      ) : null}
      {title ? (
        <TitleTag
          data-testid={titleTestId}
          className={cn(WATCH_HERO_TITLE_CLASS, titleSlot?.className)}
          style={titleSlot?.style}
        >
          {title}
        </TitleTag>
      ) : null}
      <div className="flex flex-col items-start gap-3 compact-landscape:gap-1">
        {actions ? (
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-5 gap-y-3 compact-landscape:gap-x-3 compact-landscape:gap-y-1",
              actionsSlot?.className,
            )}
            style={actionsSlot?.style}
          >
            {actions}
          </div>
        ) : null}
        {metadata}
      </div>
    </div>
  )
}
