"use client"

import { useLayoutEffect, useRef, useState } from "react"
import Image from "next/image"

import type { ResolvedSeriesBySlug } from "@/lib/content"
import { resolvePosterUrl } from "@/lib/url"
import { HeroPlayer } from "./HeroPlayer"

type SeriesHeroProps = {
  series: ResolvedSeriesBySlug["video"]
  selectedVariant: ResolvedSeriesBySlug["selectedVariant"]
}

// Mirrors `apps/web/src/components/watch/HeroPlayer.tsx`'s playability
// guard (Boolean(variant.hls)) so trailer-mode and static-mode branch
// on the same canonical discriminator. See plan Key Technical Decisions:
// hls (not muxVideo.playbackId) is the playability rule shared by the
// video page and the series page.
function hasPlayableTrailer(
  variant: ResolvedSeriesBySlug["selectedVariant"],
): variant is NonNullable<ResolvedSeriesBySlug["selectedVariant"]> {
  return variant != null && Boolean(variant.hls)
}

export function SeriesHero({ series, selectedVariant }: SeriesHeroProps) {
  if (hasPlayableTrailer(selectedVariant)) {
    return (
      <HeroPlayer
        block={{ kind: "HeroPlayer", video: series, variant: selectedVariant }}
      />
    )
  }
  return <SeriesHeroStatic series={series} />
}

// Static-mode hero: no <MuxPlayer>, no autoplay state, no chrome reveal.
// Renders the series poster pinned to viewport-top using the same sticky-
// math as HeroPlayer so the title overlay's overlay-anchor sits at the
// same scroll-aware position. The body section slides over the sticky
// hero on scroll, and the title (anchored to the zero-height div below)
// rides the body's top edge in lockstep with the video page's behavior.
function SeriesHeroStatic({
  series,
}: {
  series: ResolvedSeriesBySlug["video"]
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [heroHeight, setHeroHeight] = useState<number | null>(null)

  // useLayoutEffect: aspect-video pins the wrapper height before paint, so
  // we can install the ResizeObserver and seed heroHeight without flashing
  // the fallback `top: 0px` for a frame. Mirrors HeroPlayer's pattern.
  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const apply = (h: number) => {
      if (h > 0) setHeroHeight(h)
    }
    apply(el.getBoundingClientRect().height)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) apply(entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const posterUrl = resolvePosterUrl(series.images?.[0], null)

  return (
    <>
      <div
        ref={wrapperRef}
        data-block-type="SeriesHeroStatic"
        data-testid="series-hero-static"
        className="sticky aspect-video w-full overflow-hidden bg-black"
        style={{
          // Same sticky-top math as HeroPlayer: 100svh tracks the small
          // viewport on iOS Safari, min() clamps to 0 so the player pins
          // exactly when its bottom hits the viewport bottom.
          top:
            heroHeight != null
              ? `min(0px, calc(100svh - ${heroHeight}px))`
              : "0px",
        }}
      >
        {posterUrl ? (
          // alt="" is intentional — the series title is rendered in the
          // overlay immediately following this image in DOM order (per
          // R7), making the image decorative for screen readers. If the
          // overlay is ever relocated above the image, reconsider the
          // alt value.
          <Image
            src={posterUrl}
            alt=""
            fill
            sizes="100vw"
            priority
            className="object-cover"
          />
        ) : null}

        {/* Scrim mirrors HeroPlayer.tsx:369 — keeps the title legible
            against arbitrary poster artwork (light, saturated, or busy
            posters would otherwise wash out white text). Reuses
            tailwind classes already in the codebase, no new gradient. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent"
        />
      </div>

      {/* Zero-height overlay anchor matches HeroPlayer.tsx:383-386. The
          overlay attached here lives in normal flow and rides the body
          section's top edge on scroll, so the title behaves identically
          to the video page in both modes. */}
      <div
        data-testid="hero-player-overlay-anchor"
        className="relative z-10 h-0 w-full"
      >
        <div
          data-testid="series-hero-overlay"
          className="absolute right-6 bottom-0 left-10 flex flex-col items-start gap-4 pb-6 md:right-auto md:left-16 xl:left-24"
        >
          {series.label ? (
            <span
              data-testid="series-hero-overlay-label"
              className="text-sm font-semibold tracking-wider text-amber-400 uppercase md:text-base"
            >
              {series.label}
            </span>
          ) : null}
          {series.title ? (
            <h1
              data-testid="series-hero-overlay-title"
              className="text-4xl font-bold text-white drop-shadow-lg whitespace-nowrap md:text-6xl xl:text-7xl"
            >
              {series.title}
            </h1>
          ) : null}
        </div>
      </div>
    </>
  )
}
