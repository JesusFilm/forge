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
    "group relative block overflow-hidden rounded-lg border border-white/10 bg-stone-900 text-white shadow-xl shadow-black/20 transition duration-300 hover:-translate-y-0.5 hover:border-white/25 hover:shadow-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
    className,
  )

  return (
    <CardFrame card={card} className={frameClassName}>
      <div
        className={cn(
          "relative w-full overflow-hidden bg-stone-800",
          isVertical ? "aspect-[2/3]" : "aspect-[16/10]",
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
                : "(max-width: 768px) 78vw, 320px"
            }
            className="object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div
            aria-hidden
            className="h-full w-full bg-[linear-gradient(135deg,#111827,#4c1d1d_52%,#064e3b)]"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
        {showSequenceNumber ? (
          <div className="absolute top-3 left-3 grid h-8 w-8 place-items-center rounded-full bg-white text-sm font-bold text-black shadow">
            {index + 1}
          </div>
        ) : null}
        {card.metaLabel ? (
          <div className="absolute top-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
            {card.metaLabel}
          </div>
        ) : null}
        {card.href ? (
          <div className="absolute bottom-3 left-3 grid h-9 w-9 place-items-center rounded-full bg-white text-black shadow transition group-hover:bg-red-500 group-hover:text-white">
            <Play className="h-4 w-4 fill-current" aria-hidden />
          </div>
        ) : null}
      </div>
      <div className="space-y-2 p-4">
        <div className="text-xs font-semibold tracking-[0.18em] text-red-200 uppercase">
          {card.label}
        </div>
        <h3 className="line-clamp-2 text-base leading-snug font-semibold tracking-normal text-white">
          {card.title}
        </h3>
        {card.description ? (
          <p className="line-clamp-2 text-sm leading-5 text-stone-300">
            {card.description}
          </p>
        ) : null}
      </div>
    </CardFrame>
  )
}
