"use client"

import Image from "next/image"
import type { CSSProperties } from "react"
import { useEffect, useRef, useState } from "react"
import type {
  FragmentOf,
  LegacyFragmentValue,
} from "@/lib/legacy-fragment-types"
import type { EnrichedMediaItem } from "@/lib/enrichment"
import { enrichMediaItem } from "@/lib/enrichment"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import type { RouteVideo } from "@/lib/content"
import { mediaCollectionFragment } from "@/lib/fragments/media-collection"
import {
  WATCH_BASE_PATH,
  asLocaleSlug,
  tryAsContentSlug,
  videosIndexPath,
  watchVideoPath,
} from "@/lib/routes"
import { WatchProgressBar } from "@/components/watch/WatchProgressBar"
import { resolveMediaImageUrl } from "@/lib/media-image-url"
import { cn } from "@/lib/utils"

// Collections carry no per-item language today, so card deep links default
// to the English variant and rely on the watch route to re-resolve locale.
// See todo: EnrichedMediaItem should carry a defaultLanguage (data-model gap).
// Hoisted so the throwing constructor runs once at module load, not per card.
const DEFAULT_COLLECTION_LOCALE = asLocaleSlug("english")

export { mediaCollectionFragment }

type MediaCollectionProps = {
  data: FragmentOf<typeof mediaCollectionFragment>
  routeVideo?: RouteVideo | null
}

type HoverBackdropLayer = {
  id: number
  imageUrl: string
  state: "entering" | "exiting"
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

export function MediaCollection({ data, routeVideo }: MediaCollectionProps) {
  const {
    id,
    title,
    subtitle,
    mediaDescription: description,
    categoryLabel,
    mediaCtaLink: ctaLink,
    mediaCtaLabel: rawCtaLabel,
    showItemNumbers,
    mediaCollectionVariant: variant,
    itemsSource,
    footerText: rawFooterText,
    items,
  } = data

  const ctaLabel = typeof rawCtaLabel === "string" ? rawCtaLabel : null
  const footerText = typeof rawFooterText === "string" ? rawFooterText : null
  const selectedSource = itemsSource ?? "manual"
  const enrichedItems =
    selectedSource === "routeVideoChildren"
      ? (routeVideo?.relatedItems ?? [])
      : (items ?? [])
          .filter(
            (i: LegacyFragmentValue): i is NonNullable<typeof i> => i != null,
          )
          .map(enrichMediaItem)

  if (
    process.env.NODE_ENV === "development" &&
    selectedSource === "routeVideoChildren" &&
    routeVideo == null
  ) {
    console.warn(
      "[MediaCollection] routeVideoChildren source requires routeVideo context.",
    )
  }

  if (enrichedItems.length === 0) return null

  return (
    <WatchHomeMediaCollection
      id={id}
      title={title}
      eyebrow={categoryLabel ?? subtitle}
      description={description}
      ctaLink={ctaLink}
      ctaLabel={ctaLabel}
      footerText={footerText}
      variant={variant}
      showItemNumbers={showItemNumbers}
      items={enrichedItems}
    />
  )
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      focusable="false"
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.493 1.607c.845-.395 1.799-.187 2.555.292l.03.02 11.017 8.111c.781.464 1.504 1.175 1.505 2.172.001.99-.715 1.734-1.496 2.246l-10.93 7.644-.046.025c-.788.437-1.762.706-2.63.242-.879-.47-1.193-1.442-1.25-2.387l-.001-.028L4.2 3.968c-.019-1.02.395-1.943 1.292-2.361Z"
      />
    </svg>
  )
}

function WatchHomeMediaCollection({
  id,
  title,
  eyebrow,
  description,
  ctaLink,
  ctaLabel,
  footerText,
  variant,
  showItemNumbers,
  items,
}: {
  id: string
  title: string | null
  eyebrow: string | null
  description: string | null
  ctaLink: string | null
  ctaLabel: string | null
  footerText: string | null
  variant: string | null
  showItemNumbers: boolean | null
  items: EnrichedMediaItem[]
}) {
  const isRail = variant === "carousel"
  const isVerticalGrid = variant === "collection"
  const isVertical = isRail || isVerticalGrid
  const defaultBackgroundUrl =
    items.find((item) => resolveMediaImageUrl(item.imageUrl))?.imageUrl ?? null
  const latestHoveredBackgroundUrlRef = useRef<string | null>(null)
  const hoverLayerIdRef = useRef(0)
  const [isSectionActive, setIsSectionActive] = useState(false)
  const [settledBackgroundUrl, setSettledBackgroundUrl] = useState<
    string | null
  >(defaultBackgroundUrl)
  const [hoverBackdropLayers, setHoverBackdropLayers] = useState<
    HoverBackdropLayer[]
  >([])
  const watchHref = ctaLink ?? `${WATCH_BASE_PATH}${videosIndexPath()}`

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
      id={id}
      data-testid="media-collection-section"
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
        "scroll-mt-24 relative overflow-hidden py-16 text-white",
        isRail
          ? "bg-[linear-gradient(to_top_right,rgba(23,37,84,0.22),rgba(88,28,135,0.2),rgba(145,33,74,0.94))]"
          : "bg-[#050505]",
      )}
    >
      {settledBackgroundUrl ? (
        <div
          data-testid="media-collection-default-backdrop"
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
          key={`media-collection-hover-backdrop-${layer.id}`}
          data-testid={
            layer.state === "entering"
              ? "media-collection-hover-backdrop"
              : "media-collection-hover-backdrop-previous"
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
          style={backdropLayerStyle(layer.imageUrl, "1")}
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
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-4xl flex-col gap-1">
            {eyebrow && (
              <p className="text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base 2xl:text-lg">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="text-2xl leading-tight font-bold tracking-normal text-white xl:text-3xl 2xl:text-4xl">
                {title}
              </h2>
            )}
          </div>
          <a
            href={watchHref}
            className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold tracking-wider text-black uppercase transition-colors hover:bg-red-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <PlayIcon />
            {ctaLabel ?? "Watch"}
          </a>
        </div>
      </div>

      <div className={cn("relative z-[3]", WATCH_PAGE_CONTENT_CLASSES)}>
        <div
          className={cn(
            "grid",
            isVerticalGrid ? "gap-4" : "gap-5",
            isRail
              ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
              : isVerticalGrid
                ? "grid-cols-2 md:grid-cols-4 xl:grid-cols-4"
                : variant === "hero" || variant === "player"
                  ? "grid-cols-1 md:grid-cols-2"
                  : "grid-cols-1 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
          )}
        >
          {items.map((item: EnrichedMediaItem, index: number) => (
            <VideoCard
              key={`${item.id}-${index}`}
              item={item}
              index={index}
              orientation={isVertical ? "vertical" : "horizontal"}
              showItemNumbers={showItemNumbers}
              onHover={() => updateHoverBackground(item.imageUrl)}
            />
          ))}
        </div>
      </div>

      {description || footerText ? (
        <div className={cn("relative z-[3]", WATCH_PAGE_CONTENT_CLASSES)}>
          <div className="mt-8 max-w-5xl space-y-4 text-lg leading-relaxed text-stone-200/80 xl:text-xl">
            {description ? <p>{description}</p> : null}
            {footerText ? <p>{footerText}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function VideoCard({
  item,
  index,
  orientation,
  showItemNumbers,
  onHover,
}: {
  item: EnrichedMediaItem
  index: number
  orientation: "horizontal" | "vertical"
  showItemNumbers: boolean | null
  onHover?: () => void
}) {
  // Raw <a href> (not next/link), so the `/watch` basePath must be prefixed
  // manually. EnrichedMediaItem carries no language field, so the locale
  // segment defaults to `english` (see DEFAULT_COLLECTION_LOCALE).
  const slug = item.videoSlug ? tryAsContentSlug(item.videoSlug) : null
  const href = slug
    ? `${WATCH_BASE_PATH}${watchVideoPath(slug, DEFAULT_COLLECTION_LOCALE)}`
    : undefined
  const Wrapper = href ? "a" : "div"
  const imageSrc = resolveMediaImageUrl(item.imageUrl)
  const isVertical = orientation === "vertical"

  return (
    <Wrapper
      href={href}
      className={`group relative block overflow-hidden rounded-lg bg-black text-inherit no-underline shadow-[0_2px_6px_rgba(0,0,0,0.35),0_14px_32px_-12px_rgba(0,0,0,0.6)] transition-[opacity,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:shadow-[0_4px_10px_rgba(0,0,0,0.4),0_22px_44px_-14px_rgba(0,0,0,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 ${
        href ? "cursor-pointer" : "cursor-default"
      }`}
      aria-label="VideoCard"
      onPointerEnter={onHover}
      onFocus={onHover}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-lg bg-black/50",
          isVertical ? "aspect-[2/3]" : "aspect-video",
        )}
      >
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={item.title}
            fill
            unoptimized
            sizes={
              isVertical
                ? "(max-width: 768px) 46vw, 220px"
                : "(max-width: 768px) 100vw, 360px"
            }
            className="poster-hover-zoom object-cover"
            style={{
              objectPosition: isVertical ? "center" : "left top",
              maskImage:
                "linear-gradient(to top, transparent 0%, rgba(0,0,0,.4) 30%, black 42%)",
              WebkitMaskImage:
                "linear-gradient(to top, transparent 0%, rgba(0,0,0,.4) 30%, black 42%)",
            }}
          />
        ) : (
          <div
            aria-hidden
            className="h-full w-full bg-[linear-gradient(135deg,#111827,#4c1d1d_52%,#064e3b)]"
          />
        )}
        <div className="absolute inset-0 rounded-lg bg-gradient-to-t from-black/78 via-black/18 to-transparent" />
        {showItemNumbers ? (
          <span className="absolute top-2 left-2 z-10 text-5xl leading-none font-bold text-stone-100/90 [text-shadow:0_2px_8px_rgba(0,0,0,0.7)]">
            {index + 1}
          </span>
        ) : null}
        <WatchProgressBar videoId={item.id} />
        {item.collectionSize ? (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded bg-black/35 px-2 py-1 text-sm font-semibold text-white backdrop-blur-sm">
            {item.collectionSize}
          </div>
        ) : null}
        <div
          aria-hidden
          data-testid="media-collection-card-bevel"
          className="pointer-events-none absolute inset-0 z-40 rounded-lg opacity-40 mix-blend-soft-light shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7)]"
        />
        <div
          aria-hidden
          data-testid="media-collection-card-hover-outline"
          className={cn(
            "watch-home-gradient-outline pointer-events-none absolute z-50 opacity-0 shadow-[0_-4px_22px_rgba(239,68,68,0.26)] transition-opacity duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:opacity-100 group-focus-visible:opacity-100",
            isVertical
              ? "watch-home-gradient-outline-portrait"
              : "watch-home-gradient-outline-landscape",
          )}
        />
        <div className="absolute inset-0 flex flex-col justify-end px-4 pt-4 pb-5">
          {item.label ? (
            <div className="truncate text-xs leading-8 font-semibold tracking-wider text-stone-300/70 uppercase mix-blend-screen">
              {formatLabel(item.label)}
            </div>
          ) : null}
          <h3
            className={cn(
              "line-clamp-2 -mt-1 text-left leading-tight font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]",
              isVertical ? "text-xl" : "text-lg md:text-xl",
            )}
          >
            {item.title}
          </h3>
        </div>
      </div>
    </Wrapper>
  )
}

function formatLabel(label: string): string {
  return label.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim()
}
