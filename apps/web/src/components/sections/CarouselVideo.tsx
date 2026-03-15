"use client"

import { useCallback, useState } from "react"
import Image from "next/image"
import type { FragmentOf } from "@forge/graphql"
import { ExternalLink } from "lucide-react"
import { videoCarouselFragment } from "@/lib/fragments/video-carousel"
import { Button } from "@/components/ui/button"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import { VideoPlayer } from "./Video"

export { videoCarouselFragment }

type CarouselVideoProps = {
  data: FragmentOf<typeof videoCarouselFragment>
}

type SlideData = NonNullable<
  NonNullable<FragmentOf<typeof videoCarouselFragment>["slides"]>[number]
>

export function CarouselVideo({ data }: CarouselVideoProps) {
  const { id, sectionKey, title, subtitle, description, ctaLabel, slides } =
    data

  const validSlides = slides?.filter((s): s is SlideData => s != null) ?? []

  const [selectedIndex, setSelectedIndex] = useState(0)
  const handlePlayerReady = useCallback(() => {}, [])

  if (validSlides.length === 0) return null

  const selectedSlide = validSlides[selectedIndex]!

  const descriptionText = description ?? ""
  const firstFourWords = descriptionText.split(" ").slice(0, 4).join(" ")
  const remainingText = descriptionText.slice(firstFourWords.length)

  return (
    <div
      id={id ?? undefined}
      data-section-key={sectionKey ?? undefined}
      data-testid="CarouselVideo"
      className="relative w-full space-y-6"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-repeat opacity-50 mix-blend-multiply"
        style={{ backgroundImage: "url(/watch/assets/overlay.svg)" }}
        aria-hidden="true"
      />
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {subtitle && (
            <span className="text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base 2xl:text-lg">
              {subtitle}
            </span>
          )}
          <h3 className="text-2xl font-bold text-balance xl:text-3xl 2xl:text-4xl">
            {title}
          </h3>
        </div>
        {ctaLabel && (
          <Button variant="pill" aria-label={ctaLabel}>
            <ExternalLink size={16} />
            <span>{ctaLabel}</span>
          </Button>
        )}
      </div>

      {/* Description */}
      {descriptionText && (
        <p className="text-lg leading-relaxed text-stone-200/80 xl:text-xl">
          <span className="font-bold text-white">{firstFourWords}</span>
          {remainingText}
        </p>
      )}

      {/* Main video player */}
      <VideoPlayer
        key={selectedSlide.streamingUrl}
        src={selectedSlide.streamingUrl}
        poster={selectedSlide.imageUrl}
        onPlayerReady={handlePlayerReady}
      />

      {/* Thumbnail carousel */}
      <Carousel
        opts={{
          align: "start",
          dragFree: true,
          containScroll: "trimSnaps",
          watchDrag: (api) => api.scrollSnapList().length > 1,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-4">
          {validSlides.map((slide, index) => (
            <CarouselItem key={slide.id} className="basis-[200px] pl-4">
              <button
                type="button"
                onClick={() => setSelectedIndex(index)}
                className={`group relative flex h-[240px] w-full cursor-pointer flex-col justify-end overflow-hidden rounded-lg transition-all ${
                  selectedIndex === index
                    ? "ring-4 ring-white"
                    : "ring-0 hover:ring-2 hover:ring-white/50"
                }`}
                style={{
                  backgroundColor: slide.backgroundColor ?? "#1A1815",
                }}
                aria-label={`Play ${slide.title}`}
                aria-pressed={selectedIndex === index}
              >
                <Image
                  width={200}
                  height={150}
                  src={slide.imageUrl}
                  alt={slide.title}
                  className="absolute top-0 h-[150px] w-full object-cover mask-[linear-gradient(to_bottom,rgba(0,0,0,1)_50%,transparent_100%)]"
                />

                {/* Play icon overlay on hover */}
                <div className="absolute top-1/2 left-1/2 hidden h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-stone-900/60 group-hover:flex">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-10 w-10"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>

                <div className="p-4">
                  <span className="text-xs font-medium tracking-wider text-white/60 uppercase">
                    {slide.label ?? "Short Video"}
                  </span>
                  <h4 className="line-clamp-3 text-base leading-tight font-bold text-white/90">
                    {slide.title}
                  </h4>
                </div>
              </button>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  )
}
