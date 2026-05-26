"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { useParams } from "next/navigation"
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
import { resolvePosterUrl } from "@/lib/url"

export function SiblingCarousel({
  block,
}: {
  block: WatchSiblingCarouselBlock
}) {
  const { canonicalParent, currentVideoDocumentId } = block

  const params = useParams<{ locale?: string }>()
  const currentLocale = params?.locale ?? ""

  // Drop nulls AND items missing a slug — without a slug we can't build a
  // routable href, and rendering an unclickable card is worse than
  // omitting it entirely. Same for currentLocale: it's URL-encoded for
  // safety in case Next ever surfaces a non-encoded locale segment.
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

  // Eager-load the small window of cards around the active item (or the
  // first two in parent-mode). Hard-coded `index < 5` always targeted DOM
  // order, which wrongly eagered indices 0-4 whenever activeIndex >= 5 —
  // the api.scrollTo() snap below moves the visible cards INTO view, but
  // the eager hint fires before snap so we'd burn high-priority slots on
  // off-screen thumbnails.
  const eagerIndices = new Set<number>(
    isParentMode
      ? [0, 1]
      : [activeIndex - 1, activeIndex, activeIndex + 1, activeIndex + 2].filter(
          (i) => i >= 0 && i < children.length,
        ),
  )

  const [api, setApi] = useState<CarouselApi | null>(null)

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
    ? `${canonicalParent.title ?? "Collection"} · ${clipTotal} chapters`
    : `${canonicalParent.title ?? "Collection"} · Clip ${clipIndex} of ${clipTotal}`

  return (
    <section
      data-block-type="SiblingCarousel"
      data-mode={isParentMode ? "parent" : "chapter"}
      className="relative -mx-10 w-[calc(100%+5rem)] pt-2 pb-2 md:mx-0 md:w-full"
      aria-label={ariaLabel}
    >
      <header className="mb-4 px-10 md:px-0">
        <p className="text-sm font-medium text-stone-300">
          <span className="text-stone-100">
            {canonicalParent.title ?? "Collection"}
          </span>
          <span className="px-2 text-stone-500">·</span>
          <span data-testid="sibling-carousel-label">
            {isParentMode ? (
              `${clipTotal} chapters`
            ) : (
              <>
                <span className="md:hidden">{`${clipIndex} of ${clipTotal}`}</span>
                <span className="hidden md:inline">{`Clip ${clipIndex} of ${clipTotal}`}</span>
              </>
            )}
          </span>
        </p>
      </header>

      <Carousel
        opts={{ align: "start", containScroll: "trimSnaps" }}
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
            // 2-segment watch route: `/{slug}/{locale}`. The earlier
            // 3-segment shape (`/{parent}/{child}/{locale}`) 404s because
            // the route was migrated to a flat `[slug]/[locale]` structure.
            // Both segments are URL-encoded defensively — slugs are
            // editor-controlled (so far always URL-safe), but encoding
            // costs nothing and protects against a future Strapi slug
            // policy change. `currentLocale` is encoded for the same
            // reason.
            const href =
              `/${encodeURIComponent(child.slug)}/${encodeURIComponent(currentLocale)}` as Route

            return (
              <CarouselItem
                key={child.documentId}
                className="basis-[48%] sm:basis-[36%] md:basis-1/3 lg:basis-1/4 xl:basis-1/5 2xl:basis-1/6"
                aria-current={isActive ? "true" : undefined}
              >
                <Link
                  href={href}
                  data-testid="sibling-carousel-item"
                  data-active={isActive ? "true" : "false"}
                  data-href={href}
                  // The border is drawn inside the element (not as a ring,
                  // which extends outside the box and gets clipped by
                  // CarouselContent's `overflow-hidden` viewport at the
                  // top/bottom edges). Inactive cards have no border so
                  // the body-zone's frosted-glass backdrop doesn't read
                  // as a faint grey halo through a transparent border.
                  // The 4 px difference in image content area between
                  // active/inactive is imperceptible because the outer
                  // card geometry (carousel slot) stays the same.
                  className={cn(
                    "group relative block aspect-square cursor-pointer overflow-hidden rounded-lg bg-stone-900 transition after:pointer-events-none after:absolute after:inset-0 after:z-40 after:rounded-[calc(theme(borderRadius.lg)-4px)] after:border-4 after:border-transparent after:shadow-[inset_0_1px_0_rgba(255,255,255,0.32),inset_0_-1px_0_rgba(0,0,0,0.32),inset_0_0_0_1px_rgba(255,255,255,0.12)]",
                    isActive
                      ? "border-4 border-white"
                      : "border-4 border-transparent opacity-70 hover:border-brand-red hover:opacity-100",
                  )}
                >
                  {thumb ? (
                    <Image
                      src={thumb}
                      alt={child.title ?? ""}
                      fill
                      sizes="(max-width: 640px) 48vw, (max-width: 768px) 36vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, (max-width: 1536px) 20vw, 16vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                      // Eager-load the cards inside `eagerIndices` (the
                      // small window around activeIndex). `priority` alone
                      // wasn't surfacing as `loading="eager"` /
                      // `fetchpriority="high"` in the DOM under Next 16 +
                      // fill + sizes, so spell all three out.
                      priority={eagerIndices.has(index)}
                      loading={eagerIndices.has(index) ? "eager" : "lazy"}
                      fetchPriority={eagerIndices.has(index) ? "high" : "auto"}
                    />
                  ) : (
                    <div
                      data-testid="sibling-carousel-thumb-placeholder"
                      className="flex h-full w-full items-center justify-center bg-stone-900 text-xs text-stone-600"
                    >
                      No image
                    </div>
                  )}

                  {/* Soften the image into the lower caption zone. */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[52%] bg-black/35 backdrop-blur-[14px] [mask-image:linear-gradient(to_top,black_0%,rgba(0,0,0,0.9)_45%,rgba(0,0,0,0.35)_78%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_top,black_0%,rgba(0,0,0,0.9)_45%,rgba(0,0,0,0.35)_78%,transparent_100%)]"
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
                      episode rails, leaving the sharp artwork to the top
                      ~60% of the square tile. */}
                  <div
                    data-testid="sibling-carousel-caption"
                    className="absolute inset-x-0 bottom-0 z-20 flex h-[44%] flex-col justify-end gap-1.5 bg-gradient-to-t from-black/68 via-black/35 to-transparent p-3 sm:p-4"
                  >
                    <span className="text-[10px] font-semibold tracking-[0.18em] text-stone-200/90 uppercase drop-shadow-md sm:text-xs">
                      Chapter
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

                  {/* Visually-hidden active marker — preserves the existing
                      `sibling-carousel-playing-now` testid and gives screen
                      readers a labeled "Playing now" affordance even though
                      the visual cue is a border, not a pill. */}
                  {isActive ? (
                    <span
                      data-testid="sibling-carousel-playing-now"
                      className="sr-only"
                    >
                      Playing now
                    </span>
                  ) : null}
                </Link>
              </CarouselItem>
            )
          })}
        </CarouselContent>

        {/* The shared `outline` Button variant only sets text color on
            hover (via `hover:text-foreground`); against this dark-themed
            page the chevrons inherit white from the parent until hover.
            Force the chevrons to a near-black at all times so the arrow
            stays legible against the light circular background. */}
        <CarouselPrevious
          className="hidden text-stone-900 hover:text-stone-900 md:inline-flex"
          label="Previous chapter"
        />
        <CarouselNext
          className="hidden text-stone-900 hover:text-stone-900 md:inline-flex"
          label="Next chapter"
        />
      </Carousel>
    </section>
  )
}
