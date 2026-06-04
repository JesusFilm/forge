import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { ArrowRight, Play } from "lucide-react"
import type { WatchHomeHeroSlide } from "@/lib/watch-home"
import { videosIndexPath } from "@/lib/routes"

type WatchHomeHeroProps = {
  slides: WatchHomeHeroSlide[]
}

export function WatchHomeHero({ slides }: WatchHomeHeroProps) {
  const featured = slides[0] ?? null
  const secondarySlides = slides.slice(1, 4)

  return (
    <section
      data-testid="watch-home-hero"
      className="relative isolate min-h-[82svh] overflow-hidden bg-black pt-32 pb-14 text-white sm:pt-36 lg:pt-40"
    >
      {featured?.imageUrl ? (
        <Image
          src={featured.imageUrl}
          alt={featured.imageAlt}
          fill
          priority
          sizes="100vw"
          className="absolute inset-0 -z-20 object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 -z-20 bg-[linear-gradient(135deg,#020617,#7f1d1d_48%,#064e3b)]"
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(0,0,0,0.9),rgba(0,0,0,0.56)_45%,rgba(0,0,0,0.28)),linear-gradient(0deg,rgba(0,0,0,0.94),rgba(0,0,0,0.08)_55%)]"
      />

      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end lg:px-8">
        <div className="max-w-3xl space-y-6">
          <p className="text-xs font-semibold tracking-[0.28em] text-red-100 uppercase">
            {featured?.eyebrow ?? "Featured"}
          </p>
          <h1 className="max-w-4xl text-4xl leading-[1.04] font-semibold tracking-normal text-white sm:text-6xl lg:text-7xl">
            {featured?.title ?? "Jesus Film Project"}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-stone-200 sm:text-lg lg:text-xl">
            {featured?.description ??
              "Watch gospel films, Bible stories, and video collections for free in languages from around the world."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {featured?.href ? (
              <Link
                href={featured.href as Route}
                className="inline-flex h-12 items-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-black transition hover:bg-red-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Play className="h-4 w-4 fill-current" aria-hidden />
                Watch now
              </Link>
            ) : null}
            <Link
              href={videosIndexPath()}
              className="inline-flex h-12 items-center gap-2 rounded-lg border border-white/30 bg-black/25 px-5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Browse videos
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>

        {secondarySlides.length ? (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {secondarySlides.map((slide) => {
              const body = (
                <>
                  {slide.imageUrl ? (
                    <Image
                      src={slide.imageUrl}
                      alt={slide.imageAlt}
                      fill
                      sizes="(max-width: 1024px) 30vw, 160px"
                      className="object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden
                      className="h-full w-full bg-[linear-gradient(135deg,#111827,#4c1d1d_52%,#064e3b)]"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-r from-black/78 to-black/20" />
                  <div className="relative flex min-h-28 items-end p-4">
                    <div>
                      <p className="text-[10px] font-semibold tracking-[0.18em] text-red-100 uppercase">
                        {slide.label}
                      </p>
                      <h2 className="line-clamp-2 text-sm font-semibold text-white">
                        {slide.title}
                      </h2>
                    </div>
                  </div>
                </>
              )

              const className =
                "group relative overflow-hidden rounded-lg border border-white/15 bg-white/5 text-left transition hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"

              return slide.href ? (
                <Link
                  key={slide.id}
                  href={slide.href as Route}
                  className={className}
                >
                  {body}
                </Link>
              ) : (
                <div key={slide.id} className={className}>
                  {body}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </section>
  )
}
