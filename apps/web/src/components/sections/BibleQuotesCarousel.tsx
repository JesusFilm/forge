"use client"

import Image from "next/image"
import type { ReactNode } from "react"
import type {
  FragmentOf,
  LegacyFragmentValue,
} from "@/lib/legacy-fragment-types"
import { BookOpen, ExternalLink } from "lucide-react"
import { useTranslations } from "next-intl"
import { bibleQuotesCarouselFragment } from "@/lib/fragments/bible-quotes-carousel"
import { Button } from "@/components/ui/button"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import {
  CAROUSEL_BLEED_CLASSES,
  CAROUSEL_CONTENT_PADDING,
  CAROUSEL_END_SPACER,
} from "@/lib/content-width"

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
    quotes?.filter(
      (q: LegacyFragmentValue): q is NonNullable<typeof q> => q != null,
    ) ?? []

  if (validQuotes.length === 0) return null

  return (
    <div data-testid="bible-quotes-carousel" className="pt-14 pb-6">
      <BibleQuotesHeader heading={heading} />
      <div className={CAROUSEL_BLEED_CLASSES}>
        <Carousel
          opts={{
            align: "start",
            dragFree: true,
            containScroll: "trimSnaps",
            watchDrag: (api) => api.scrollSnapList().length > 1,
          }}
          className="w-full"
        >
          <CarouselContent className={`-ml-4 ${CAROUSEL_CONTENT_PADDING}`}>
            {validQuotes.map((quote: QuoteItem) => (
              <CarouselItem
                key={quote.id}
                className="basis-[85vw] pl-4 sm:basis-[50%] lg:basis-1/4"
              >
                {quote.ctaLabel ? (
                  <FreeResourceCard quote={quote} />
                ) : (
                  <QuoteCard quote={quote} />
                )}
              </CarouselItem>
            ))}
            <CarouselItem
              className="basis-auto pl-0"
              aria-hidden="true"
              tabIndex={-1}
            >
              <div className={CAROUSEL_END_SPACER} />
            </CarouselItem>
          </CarouselContent>
        </Carousel>
      </div>
    </div>
  )
}

function BibleQuotesHeader({ heading }: { heading: string | null }) {
  const t = useTranslations("BibleQuotes")

  async function handleShare() {
    const shareUrl = new URL(window.location.href)
    shareUrl.searchParams.set("utm_source", "share")

    const shareData = {
      url: shareUrl.toString(),
      title: heading ?? "",
      text: "",
    }

    try {
      if (navigator.share) {
        await navigator.share(shareData)
      } else {
        await navigator.clipboard.writeText(shareUrl.toString())
      }
    } catch {
      // User cancelled share dialog or clipboard access denied
    }
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between pb-2">
      {heading && (
        <h3 className="text-sm font-semibold tracking-eyebrow text-red-100/70 uppercase xl:text-base 2xl:text-lg">
          {heading}
        </h3>
      )}
      <Button variant="pill" onClick={handleShare} aria-label={t("share")}>
        <ExternalLink size={16} />
        <span>{t("share")}</span>
      </Button>
    </div>
  )
}

function BibleQuoteCard({
  imageUrl,
  bgColor = "#1A1815",
  altText = "",
  children,
}: {
  imageUrl?: string | null
  bgColor?: string | null
  altText?: string
  children: ReactNode
}) {
  return (
    <div
      className="relative flex aspect-square w-full flex-col justify-end overflow-hidden rounded-lg shadow-2xl shadow-stone-950/70"
      style={{ backgroundColor: bgColor ?? "#1A1815" }}
    >
      {imageUrl && (
        <Image
          height={400}
          width={400}
          src={imageUrl}
          alt={altText}
          className="absolute top-0 h-[65%] w-full object-cover mask-[linear-gradient(to_bottom,rgba(0,0,0,1)_50%,transparent_100%)]"
        />
      )}
      <div className="z-1 p-6 pt-0">{children}</div>
    </div>
  )
}

function QuoteCard({ quote }: { quote: QuoteItem }) {
  const t = useTranslations("BibleQuotes")
  // Reference-first scripture (video-anchored generation) stores only the
  // reference; verse text is resolved at render in a follow-up. Until then,
  // render the reference prominently with a "read it" hint instead of a blank.
  const hasText = typeof quote.text === "string" && quote.text.trim().length > 0
  return (
    <BibleQuoteCard
      imageUrl={quote.imageUrl}
      bgColor={quote.backgroundColor}
      altText={quote.reference}
    >
      <span
        className={`mb-1 block font-semibold tracking-[0.15em] text-amber-200/60 uppercase ${
          hasText ? "text-[10px]" : "text-sm"
        }`}
      >
        {quote.reference}
      </span>
      {hasText ? (
        <p className="text-base leading-relaxed text-balance text-white/90">
          {quote.text}
        </p>
      ) : (
        <p className="text-sm leading-relaxed text-balance text-white/70">
          {t("readPassage")}
        </p>
      )}
    </BibleQuoteCard>
  )
}

function FreeResourceCard({ quote }: { quote: QuoteItem }) {
  return (
    <BibleQuoteCard
      imageUrl={quote.imageUrl}
      bgColor={quote.backgroundColor}
      altText={quote.reference}
    >
      <span className="mb-1 block text-xs font-semibold tracking-[0.15em] text-white/70 uppercase">
        {quote.reference}
      </span>
      <h3 className="mt-1 mb-4 text-xl font-bold leading-snug text-balance text-white/90">
        {quote.text}
      </h3>
      <Button
        variant="pill"
        nativeButton={false}
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
