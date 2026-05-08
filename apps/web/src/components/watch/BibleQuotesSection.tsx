"use client"

// Image-less cards: the bibleCitations projection carries reference fields
// only (no imageUrl / quote text). The Experience-page BibleQuotesCarousel
// has richer authored content; this surface mirrors its visual vocabulary
// without forcing the existing component to consume a degraded shape.

import { ExternalLink } from "lucide-react"

import type { WatchBibleQuotesBlock } from "@/lib/content"
import { formatCitation } from "@/lib/citation-format"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import {
  CAROUSEL_BLEED_CLASSES,
  CAROUSEL_CONTENT_PADDING,
  CAROUSEL_END_SPACER,
} from "@/lib/content-width"

type BibleQuotesSectionProps = {
  bibleCitations: WatchBibleQuotesBlock["bibleCitations"]
  onShareClick: () => void
}

const JOIN_BIBLE_STUDY_URL =
  "https://join.bsfinternational.org/?utm_source=jesusfilm-watch"

// Disable click-and-drag when the carousel has at most one snap point —
// dragging a single visible card is a no-op gesture that visibly tugs and
// snaps back. Exported for direct unit-testing because jsdom collapses
// layout to zero, making `scrollSnapList()` always return [] in component
// tests.
export function shouldEnableDrag(api: {
  scrollSnapList: () => unknown[]
}): boolean {
  return api.scrollSnapList().length > 1
}

// Stable opts reference. embla-carousel-reactive-utils compares opts via
// areOptionsEqual, which serializes function values with .toString(). A
// module-level constant guarantees a stable identity across renders so a
// future captured prop in watchDrag can't silently trigger reInit
// mid-scroll, briefly tearing down event listeners.
const CAROUSEL_OPTS = {
  align: "start",
  dragFree: true,
  containScroll: "trimSnaps",
  watchDrag: shouldEnableDrag,
} as const

export function BibleQuotesSection({
  bibleCitations,
  onShareClick,
}: BibleQuotesSectionProps) {
  // The carousel always renders, even when the video has no Bible citations —
  // the trailing "Join Our Bible Study" promo card is the always-on CTA, and
  // every video page should surface it.
  return (
    <section
      data-block-type="BibleQuotes"
      data-testid="watch-bible-quotes"
      className="pt-4 pb-6"
    >
      <div
        data-testid="watch-bible-quotes-header"
        className="mb-6 flex flex-wrap items-center justify-between gap-3 pb-2"
      >
        <h3 className="text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base 2xl:text-lg">
          Bible Quotes
        </h3>
        <Button
          variant="pill"
          onClick={onShareClick}
          aria-label="Share"
          data-testid="watch-share-button"
        >
          <ExternalLink size={16} />
          <span>Share</span>
        </Button>
      </div>

      <div className={CAROUSEL_BLEED_CLASSES}>
        <Carousel
          aria-label="Bible Quotes"
          opts={CAROUSEL_OPTS}
          className="w-full"
        >
          <CarouselContent
            data-testid="watch-bible-quotes-list"
            className={`-ml-4 ${CAROUSEL_CONTENT_PADDING}`}
          >
            {bibleCitations.map((citation) => (
              <CarouselItem
                key={citation.documentId}
                data-testid="watch-bible-quotes-item"
                className="basis-[85vw] pl-4 sm:basis-[50%] lg:basis-1/4"
              >
                <BibleQuoteCard>
                  <span
                    data-testid="watch-bible-quotes-reference"
                    className="block text-[10px] font-semibold tracking-[0.15em] text-amber-200/60 uppercase"
                  >
                    {formatCitation(citation)}
                  </span>
                </BibleQuoteCard>
              </CarouselItem>
            ))}
            <CarouselItem
              data-testid="watch-bible-quotes-promo"
              className="basis-[85vw] pl-4 sm:basis-[50%] lg:basis-1/4"
            >
              <BibleQuoteCard bgColor="#3a2510">
                <span className="mb-1 block text-xs font-semibold tracking-[0.15em] text-white/70 uppercase">
                  Free Resources
                </span>
                <h3 className="mt-1 mb-4 text-xl font-bold leading-snug text-balance text-white/90">
                  Join Our Bible Study
                </h3>
                <a
                  href={JOIN_BIBLE_STUDY_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  data-testid="watch-bible-quotes-promo-cta"
                  className={`${buttonVariants({ variant: "pill" })} self-start`}
                >
                  Join our Bible study
                </a>
              </BibleQuoteCard>
            </CarouselItem>
            <CarouselItem
              className="basis-auto pl-0"
              aria-hidden="true"
              tabIndex={-1}
              data-testid="watch-bible-quotes-end-spacer"
            >
              <div className={CAROUSEL_END_SPACER} />
            </CarouselItem>
          </CarouselContent>
          {/* Keyboard / assistive-tech / headless-agent step controls. The
              design surface is drag-and-scroll, so these are visually
              hidden but reachable by Tab + Enter. */}
          <CarouselPrevious
            className="sr-only"
            data-testid="watch-bible-quotes-prev"
          />
          <CarouselNext
            className="sr-only"
            data-testid="watch-bible-quotes-next"
          />
        </Carousel>
      </div>
    </section>
  )
}

function BibleQuoteCard({
  bgColor = "#1A1815",
  children,
}: {
  bgColor?: string | null
  children: React.ReactNode
}) {
  return (
    <div
      className="relative flex aspect-square w-full flex-col justify-end overflow-hidden rounded-lg shadow-2xl shadow-stone-950/70"
      style={{ backgroundColor: bgColor ?? "#1A1815" }}
    >
      <div className="z-1 p-6 pt-0">{children}</div>
    </div>
  )
}
