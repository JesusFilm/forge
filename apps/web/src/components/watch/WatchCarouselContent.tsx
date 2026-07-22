import type { ComponentProps } from "react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import {
  WATCH_CAROUSEL_INVENTORY_ALIGN,
  WATCH_CAROUSEL_INVENTORY_CONTENT_PADDING,
  WATCH_CAROUSEL_INVENTORY_END_SPACER,
  WATCH_CAROUSEL_RAIL_ALIGN,
  WATCH_CAROUSEL_RAIL_CONTENT_PADDING,
  WATCH_CAROUSEL_RAIL_END_SPACER,
  WATCH_CAROUSEL_RAIL_VIEWPORT_CLASSES,
} from "@/lib/content-width"
import { cn } from "@/lib/utils"

type WatchCarouselLayout = "rail" | "inventory"

type WatchCarouselProps = Omit<ComponentProps<typeof Carousel>, "opts"> & {
  layout?: WatchCarouselLayout
  opts?: ComponentProps<typeof Carousel>["opts"]
}

type WatchCarouselContentProps = Omit<
  ComponentProps<typeof CarouselContent>,
  "viewportClassName"
> & {
  layout?: WatchCarouselLayout
  endSpacer?: boolean
  endSpacerTestId?: string
}

const LAYOUT_CLASSES: Record<
  WatchCarouselLayout,
  {
    align: (viewSize: number) => number
    viewport?: string
    track: string
    endSpacer: string
  }
> = {
  rail: {
    align: WATCH_CAROUSEL_RAIL_ALIGN,
    viewport: WATCH_CAROUSEL_RAIL_VIEWPORT_CLASSES,
    track: WATCH_CAROUSEL_RAIL_CONTENT_PADDING,
    endSpacer: WATCH_CAROUSEL_RAIL_END_SPACER,
  },
  inventory: {
    align: WATCH_CAROUSEL_INVENTORY_ALIGN,
    track: WATCH_CAROUSEL_INVENTORY_CONTENT_PADDING,
    endSpacer: WATCH_CAROUSEL_INVENTORY_END_SPACER,
  },
}

/** Keeps every Embla snap on the same Watch content rail, including loops. */
export function WatchCarousel({
  layout = "rail",
  opts,
  ...props
}: WatchCarouselProps) {
  return (
    <Carousel
      {...props}
      opts={{ ...opts, align: LAYOUT_CLASSES[layout].align }}
    />
  )
}

/**
 * Shared public-Watch composition for an Embla content viewport.
 *
 * The generic carousel continues to own overflow containment and interaction;
 * this layer owns Watch frame geometry and a real terminal spacer for Embla's
 * trimSnaps behavior.
 */
export function WatchCarouselContent({
  layout = "rail",
  endSpacer = true,
  endSpacerTestId,
  className,
  children,
  ...props
}: WatchCarouselContentProps) {
  const layoutClasses = LAYOUT_CLASSES[layout]

  return (
    <CarouselContent
      {...props}
      viewportClassName={layoutClasses.viewport}
      className={cn(layoutClasses.track, className)}
    >
      {children}
      {endSpacer ? (
        <CarouselItem
          className={cn("basis-auto pl-0", layoutClasses.endSpacer)}
          aria-hidden="true"
          tabIndex={-1}
          data-testid={endSpacerTestId}
        />
      ) : null}
    </CarouselContent>
  )
}
