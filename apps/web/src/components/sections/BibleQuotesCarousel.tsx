"use client"

import Image from "next/image"
import type { ReactNode } from "react"
import type { FragmentOf } from "@forge/graphql"
import { BookOpen, Share2 } from "lucide-react"
import { bibleQuotesCarouselFragment } from "@/lib/fragments/bible-quotes-carousel"
import { Button } from "@/components/ui/button"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"

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
      <Carousel
        opts={{
          align: "start",
          dragFree: true,
          containScroll: "trimSnaps",
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-4 pl-2 sm:pl-4 xl:pl-6">
          {validQuotes.map((quote) => (
            <CarouselItem
              key={quote.id}
              className="basis-[85vw] pl-4 sm:basis-[360px] lg:basis-[400px]"
            >
              {quote.ctaLabel ? (
                <FreeResourceCard quote={quote} />
              ) : (
                <QuoteCard quote={quote} />
              )}
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  )
}

function BibleQuotesHeader({ heading }: { heading: string | null }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between px-4 sm:px-6 xl:px-8">
      {heading && (
        <h4 className="flex shrink-0 items-center gap-4 py-4 text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base 2xl:text-lg">
          {heading}
        </h4>
      )}
      <Button variant="pill">
        <Share2 size={14} />
        <span>Share</span>
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
        variant="pill"
        render={
          quote.ctaLink ? (
            <a href={quote.ctaLink} target="_blank" rel="noopener noreferrer" />
          ) : undefined
        }
      >
        <BookOpen size={16} />
        <span>{quote.ctaLabel}</span>
      </Button>
    </BibleQuoteCard>
  )
}
