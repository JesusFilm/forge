"use client"

import Image from "next/image"
import { useRef, useCallback, type ReactNode, type MouseEvent } from "react"
import type { FragmentOf } from "@forge/graphql"
import { BookOpen, Share2 } from "lucide-react"
import { bibleQuotesCarouselFragment } from "@/lib/fragments/bible-quotes-carousel"
import { Button } from "@/components/ui/button"

export { bibleQuotesCarouselFragment }

type BibleQuotesCarouselProps = {
  data: FragmentOf<typeof bibleQuotesCarouselFragment>
}

type QuoteItem = NonNullable<
  NonNullable<FragmentOf<typeof bibleQuotesCarouselFragment>["quotes"]>[number]
>

export function BibleQuotesCarousel({ data }: BibleQuotesCarouselProps) {
  const { heading, quotes } = data
  const validQuotes =
    quotes?.filter((q): q is NonNullable<typeof q> => q != null) ?? []

  if (validQuotes.length === 0) return null

  return (
    <div data-testid="bible-quotes-carousel" className="pt-14 pb-6">
      <BibleQuotesHeader heading={heading} />
      <ScrollableTrack>
        {validQuotes.map((quote, index) => (
          <div
            key={quote.id}
            className={`shrink-0 snap-start pl-4 sm:pl-6 xl:pl-8 ${index === validQuotes.length - 1 ? "pr-4 sm:pr-6 xl:pr-8" : ""}`}
            style={{ width: "min(400px, 85vw)" }}
          >
            {quote.ctaLabel ? (
              <FreeResourceCard quote={quote} />
            ) : (
              <QuoteCard quote={quote} />
            )}
          </div>
        ))}
      </ScrollableTrack>
    </div>
  )
}

function ScrollableTrack({ children }: { children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const startX = useRef(0)
  const scrollLeft = useRef(0)

  const onMouseDown = useCallback((e: MouseEvent) => {
    const el = trackRef.current
    if (!el) return
    dragging.current = true
    startX.current = e.pageX - el.offsetLeft
    scrollLeft.current = el.scrollLeft
    el.style.cursor = "grabbing"
    el.style.userSelect = "none"
  }, [])

  const onMouseUp = useCallback(() => {
    dragging.current = false
    const el = trackRef.current
    if (el) {
      el.style.cursor = "grab"
      el.style.userSelect = ""
    }
  }, [])

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return
    e.preventDefault()
    const el = trackRef.current
    if (!el) return
    const x = e.pageX - el.offsetLeft
    el.scrollLeft = scrollLeft.current - (x - startX.current)
  }, [])

  return (
    <div
      ref={trackRef}
      className="flex cursor-grab snap-x snap-proximity gap-0 overflow-x-auto scroll-smooth pb-4 active:cursor-grabbing"
      style={{ scrollbarWidth: "none" }}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onMouseMove={onMouseMove}
    >
      {children}
    </div>
  )
}

function BibleQuotesHeader({ heading }: { heading: string | null }) {
  return (
    <div className="mb-6 flex items-center justify-between px-4 sm:px-6 xl:pl-8">
      {heading && (
        <h4 className="text-xs font-semibold tracking-wider text-stone-400 uppercase">
          {heading}
        </h4>
      )}
      <Button
        variant="outline"
        size="sm"
        className="ml-auto gap-2 rounded-full border-stone-700 bg-transparent text-xs tracking-wider text-stone-300 uppercase hover:border-stone-500 hover:bg-transparent hover:text-stone-100"
      >
        <Share2 size={14} />
        Share
      </Button>
    </div>
  )
}

function BibleQuoteCard({
  imageUrl,
  bgColor = "#1A1815",
  children,
}: {
  imageUrl?: string | null
  bgColor?: string | null
  children: ReactNode
}) {
  return (
    <div
      className="relative flex h-[400px] w-full flex-col justify-end overflow-hidden rounded-lg shadow-2xl shadow-stone-950/70"
      style={{ backgroundColor: bgColor ?? "#1A1815" }}
    >
      {imageUrl && (
        <Image
          height={400}
          width={400}
          src={imageUrl}
          alt=""
          className="absolute top-0 h-[260px] w-full object-cover mask-[linear-gradient(to_bottom,rgba(0,0,0,1)_50%,transparent_100%)]"
          draggable={false}
        />
      )}
      <div className="z-1 p-6 pt-0">{children}</div>
    </div>
  )
}

function QuoteCard({ quote }: { quote: QuoteItem }) {
  return (
    <BibleQuoteCard imageUrl={quote.imageUrl} bgColor={quote.backgroundColor}>
      <span className="mb-1 block text-[10px] font-semibold tracking-[0.15em] text-amber-200/60 uppercase">
        {quote.reference}
      </span>
      <p className="text-base leading-relaxed text-balance text-white/90">
        {quote.text}
      </p>
    </BibleQuoteCard>
  )
}

function FreeResourceCard({ quote }: { quote: QuoteItem }) {
  return (
    <BibleQuoteCard imageUrl={quote.imageUrl} bgColor={quote.backgroundColor}>
      <span className="mb-1 block text-xs font-semibold tracking-[0.15em] text-white/70 uppercase">
        {quote.reference}
      </span>
      <h3 className="mt-1 mb-4 text-xl font-bold leading-snug text-balance text-white/90">
        {quote.text}
      </h3>
      <Button
        variant="secondary"
        size="lg"
        className="rounded-full bg-white text-sm font-bold tracking-wider text-black uppercase hover:bg-white/80"
        render={
          quote.ctaLink ? (
            <a href={quote.ctaLink} target="_blank" rel="noopener noreferrer" />
          ) : undefined
        }
      >
        <BookOpen size={16} />
        {quote.ctaLabel}
      </Button>
    </BibleQuoteCard>
  )
}
