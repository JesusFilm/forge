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
      className="relative w-full px-4 pt-2 pb-2 md:px-8"
      aria-label={ariaLabel}
    >
      <header className="mb-4">
        <p className="text-sm font-medium text-stone-300">
          <span className="text-stone-100">
            {canonicalParent.title ?? "Collection"}
          </span>
          <span className="px-2 text-stone-500">·</span>
          <span data-testid="sibling-carousel-label">
            {isParentMode
              ? `${clipTotal} chapters`
              : `Clip ${clipIndex} of ${clipTotal}`}
          </span>
        </p>
      </header>

      <Carousel
        opts={{ align: "start", containScroll: "trimSnaps" }}
        setApi={setApi}
        className="w-full"
      >
        <CarouselContent>
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
                className="basis-[70%] sm:basis-[45%] md:basis-1/3 lg:basis-1/4 xl:basis-1/5 2xl:basis-1/6"
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
                    "group relative block aspect-video overflow-hidden rounded-lg bg-stone-900 transition",
                    isActive
                      ? "border-4 border-red-600"
                      : "opacity-80 hover:opacity-100",
                  )}
                >
                  {thumb ? (
                    <Image
                      src={thumb}
                      alt={child.title ?? ""}
                      fill
                      sizes="(max-width: 640px) 70vw, (max-width: 768px) 45vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, (max-width: 1536px) 20vw, 16vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                      // Mark the first 5 cards above-the-fold so Next can
                      // preload them and avoid CLS / late paints on the
                      // initial visible strip. Cards beyond the first 5
                      // are off-screen at most viewport widths.
                      priority={index < 5}
                    />
                  ) : (
                    <div
                      data-testid="sibling-carousel-thumb-placeholder"
                      className="flex h-full w-full items-center justify-center bg-stone-900 text-xs text-stone-600"
                    >
                      No image
                    </div>
                  )}

                  {/* Bottom gradient for caption legibility over the thumbnail. */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
                  />

                  {/* Hover-only play overlay on inactive cards. The active
                      card already signals "this is what's playing" via the
                      red border, so we don't double-mark it with a button. */}
                  {!isActive ? (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
                    >
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow-lg ring-1 ring-black/20">
                        <Play size={20} fill="currentColor" stroke="none" />
                      </span>
                    </div>
                  ) : null}

                  {/* Caption block — CHAPTER label + title overlaid on the
                      thumbnail's lower-left, matching the watch-page mockup. */}
                  <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3 sm:p-4">
                    <span className="text-[10px] font-semibold tracking-[0.18em] text-stone-300 uppercase drop-shadow-md sm:text-xs">
                      Chapter
                    </span>
                    <h3 className="line-clamp-2 text-sm font-bold text-white drop-shadow-md sm:text-base">
                      {child.title ?? ""}
                    </h3>
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
        <CarouselPrevious className="hidden text-stone-900 hover:text-stone-900 md:inline-flex" />
        <CarouselNext className="hidden text-stone-900 hover:text-stone-900 md:inline-flex" />
      </Carousel>
    </section>
  )
}
