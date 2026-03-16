"use client"

import Image from "next/image"
import { useCallback, useState } from "react"
import type { FragmentOf } from "@forge/graphql"
import { videoCarouselFragment } from "@/lib/fragments/video-carousel"
import { cn } from "@/lib/utils"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import { VideoPlayer } from "./Video"

export { videoCarouselFragment }

type CarouselVideoProps = {
  data: FragmentOf<typeof videoCarouselFragment>
}

export function CarouselVideo({ data }: CarouselVideoProps) {
  const { id, sectionKey, title, subtitle, carouselDescription, slides } = data

  const validSlides = slides?.filter(
    (s): s is NonNullable<typeof s> => s != null,
  )
  const [selectedIndex, setSelectedIndex] = useState(0)

  const activeSlide = validSlides?.[selectedIndex]
  const handlePlayerReady = useCallback(() => {}, [])

  if (!validSlides?.length || !activeSlide) return null

  const descriptionWords = carouselDescription?.split(" ") ?? []
  const leadWords = descriptionWords.slice(0, 4).join(" ")
  const restWords = descriptionWords.slice(4).join(" ")

  return (
    <div
      id={id ?? undefined}
      data-section-key={sectionKey ?? undefined}
      data-testid="CarouselVideoSection"
      className="w-full space-y-6"
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          {subtitle && (
            <span className="text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base">
              {subtitle}
            </span>
          )}
          <h3 className="text-2xl font-bold text-balance xl:text-3xl 2xl:text-4xl">
            {title}
          </h3>
        </div>
      </div>

      {/* Description */}
      {carouselDescription && (
        <p className="text-lg leading-relaxed text-stone-200/80 xl:text-xl">
          <span className="font-bold text-white">{leadWords}</span>
          {restWords ? ` ${restWords}` : ""}
        </p>
      )}

      {/* Active video player */}
      <VideoPlayer
        key={activeSlide.streamingUrl}
        src={activeSlide.streamingUrl}
        poster={activeSlide.imageUrl}
        onPlayerReady={handlePlayerReady}
      />

      {/* Thumbnail carousel */}
      <Carousel
        opts={{
          align: "start",
          dragFree: true,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-3">
          {validSlides.map((slide, index) => (
            <CarouselItem key={slide.id} className="basis-[200px] pl-3">
              <button
                type="button"
                onClick={() => setSelectedIndex(index)}
                className={cn(
                  "group relative flex h-[240px] w-full flex-col justify-end overflow-hidden rounded-lg transition-all",
                  selectedIndex === index
                    ? "ring-4 ring-white"
                    : "ring-0 hover:ring-2 hover:ring-white/50",
                )}
                style={{ backgroundColor: slide.backgroundColor ?? "#000" }}
              >
                <Image
                  width={200}
                  height={150}
                  src={slide.imageUrl}
                  alt={slide.title}
                  className="absolute top-0 h-[150px] w-full object-cover [mask-image:linear-gradient(to_bottom,rgba(0,0,0,1)_50%,transparent_100%)]"
                />

                {/* Play overlay on hover */}
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

                <div className="relative p-4">
                  <span className="text-xs font-medium tracking-wider text-white/60 uppercase">
                    Short Video
                  </span>
                  <h4 className="line-clamp-3 text-base leading-tight font-bold text-white/90">
                    {slide.title}
                  </h4>
                </div>
              </button>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="-left-4 border-white/20 bg-black/50 text-white hover:bg-black/70 hover:text-white" />
        <CarouselNext className="-right-4 border-white/20 bg-black/50 text-white hover:bg-black/70 hover:text-white" />
      </Carousel>
    </div>
  )
}
