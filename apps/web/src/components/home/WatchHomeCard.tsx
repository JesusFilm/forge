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
  const frameClassName = cn(
    "beveled group relative block overflow-hidden rounded-lg bg-black text-inherit no-underline shadow-xl shadow-stone-950/70 transition duration-300 hover:scale-[1.02] focus-visible:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
    className,
  )

  return (
    <CardFrame
      card={card}
      className={frameClassName}
      onPointerEnter={() => onHoverImageChange?.(card.imageUrl)}
      onPointerLeave={() => onHoverImageChange?.(null)}
      onFocus={() => onHoverImageChange?.(card.imageUrl)}
      onBlur={() => onHoverImageChange?.(null)}
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
            style={{
              objectPosition: "left top",
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
        {showSequenceNumber ? (
          <span className="absolute top-2 left-2 z-10 text-5xl leading-none font-bold text-stone-100/90 [text-shadow:0_2px_8px_rgba(0,0,0,0.7)]">
            {index + 1}
          </span>
        ) : null}
        <WatchProgressBar videoId={card.id} />
        {card.metaLabel ? (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded bg-black/35 px-2 py-1 text-sm font-semibold text-white backdrop-blur-sm">
            {card.childCount === 0 && card.href ? (
              <Play className="h-4 w-4 fill-current" aria-hidden />
            ) : null}
            {card.metaLabel}
          </div>
        ) : null}
        <div className="absolute inset-0 rounded-lg opacity-15 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] transition-opacity duration-300 group-hover:opacity-50" />
        <div className="absolute inset-0 flex flex-col justify-end px-4 pt-4 pb-5">
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
