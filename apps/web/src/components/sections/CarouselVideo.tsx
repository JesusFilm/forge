"use client"

import { useCallback, useState } from "react"
import Image from "next/image"
import type { FragmentOf } from "@forge/graphql"
import { videoCarouselFragment } from "@/lib/fragments/video-carousel"
import { CONTENT_WIDTH_CLASSES } from "@/lib/content-width"
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
      className="relative bg-linear-to-tr from-violet-950/10 via-indigo-500/10 to-cyan-300/50 py-16"
    >
      <hr className="section-divider" />

      <div className="overlay-texture-image absolute inset-0 bg-repeat mix-blend-multiply" />

      {/* Header */}
      <div className={`${CONTENT_WIDTH_CLASSES} relative z-2`}>
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-4">
            <div className="flex flex-col gap-1">
              {subtitle && (
                <h4 className="mb-0 text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:mb-1 xl:text-base 2xl:text-lg">
                  {subtitle}
                </h4>
              )}
              <h3 className="mb-0 text-2xl font-bold text-balance xl:text-3xl 2xl:text-4xl">
                {title}
              </h3>
            </div>
          </div>
          {ctaLabel && (
            <Button variant="pill" aria-label={ctaLabel}>
              <span>{ctaLabel}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Description */}
      {descriptionText && (
        <div className={`${CONTENT_WIDTH_CLASSES} space-y-6 pt-6 pb-10`}>
          <p className="mt-2 text-lg leading-relaxed text-stone-200/80 xl:text-xl">
            <span className="font-bold text-white">{firstFourWords}</span>
            {remainingText}
          </p>
        </div>
      )}

      {/* Main video player */}
      <VideoPlayer
        key={selectedSlide.streamingUrl}
        src={selectedSlide.streamingUrl}
        poster={selectedSlide.imageUrl}
        onPlayerReady={handlePlayerReady}
      />

      {/* Thumbnail carousel */}
      <div className="pt-8">
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
              <CarouselItem
                key={slide.id}
                className={`max-w-[200px] pl-4 ${index === 0 ? "pl-4 sm:pl-8 lg:pl-10 xl:pl-12 2xl:pl-20" : ""} ${index === validSlides.length - 1 ? "pr-6" : ""} cursor-pointer`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  className={`beveled group relative m-1 flex h-[240px] w-full cursor-pointer flex-col justify-end overflow-hidden rounded-lg ${
                    selectedIndex === index ? "outline-4 outline-white" : ""
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
                    className="absolute top-0 h-[150px] w-full overflow-hidden object-cover [mask-image:linear-gradient(to_bottom,rgba(0,0,0,1)_50%,transparent_100%)] [mask-size:cover]"
                  />

                  <div className="absolute top-1/2 left-1/2 hidden h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-stone-900/60 group-hover:flex hover:bg-red-500">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-20 w-20"
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
    </div>
  )
}
