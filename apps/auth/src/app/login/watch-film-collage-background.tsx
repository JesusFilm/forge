"use client"

import { useLayoutEffect, useRef, type CSSProperties } from "react"
import Image from "next/image"

type CollageImage = {
  title: string
  src: string
}

type CollageRow = {
  animationClass: string
  count: number
  offsetClass: string
  start: number
}

const COLLAGE_ANIMATION_EPOCH_KEY = "forge.auth.collageAnimationEpoch"
const TILE_SIZES = "(max-width: 820px) 56vw, 23vw"

const WATCH_ARTWORK: CollageImage[] = [
  {
    title: "The Pilgrim's Progress",
    src: "/images/watch-collage/feature-film/the-pilgrims-progress.jpg",
  },
  {
    title: "Augustine",
    src: "/images/watch-collage/feature-film/augustine.jpg",
  },
  {
    title: "The Story of Jesus for Children",
    src: "/images/watch-collage/feature-film/the-story-of-jesus-for-children.jpg",
  },
  {
    title: "JESUS",
    src: "/images/watch-collage/feature-film/jesus.jpg",
  },
  {
    title: "Magdalena",
    src: "/images/watch-collage/feature-film/magdalena.jpg",
  },
  {
    title: "Life of Jesus (Gospel of John)",
    src: "/images/watch-collage/feature-film/life-of-jesus-gospel-of-john.jpg",
  },
  {
    title: "The Savior",
    src: "/images/watch-collage/feature-film/the-savior.jpg",
  },
  {
    title: "Reflections of Hope",
    src: "/images/watch-collage/series/reflections-of-hope.jpg",
  },
  {
    title: "Grow Your Faith",
    src: "/images/watch-collage/collection/grow-your-faith.jpg",
  },
  {
    title: "My Last Day",
    src: "/images/watch-collage/short-film/my-last-day.jpg",
  },
  {
    title: "Women's Resources",
    src: "/images/watch-collage/collection/womens-resources.jpg",
  },
  {
    title: "#FallingPlates",
    src: "/images/watch-collage/short-film/fallingplates.jpg",
  },
  {
    title: "Chosen Witness",
    src: "/images/watch-collage/short-film/chosen-witness.jpg",
  },
  {
    title: "New Believer Course",
    src: "/images/watch-collage/series/new-believer-course.jpg",
  },
  {
    title: "Good Friday: Live",
    src: "/images/watch-collage/short-film/good-friday-live.jpg",
  },
  {
    title: "Make Way for the King",
    src: "/images/watch-collage/short-film/make-way-for-the-king.jpg",
  },
  {
    title: "Run the Race",
    src: "/images/watch-collage/short-film/run-the-race.jpg",
  },
  {
    title: "Easter",
    src: "/images/watch-collage/collection/easter.jpg",
  },
  {
    title: "Who Do You Say I Am?",
    src: "/images/watch-collage/short-film/who-do-you-say-i-am.jpg",
  },
  {
    title: "Christmas",
    src: "/images/watch-collage/collection/christmas.jpg",
  },
  {
    title: "The Story Short Film",
    src: "/images/watch-collage/short-film/the-story-short-film.jpg",
  },
  {
    title: "Hope Collection",
    src: "/images/watch-collage/collection/hope-collection.jpg",
  },
  {
    title: "Creation to Christ",
    src: "/images/watch-collage/series/creation-to-christ.jpg",
  },
  {
    title: "LUMO - The Gospel of Matthew",
    src: "/images/watch-collage/collection/lumo-the-gospel-of-matthew.jpg",
  },
  {
    title: "LUMO - The Gospel of Mark",
    src: "/images/watch-collage/collection/lumo-the-gospel-of-mark.jpg",
  },
  {
    title: "LUMO - The Gospel of Luke",
    src: "/images/watch-collage/collection/lumo-the-gospel-of-luke.jpg",
  },
  {
    title: "LUMO - The Gospel of John",
    src: "/images/watch-collage/collection/lumo-the-gospel-of-john.jpg",
  },
  {
    title: "Sweet Tooth",
    src: "/images/watch-collage/short-film/sweet-tooth.jpg",
  },
  {
    title: "THE FOUR",
    src: "/images/watch-collage/collection/the-four.jpg",
  },
  {
    title: "A Perfect Love",
    src: "/images/watch-collage/short-film/a-perfect-love.jpg",
  },
  {
    title: "The Prodigal",
    src: "/images/watch-collage/short-film/the-prodigal.jpg",
  },
  {
    title: "Perfect?",
    src: "/images/watch-collage/short-film/perfect.jpg",
  },
]

const MOBILE_FEATURE_FILMS: CollageImage[] = [
  {
    title: "The Pilgrim's Progress",
    src: "/images/watch-collage/feature-film/the-pilgrims-progress.jpg",
  },
  {
    title: "Augustine",
    src: "/images/watch-collage/feature-film/augustine.jpg",
  },
  {
    title: "The Story of Jesus for Children",
    src: "/images/watch-collage/feature-film/the-story-of-jesus-for-children.jpg",
  },
  {
    title: "JESUS",
    src: "/images/watch-collage/feature-film/jesus.jpg",
  },
  {
    title: "Magdalena",
    src: "/images/watch-collage/feature-film/magdalena.jpg",
  },
  {
    title: "Life of Jesus (Gospel of John)",
    src: "/images/watch-collage/feature-film/life-of-jesus-gospel-of-john.jpg",
  },
  {
    title: "The Savior",
    src: "/images/watch-collage/feature-film/the-savior.jpg",
  },
]

const ROWS = [
  {
    start: 0,
    count: 7,
    offsetClass:
      "left-[calc(50%_-_3.5*clamp(180px,23vw,390px)_-_3*1rem)] max-[820px]:left-[calc(50%_-_3.5*56vw_-_3*0.75rem)]",
    animationClass:
      "animate-[film-collage-drift-slow_420s_linear_infinite_alternate]",
  },
  {
    start: 7,
    count: 7,
    offsetClass:
      "left-[calc(50%_-_2.2*clamp(180px,23vw,390px)_-_2*1rem)] max-[820px]:left-[calc(50%_-_2.2*56vw_-_2*0.75rem)]",
    animationClass:
      "animate-[film-collage-drift-medium_360s_linear_infinite_alternate]",
  },
  {
    start: 14,
    count: 8,
    offsetClass:
      "left-[calc(50%_-_4.6*clamp(180px,23vw,390px)_-_4*1rem)] max-[820px]:left-[calc(50%_-_4.6*56vw_-_4*0.75rem)]",
    animationClass:
      "animate-[film-collage-drift-slow_420s_linear_infinite_alternate]",
  },
  {
    start: 21,
    count: 11,
    offsetClass:
      "left-[calc(50%_-_1.6*clamp(180px,23vw,390px)_-_1*1rem)] max-[820px]:left-[calc(50%_-_1.6*56vw_-_1*0.75rem)]",
    animationClass:
      "animate-[film-collage-drift-medium_360s_linear_infinite_alternate]",
  },
] satisfies CollageRow[]

export function WatchFilmCollageBackground() {
  const collageRootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    collageRootRef.current?.style.setProperty(
      "--film-collage-delay",
      String(getCollageAnimationDelaySeconds()),
    )
  }, [])

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden bg-black max-[820px]:relative max-[820px]:inset-auto max-[820px]:h-[260px]"
      aria-hidden="true"
      ref={collageRootRef}
      style={
        {
          "--film-collage-delay": 0,
        } as CSSProperties & { "--film-collage-delay": number }
      }
    >
      <div className="absolute left-1/2 top-1/2 flex h-[125vh] w-[150vw] -translate-x-1/2 -translate-y-1/2 rotate-[-9deg] scale-110 flex-col justify-center gap-4 max-[820px]:top-1/2 max-[820px]:h-[360px] max-[820px]:w-[230vw] max-[820px]:-translate-y-1/2 max-[820px]:scale-90 max-[820px]:justify-center max-[820px]:gap-3">
        {ROWS.map((row) => (
          <div
            key={`${row.start}-${row.count}`}
            className={`relative flex gap-4 [animation-delay:calc(var(--film-collage-delay)*-1s)] will-change-transform ${row.offsetClass} ${row.animationClass}`}
          >
            {[
              ...selectArtwork(row.start, row.count),
              ...selectArtwork(row.start, row.count),
            ].map((image, index) => (
              <Tile image={image} key={`${image.title}-${index}`} />
            ))}
            {[
              ...selectArtworkFrom(MOBILE_FEATURE_FILMS, row.start, row.count),
              ...selectArtworkFrom(MOBILE_FEATURE_FILMS, row.start, row.count),
            ].map((image, index) => (
              <Tile
                image={image}
                key={`mobile-${image.title}-${index}`}
                variant="mobile"
              />
            ))}
          </div>
        ))}
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(0,0,0,0.08),rgba(0,0,0,0.56)_56%,rgba(0,0,0,0.9)_100%)] max-[820px]:bg-[radial-gradient(circle_at_82%_10%,rgba(0,0,0,0)_0,rgba(0,0,0,0.08)_30%,rgba(0,0,0,0.78)_82%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.45),rgba(0,0,0,0.12)_38%,rgba(0,0,0,0.78))] max-[820px]:bg-[linear-gradient(150deg,rgba(0,0,0,0.88)_0,rgba(0,0,0,0.68)_36%,rgba(0,0,0,0.2)_72%,rgba(0,0,0,0.08)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.6),transparent_44%,rgba(0,0,0,0.58))] max-[820px]:bg-[linear-gradient(to_bottom,rgba(0,0,0,0.05),rgba(0,0,0,0.18)_52%,rgba(0,0,0,0.92)_100%)]" />
    </div>
  )
}

function getCollageAnimationDelaySeconds() {
  if (typeof window === "undefined") return 0

  const now = Date.now()

  try {
    const storedEpoch = window.sessionStorage.getItem(
      COLLAGE_ANIMATION_EPOCH_KEY,
    )
    const epoch = storedEpoch ? Number(storedEpoch) : now

    if (!Number.isFinite(epoch)) {
      window.sessionStorage.setItem(COLLAGE_ANIMATION_EPOCH_KEY, String(now))
      return 0
    }

    if (!storedEpoch) {
      window.sessionStorage.setItem(COLLAGE_ANIMATION_EPOCH_KEY, String(epoch))
    }

    return (now - epoch) / 1000
  } catch {
    return 0
  }
}

function selectArtwork(start: number, count: number) {
  return selectArtworkFrom(WATCH_ARTWORK, start, count)
}

function selectArtworkFrom(
  artwork: CollageImage[],
  start: number,
  count: number,
) {
  return Array.from({ length: count }, (_, index) => {
    return artwork[(start + index) % artwork.length]
  })
}

function Tile({
  image,
  variant = "desktop",
}: {
  image: CollageImage
  variant?: "desktop" | "mobile"
}) {
  const visibilityClass =
    variant === "mobile" ? "hidden max-[820px]:block" : "max-[820px]:hidden"

  return (
    <div
      className={`relative aspect-video w-[clamp(180px,23vw,390px)] flex-none overflow-hidden rounded-md bg-[#14110f] opacity-[0.96] shadow-[0_18px_45px_rgba(0,0,0,0.65)] after:absolute after:inset-0 after:bg-[linear-gradient(to_top,rgba(0,0,0,0.36),transparent_58%,rgba(255,255,255,0.06))] after:content-[''] max-[820px]:w-[56vw] ${visibilityClass}`}
    >
      <Image
        alt=""
        aria-hidden="true"
        className="object-cover"
        fill
        sizes={TILE_SIZES}
        src={image.src}
      />
    </div>
  )
}
