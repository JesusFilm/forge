import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { Play } from "lucide-react"
import { WatchProgressBar } from "@/components/watch/WatchProgressBar"
import { cn } from "@/lib/utils"
import type { WatchHomeCard as WatchHomeCardModel } from "@/lib/watch-home"

type WatchHomeCardProps = {
  card: WatchHomeCardModel
  index?: number
  orientation?: "horizontal" | "vertical"
  showSequenceNumber?: boolean
  onHoverImageChange?: (imageUrl: string | null) => void
  className?: string
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
  const isVertical = orientation === "vertical"
  const isCollectionCard = card.label === "Collection" || card.childCount > 0
  const showMetaLabel = Boolean(card.metaLabel && !isCollectionCard)
  const frameClassName = cn(
    "group relative block overflow-hidden rounded-lg bg-black text-inherit no-underline shadow-[0_2px_6px_rgba(0,0,0,0.35),0_14px_32px_-12px_rgba(0,0,0,0.6)] transition-[opacity,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:shadow-[0_4px_10px_rgba(0,0,0,0.4),0_22px_44px_-14px_rgba(0,0,0,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80",
    className,
  )

  return (
    <CardFrame
      card={card}
      className={frameClassName}
      onPointerEnter={() => onHoverImageChange?.(card.imageUrl)}
      onFocus={() => onHoverImageChange?.(card.imageUrl)}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-lg bg-black/50",
          isVertical ? "aspect-[2/3]" : "aspect-video",
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
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded bg-black/35 px-2 py-1 text-sm font-semibold text-white backdrop-blur-sm">
            {card.href ? (
              <Play className="h-4 w-4 fill-current" aria-hidden />
            ) : null}
            {card.metaLabel}
          </div>
        ) : null}
        <div
          aria-hidden
          data-testid="watch-home-card-bevel"
          className="pointer-events-none absolute inset-0 z-40 rounded-lg opacity-40 mix-blend-soft-light shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7)]"
        />
        <div
          aria-hidden
          data-testid="watch-home-card-hover-outline"
          className={cn(
            "watch-home-gradient-outline pointer-events-none absolute z-50 opacity-0 shadow-[0_-4px_22px_rgba(239,68,68,0.26)] transition-opacity duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:opacity-100 group-focus-visible:opacity-100",
            isVertical
              ? "watch-home-gradient-outline-portrait"
              : "watch-home-gradient-outline-landscape",
          )}
        />
        <div
          data-testid="watch-home-card-text-gradient"
          className="absolute inset-x-0 bottom-0 flex flex-col justify-end bg-gradient-to-t from-black/78 via-black/44 to-transparent px-4 pt-10 pb-5"
        >
          <div className="truncate text-xs leading-8 font-semibold tracking-wider text-stone-300/70 uppercase mix-blend-screen">
            {card.label}
          </div>
          <h3 className="line-clamp-2 -mt-1 text-left text-xl leading-tight font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]">
            {card.title}
          </h3>
        </div>
      </div>
    </CardFrame>
  )
}
