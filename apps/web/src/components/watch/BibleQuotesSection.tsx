"use client"

// Visual + verse rendering parity with the legacy `core/apps/watch`
// BibleCitationCard:
//   - hard-coded Unsplash photo cycled by index as the card background
//   - locale-aware verse text fetched client-side from the wldeh/bible-api
//     mirror on jsdelivr (single-verse JSON, keyed by verseStart)
//   - "Read more..." link to BibleGateway, shown when verseEnd is present
//
// The bibleCitations projection still only carries reference fields, so
// verse text is fetched per card on mount rather than received from Strapi.

import Image from "next/image"
import { ExternalLink } from "lucide-react"
import { useEffect, useState } from "react"

import type { WatchBibleQuotesBlock } from "@/lib/content"
import { formatCitation } from "@/lib/citation-format"
import { Button } from "@/components/ui/button"
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

type WatchBibleCitation = WatchBibleQuotesBlock["bibleCitations"][number]

type BibleQuotesSectionProps = {
  bibleCitations: WatchBibleQuotesBlock["bibleCitations"]
  onShareClick: () => void
  /**
   * BCP-47-ish locale used to pick the Bible translation for the inline
   * verse fetch. Defaults to English. The renderer does not currently
   * thread locale here; pass it through when wired.
   */
  locale?: string
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

// Locale → translation pair, mirroring core/apps/watch's
// LOCALE_TO_BIBLE_VERSION_MAP. `bibleApi` is the wldeh/bible-api directory
// (single-verse JSON), `bibleGateway` is the URL `?version=` for the
// "Read more..." link.
type BibleVersion = { bibleApi: string; bibleGateway: string }

// WEBBE chosen over en-web because it renders the divine name as
// "the LORD" (NIV/ESV convention) rather than "Yahweh". BSB was the
// closer NIV/ESV match but wldeh/bible-api bakes BSB translator
// footnotes inline into verse text. BibleGateway has no WEBBE version
// code, so Read-more falls back to ?version=WEB (same underlying text).
const DEFAULT_BIBLE_VERSION = {
  bibleApi: "en-webbe",
  bibleGateway: "WEB",
} as const satisfies BibleVersion

const LOCALE_TO_BIBLE_VERSION_MAP = {
  en: DEFAULT_BIBLE_VERSION,
  es: { bibleApi: "es-rvr1960", bibleGateway: "NVI" },
  fr: { bibleApi: "fr-s21", bibleGateway: "BDS" },
  id: { bibleApi: "id-tlab", bibleGateway: "TB" },
  ja: { bibleApi: "ja-jc", bibleGateway: "SHINK2017" },
  ko: { bibleApi: "ko-askv", bibleGateway: "NKRV" },
  ru: { bibleApi: "ru-synod", bibleGateway: "SYNOD" },
  th: { bibleApi: "th-tkjv", bibleGateway: "TNCV" },
  tr: { bibleApi: "tr-tcl02", bibleGateway: "TC-2009" },
  zh: { bibleApi: "zh-cunp-s", bibleGateway: "CUVMPT" },
  "zh-Hans-CN": { bibleApi: "zh-cn-cmn-s-cuv", bibleGateway: "CUVS" },
} as const satisfies Record<string, BibleVersion>

function getBibleVersionForLocale(locale: string): BibleVersion {
  return (
    (LOCALE_TO_BIBLE_VERSION_MAP as Record<string, BibleVersion>)[locale] ??
    DEFAULT_BIBLE_VERSION
  )
}

// Strip wldeh/bible-api's inline footnotes (";N:N…" and ",N:N…") and
// collapse line breaks. Port of formatScripture from core/apps/watch.
function formatScripture(verse: string): string {
  return verse
    .replace(/;\d[\s\S]*/, "")
    .replace(/,\d:\d[\s\S]*/, "")
    .replace(/\n/g, " ")
    .trim()
}

// Sanitize CMS-supplied book name into a jsdelivr-API-safe path segment.
// `bookName.toLowerCase()` alone preserves whitespace ("1 Corinthians" →
// "1 corinthians"), which the URL-encoder converts to "1%20corinthians" —
// a path the wldeh/bible-api repo does not contain (returns 403). Strip
// whitespace, validate against an allowlist, and reject anything that
// could escape the intended path (`..`, query separators, etc.).
const BIBLE_BOOK_SLUG_PATTERN = /^[a-z0-9-]+$/

function bookSlugForApi(rawBookName: string): string | null {
  const slug = rawBookName.toLowerCase().replace(/\s+/g, "")
  return BIBLE_BOOK_SLUG_PATTERN.test(slug) ? slug : null
}

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
  locale = "en",
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
        <h2 className="text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base 2xl:text-lg">
          Bible Quotes
        </h2>
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
            {bibleCitations.map((citation, i) => (
              <CarouselItem
                key={citation.documentId}
                data-testid="watch-bible-quotes-item"
                className="basis-[85vw] pl-4 sm:basis-[50%] lg:basis-1/4"
              >
                <BibleCitationCard
                  citation={citation}
                  imageUrl={BIBLE_IMAGES[i % BIBLE_IMAGES.length]!}
                  locale={locale}
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
              className="basis-[85vw] pl-4 sm:basis-[50%] lg:basis-1/4"
            >
              <div
                className="relative flex aspect-square w-full flex-col justify-end overflow-hidden rounded-lg border border-white/10 shadow-2xl shadow-stone-950/70"
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
                  className="absolute top-0 overflow-hidden rounded-lg object-cover"
                  sizes="(max-width: 640px) 85vw, (max-width: 1024px) 50vw, 25vw"
                />
                <div className="z-1 p-6 pt-0">
                  <span className="mb-1 block text-xs font-semibold tracking-[0.15em] text-white/80 uppercase">
                    Free Resources
                  </span>
                  <h3 className="mt-1 mb-4 text-xl font-bold leading-snug text-balance text-white">
                    Want to grow deep in your understanding of the Bible?
                  </h3>
                  <Button
                    variant="pill"
                    nativeButton={false}
                    data-testid="watch-bible-quotes-promo-cta"
                    className="self-start"
                    render={
                      <a
                        href={JOIN_BIBLE_STUDY_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                      />
                    }
                  >
                    Join our Bible study
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
          {/* Keyboard / assistive-tech / headless-agent step controls. The
              design surface is drag-and-scroll, so these are visually
              hidden but reachable by Tab + Enter. */}
          <CarouselPrevious
            className="sr-only"
            label="Previous Bible quote"
            data-testid="watch-bible-quotes-prev"
          />
          <CarouselNext
            className="sr-only"
            label="Next Bible quote"
            data-testid="watch-bible-quotes-next"
          />
        </Carousel>
      </div>
    </section>
  )
}

// Wall-clock budget for a single jsdelivr verse fetch. Bounds the request
// independently of `AbortController` (which only fires on unmount), so a
// hanging CDN connection cannot hold a per-origin slot indefinitely.
const VERSE_FETCH_TIMEOUT_MS = 8000

// jsdelivr returns `{ verse: string, text: string }` for valid verses and a
// 403 (NOT 200 with empty body) for missing ones. The historical "200 with
// empty body" guard remains as a belt-and-braces backstop in case a future
// translation drops content into a partial shape.
function isFetchedScripture(value: unknown): value is { text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof (value as { text: unknown }).text === "string" &&
    (value as { text: string }).text.length > 0
  )
}

function BibleCitationCard({
  citation,
  imageUrl,
  locale,
  eager = false,
}: {
  citation: WatchBibleCitation
  imageUrl: string
  locale: string
  // Whether to load the card image eagerly with high fetch priority. Off
  // by default — the section sits below the fold on the watch page, so
  // marking a card priority diverts budget without helping LCP. Callers
  // may opt in after measuring the actual LCP element.
  eager?: boolean
}) {
  const [scripture, setScripture] = useState<{ text: string } | null>(null)
  // Destructured to primitive strings so the effect's dependency list
  // captures stable values, not the per-render object identity returned by
  // `getBibleVersionForLocale`.
  const { bibleApi, bibleGateway } = getBibleVersionForLocale(locale)
  const bookSlug =
    citation.bibleBook?.name != null
      ? bookSlugForApi(citation.bibleBook.name)
      : null

  // Chapter-only citations (editor left verseStart blank to point at a whole
  // chapter, e.g. "Genesis 3") still get a verse preview — we fetch verse 1
  // as the body text and surface "Read more..." so the user can read the
  // rest of the chapter on BibleGateway. For verse-bearing citations the
  // CMS-supplied verseStart is used directly.
  const isChapterOnly = citation.verseStart == null
  const fetchVerse = citation.verseStart ?? 1

  // Reset scripture when the fetch key (book+chapter+verse+translation)
  // changes — locale switch, variant switch, or citation reshape. Done in
  // render via React's "adjusting state in render" pattern instead of a
  // useEffect so the stale verse text never paints alongside the new
  // citation reference for even one frame.
  //
  // Use the raw `verseStart` (or a "chapter-only" sentinel) in the key so
  // a transition between an explicit `verseStart: 1` citation and a
  // chapter-only one resets the scripture state — both fetch the same
  // URL but the Read-more affordance differs, and a stale scripture
  // pointer would skip the intended reset.
  const fetchKey = `${bibleApi}|${bookSlug ?? ""}|${citation.chapterStart ?? ""}|${citation.verseStart ?? "chapter-only"}`
  const [prevFetchKey, setPrevFetchKey] = useState(fetchKey)
  if (prevFetchKey !== fetchKey) {
    setPrevFetchKey(fetchKey)
    setScripture(null)
  }

  useEffect(() => {
    if (bookSlug == null || citation.chapterStart == null) {
      // Missing required field(s) — no fetch possible. Initial state is
      // already null, so nothing to set.
      return
    }
    const controller = new AbortController()
    // Wall-clock timeout via setTimeout + controller.abort rather than
    // AbortSignal.any — the latter trips on jsdom/undici realm checks in
    // vitest tests. Single AbortController serves both the unmount
    // cleanup and the timeout deadline.
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, VERSE_FETCH_TIMEOUT_MS)
    // Closure flag — `AbortController` cancels the in-flight network leg
    // but not an awaited `res.json()` body parse. Without this guard, a
    // body that finishes parsing after the component unmounts (or after
    // the deps change) would write stale state via the trailing
    // `setScripture` call.
    let cancelled = false
    void (async () => {
      try {
        const url = `https://cdn.jsdelivr.net/gh/wldeh/bible-api/bibles/${bibleApi}/books/${bookSlug}/chapters/${citation.chapterStart}/verses/${fetchVerse}.json`
        const res = await fetch(url, {
          signal: controller.signal,
          cache: "force-cache",
        })
        if (cancelled || !res.ok) return
        const data: unknown = await res.json()
        if (cancelled) return
        if (isFetchedScripture(data)) {
          setScripture({ text: data.text })
        }
      } catch (error) {
        // Distinguish intentional aborts (unmount / locale change / timeout)
        // from real failures. AbortError lands here but does NOT mean the
        // verse is unavailable — suppressing the null-write avoids the
        // flicker where the previous verse disappears before the new one
        // arrives. Other errors (network, JSON parse) are logged so CDN
        // problems are visible in devtools rather than silently degrading.
        if (cancelled) return
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }
        console.error(
          "[BibleCitationCard] verse fetch failed",
          {
            url: `${bibleApi}/${bookSlug}/${citation.chapterStart}:${fetchVerse}`,
          },
          error,
        )
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timeoutId)
    }
  }, [bibleApi, bookSlug, citation.chapterStart, fetchVerse])

  const referenceLabel = formatCitation(citation)
  const bibleGatewayUrl = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(referenceLabel)}&version=${bibleGateway}`
  // "Read more..." appears whenever the card only previews a slice of the
  // cited range: a verse range (verseEnd set) shows only verse 1 of N, and
  // a chapter-only citation shows only verse 1 of the whole chapter.
  const showReadMore = citation.verseEnd != null || isChapterOnly

  return (
    <div
      className="relative flex aspect-square w-full flex-col justify-end overflow-hidden rounded-lg border border-white/10 shadow-2xl shadow-stone-950/70"
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
        className="absolute top-0 overflow-hidden rounded-lg object-cover [mask-image:linear-gradient(to_bottom,rgba(0,0,0,1)_20%,transparent_100%)] [mask-size:cover]"
        sizes="(max-width: 640px) 85vw, (max-width: 1024px) 50vw, 25vw"
      />
      <div className="z-1 p-6 pt-0">
        <span
          data-testid="watch-bible-quotes-reference"
          className="relative block text-[10px] font-semibold tracking-[0.15em] text-amber-200/60 uppercase"
        >
          {referenceLabel}
        </span>
        {scripture != null && (
          <p
            data-testid="watch-bible-quotes-verse"
            className="relative mt-3 text-sm text-white/90"
          >
            {formatScripture(scripture.text)}
          </p>
        )}
        {showReadMore && (
          <a
            href={bibleGatewayUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="watch-bible-quotes-read-more"
            className="relative mt-3 block text-sm text-white/80 underline transition-colors duration-200 hover:text-white"
          >
            Read more...
          </a>
        )}
      </div>
    </div>
  )
}
