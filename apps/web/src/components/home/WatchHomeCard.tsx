import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import type { CSSProperties } from "react"
import { useTranslations } from "next-intl"
import { Play } from "lucide-react"
import {
  VideoThumbnailCaption,
  VideoThumbnailEyebrow,
  VideoThumbnailTitle,
} from "@/components/ui/video-thumbnail-caption"
import {
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "@/components/ui/video-thumbnail-interaction-frame"
import { WatchProgressBar } from "@/components/watch/WatchProgressBar"
import { readableScrimRgb } from "@/lib/readable-scrim-color"
import { cn } from "@/lib/utils"
import type { WatchHomeCard as WatchHomeCardModel } from "@/lib/watch-home"
import { videoLabelMessageKey } from "@/lib/video-labels"

type WatchHomeCardProps = {
  card: WatchHomeCardModel
  index?: number
  orientation?: "horizontal" | "vertical"
  showSequenceNumber?: boolean
  onHoverImageChange?: (imageUrl: string | null) => void
  className?: string
}

function textScrimStyle(card: WatchHomeCardModel): CSSProperties {
  const rgb = readableScrimRgb(card.dominantColor)
  if (!rgb) {
    return {
      background:
        "linear-gradient(to top, rgba(0,0,0,.78), rgba(0,0,0,.44), transparent)",
    }
  }

  return {
    background: `linear-gradient(to top, rgb(${rgb.r},${rgb.g},${rgb.b}), rgba(${rgb.r},${rgb.g},${rgb.b},.86) 24%, rgba(${rgb.r},${rgb.g},${rgb.b},.28) 42%, transparent 62%)`,
  }
}

function CardFrame({
  card,
  className,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  children,
}: {
  card: WatchHomeCardModel
  className: string
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onFocus?: () => void
  onBlur?: () => void
  children: React.ReactNode
}) {
  if (!card.href) {
    return (
      <div
        aria-label={card.title}
        className={className}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        {children}
      </div>
    )
  }

  return (
    <Link
      href={card.href as Route}
      aria-label={card.title}
      className={className}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {children}
    </Link>
  )
}

export function WatchHomeCard({
  card,
  index = 0,
  orientation = "horizontal",
  showSequenceNumber = false,
  onHoverImageChange,
  className,
}: WatchHomeCardProps) {
  const videoLabels = useTranslations("VideoLabels")
  const isVertical = orientation === "vertical"
  const isCollectionCard = card.label === "Collection" || card.childCount > 0
  const isInteractive = Boolean(card.href)
  const showMetaLabel = Boolean(card.metaLabel && !isCollectionCard)
  const metaLabel =
    card.metaLabel === card.label
      ? videoLabels(videoLabelMessageKey(card.label))
      : card.metaLabel
  const blurDataUrl = card.blurDataUrl ?? undefined
  const frameClassName = cn(
    "relative block overflow-hidden rounded-lg bg-black text-inherit no-underline shadow-[0_2px_6px_rgba(0,0,0,0.35),0_14px_32px_-12px_rgba(0,0,0,0.6)] transition-[opacity,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
    isInteractive &&
      "group hover:shadow-[0_4px_10px_rgba(0,0,0,0.4),0_22px_44px_-14px_rgba(0,0,0,0.7)]",
    isInteractive && VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
    className,
  )

  return (
    <CardFrame
      card={card}
      className={frameClassName}
      onPointerEnter={
        isInteractive ? () => onHoverImageChange?.(card.imageUrl) : undefined
      }
      onFocus={
        isInteractive ? () => onHoverImageChange?.(card.imageUrl) : undefined
      }
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-lg bg-black/50",
          isVertical
            ? "aspect-[2/3] min-h-[13rem] sm:min-h-[16rem]"
            : "aspect-video min-h-[10rem]",
        )}
      >
        {card.imageUrl ? (
          <Image
            src={card.imageUrl}
            alt={card.imageAlt}
            fill
            sizes={
              isVertical
                ? "(max-width: 768px) 46vw, 220px"
                : "(max-width: 768px) 100vw, 360px"
            }
            placeholder={blurDataUrl ? "blur" : "empty"}
            blurDataURL={blurDataUrl}
            className="poster-hover-zoom object-cover"
            style={{ objectPosition: "left top" }}
          />
        ) : (
          <div
            aria-hidden
            className="h-full w-full bg-[linear-gradient(135deg,#111827,#4c1d1d_52%,#064e3b)]"
          />
        )}
        {showSequenceNumber ? (
          <span className="absolute top-2 left-2 z-10 text-5xl leading-none font-bold text-stone-100/90 [text-shadow:0_2px_8px_rgba(0,0,0,0.7)]">
            {index + 1}
          </span>
        ) : null}
        <WatchProgressBar videoId={card.id} />
        {showMetaLabel ? (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded bg-black/35 px-2 py-1 text-base sm:text-sm font-semibold text-white backdrop-blur-sm">
            {card.href ? (
              <Play className="h-4 w-4 fill-current" aria-hidden />
            ) : null}
            {metaLabel}
          </div>
        ) : null}
        <div
          aria-hidden
          data-testid="watch-home-card-bevel"
          className="pointer-events-none absolute inset-0 z-40 rounded-lg opacity-40 mix-blend-soft-light shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7)]"
        />
        {isInteractive ? (
          <VideoThumbnailInteractionFrame
            data-testid="watch-home-card-hover-outline"
            className="duration-350 ease-[cubic-bezier(0.22,1,0.36,1)]"
          />
        ) : null}
        <VideoThumbnailCaption
          data-testid="watch-home-card-text-gradient"
          className="z-30"
          style={textScrimStyle(card)}
        >
          <VideoThumbnailEyebrow as="div">
            {videoLabels(videoLabelMessageKey(card.label))}
          </VideoThumbnailEyebrow>
          <VideoThumbnailTitle size="large">{card.title}</VideoThumbnailTitle>
        </VideoThumbnailCaption>
      </div>
    </CardFrame>
  )
}
