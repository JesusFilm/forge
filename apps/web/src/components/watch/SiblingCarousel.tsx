"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Play } from "lucide-react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel"
import { cn } from "@/lib/utils"
import type { WatchSiblingCarouselBlock } from "@/lib/content"
import { tryAsContentSlug, tryAsLocaleSlug, watchVideoPath } from "@/lib/routes"
import { resolvePosterUrl } from "@/lib/url"

export function SiblingCarousel({
  block,
  languageSlug,
}: {
  block: WatchSiblingCarouselBlock
  languageSlug: string
}) {
  const t = useTranslations("SiblingCarousel")
  const videoLabels = useTranslations("VideoLabels")
  const { canonicalParent, currentVideoDocumentId } = block

  // Drop nulls AND items missing a slug — without a slug we can't build a
  // routable href, and rendering an unclickable card is worse than
  // omitting it entirely. Content-slug and public language-slug validity are
  // re-checked per child via the route builders below (a malformed slug still
  // renders, just not as a <Link>).
  const children = (canonicalParent.children ?? []).filter(
    (child): child is NonNullable<typeof child> & { slug: string } =>
      child != null && typeof child.slug === "string" && child.slug.length > 0,
  )

  const activeIndex = children.findIndex(
    (child) => child.documentId === currentVideoDocumentId,
  )
  const isParentMode = activeIndex < 0
  const clipIndex = activeIndex >= 0 ? activeIndex + 1 : 1
  const clipTotal = children.length
  const parentTitle = canonicalParent.title ?? videoLabels("collection")

  // All carousel thumbnails ship with `loading="lazy"`. Native browser
  // lazy-loading still fetches above-fold images immediately — it only
  // defers fetches for images far below the viewport. Cards peeking
  // through the 300 px gap under the sticky hero load on the same paint
  // cycle. We don't emit `<link rel="preload">` in head (next/image emits
  // those for both `priority` and `loading="eager"`) because they
  // compete with the LCP poster fetch on the critical chain.

  const [api, setApi] = useState<CarouselApi | null>(null)
  const initialCarouselIndex = activeIndex >= 0 ? activeIndex : 0

  // Snap to the active item whenever it changes (or when `api` first
  // becomes available). Re-keying on `activeIndex` covers variant-switch
  // scenarios where the same SiblingCarousel instance now has a new
  // active child — without this, the carousel would stay scrolled to the
  // previous chapter. The early-return guard handles parent-page mode
  // (activeIndex === -1, no card to snap to).
  useEffect(() => {
    if (!api) return
    if (activeIndex < 0) return
    api.scrollTo(activeIndex, true)
  }, [api, activeIndex])

  if (children.length < 2) return null

  // Parent-page mode (current video IS the parent / collection): suppress
  // the "Clip N of M" position counter. There's no active position to
  // count from, and rendering "Clip 1 of N" would be misleading. Show a
  // simple "{N} chapters" total instead, mirroring the change in
  // aria-label below.
  const ariaLabel = isParentMode
    ? t("chaptersAriaLabel", { title: parentTitle, count: clipTotal })
    : t("clipAriaLabel", {
        title: parentTitle,
        current: clipIndex,
        total: clipTotal,
      })

  return (
    <section
      data-block-type="SiblingCarousel"
      data-mode={isParentMode ? "parent" : "chapter"}
      className="relative -mx-10 w-[calc(100%+5rem)] pt-2 pb-2 md:mx-0 md:w-full"
      aria-label={ariaLabel}
    >
      <header className="mb-4 px-10 md:px-0">
        <p className="text-sm font-medium text-stone-300">
          <span className="text-stone-100">{parentTitle}</span>
          <span className="px-2 text-stone-500">·</span>
          <span data-testid="sibling-carousel-label">
            {isParentMode ? (
              t("chapterCount", { count: clipTotal })
            ) : (
              <>
                <span className="md:hidden">
                  {t("position", { current: clipIndex, total: clipTotal })}
                </span>
                <span className="hidden md:inline">
                  {t("clipPosition", {
                    current: clipIndex,
                    total: clipTotal,
                  })}
                </span>
              </>
            )}
          </span>
        </p>
      </header>

      <Carousel
        opts={{
          align: "start",
          containScroll: "trimSnaps",
          startIndex: initialCarouselIndex,
        }}
        setApi={setApi}
        className="w-full"
      >
        <CarouselContent className="pl-10 md:pl-0">
          {children.map((child, index) => {
            const isActive = index === activeIndex
            // `resolvePosterUrl` codifies the editorial-cinematic priority
            // chain shared with WatchPageClient. The raw `images[].url`
            // value is excluded from that chain entirely: it's a misshaped
            // Cloudflare Images URL (missing the variant path segment)
            // that returns 400, so a "last resort" fallback to it only
            // ever produces broken images.
            const thumb = resolvePosterUrl(child.images?.[0])
            // The builder emits the canonical 2-segment `.html` shape
            // (`/{slug}.html/{languageSlug}.html`).
            const slug = tryAsContentSlug(child.slug)
            const lang = tryAsLocaleSlug(languageSlug)
            const href = slug && lang ? watchVideoPath(slug, lang) : undefined
            const thumbnailAlt = child.title
              ? `${child.title} thumbnail`
              : "Related video thumbnail"

            const cardClassName = cn(
              "group relative block aspect-video cursor-pointer overflow-hidden rounded-lg bg-stone-900 transition shadow-[0_2px_6px_rgba(0,0,0,0.35),0_14px_32px_-12px_rgba(0,0,0,0.6)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80",
              isActive
                ? "border-4 border-white"
                : "opacity-70 hover:outline-4 hover:outline-offset-[-4px] hover:outline-brand-red hover:opacity-100 hover:shadow-[0_4px_10px_rgba(0,0,0,0.4),0_22px_44px_-14px_rgba(0,0,0,0.7)]",
            )

            // Card contents are identical whether the card is a routable
            // <Link> or (for a rare malformed slug) a non-clickable <div>.
            const cardInner = (
              <>
                {thumb ? (
                  <Image
                    src={thumb}
                    alt={thumbnailAlt}
                    fill
                    sizes="(max-width: 640px) 48vw, (max-width: 768px) 36vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, (max-width: 1536px) 20vw, 16vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    // Native lazy-loading. Browser still fetches
                    // above-fold cards immediately (lazy only defers
                    // far-from-viewport). Avoids the head-preload
                    // entries next/image emits for `priority` /
                    // `loading="eager"` that compete with the LCP
                    // poster fetch.
                    loading="lazy"
                  />
                ) : (
                  <div
                    data-testid="sibling-carousel-thumb-placeholder"
                    className="flex h-full w-full items-center justify-center bg-stone-900 text-xs text-stone-600"
                  >
                    {t("noImage")}
                  </div>
                )}

                {/* Soften the image into the lower caption zone. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-full bg-black/35 backdrop-blur-[14px] [mask-image:linear-gradient(to_top,black_0%,rgba(0,0,0,0.9)_35%,rgba(0,0,0,0.35)_62%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_top,black_0%,rgba(0,0,0,0.9)_35%,rgba(0,0,0,0.35)_62%,transparent_100%)]"
                />

                {/* Hover-only play overlay on inactive cards. The active
                    card already signals "this is what's playing" via the
                    red border, so we don't double-mark it with a button. */}
                {!isActive ? (
                  <div
                    aria-hidden="true"
                    data-testid="sibling-carousel-play-overlay"
                    className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-red text-white shadow-lg ring-1 ring-black/20">
                      <Play size={20} fill="currentColor" stroke="none" />
                    </span>
                  </div>
                ) : null}

                {/* Caption block — a lower frosted panel like the modern
                    episode rails, keeping text readable inside the
                    landscape tile. */}
                <div
                  data-testid="sibling-carousel-caption"
                  className="absolute inset-x-0 bottom-0 z-20 flex h-full flex-col justify-end gap-1.5 bg-gradient-to-t from-black/68 via-black/35 to-transparent p-3 sm:p-4"
                >
                  <span className="text-[10px] font-semibold tracking-[0.18em] text-stone-200/90 uppercase drop-shadow-md sm:text-xs">
                    {t("chapter")}
                  </span>
                  {/* Card title rendered as <span>, not <h3>: the cards are
                      sibling-navigation Link items and don't anchor their
                      own section. Emitting an <h3> with no parent <h2>
                      skipped the heading order (WCAG 1.3.1) and would
                      require an artificial sr-only section header. The
                      Link's accessible name covers the card's title. */}
                  <span className="line-clamp-2 text-sm leading-tight font-bold text-white drop-shadow-md sm:text-base">
                    {child.title ?? ""}
                  </span>
                </div>

                <div
                  aria-hidden="true"
                  data-testid="sibling-carousel-bevel"
                  className="pointer-events-none absolute inset-0 z-40 rounded-lg border border-white opacity-40 mix-blend-soft-light"
                />

                {/* Visually-hidden active marker — preserves the existing
                    `sibling-carousel-playing-now` testid and gives screen
                    readers a labeled "Playing now" affordance even though
                    the visual cue is a border, not a pill. */}
                {isActive ? (
                  <span
                    data-testid="sibling-carousel-playing-now"
                    className="sr-only"
                  >
                    {t("playingNow")}
                  </span>
                ) : null}
              </>
            )

            return (
              <CarouselItem
                key={child.documentId}
                className="basis-[48%] sm:basis-[36%] md:basis-1/3 lg:basis-1/4 xl:basis-1/5 2xl:basis-1/6"
                aria-current={isActive ? "true" : undefined}
              >
                {/* Active cards use a real inside border. Inactive cards keep
                    no transparent border; the bevel is drawn by a content
                    overlay so it stays visible around the whole picture. A
                    malformed slug (no routable href) renders a non-clickable
                    <div> with identical markup minus the href/data-href. */}
                {href ? (
                  <Link
                    href={href}
                    data-testid="sibling-carousel-item"
                    data-active={isActive ? "true" : "false"}
                    data-href={href}
                    className={cardClassName}
                  >
                    {cardInner}
                  </Link>
                ) : (
                  <div
                    data-testid="sibling-carousel-item"
                    data-active={isActive ? "true" : "false"}
                    className={cardClassName}
                  >
                    {cardInner}
                  </div>
                )}
              </CarouselItem>
            )
          })}
          <div
            aria-hidden="true"
            data-testid="sibling-carousel-end-spacer"
            className="min-w-0 shrink-0 grow-0 basis-[52%] sm:basis-[64%] md:basis-[66.666%] lg:basis-[75%] xl:basis-[80%] 2xl:basis-[83.333%]"
          />
        </CarouselContent>

        {/* The shared `outline` Button variant only sets text color on
            hover (via `hover:text-foreground`); against this dark-themed
            page the chevrons inherit white from the parent until hover.
            Force the chevrons to a near-black at all times so the arrow
            stays legible against the light circular background. */}
        <CarouselPrevious
          className="hidden text-stone-900 hover:text-stone-900 md:inline-flex"
          label={t("previousChapter")}
        />
        <CarouselNext
          className="hidden text-stone-900 hover:text-stone-900 md:inline-flex"
          label={t("nextChapter")}
        />
      </Carousel>
    </section>
  )
}
