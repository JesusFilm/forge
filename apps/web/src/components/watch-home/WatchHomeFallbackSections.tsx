import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import type { WatchHomeCarouselSlide } from "@/lib/watch-home-carousel"

type WatchHomeFallbackSectionsProps = {
  slides: readonly WatchHomeCarouselSlide[]
}

function fallbackItems(slides: readonly WatchHomeCarouselSlide[]) {
  return slides
    .filter((slide) => slide.kind === "video")
    .filter((slide) => slide.thumbnailUrl || slide.posterUrl)
    .slice(0, 12)
}

export function WatchHomeFallbackSections({
  slides,
}: WatchHomeFallbackSectionsProps) {
  const items = fallbackItems(slides)
  if (!items.length) return null

  return (
    <section
      aria-labelledby="watch-home-fallback-heading"
      className="bg-stone-900 px-5 py-10 text-white sm:px-10 md:px-12 md:py-14"
      data-testid="watch-home-fallback-sections"
    >
      <div className="mx-auto max-w-[1920px]">
        <h2
          id="watch-home-fallback-heading"
          className="text-2xl font-extrabold sm:text-3xl"
        >
          More to Watch
        </h2>
        <div className="mt-6 flex gap-4 overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((slide) => (
            <Link
              key={slide.id}
              href={slide.href as Route}
              className="group w-[min(72vw,22rem)] shrink-0 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:w-[20rem] lg:w-[24rem]"
            >
              <span className="relative block aspect-video overflow-hidden rounded-lg bg-stone-950 shadow-[0_10px_28px_rgba(0,0,0,0.35)] ring-1 ring-white/10 transition group-hover:ring-white/45">
                <Image
                  src={slide.thumbnailUrl ?? slide.posterUrl ?? ""}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 72vw, 24rem"
                  className="object-cover transition duration-500 group-hover:scale-[1.03]"
                />
                <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_34%,rgba(0,0,0,0.74)_100%)]" />
                <span className="absolute right-4 bottom-4 left-4">
                  <span className="block truncate text-[0.7rem] font-bold tracking-[0.22em] text-white/55 uppercase">
                    {slide.label}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-base leading-tight font-extrabold sm:text-lg">
                    {slide.title}
                  </span>
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
