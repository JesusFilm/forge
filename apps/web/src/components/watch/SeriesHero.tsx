"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import Image from "next/image"

import type { ResolvedSeriesBySlug } from "@/lib/content"
import {
  CONTENT_WIDTH_ALIGN_CLASSES,
  WATCH_PAGE_LEFT_RAIL_CLASSES,
} from "@/lib/content-width"
import { resolvePosterUrl } from "@/lib/url"
import { HeroPlayer } from "./HeroPlayer"

type SeriesHeroProps = {
  series: ResolvedSeriesBySlug["video"]
  selectedVariant: ResolvedSeriesBySlug["selectedVariant"]
  onLanguageClick?: () => void
  playableLanguageCount?: number
  // Optional hero-overlay content. When provided, replaces the default
  // label/title overlay in both trailer and static modes. The series
  // page uses this to render the episode-count label, title, and share
  // pill as a single horizontal band — see SeriesPageClient.
  overlay?: ReactNode
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

export function SeriesHero({
  series,
  selectedVariant,
  onLanguageClick,
  playableLanguageCount,
  overlay,
}: SeriesHeroProps) {
  if (hasPlayableTrailer(selectedVariant)) {
    // darkenOverlay reads the trailer as decorative background rather
    // than a primary playback surface (the series page is not a video
    // player page — it's a landing page with a trailer for visual mood).
    return (
      <HeroPlayer
        block={{ kind: "HeroPlayer", video: series, variant: selectedVariant }}
        darkenOverlay
        onLanguageClick={onLanguageClick}
        playableLanguageCount={playableLanguageCount}
        overlay={overlay}
      />
    )
  }
  return <SeriesHeroStatic series={series} overlay={overlay} />
}

// Static-mode hero: no <MuxPlayer>, no autoplay state, no chrome reveal.
// Renders the series poster pinned to viewport-top using the same sticky-
// math as HeroPlayer so the title overlay's overlay-anchor sits at the
// same scroll-aware position. The body section slides over the sticky
// hero on scroll, and the title (anchored to the zero-height div below)
// rides the body's top edge in lockstep with the video page's behavior.
function SeriesHeroStatic({
  series,
  overlay,
}: {
  series: ResolvedSeriesBySlug["video"]
  overlay?: ReactNode
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

        {/* Flat-tint darken overlay matches the trailer-mode pass-through
            (HeroPlayer's `darkenOverlay` prop). The series page treats
            the hero image as decorative background, not a primary
            playback surface, so we apply uniform darkening across the
            whole hero rather than a bottom-only legibility gradient. */}
        <div
          aria-hidden="true"
          data-testid="series-hero-darken-overlay"
          className="pointer-events-none absolute inset-0 bg-black/50"
        />
      </div>

      {/* Zero-height overlay anchor matches HeroPlayer.tsx:383-386. The
          overlay attached here lives in normal flow and rides the body
          section's top edge on scroll, so the title behaves identically
          to the video page in both modes. */}
      <div
        data-testid="hero-player-overlay-anchor"
        className={`${CONTENT_WIDTH_ALIGN_CLASSES} relative z-10 h-0`}
      >
        {overlay ?? (
          <div
            data-testid="series-hero-overlay"
            className={`absolute right-6 bottom-0 flex flex-col items-start gap-4 pb-6 md:right-auto ${WATCH_PAGE_LEFT_RAIL_CLASSES}`}
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
                className="max-w-[calc(100vw-5rem)] text-2xl leading-[1.08] font-bold text-balance break-words text-white drop-shadow-lg sm:text-4xl md:max-w-[18ch] md:text-6xl xl:max-w-[20ch] xl:text-7xl"
              >
                {series.title}
              </h1>
            ) : null}
          </div>
        )}
      </div>
    </>
  )
}
