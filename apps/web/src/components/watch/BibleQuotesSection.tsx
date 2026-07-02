"use client"

// Bible quote cards render only Admin-resolved passage text. Web should not
// fetch Bible text from public fallback APIs; Admin owns provider access,
// caching, and version selection.

import Image from "next/image"
import { ExternalLink } from "lucide-react"
import { useTranslations } from "next-intl"
import { useCallback, useMemo, type MouseEvent } from "react"

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
import { CAROUSEL_END_SPACER } from "@/lib/content-width"
import {
  WATCH_PILL_BUTTON_CLASS,
  WATCH_SECTION_EYEBROW_CLASS,
} from "@/components/watch/watch-section-styles"
import { cn } from "@/lib/utils"

type WatchBibleCitation = WatchBibleQuotesBlock["bibleCitations"][number]
type WatchBiblePassage = NonNullable<WatchBibleQuotesBlock["passages"]>[number]

type BibleQuotesSectionProps = {
  bibleCitations: WatchBibleQuotesBlock["bibleCitations"]
  href?: string
  onShareClick: () => void
  /**
   * Admin-resolved passage payloads keyed by citation documentId.
   */
  passages?: WatchBibleQuotesBlock["passages"]
}

const JOIN_BIBLE_STUDY_URL =
  "https://join.bsfinternational.org/?utm_source=jesusfilm-watch"

// Promo-card hero image. Same fixed Unsplash photo used by
// `FreeResourceCard` in core/apps/watch — the final slide is intentionally
// constant, not cycled like the citation cards.
const PROMO_IMAGE_URL =
  "https://images.unsplash.com/photo-1650658720644-e1588bd66de3?w=900&auto=format&fit=crop&q=60"

// Unsplash URLs ported verbatim from core/apps/watch BibleCitations.tsx —
// these are decorative wallpapers cycled by index, not curated per verse.
const BIBLE_IMAGES = [
  "https://images.unsplash.com/photo-1480869799327-03916a613b29?q=80&w=1632&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  "https://images.unsplash.com/16/unsplash_526360a842e20_1.JPG?q=80&w=1887&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  "https://images.unsplash.com/photo-1497333558196-daaff02b56d0?q=80&w=1738&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  "https://images.unsplash.com/photo-1555892727-55b51e5fceae?q=80&w=1674&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  "https://images.unsplash.com/photo-1631125915973-e0d155a14e4e?q=80&w=1887&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  "https://images.unsplash.com/photo-1659260145900-1ac1afc45dcf?q=80&w=1887&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  "https://images.unsplash.com/photo-1535979863199-3c77338429a0?q=80&w=1660&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
] as const

const BIBLE_QUOTE_SLIDE_CLASSES =
  "basis-[76vw] pl-4 sm:basis-[64vw] md:basis-[48vw] lg:basis-[36rem] xl:basis-[38rem]"

const BIBLE_QUOTE_IMAGE_SIZES =
  "(max-width: 640px) 76vw, (max-width: 768px) 64vw, (max-width: 1024px) 48vw, 38rem"

// Stable opts reference. embla-carousel-reactive-utils compares opts via
// areOptionsEqual. A module-level constant avoids reInit churn mid-scroll,
// which is especially visible now that these cards are large and draggable.
const CAROUSEL_OPTS = {
  align: "start",
  dragFree: true,
  containScroll: "trimSnaps",
} as const

export function BibleQuotesSection({
  bibleCitations,
  href,
  onShareClick,
  passages = [],
}: BibleQuotesSectionProps) {
  const t = useTranslations("BibleQuotes")
  const passagesByCitationId = useMemo(
    () =>
      new Map(passages.map((passage) => [passage.citationDocumentId, passage])),
    [passages],
  )

  const handleShareLinkClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault()
      onShareClick()
    },
    [onShareClick],
  )

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
        <h2 className={WATCH_SECTION_EYEBROW_CLASS}>{t("title")}</h2>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-slot="button"
            className={cn(
              buttonVariants({
                variant: "pill",
                className: WATCH_PILL_BUTTON_CLASS,
              }),
            )}
            onClick={handleShareLinkClick}
            aria-label={t("share")}
            data-testid="watch-share-button"
            style={{ cursor: "pointer" }}
          >
            <ExternalLink size={16} />
            <span>{t("share")}</span>
          </a>
        ) : (
          <Button
            variant="pill"
            className={WATCH_PILL_BUTTON_CLASS}
            onClick={onShareClick}
            aria-label={t("share")}
            data-testid="watch-share-button"
            style={{ cursor: "pointer" }}
          >
            <ExternalLink size={16} />
            <span>{t("share")}</span>
          </Button>
        )}
      </div>

      <div
        data-testid="watch-bible-quotes-carousel-bleed"
        className="-mx-5 w-[calc(100%+2.5rem)] md:mx-0 md:w-full"
      >
        <Carousel
          aria-label={t("title")}
          opts={CAROUSEL_OPTS}
          className="w-full"
        >
          <CarouselContent
            data-testid="watch-bible-quotes-list"
            className="-ml-4 pl-5 md:pl-0"
          >
            {bibleCitations.map((citation, i) => (
              <CarouselItem
                key={citation.documentId}
                data-testid="watch-bible-quotes-item"
                className={BIBLE_QUOTE_SLIDE_CLASSES}
              >
                <BibleCitationCard
                  citation={citation}
                  imageUrl={BIBLE_IMAGES[i % BIBLE_IMAGES.length]!}
                  passage={
                    passagesByCitationId.get(citation.documentId) ?? null
                  }
                />
                {/*
                  Previously passed `isLcpCandidate={i === 0}` to mark the
                  first card priority because Next.js's LCP heuristic flagged
                  it. Removed: the section sits below a sticky 100svh hero,
                  so on every typical viewport the BibleQuotes card is
                  off-screen at initial paint and cannot be the true LCP
                  element. Forcing fetchPriority=high here diverts budget
                  from whatever IS the LCP (likely the Mux poster). Re-add
                  the hint only after a Chrome LCP trace confirms a
                  specific card is the candidate.
                */}
              </CarouselItem>
            ))}
            <CarouselItem
              data-testid="watch-bible-quotes-promo"
              className={BIBLE_QUOTE_SLIDE_CLASSES}
            >
              <div
                className="relative flex aspect-[1.08/1] min-h-[21rem] w-full flex-col justify-end overflow-hidden rounded-xl border border-white/10 shadow-2xl shadow-stone-950/70 sm:min-h-[24rem] md:min-h-[28rem]"
                style={{ backgroundColor: "rgba(0, 0, 0, 0.1)" }}
              >
                <Image
                  fill
                  src={PROMO_IMAGE_URL}
                  alt=""
                  aria-hidden="true"
                  // When there are no editorial citations the promo card is
                  // the section's only content and would otherwise lazy-load
                  // into view with a visible pop-in. Mark it eager only on
                  // that path so the typical N-citations case stays lazy.
                  priority={bibleCitations.length === 0}
                  className="absolute top-0 overflow-hidden rounded-xl object-cover"
                  sizes={BIBLE_QUOTE_IMAGE_SIZES}
                />
                <div className="z-1 p-8 pt-0 md:p-10 md:pt-0">
                  <span
                    data-testid="watch-bible-quotes-promo-eyebrow"
                    className="mb-3 block text-sm font-medium tracking-[0.18em] text-white/80 uppercase"
                  >
                    {t("freeResources")}
                  </span>
                  <h3
                    data-testid="watch-bible-quotes-promo-heading"
                    className="mb-6 max-w-[19ch] text-2xl leading-tight font-semibold text-balance text-white md:text-3xl"
                  >
                    {t("promoHeading")}
                  </h3>
                  <Button
                    variant="pill"
                    nativeButton={false}
                    data-testid="watch-bible-quotes-promo-cta"
                    className={`${WATCH_PILL_BUTTON_CLASS} max-w-full self-start whitespace-normal text-center leading-tight break-words`}
                    render={
                      <a
                        href={JOIN_BIBLE_STUDY_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                      />
                    }
                  >
                    {t("joinBibleStudy")}
                  </Button>
                </div>
              </div>
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
          {/* Match the watch chapter carousel's visible circular step
              controls so large quote cards are browsable without dragging. */}
          <CarouselPrevious
            className="hidden text-stone-900 hover:text-stone-900 md:inline-flex"
            label={t("previousQuote")}
            data-testid="watch-bible-quotes-prev"
          />
          <CarouselNext
            className="hidden text-stone-900 hover:text-stone-900 md:inline-flex"
            label={t("nextQuote")}
            data-testid="watch-bible-quotes-next"
          />
        </Carousel>
      </div>
    </section>
  )
}

function BibleCitationCard({
  citation,
  imageUrl,
  passage,
  eager = false,
}: {
  citation: WatchBibleCitation
  imageUrl: string
  passage: WatchBiblePassage | null
  // Whether to load the card image eagerly with high fetch priority. Off
  // by default — the section sits below the fold on the watch page, so
  // marking a card priority diverts budget without helping LCP. Callers
  // may opt in after measuring the actual LCP element.
  eager?: boolean
}) {
  const referenceLabel = passage?.humanReference ?? formatCitation(citation)
  const versionLabel = [passage?.versionAbbreviation, passage?.versionTitle]
    .filter(Boolean)
    .join(" · ")
  const bibleComUrl = getBibleComUrl(passage)

  return (
    <div
      className="relative flex aspect-[1.08/1] min-h-[21rem] w-full flex-col justify-end overflow-hidden rounded-xl border border-white/10 shadow-2xl shadow-stone-950/70 sm:min-h-[24rem] md:min-h-[28rem]"
      style={{ backgroundColor: "#1A1815" }}
    >
      <Image
        fill
        src={imageUrl}
        alt=""
        aria-hidden="true"
        priority={eager}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        className="absolute top-0 overflow-hidden rounded-xl object-cover [mask-image:linear-gradient(to_bottom,rgba(0,0,0,1)_24%,transparent_100%)] [mask-size:cover]"
        sizes={BIBLE_QUOTE_IMAGE_SIZES}
      />
      <div className="z-1 p-8 pt-0 md:p-10 md:pt-0">
        <span
          data-testid="watch-bible-quotes-reference"
          className="relative mb-5 block text-sm leading-none font-black tracking-normal text-amber-200/75 uppercase md:text-base"
        >
          {bibleComUrl ? (
            <a
              href={bibleComUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-amber-200/35 underline-offset-4 transition-colors hover:text-amber-100 hover:decoration-amber-100/70"
            >
              {referenceLabel}
            </a>
          ) : (
            referenceLabel
          )}
        </span>
        {passage?.content && (
          <p
            data-testid="watch-bible-quotes-verse"
            className="relative max-w-[20ch] text-xl leading-[1.22] font-semibold text-balance text-white/95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)] md:text-2xl"
          >
            {passage.content}
          </p>
        )}
        {versionLabel && (
          <p
            data-testid="watch-bible-quotes-version"
            className="relative mt-4 text-xs font-semibold text-white/65"
          >
            {versionLabel}
          </p>
        )}
        {passage?.copyright && (
          <p
            data-testid="watch-bible-quotes-copyright"
            className="relative mt-3 max-w-[36ch] text-xs leading-relaxed text-white/55"
          >
            {passage.copyright}
          </p>
        )}
      </div>
    </div>
  )
}

function getBibleComUrl(passage: WatchBiblePassage | null) {
  if (
    passage == null ||
    passage.reference.trim() === "" ||
    passage.versionAbbreviation == null ||
    passage.versionAbbreviation.trim() === ""
  ) {
    return null
  }

  return `https://www.bible.com/bible/${passage.versionId}/${encodeURIComponent(
    passage.reference,
  )}.${encodeURIComponent(passage.versionAbbreviation.trim())}`
}
