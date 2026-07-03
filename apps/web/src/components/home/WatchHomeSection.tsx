"use client"

import Link from "next/link"
import type { Route } from "next"
import { useState } from "react"
import { Play } from "lucide-react"
import { WatchHomeCard } from "@/components/home/WatchHomeCard"
import {
  WATCH_PAGE_CONTENT_CLASSES,
  WATCH_PAGE_RAIL_PADDING_CLASSES,
} from "@/lib/content-width"
import { cn } from "@/lib/utils"
import type { WatchHomeSection as WatchHomeSectionModel } from "@/lib/watch-home"
import { videosIndexPath } from "@/lib/routes"

type WatchHomeSectionProps = {
  section: WatchHomeSectionModel
}

function backgroundImageStyle(imageUrl: string | null) {
  return imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined
}

export function WatchHomeSection({ section }: WatchHomeSectionProps) {
  const isRail = section.layout === "rail"
  const cardOrientation = isRail ? "vertical" : section.orientation
  const isVertical = cardOrientation === "vertical"
  const backgroundCard = section.cards.find((card) => card.imageUrl)
  const defaultBackgroundUrl = backgroundCard?.imageUrl ?? null
  const [hoverBackgroundUrl, setHoverBackgroundUrl] = useState<string | null>(
    null,
  )
  const currentBackgroundUrl = hoverBackgroundUrl ?? defaultBackgroundUrl
  const sectionHref = section.cards.find((card) => card.href)?.href
  const ctaHref = sectionHref ?? videosIndexPath()

  return (
    <section
      data-testid="watch-home-section"
      data-section-id={section.id}
      className={cn(
        "scroll-mt-24 relative overflow-hidden py-16 text-white",
        isRail
          ? "bg-[linear-gradient(to_top_right,rgba(23,37,84,0.12),rgba(88,28,135,0.12),rgba(145,33,74,0.9))]"
          : "bg-[#050505]",
      )}
    >
      {currentBackgroundUrl ? (
        <>
          <div
            className={cn(
              "absolute inset-0 z-0 scale-105 bg-cover bg-center bg-no-repeat blur-md transition-opacity duration-500 ease-in-out",
              isRail
                ? "opacity-30 mix-blend-overlay"
                : "opacity-45 brightness-75 saturate-125",
              hoverBackgroundUrl
                ? isRail
                  ? "opacity-40"
                  : "opacity-65"
                : null,
            )}
            style={backgroundImageStyle(currentBackgroundUrl)}
            aria-hidden
          />
          {!isRail ? (
            <div
              className={cn(
                "animate-background-pan-zoom absolute inset-[-8%] z-0 bg-no-repeat opacity-35 blur-2xl brightness-75 saturate-150 transition-opacity duration-500 ease-in-out",
                hoverBackgroundUrl ? "opacity-55" : "opacity-35",
              )}
              style={{
                ...backgroundImageStyle(currentBackgroundUrl),
                backgroundSize: "200% 200%",
                backgroundPosition: "center",
              }}
              aria-hidden
            />
          ) : null}
        </>
      ) : null}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 z-[1]",
          isRail
            ? "bg-[linear-gradient(to_top_right,rgba(23,37,84,0.16),rgba(88,28,135,0.16),rgba(145,33,74,0.72))] mix-blend-multiply"
            : "bg-[linear-gradient(to_top_right,rgba(88,28,135,0.18),rgba(12,10,9,0.28)_42%,rgba(12,10,9,0.82))]",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 z-[1] bg-[url(/watch/images/overlay.svg)] bg-repeat mix-blend-multiply",
          isRail ? "opacity-70" : "opacity-45",
        )}
      />

      <div className={cn("relative z-[2] pb-6", WATCH_PAGE_CONTENT_CLASSES)}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-4xl flex-col gap-1">
            <p className="text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base 2xl:text-lg">
              {section.eyebrow}
            </p>
            <h2 className="text-2xl leading-tight font-bold tracking-normal xl:text-3xl 2xl:text-4xl">
              {section.title}
            </h2>
          </div>
          <Link
            href={ctaHref as Route}
            className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold tracking-wider text-black uppercase transition-colors hover:bg-red-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Play className="h-4 w-4 fill-current" aria-hidden />
            Watch
          </Link>
        </div>
      </div>

      {isRail ? (
        <div className="relative z-[2] w-full overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div
            className={cn(
              "mx-auto flex w-max max-w-[1920px] gap-5",
              WATCH_PAGE_RAIL_PADDING_CLASSES,
            )}
          >
            {section.cards.map((card, index) => (
              <WatchHomeCard
                key={`${section.id}-${card.id}-${index}`}
                card={card}
                index={index}
                orientation={cardOrientation}
                showSequenceNumber={section.showSequenceNumbers}
                onHoverImageChange={setHoverBackgroundUrl}
                className="w-[158px] snap-start sm:w-[200px]"
              />
            ))}
          </div>
        </div>
      ) : (
        <div className={cn("relative z-[2]", WATCH_PAGE_CONTENT_CLASSES)}>
          <div
            className={cn(
              "grid gap-4",
              isVertical
                ? "grid-cols-2 md:grid-cols-4 xl:grid-cols-4"
                : "grid-cols-1 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
            )}
          >
            {section.cards.map((card, index) => (
              <WatchHomeCard
                key={`${section.id}-${card.id}-${index}`}
                card={card}
                index={index}
                orientation={cardOrientation}
                showSequenceNumber={section.showSequenceNumbers}
                onHoverImageChange={setHoverBackgroundUrl}
              />
            ))}
          </div>
        </div>
      )}

      {section.description ? (
        <div className={cn("relative z-[2]", WATCH_PAGE_CONTENT_CLASSES)}>
          <p className="mt-8 max-w-5xl text-lg leading-relaxed text-stone-200/80 xl:text-xl">
            {section.description}
          </p>
        </div>
      ) : null}
    </section>
  )
}
