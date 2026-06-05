"use client"

import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import type { Ref, RefObject } from "react"
import MuxVideo from "@forge/video-player/mux-video"
import { Play, SkipForward, Volume2, VolumeX } from "lucide-react"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type {
  WatchHomeCarouselData,
  WatchHomeCarouselSlide,
} from "@/lib/watch-home-carousel"
import { useWatchHomeCarousel } from "./useWatchHomeCarousel"

type WatchHomeCarouselClientProps = {
  data: WatchHomeCarouselData
}

function PrimaryAction({ slide }: { slide: WatchHomeCarouselSlide }) {
  const className =
    "inline-flex h-14 max-w-full items-center gap-3 rounded-full bg-brand-red px-5 text-lg font-bold text-white shadow-[0_14px_32px_rgba(0,0,0,0.34)] transition hover:bg-brand-red/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:h-16 sm:px-7 sm:text-xl"

  if (slide.kind === "video") {
    return (
      <Link href={slide.href as Route} className={className}>
        <Play className="h-5 w-5 shrink-0 fill-current" aria-hidden />
        <span className="truncate">Watch</span>
      </Link>
    )
  }

  if (slide.action) {
    return (
      <a href={slide.action.url} className={className}>
        <Play className="h-5 w-5 shrink-0 fill-current" aria-hidden />
        <span className="truncate">{slide.action.label}</span>
      </a>
    )
  }

  return null
}

function WatchHomeMedia({
  activeSlide,
  isMuted,
  onCanPlay,
  onEnded,
  onLoadedMetadata,
  onTimeUpdate,
  videoRef,
}: {
  activeSlide: WatchHomeCarouselSlide
  isMuted: boolean
  onCanPlay: () => void
  onEnded: () => void
  onLoadedMetadata: () => void
  onTimeUpdate: () => void
  videoRef: RefObject<HTMLVideoElement | null>
}) {
  return (
    <div className="absolute inset-x-0 top-0 bottom-[132px] overflow-hidden bg-black sm:bottom-[150px] md:bottom-[164px]">
      {activeSlide.posterUrl ? (
        <Image
          key={`${activeSlide.id}-poster`}
          src={activeSlide.posterUrl}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      ) : null}
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
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_38%,rgba(0,0,0,0.34)_70%,rgba(0,0,0,0.62)_100%)]" />
      <div className="absolute inset-y-0 left-0 w-2/5 bg-[linear-gradient(90deg,rgba(0,0,0,0.34)_0%,rgba(0,0,0,0)_100%)]" />
    </div>
  )
}

function WatchHomeOverlay({
  activeSlide,
  isMuted,
  onNext,
  onToggleMuted,
}: {
  activeSlide: WatchHomeCarouselSlide
  isMuted: boolean
  onNext: () => void
  onToggleMuted: () => void
}) {
  return (
    <div className="absolute inset-x-0 bottom-[132px] z-10 flex items-end justify-between gap-4 px-5 pb-6 sm:bottom-[150px] sm:px-10 sm:pb-8 md:bottom-[164px] md:px-12">
      <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-end sm:gap-5">
        <PrimaryAction slide={activeSlide} />
        <div className="min-w-0 text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.7)]">
          <p className="text-xs font-bold tracking-[0.24em] text-amber-300 uppercase sm:text-sm">
            {activeSlide.label}
          </p>
          <h1 className="line-clamp-2 max-w-[calc(100vw-9rem)] text-3xl leading-tight font-extrabold sm:max-w-[min(44rem,calc(100vw-2.5rem))] sm:text-4xl md:text-5xl">
            {activeSlide.title}
          </h1>
        </div>
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

function WatchHomeCard({
  isActive,
  onSelect,
  progress,
  slide,
}: {
  isActive: boolean
  onSelect: () => void
  progress: number
  slide: WatchHomeCarouselSlide
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative block aspect-video w-[72vw] max-w-[420px] min-w-[236px] overflow-hidden rounded-lg bg-stone-950 text-left shadow-[0_8px_22px_rgba(0,0,0,0.42)] ring-1 ring-white/10 transition focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:w-[30rem]",
        isActive
          ? "opacity-100 ring-2 ring-white"
          : "opacity-62 hover:opacity-95 hover:ring-white/45",
      )}
      aria-pressed={isActive}
      aria-label={`Show ${slide.title}`}
      data-testid="watch-home-carousel-card"
    >
      {slide.thumbnailUrl ? (
        <Image
          src={slide.thumbnailUrl}
          alt=""
          fill
          sizes="(max-width: 640px) 72vw, 30rem"
          className="object-cover transition duration-500 group-hover:scale-[1.03]"
        />
      ) : null}
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

function WatchHomeRail({
  activeSlideId,
  onSelect,
  progress,
  slides,
}: {
  activeSlideId: string
  onSelect: (slideId: string) => void
  progress: number
  slides: readonly WatchHomeCarouselSlide[]
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 h-[132px] bg-black/45 px-5 pt-4 backdrop-blur-sm sm:h-[150px] sm:px-10 md:h-[164px] md:px-12">
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
              <WatchHomeCard
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

export function WatchHomeCarouselClient({
  data,
}: WatchHomeCarouselClientProps) {
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
  } = useWatchHomeCarousel(data.slides)

  if (!activeSlide) return null

  return (
    <section
      className="relative bg-black pt-[calc(6rem+env(safe-area-inset-top,0px))] md:pt-[calc(8rem+env(safe-area-inset-top,0px))]"
      data-testid="watch-home-carousel"
    >
      <div className="relative mx-auto h-[calc(100svh_-_6rem_-_env(safe-area-inset-top,0px))] min-h-[600px] w-full max-w-[1920px] overflow-hidden bg-black sm:min-h-[680px] md:h-[calc(100svh_-_8rem_-_env(safe-area-inset-top,0px))]">
        <WatchHomeMedia
          activeSlide={activeSlide}
          isMuted={isMuted}
          onCanPlay={handleCanPlay}
          onEnded={handleEnded}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          videoRef={videoRef}
        />
        <WatchHomeOverlay
          activeSlide={activeSlide}
          isMuted={isMuted}
          onNext={advance}
          onToggleMuted={toggleMuted}
        />
        <div className="absolute right-5 bottom-[148px] z-30 flex gap-2 sm:hidden">
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
        <WatchHomeRail
          slides={data.slides}
          activeSlideId={activeSlide.id}
          progress={progress}
          onSelect={selectSlide}
        />
      </div>
    </section>
  )
}
