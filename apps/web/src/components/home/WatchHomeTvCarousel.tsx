"use client"

import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { useMemo, type Ref, type RefObject } from "react"
import MuxVideo from "@forge/video-player/mux-video"
import { Play, SkipForward, Volume2, VolumeX } from "lucide-react"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import { Button } from "@/components/ui/button"
import type { WatchHomeHeroSlide } from "@/lib/watch-home"
import { cn } from "@/lib/utils"
import {
  useWatchHomeTvCarousel,
  type WatchHomeTvCarouselSlide,
} from "@/components/home/useWatchHomeTvCarousel"

type WatchHomeTvCarouselProps = {
  slides: WatchHomeHeroSlide[]
}

function muxStreamUrl(playbackId: string | null) {
  return playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : null
}

function muxThumbnailUrl(playbackId: string | null, width = 1280) {
  return playbackId
    ? `https://image.mux.com/${playbackId}/thumbnail.jpg?width=${width}&height=720&fit_mode=smartcrop`
    : null
}

export function watchHomeHeroSlidesToTvCarouselSlides(
  slides: readonly WatchHomeHeroSlide[],
): WatchHomeTvCarouselSlide[] {
  return slides.map((slide) => {
    const muxThumbnail = muxThumbnailUrl(slide.playbackId)
    const posterUrl = slide.imageUrl ?? muxThumbnail

    return {
      id: slide.id,
      title: slide.title,
      description: slide.description,
      label: slide.eyebrow || slide.label,
      href: slide.href,
      posterUrl,
      thumbnailUrl:
        slide.imageUrl ?? muxThumbnailUrl(slide.playbackId, 640) ?? posterUrl,
      imageAlt: slide.imageAlt,
      src: slide.hls ?? muxStreamUrl(slide.playbackId),
      playbackId: slide.playbackId,
    }
  })
}

function PrimaryAction({ slide }: { slide: WatchHomeTvCarouselSlide }) {
  if (!slide.href) return null

  return (
    <Link
      href={slide.href as Route}
      className="inline-flex h-14 max-w-full items-center gap-3 rounded-full bg-brand-red px-5 text-lg font-bold text-white shadow-[0_14px_32px_rgba(0,0,0,0.34)] transition hover:bg-brand-red/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:h-16 sm:px-7 sm:text-xl"
    >
      <Play className="h-5 w-5 shrink-0 fill-current" aria-hidden />
      <span className="truncate">Watch Now</span>
    </Link>
  )
}

function WatchHomeTvMedia({
  activeSlide,
  isMuted,
  onCanPlay,
  onEnded,
  onLoadedMetadata,
  onTimeUpdate,
  videoRef,
}: {
  activeSlide: WatchHomeTvCarouselSlide
  isMuted: boolean
  onCanPlay: () => void
  onEnded: () => void
  onLoadedMetadata: () => void
  onTimeUpdate: () => void
  videoRef: RefObject<HTMLVideoElement | null>
}) {
  return (
    <div className="absolute inset-x-0 top-0 bottom-[var(--watch-home-rail-height)] overflow-hidden bg-black">
      {activeSlide.posterUrl ? (
        <Image
          key={`${activeSlide.id}-poster`}
          src={activeSlide.posterUrl}
          alt={activeSlide.imageAlt}
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="h-full w-full bg-[linear-gradient(135deg,#020617,#3f1d2b_48%,#14332c)]"
        />
      )}
      {activeSlide.src ? (
        <MuxVideo
          key={activeSlide.id}
          ref={videoRef as Ref<HTMLVideoElement | undefined>}
          src={activeSlide.src}
          poster={activeSlide.posterUrl ?? undefined}
          muted={isMuted}
          playsInline
          disableTracking
          controls={false}
          onCanPlay={onCanPlay}
          onEnded={onEnded}
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0)_36%,rgba(0,0,0,0.35)_70%,rgba(0,0,0,0.72)_100%)]" />
      <div className="absolute inset-y-0 left-0 w-3/5 bg-[linear-gradient(90deg,rgba(0,0,0,0.48)_0%,rgba(0,0,0,0)_100%)]" />
    </div>
  )
}

function WatchHomeTvOverlay({
  activeSlide,
  isMuted,
  onNext,
  onToggleMuted,
}: {
  activeSlide: WatchHomeTvCarouselSlide
  isMuted: boolean
  onNext: () => void
  onToggleMuted: () => void
}) {
  return (
    <div className="absolute inset-x-0 bottom-[var(--watch-home-rail-height)] z-10 flex items-end justify-between gap-4 px-5 pb-6 sm:px-10 sm:pb-8 md:px-12">
      <div className="flex min-w-0 max-w-[min(58rem,calc(100vw-2.5rem))] flex-col items-start gap-4 text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.7)]">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-[0.24em] text-amber-300 uppercase sm:text-sm">
            {activeSlide.label}
          </p>
          <h1 className="line-clamp-2 text-4xl leading-tight font-extrabold sm:text-5xl md:text-6xl">
            {activeSlide.title}
          </h1>
          {activeSlide.description ? (
            <p className="mt-3 line-clamp-3 max-w-[min(52rem,calc(100vw-2.5rem))] text-base leading-7 font-semibold text-white/78 sm:text-lg md:text-xl">
              {activeSlide.description}
            </p>
          ) : null}
        </div>
        <PrimaryAction slide={activeSlide} />
      </div>
      <div className="hidden shrink-0 items-center gap-4 text-white sm:flex">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Next video"
          onClick={onNext}
          className="h-14 w-14 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
        >
          <SkipForward className="h-8 w-8 fill-current" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={isMuted ? "Unmute preview" : "Mute preview"}
          onClick={onToggleMuted}
          className="h-14 w-14 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
        >
          {isMuted ? (
            <VolumeX className="h-8 w-8" aria-hidden />
          ) : (
            <Volume2 className="h-8 w-8" aria-hidden />
          )}
        </Button>
      </div>
    </div>
  )
}

function WatchHomeTvCard({
  isActive,
  onSelect,
  progress,
  slide,
}: {
  isActive: boolean
  onSelect: () => void
  progress: number
  slide: WatchHomeTvCarouselSlide
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative block aspect-video w-[clamp(14.75rem,72vw,min(26.25rem,50svh))] overflow-hidden rounded-lg bg-stone-950 text-left shadow-[0_8px_22px_rgba(0,0,0,0.42)] ring-1 ring-white/10 transition focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:w-[clamp(14.75rem,30vw,min(26.25rem,50svh))]",
        isActive
          ? "opacity-100 ring-2 ring-white"
          : "opacity-62 hover:opacity-95 hover:ring-white/45",
      )}
      aria-pressed={isActive}
      aria-label={`Show ${slide.title}`}
      data-testid="watch-home-tv-carousel-card"
    >
      {slide.thumbnailUrl ? (
        <Image
          src={slide.thumbnailUrl}
          alt=""
          fill
          sizes="(max-width: 640px) 72vw, min(30vw, 26.25rem)"
          className="object-cover transition duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div
          aria-hidden
          className="h-full w-full bg-[linear-gradient(135deg,#111827,#4c1d1d_52%,#064e3b)]"
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_28%,rgba(0,0,0,0.72)_100%)]" />
      {isActive ? (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
          <div
            className="h-full bg-brand-red"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
      <div className="absolute right-4 bottom-4 left-4">
        <p className="mb-1 truncate text-[0.7rem] font-bold tracking-[0.22em] text-white/55 uppercase sm:text-xs">
          {slide.label}
        </p>
        <h2 className="line-clamp-2 text-base leading-tight font-extrabold text-white sm:text-xl">
          {slide.title}
        </h2>
      </div>
    </button>
  )
}

function WatchHomeTvRail({
  activeSlideId,
  onSelect,
  progress,
  slides,
}: {
  activeSlideId: string
  onSelect: (slideId: string) => void
  progress: number
  slides: readonly WatchHomeTvCarouselSlide[]
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 h-[var(--watch-home-rail-height)] bg-black/45 px-5 pt-4 backdrop-blur-sm sm:px-10 md:px-12">
      <Carousel
        opts={{
          align: "start",
          containScroll: "trimSnaps",
          dragFree: true,
        }}
        className="h-full"
      >
        <CarouselContent className="-ml-4">
          {slides.map((slide) => (
            <CarouselItem key={slide.id} className="basis-auto pl-4">
              <WatchHomeTvCard
                slide={slide}
                isActive={slide.id === activeSlideId}
                progress={slide.id === activeSlideId ? progress : 0}
                onSelect={() => onSelect(slide.id)}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  )
}

export function WatchHomeTvCarousel({ slides }: WatchHomeTvCarouselProps) {
  const carouselSlides = useMemo(
    () => watchHomeHeroSlidesToTvCarouselSlides(slides),
    [slides],
  )
  const {
    activeSlide,
    advance,
    handleCanPlay,
    handleEnded,
    handleLoadedMetadata,
    handleTimeUpdate,
    isMuted,
    progress,
    selectSlide,
    toggleMuted,
    videoRef,
  } = useWatchHomeTvCarousel(carouselSlides)

  if (!activeSlide) return null

  return (
    <section
      className="relative bg-black [--watch-home-rail-height:clamp(9.25rem,31svh,15.75rem)] pt-[calc(6rem+env(safe-area-inset-top,0px))] md:pt-[calc(8rem+env(safe-area-inset-top,0px))]"
      data-testid="watch-home-tv-carousel"
    >
      <h1 className="sr-only">Jesus Film Project Watch</h1>
      <div className="relative mx-auto h-[calc(100svh_-_6rem_-_env(safe-area-inset-top,0px))] w-full max-w-[1920px] overflow-hidden bg-black md:h-[calc(100svh_-_8rem_-_env(safe-area-inset-top,0px))]">
        <WatchHomeTvMedia
          activeSlide={activeSlide}
          isMuted={isMuted}
          onCanPlay={handleCanPlay}
          onEnded={handleEnded}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          videoRef={videoRef}
        />
        <WatchHomeTvOverlay
          activeSlide={activeSlide}
          isMuted={isMuted}
          onNext={advance}
          onToggleMuted={toggleMuted}
        />
        <div className="absolute right-5 bottom-[calc(var(--watch-home-rail-height)+1rem)] z-30 flex gap-2 sm:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next video"
            onClick={advance}
            className="h-11 w-11 rounded-full bg-black/35 text-white hover:bg-black/55"
          >
            <SkipForward className="h-6 w-6 fill-current" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={isMuted ? "Unmute preview" : "Mute preview"}
            onClick={toggleMuted}
            className="h-11 w-11 rounded-full bg-black/35 text-white hover:bg-black/55"
          >
            {isMuted ? (
              <VolumeX className="h-6 w-6" aria-hidden />
            ) : (
              <Volume2 className="h-6 w-6" aria-hidden />
            )}
          </Button>
        </div>
        <WatchHomeTvRail
          slides={carouselSlides}
          activeSlideId={activeSlide.id}
          progress={progress}
          onSelect={selectSlide}
        />
      </div>
    </section>
  )
}
