import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { Play } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "@/components/ui/video-thumbnail-interaction-frame"
import type { WatchHomeHeroSlide } from "@/lib/watch-home"
import { cn } from "@/lib/utils"

type WatchHomeHeroProps = {
  slides: WatchHomeHeroSlide[]
}

export function WatchHomeHero({ slides }: WatchHomeHeroProps) {
  const t = useTranslations("WatchHome")
  const featured = slides[0] ?? null

  return (
    <section
      data-testid="watch-home-hero"
      className="relative isolate min-h-[100svh] overflow-hidden pt-28 text-white sm:pt-32 lg:pt-36"
    >
      {featured?.imageUrl ? (
        <Image
          src={featured.imageUrl}
          alt={featured.imageAlt}
          fill
          priority
          sizes="100vw"
          className="absolute inset-0 -z-20 scale-105 object-cover opacity-55 blur-[2px]"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 -z-20 bg-[linear-gradient(135deg,#020617,#3f1d2b_48%,#14332c)]"
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(0,0,0,0.62),rgba(0,0,0,0.14)_42%,rgba(0,0,0,0.82)),linear-gradient(90deg,rgba(0,0,0,0.42),rgba(0,0,0,0.08)_55%)]"
      />

      <div className="mx-auto flex min-h-[calc(100svh-7rem)] w-full max-w-[1920px] flex-col justify-end pb-8 sm:pb-10 lg:pb-12">
        <h1 className="sr-only">{t("pageTitle")}</h1>
        <div className="w-full overflow-x-auto pb-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max gap-2 px-4 sm:px-6 md:gap-3 lg:px-8">
            {slides.map((slide, index) => {
              const isActive = index === 0
              const isInteractive = Boolean(slide.href)
              const content = (
                <>
                  {slide.imageUrl ? (
                    <Image
                      src={slide.imageUrl}
                      alt={slide.imageAlt}
                      fill
                      priority={isActive}
                      sizes="(max-width: 768px) 140px, 260px"
                      className="object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden
                      className="h-full w-full bg-[linear-gradient(135deg,#111827,#4c1d1d_52%,#064e3b)]"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/24 to-transparent" />
                  {isInteractive || isActive ? (
                    <VideoThumbnailInteractionFrame
                      data-testid="watch-home-hero-thumbnail-frame"
                      interactive={isInteractive && !isActive}
                      visible={isActive}
                    />
                  ) : null}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span
                      className={cn(
                        "grid h-14 w-14 place-items-center rounded-full bg-red-500 text-white opacity-0 transition group-hover:opacity-100",
                        isActive ? "hidden" : null,
                      )}
                    >
                      <Play className="h-8 w-8 fill-current" aria-hidden />
                    </span>
                  </div>
                  <div className="relative flex h-full flex-col justify-end p-3 md:p-4">
                    <p className="truncate text-[11px] leading-5 font-bold tracking-widest text-stone-100/80 uppercase">
                      {slide.label}
                    </p>
                    <h2 className="line-clamp-3 text-sm leading-tight font-bold text-stone-50 [text-shadow:0_1px_3px_rgba(0,0,0,0.55)] md:text-base">
                      {slide.title}
                    </h2>
                  </div>
                </>
              )

              const className = cn(
                "beveled relative block h-[136px] w-[140px] overflow-hidden rounded-lg bg-black text-left no-underline transition-opacity duration-200 md:w-[260px]",
                isInteractive && "group",
                isInteractive && VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
                isActive
                  ? "opacity-100"
                  : cn(
                      "opacity-60",
                      isInteractive &&
                        "hover:opacity-85 focus-visible:opacity-85",
                    ),
              )

              return slide.href ? (
                <Link
                  key={slide.id}
                  href={slide.href as Route}
                  aria-label={slide.title}
                  className={className}
                >
                  {content}
                </Link>
              ) : (
                <div
                  key={slide.id}
                  aria-label={slide.title}
                  className={className}
                >
                  {content}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
