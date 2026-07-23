"use client"

import Link from "next/link"
import type { Route } from "next"
import type { CSSProperties } from "react"
import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Play } from "lucide-react"
import { WatchHomeCard } from "@/components/home/WatchHomeCard"
import { WATCH_MEDIA_SECTION_VERTICAL_PADDING_CLASS } from "@/components/watch/watch-section-styles"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { cn } from "@/lib/utils"
import type { WatchHomeSection as WatchHomeSectionModel } from "@/lib/watch-home"
import type { WatchHomeSectionId } from "@/lib/watch-home-config"
import { languagesIndexPath } from "@/lib/routes"

type WatchHomeSectionProps = {
  section: WatchHomeSectionModel
}

type HoverBackdropLayer = {
  id: number
  imageUrl: string
  state: "entering" | "exiting"
}

const SECTION_COPY_KEYS = {
  "home-video-gospels": {
    eyebrow: "videoBibleEyebrow",
    title: "gospelRailTitle",
    description: "videoBibleDescription",
  },
  "home-collection-showcase-grid": {
    eyebrow: "videoBibleEyebrow",
    title: "showcaseTitle",
    description: "videoBibleDescription",
  },
  "home-collection-showcase-grid-christmas-advent": {
    eyebrow: "adventEyebrow",
    title: "adventTitle",
    description: "adventDescription",
  },
  "home-collection-bibleproject-advent": {
    eyebrow: "bibleProjectEyebrow",
    title: "bibleProjectAdventTitle",
  },
  "home-collection-nua": {
    eyebrow: "nuaEyebrow",
    title: "nuaTitle",
  },
  "home-collection-nua-origins-worth": {
    eyebrow: "worthEyebrow",
    title: "nuaWorthTitle",
  },
  "home-collection-new-believer-course": {
    eyebrow: "videoCourseEyebrow",
    title: "journeyWithJesusTitle",
  },
  "home-collection-showcase-grid-vertical": {
    eyebrow: "gospelsOnVideoEyebrow",
    title: "scriptureAsWrittenTitle",
    description: "videoBibleDescription",
  },
} as const satisfies Record<
  WatchHomeSectionId,
  {
    eyebrow: string
    title: string
    description?: string
  }
>

function hasSectionCopy(id: string): id is WatchHomeSectionId {
  return id in SECTION_COPY_KEYS
}

function backgroundImageStyle(imageUrl: string | null) {
  return imageUrl ? { backgroundImage: `url("${imageUrl}")` } : undefined
}

function backdropLayerStyle(
  imageUrl: string | null,
  opacity: string,
  extraStyle?: CSSProperties,
): CSSProperties {
  return {
    ...backgroundImageStyle(imageUrl),
    ...extraStyle,
    "--watch-home-backdrop-opacity": opacity,
  } as CSSProperties
}

export function WatchHomeSection({ section }: WatchHomeSectionProps) {
  const t = useTranslations("WatchHome")
  const sectionT = useTranslations("WatchHomeSections")
  const sectionCopy = hasSectionCopy(section.id)
    ? SECTION_COPY_KEYS[section.id]
    : null
  const eyebrow = sectionCopy ? sectionT(sectionCopy.eyebrow) : section.eyebrow
  const title = sectionCopy ? sectionT(sectionCopy.title) : section.title
  const description =
    sectionCopy && "description" in sectionCopy
      ? sectionT(sectionCopy.description)
      : section.description
  const isRail = section.layout === "rail"
  const cardOrientation = isRail ? "vertical" : section.orientation
  const isVertical = cardOrientation === "vertical"
  const backgroundCard = section.cards.find((card) => card.imageUrl)
  const defaultBackgroundUrl = backgroundCard?.imageUrl ?? null
  const latestHoveredBackgroundUrlRef = useRef<string | null>(null)
  const hoverLayerIdRef = useRef(0)
  const [isSectionActive, setIsSectionActive] = useState(false)
  const [settledBackgroundUrl, setSettledBackgroundUrl] = useState<
    string | null
  >(defaultBackgroundUrl)
  const [hoverBackdropLayers, setHoverBackdropLayers] = useState<
    HoverBackdropLayer[]
  >([])
  const sectionHref = section.cards.find((card) => card.href)?.href
  const ctaHref = sectionHref ?? languagesIndexPath()
  const hoverBackdropOpacity = "1"

  function updateHoverBackground(imageUrl: string | null) {
    if (imageUrl) {
      latestHoveredBackgroundUrlRef.current = imageUrl
    }

    setHoverBackdropLayers((layers) => {
      let currentLayer: HoverBackdropLayer | null = null
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        if (layers[index]?.state === "entering") {
          currentLayer = layers[index]
          break
        }
      }
      if ((currentLayer?.imageUrl ?? null) === imageUrl) return layers

      const exitingLayers = layers.map((layer) => ({
        ...layer,
        state: "exiting" as const,
      }))

      if (!imageUrl) return exitingLayers

      hoverLayerIdRef.current += 1
      return [
        ...exitingLayers,
        {
          id: hoverLayerIdRef.current,
          imageUrl,
          state: "entering",
        },
      ]
    })
  }

  function settleLatestHoveredBackground() {
    setSettledBackgroundUrl(
      latestHoveredBackgroundUrlRef.current ?? defaultBackgroundUrl,
    )
  }

  useEffect(() => {
    if (hoverBackdropLayers.length === 0) return undefined

    const timeoutId = window.setTimeout(() => {
      setSettledBackgroundUrl(
        latestHoveredBackgroundUrlRef.current ?? defaultBackgroundUrl,
      )
      setHoverBackdropLayers([])
    }, 1250)

    return () => window.clearTimeout(timeoutId)
  }, [defaultBackgroundUrl, hoverBackdropLayers])

  return (
    <section
      data-testid="watch-home-section"
      data-section-id={section.id}
      onPointerEnter={() => setIsSectionActive(true)}
      onPointerLeave={() => {
        settleLatestHoveredBackground()
        setIsSectionActive(false)
        updateHoverBackground(null)
      }}
      onFocus={() => setIsSectionActive(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          settleLatestHoveredBackground()
          setIsSectionActive(false)
          updateHoverBackground(null)
        }
      }}
      className={cn(
        "scroll-mt-24 relative overflow-hidden text-white",
        WATCH_MEDIA_SECTION_VERTICAL_PADDING_CLASS,
        isRail
          ? "bg-[linear-gradient(to_top_right,rgba(23,37,84,0.22),rgba(88,28,135,0.2),rgba(145,33,74,0.94))]"
          : "bg-[#050505]",
      )}
    >
      {settledBackgroundUrl ? (
        <div
          data-testid="watch-home-section-default-backdrop"
          className={cn(
            "absolute inset-0 z-0 scale-105 bg-cover bg-center bg-no-repeat opacity-100 blur-2xl",
            isRail
              ? "brightness-80 saturate-125"
              : "brightness-75 saturate-110",
          )}
          style={backgroundImageStyle(settledBackgroundUrl)}
          aria-hidden
        />
      ) : null}
      {hoverBackdropLayers.map((layer) => (
        <div
          key={`hover-backdrop-${layer.id}`}
          data-testid={
            layer.state === "entering"
              ? "watch-home-section-hover-backdrop"
              : "watch-home-section-hover-backdrop-previous"
          }
          className={cn(
            "absolute inset-0 z-0 scale-105 bg-cover bg-center bg-no-repeat blur-2xl",
            layer.state === "entering"
              ? "watch-home-section-backdrop-enter"
              : "watch-home-section-backdrop-exit",
            isRail
              ? "brightness-80 saturate-125"
              : "brightness-75 saturate-110",
          )}
          style={backdropLayerStyle(layer.imageUrl, hoverBackdropOpacity)}
          aria-hidden
        />
      ))}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 z-[1] transition-opacity duration-500 ease-out",
          isSectionActive ? "opacity-0" : "opacity-100",
          isRail
            ? "bg-[linear-gradient(to_top_right,rgba(23,37,84,0.38),rgba(88,28,135,0.34),rgba(145,33,74,0.88))] mix-blend-multiply"
            : "bg-[linear-gradient(to_top_right,rgba(88,28,135,0.42),rgba(190,24,93,0.34)_38%,rgba(12,10,9,0.9))]",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 z-[1] bg-[url(/watch/images/overlay.svg)] bg-repeat mix-blend-multiply transition-opacity duration-500 ease-out",
          isSectionActive ? "opacity-0" : isRail ? "opacity-85" : "opacity-65",
        )}
      />

      <div className={cn("relative z-[3] pb-6", WATCH_PAGE_CONTENT_CLASSES)}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 max-w-4xl flex-1 flex-col gap-1">
            <p className="text-sm font-semibold tracking-eyebrow text-red-100/70 uppercase xl:text-base 2xl:text-lg">
              {eyebrow}
            </p>
            <h2 className="text-2xl leading-tight font-bold tracking-normal xl:text-3xl 2xl:text-4xl">
              {title}
            </h2>
          </div>
          <Link
            href={ctaHref as Route}
            className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold tracking-wider text-black uppercase transition-colors hover:bg-red-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Play className="h-4 w-4 fill-current" aria-hidden />
            {t("watch")}
          </Link>
        </div>
      </div>

      {isRail ? (
        <div className={cn("relative z-[3]", WATCH_PAGE_CONTENT_CLASSES)}>
          <div
            className={cn(
              "grid gap-5",
              "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
            )}
          >
            {section.cards.map((card, index) => (
              <WatchHomeCard
                key={`${section.id}-${card.id}-${index}`}
                card={card}
                index={index}
                orientation={cardOrientation}
                showSequenceNumber={section.showSequenceNumbers}
                onHoverImageChange={updateHoverBackground}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className={cn("relative z-[3]", WATCH_PAGE_CONTENT_CLASSES)}>
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
                onHoverImageChange={updateHoverBackground}
              />
            ))}
          </div>
        </div>
      )}

      {description ? (
        <div className={cn("relative z-[3]", WATCH_PAGE_CONTENT_CLASSES)}>
          <p className="mt-8 max-w-5xl text-lg leading-relaxed text-stone-200/80 xl:text-xl">
            {description}
          </p>
        </div>
      ) : null}
    </section>
  )
}
