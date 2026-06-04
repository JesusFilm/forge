import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { Play } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WatchHomeCard as WatchHomeCardModel } from "@/lib/watch-home"

type WatchHomeCardProps = {
  card: WatchHomeCardModel
  index?: number
  orientation?: "horizontal" | "vertical"
  showSequenceNumber?: boolean
  className?: string
}

function CardFrame({
  card,
  className,
  children,
}: {
  card: WatchHomeCardModel
  className: string
  children: React.ReactNode
}) {
  if (!card.href) {
    return (
      <div aria-label={card.title} className={className}>
        {children}
      </div>
    )
  }

  return (
    <Link
      href={card.href as Route}
      aria-label={card.title}
      className={className}
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
  className,
}: WatchHomeCardProps) {
  const isVertical = orientation === "vertical"
  const frameClassName = cn(
    "beveled group relative block overflow-hidden rounded-lg bg-black text-inherit no-underline shadow-xl shadow-stone-950/70 transition duration-300 hover:scale-[1.02] focus-visible:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
    className,
  )

  return (
    <CardFrame card={card} className={frameClassName}>
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
        {card.metaLabel ? (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded bg-black/35 px-2 py-1 text-sm font-semibold text-white backdrop-blur-sm">
            {card.childCount === 0 && card.href ? (
              <Play className="h-4 w-4 fill-current" aria-hidden />
            ) : null}
            {card.metaLabel}
          </div>
        ) : null}
        {card.href ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-stone-900/60 text-white opacity-0 transition duration-200 group-hover:bg-red-500 group-hover:opacity-100">
              <Play className="h-10 w-10 fill-current" aria-hidden />
            </div>
          </div>
        ) : null}
        <div className="absolute inset-0 rounded-lg opacity-15 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] transition-opacity duration-300 group-hover:opacity-50" />
        <div className="absolute inset-0 flex flex-col justify-end p-4">
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
