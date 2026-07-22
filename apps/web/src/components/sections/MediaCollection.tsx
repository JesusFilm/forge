"use client"

import Image from "next/image"
import type { CSSProperties } from "react"
import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import type { FragmentOf } from "@/lib/legacy-fragment-types"
import type { EnrichedMediaItem } from "@/lib/enrichment"
import { enrichMediaItem } from "@/lib/enrichment"
import {
  CONTENT_WIDTH_ALIGN_CLASSES,
  WATCH_PAGE_CONTENT_CLASSES,
} from "@/lib/content-width"
import type { RouteVideo } from "@/lib/content"
import { mediaCollectionFragment } from "@/lib/fragments/media-collection"
import { MuxHoverPreview } from "@/components/watch/MuxHoverPreview"
import {
  WATCH_BASE_PATH,
  asLocaleSlug,
  tryAsContentSlug,
  tryAsLocaleSlug,
  videosIndexPath,
  watchVideoPath,
} from "@/lib/routes"
import { WatchProgressBar } from "@/components/watch/WatchProgressBar"
import { resolveMediaImageUrl } from "@/lib/media-image-url"
import { hexToRgb, readableScrimRgb } from "@/lib/readable-scrim-color"
import { resolveMuxAnimatedPreviewUrl } from "@/lib/url"
import { cn } from "@/lib/utils"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import {
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "@/components/ui/video-thumbnail-interaction-frame"
import {
  VideoThumbnailCaption,
  VideoThumbnailEyebrow,
  VideoThumbnailTitle,
} from "@/components/ui/video-thumbnail-caption"

// Hoisted so the throwing constructor runs once at module load, not per card.
const DEFAULT_COLLECTION_LOCALE = asLocaleSlug("english")

export { mediaCollectionFragment }

type MediaCollectionProps = {
  data: FragmentOf<typeof mediaCollectionFragment>
  routeVideo?: RouteVideo | null
  languageSlug?: string | null
}

type HoverBackdropLayer = {
  id: number
  imageUrl: string
  state: "entering" | "exiting"
}

const MEDIA_COLLECTION_TINTS: Record<string, string> = {
  default: "#050505",
  dark: "#050505",
  primary: "#172554",
  cosmic: "#312e81",
  purple: "#91214A",
  red: "#7f1d1d",
  rose: "#9f1239",
  blue: "#1e3a8a",
  teal: "#134e4a",
  green: "#14532d",
  amber: "#92400e",
}

function backgroundImageStyle(imageUrl: string | null) {
  return imageUrl ? { backgroundImage: `url("${imageUrl}")` } : undefined
}

function normalizeTintColor(value: unknown): string | null {
  if (typeof value !== "string") return null

  const trimmed = value.trim()
  if (!trimmed) return null

  return MEDIA_COLLECTION_TINTS[trimmed] ?? trimmed
}

function alphaColor(color: string, opacity: number): string {
  const rgb = hexToRgb(color)
  if (!rgb) return color

  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`
}

function textScrimStyle(
  item: EnrichedMediaItem,
  orientation: "horizontal" | "vertical",
): CSSProperties {
  const rgb = readableScrimRgb(item.dominantColor)
  if (!rgb) {
    return {
      background:
        "linear-gradient(to top, rgba(0,0,0,.78), rgba(0,0,0,.18), transparent)",
    }
  }

  if (orientation === "vertical") {
    return {
      background: `linear-gradient(to top, rgb(${rgb.r},${rgb.g},${rgb.b}), rgba(${rgb.r},${rgb.g},${rgb.b},.78) 36%, rgba(${rgb.r},${rgb.g},${rgb.b},.22) 68%, transparent 100%)`,
    }
  }

  return {
    background: `linear-gradient(to top, rgb(${rgb.r},${rgb.g},${rgb.b}), rgba(${rgb.r},${rgb.g},${rgb.b},.86) 24%, rgba(${rgb.r},${rgb.g},${rgb.b},.28) 42%, transparent 62%)`,
  }
}

function tintOverlayStyle(
  backgroundColor: string | null,
  isRail: boolean,
): CSSProperties | undefined {
  if (!backgroundColor) return undefined

  const strong = alphaColor(backgroundColor, isRail ? 0.92 : 0.86)
  const soft = alphaColor(backgroundColor, isRail ? 0.38 : 0.34)
  const deep = alphaColor("#050505", isRail ? 0.62 : 0.76)

  return {
    background: `linear-gradient(to top right, ${deep}, ${soft} 42%, ${strong})`,
  }
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

export function MediaCollection({
  data,
  routeVideo,
  languageSlug,
}: MediaCollectionProps) {
  const {
    id,
    title,
    subtitle,
    mediaDescription: description,
    backgroundColor,
    categoryLabel,
    mediaCtaLink: ctaLink,
    mediaCtaLabel: rawCtaLabel,
    mediaDefaultCollectionSlug,
    showItemNumbers,
    mediaCollectionVariant: variant,
    itemsSource,
    footerText: rawFooterText,
    items,
  } = data

  const ctaLabel = typeof rawCtaLabel === "string" ? rawCtaLabel : null
  const footerText = typeof rawFooterText === "string" ? rawFooterText : null
  const selectedSource = itemsSource ?? "manual"
  const rawEnrichedItems: Array<EnrichedMediaItem | null | undefined> =
    selectedSource === "routeVideoChildren"
      ? (routeVideo?.relatedItems ?? [])
      : (items ?? []).map(enrichMediaItem)
  const enrichedItems = rawEnrichedItems.filter(
    (item): item is EnrichedMediaItem => item != null,
  )
  const resolvedLanguageSlug =
    tryAsLocaleSlug(languageSlug ?? "") ?? DEFAULT_COLLECTION_LOCALE
  const inferredCollectionSlug =
    selectedSource === "routeVideoChildren"
      ? tryAsContentSlug(routeVideo?.slug ?? "")
      : tryAsContentSlug(mediaDefaultCollectionSlug ?? "")
  const inferredCtaLink = inferredCollectionSlug
    ? `${WATCH_BASE_PATH}${watchVideoPath(inferredCollectionSlug, resolvedLanguageSlug)}`
    : null
  const explicitCtaLink =
    typeof ctaLink === "string" && ctaLink.trim().length > 0 ? ctaLink : null

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
      categoryLabel={categoryLabel}
      title={title}
      subtitle={subtitle}
      description={description}
      ctaLink={explicitCtaLink ?? inferredCtaLink}
      ctaLabel={ctaLabel}
      footerText={footerText}
      variant={variant}
      backgroundColor={normalizeTintColor(backgroundColor)}
      showItemNumbers={showItemNumbers}
      items={enrichedItems}
      fallbackLanguageSlug={resolvedLanguageSlug}
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
  categoryLabel,
  title,
  subtitle,
  description,
  ctaLink,
  ctaLabel,
  footerText,
  variant,
  backgroundColor,
  showItemNumbers,
  items,
  fallbackLanguageSlug,
}: {
  id: string
  categoryLabel: string | null
  title: string | null
  subtitle: string | null
  description: string | null
  ctaLink: string | null
  ctaLabel: string | null
  footerText: string | null
  variant: string | null
  backgroundColor: string | null
  showItemNumbers: boolean | null
  items: EnrichedMediaItem[]
  fallbackLanguageSlug: ReturnType<typeof asLocaleSlug>
}) {
  const t = useTranslations("WatchHome")
  const isRail = variant === "carousel"
  const isVerticalGrid = variant === "collection"
  const isVertical = isRail || isVerticalGrid
  const defaultBackgroundUrl =
    items.map(mediaItemBackdropImageUrl).find((imageUrl) => imageUrl) ?? null
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
  const sectionBackgroundColor =
    backgroundColor ?? (isRail ? "#5b1537" : "#050505")
  const tintStyle = tintOverlayStyle(backgroundColor, isRail)
  const titleRowStart = categoryLabel ? "row-start-2" : "row-start-1"
  const watchCta = (
    <a
      href={watchHref}
      data-testid="media-collection-cta"
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold tracking-wider text-black uppercase transition-colors hover:bg-red-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
        title && `col-start-2 ${titleRowStart}`,
      )}
    >
      <PlayIcon />
      {ctaLabel ?? t("watch")}
    </a>
  )
  const categoryEyebrow = categoryLabel ? (
    <p className="text-xs font-semibold tracking-widest text-red-100/60 uppercase xl:text-sm 2xl:text-base">
      {categoryLabel}
    </p>
  ) : null
  const supportingCopy = (
    <>
      {subtitle ? (
        <p
          data-testid="media-collection-supporting-title"
          className={cn(
            "w-full text-lg leading-snug font-normal text-stone-100/90 xl:text-xl",
            title && "pt-1",
          )}
        >
          {subtitle}
        </p>
      ) : null}
      {description ? (
        <p
          data-testid="media-collection-description"
          className="w-full pt-2 text-sm leading-relaxed font-normal text-stone-200/80 xl:text-base"
        >
          {description}
        </p>
      ) : null}
    </>
  )

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
        !backgroundColor &&
          (isRail
            ? "bg-[linear-gradient(to_top_right,rgba(23,37,84,0.22),rgba(88,28,135,0.2),rgba(145,33,74,0.94))]"
            : "bg-[#050505]"),
      )}
      style={{ backgroundColor: sectionBackgroundColor }}
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
          !backgroundColor && isRail
            ? "bg-[linear-gradient(to_top_right,rgba(23,37,84,0.38),rgba(88,28,135,0.34),rgba(145,33,74,0.88))] mix-blend-multiply"
            : !backgroundColor
              ? "bg-[linear-gradient(to_top_right,rgba(88,28,135,0.42),rgba(190,24,93,0.34)_38%,rgba(12,10,9,0.9))]"
              : "mix-blend-multiply",
        )}
        style={tintStyle}
      />
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 z-[1] bg-[url(/watch/images/overlay.svg)] bg-repeat mix-blend-multiply transition-opacity duration-500 ease-out",
          isSectionActive ? "opacity-0" : isRail ? "opacity-85" : "opacity-65",
        )}
      />

      <div className={cn("relative z-[3] pb-6", WATCH_PAGE_CONTENT_CLASSES)}>
        <div className="flex flex-col gap-1">
          {title ? (
            <>
              <div
                data-testid="media-collection-title-row"
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1"
              >
                {categoryEyebrow}
                <h2
                  className={cn(
                    "col-start-1 max-w-4xl text-2xl leading-tight font-bold tracking-normal text-white xl:text-3xl 2xl:text-4xl",
                    titleRowStart,
                  )}
                >
                  {title}
                </h2>
                {watchCta}
              </div>
              {supportingCopy}
            </>
          ) : (
            <>
              {categoryEyebrow}
              <div
                data-testid="media-collection-titleless-layout"
                className="flex flex-col gap-6 lg:items-end"
              >
                <div
                  data-testid="media-collection-titleless-supporting-copy"
                  className="flex w-full flex-col gap-1"
                >
                  {supportingCopy}
                </div>
                {watchCta}
              </div>
            </>
          )}
        </div>
      </div>

      {isRail ? (
        <div className={cn("relative z-[3]", CONTENT_WIDTH_ALIGN_CLASSES)}>
          <Carousel
            aria-label={title ?? t("mediaCollection")}
            data-testid="media-collection-carousel"
            opts={{
              align: "start",
              dragFree: true,
              containScroll: "trimSnaps",
              watchDrag: (api) => api.scrollSnapList().length > 1,
            }}
            className="w-full"
          >
            <CarouselContent
              data-testid="media-collection-carousel-content"
              className="-ml-5 pl-5 md:pl-16 xl:pl-24"
            >
              {items.map((item: EnrichedMediaItem, index: number) => (
                <CarouselItem
                  key={`${item.id}-${index}`}
                  data-testid="media-collection-carousel-item"
                  className="max-w-[200px] py-1 pl-5"
                >
                  <VideoCard
                    item={item}
                    index={index}
                    orientation="vertical"
                    showItemNumbers={showItemNumbers}
                    fallbackLanguageSlug={fallbackLanguageSlug}
                    onHover={() =>
                      updateHoverBackground(mediaItemBackdropImageUrl(item))
                    }
                  />
                </CarouselItem>
              ))}
              <CarouselItem
                aria-hidden="true"
                tabIndex={-1}
                data-testid="media-collection-carousel-end-spacer"
                className="basis-auto pl-0"
              >
                <div className="w-5 md:w-16 xl:w-24" />
              </CarouselItem>
            </CarouselContent>
          </Carousel>
        </div>
      ) : (
        <div className={cn("relative z-[3]", WATCH_PAGE_CONTENT_CLASSES)}>
          <div
            data-testid="media-collection-grid"
            className={cn(
              "grid",
              isVerticalGrid ? "gap-4" : "gap-5",
              isVerticalGrid
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
                fallbackLanguageSlug={fallbackLanguageSlug}
                onHover={() =>
                  updateHoverBackground(mediaItemBackdropImageUrl(item))
                }
              />
            ))}
          </div>
        </div>
      )}

      {footerText ? (
        <div className={cn("relative z-[3]", WATCH_PAGE_CONTENT_CLASSES)}>
          <p
            data-testid="media-collection-footer"
            className="mt-8 max-w-5xl text-xs leading-relaxed font-normal text-stone-200/80 xl:text-sm"
          >
            {footerText}
          </p>
        </div>
      ) : null}
    </section>
  )
}

function mediaItemDisplayImageUrl(item: EnrichedMediaItem) {
  return item.imageUrl
}

function mediaItemBackdropImageUrl(item: EnrichedMediaItem) {
  return item.blurDataUrl ?? item.imageUrl
}

function VideoCard({
  item,
  index,
  orientation,
  showItemNumbers,
  fallbackLanguageSlug,
  onHover,
}: {
  item: EnrichedMediaItem
  index: number
  orientation: "horizontal" | "vertical"
  showItemNumbers: boolean | null
  fallbackLanguageSlug: ReturnType<typeof asLocaleSlug>
  onHover?: () => void
}) {
  const t = useTranslations("WatchHome")
  // Raw <a href> (not next/link), so the `/watch` basePath must be prefixed
  // manually. Prefer the resolved item dub language; fall back to the current
  // page language for route-derived items or legacy payloads.
  const slug = item.videoSlug ? tryAsContentSlug(item.videoSlug) : null
  const itemLanguageSlug = tryAsLocaleSlug(item.languageSlug ?? "")
  const cardLanguageSlug =
    itemLanguageSlug ?? fallbackLanguageSlug ?? DEFAULT_COLLECTION_LOCALE
  const href = slug
    ? `${WATCH_BASE_PATH}${watchVideoPath(slug, cardLanguageSlug)}`
    : undefined
  const isInteractive = Boolean(href)
  const Wrapper = href ? "a" : "div"
  const imageSrc = resolveMediaImageUrl(mediaItemDisplayImageUrl(item))
  const blurDataUrl = item.blurDataUrl ?? undefined
  const muxPreviewUrl = resolveMuxAnimatedPreviewUrl(item.muxPlaybackId)
  const isVertical = orientation === "vertical"
  const [isMuxPreviewLoaded, setIsMuxPreviewLoaded] = useState(false)
  const accessibleTitle =
    item.title || [item.label, item.videoSlug].filter(Boolean).join(" ")

  return (
    <Wrapper
      href={href}
      className={cn(
        "relative block overflow-hidden rounded-lg bg-black text-inherit no-underline shadow-[0_2px_6px_rgba(0,0,0,0.35),0_14px_32px_-12px_rgba(0,0,0,0.6)] transition-[opacity,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
        isInteractive
          ? "group cursor-pointer hover:shadow-[0_4px_10px_rgba(0,0,0,0.4),0_22px_44px_-14px_rgba(0,0,0,0.7)]"
          : "cursor-default",
        isInteractive && VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
      )}
      aria-label={
        isInteractive ? t("showVideo", { title: accessibleTitle }) : undefined
      }
      data-testid="VideoCard"
      onPointerEnter={isInteractive ? onHover : undefined}
      onFocus={isInteractive ? onHover : undefined}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-lg bg-black/50",
          isVertical
            ? "aspect-[2/3] min-h-[13rem] sm:min-h-[16rem]"
            : "aspect-video min-h-[10rem]",
        )}
      >
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={item.title}
            fill
            sizes={
              isVertical
                ? "(max-width: 768px) 46vw, 220px"
                : "(max-width: 768px) 100vw, 360px"
            }
            placeholder={blurDataUrl ? "blur" : "empty"}
            blurDataURL={blurDataUrl}
            className="poster-hover-zoom object-cover"
            style={
              isVertical || item.dominantColor
                ? { objectPosition: isVertical ? "center" : "left top" }
                : {
                    objectPosition: "left top",
                    maskImage:
                      "linear-gradient(to top, transparent 0%, rgba(0,0,0,.4) 30%, black 42%)",
                    WebkitMaskImage:
                      "linear-gradient(to top, transparent 0%, rgba(0,0,0,.4) 30%, black 42%)",
                  }
            }
          />
        ) : (
          <div
            aria-hidden
            className="h-full w-full bg-[linear-gradient(135deg,#111827,#4c1d1d_52%,#064e3b)]"
          />
        )}
        <MuxHoverPreview
          previewUrl={muxPreviewUrl}
          sizes={
            isVertical
              ? "(max-width: 768px) 46vw, 220px"
              : "(max-width: 768px) 100vw, 360px"
          }
          imageClassName={isVertical ? undefined : "object-left-top"}
          onPreviewLoadedChange={setIsMuxPreviewLoaded}
        />
        <div
          aria-hidden
          data-testid="media-collection-card-text-scrim"
          className={cn(
            "pointer-events-none absolute z-20 rounded-lg opacity-100 transition-opacity duration-300 ease-out",
            isMuxPreviewLoaded &&
              "group-hover:opacity-65 group-focus-visible:opacity-65 group-focus-within:opacity-65",
            isVertical ? "inset-x-0 bottom-0 h-[40%]" : "inset-0",
          )}
          style={textScrimStyle(item, orientation)}
        />
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
        {isInteractive ? (
          <VideoThumbnailInteractionFrame
            data-testid="media-collection-card-hover-outline"
            className="duration-350 ease-[cubic-bezier(0.22,1,0.36,1)]"
          />
        ) : null}
        <VideoThumbnailCaption className="z-30">
          {item.label ? (
            <VideoThumbnailEyebrow as="div">
              {formatLabel(item.label)}
            </VideoThumbnailEyebrow>
          ) : null}
          {item.title ? (
            <VideoThumbnailTitle size={isVertical ? "large" : "prominent"}>
              {item.title}
            </VideoThumbnailTitle>
          ) : null}
        </VideoThumbnailCaption>
      </div>
    </Wrapper>
  )
}

function formatLabel(label: string): string {
  return label.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim()
}
