import Image from "next/image"
import Link from "next/link"
import { ArrowLeft, Clapperboard } from "lucide-react"

import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { searchPath, videosIndexPath, WATCH_BASE_PATH } from "@/lib/routes"
import { cn } from "@/lib/utils"

const WATCH_NOT_FOUND_ARTWORK = `${WATCH_BASE_PATH}/images/thumbnails/11_Advent0304-vertical.jpg`

const actionClasses =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-bold text-white transition focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:h-14 sm:px-6 sm:text-base"
const primaryActionClasses = cn(
  actionClasses,
  "bg-brand-red shadow-[0_14px_32px_rgba(0,0,0,0.34)] hover:bg-brand-red/90",
)
const secondaryActionClasses = cn(
  actionClasses,
  "border border-white/35 bg-black/30 shadow-[0_14px_32px_rgba(0,0,0,0.22)] backdrop-blur hover:border-white/60 hover:bg-white/12",
)

export function WatchNotFound() {
  return (
    <main className="relative isolate min-h-svh overflow-x-hidden overflow-y-auto bg-black text-white">
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        <div className="watch-home-media-enter absolute inset-y-0 right-0 w-full md:w-[62%]">
          <Image
            src={WATCH_NOT_FOUND_ARTWORK}
            alt=""
            fill
            priority
            sizes="(max-width: 767px) 100vw, 62vw"
            unoptimized
            className="object-cover object-center opacity-55 md:object-right"
          />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_74%_42%,rgba(239,51,64,0.14),transparent_38%),linear-gradient(180deg,rgba(0,0,0,0.48)_0%,rgba(0,0,0,0.12)_45%,rgba(0,0,0,0.88)_100%)] md:bg-[radial-gradient(circle_at_74%_42%,rgba(239,51,64,0.14),transparent_38%),linear-gradient(90deg,#000_0%,rgba(0,0,0,0.94)_38%,rgba(0,0,0,0.58)_67%,rgba(0,0,0,0.24)_100%)]" />
      </div>

      <div
        className={`${WATCH_PAGE_CONTENT_CLASSES} relative z-10 flex min-h-svh items-center pt-[calc(env(safe-area-inset-top,0px)+6.5rem)] pb-[calc(env(safe-area-inset-bottom,0px)+2.5rem)] md:pt-[calc(env(safe-area-inset-top,0px)+9rem)] md:pb-[calc(env(safe-area-inset-bottom,0px)+4rem)]`}
      >
        <section
          aria-labelledby="watch-not-found-heading"
          className="watch-home-copy-enter relative w-full max-w-2xl"
        >
          <p
            aria-hidden="true"
            data-testid="watch-not-found-code"
            className="pointer-events-none absolute top-1/2 left-0 -translate-y-1/2 text-[clamp(11rem,42vw,22rem)] leading-none font-black tracking-[-0.09em] text-white/10 select-none md:-left-5 md:text-[clamp(15rem,24vw,24rem)]"
          >
            404
          </p>

          <div className="relative z-10">
            <p className="text-xs font-bold tracking-[0.24em] text-brand-red uppercase sm:text-sm">
              Page not found
            </p>

            <h1
              id="watch-not-found-heading"
              className="mt-4 max-w-xl text-4xl leading-[0.98] font-extrabold tracking-[-0.04em] text-white text-balance sm:mt-6 sm:text-6xl md:text-7xl"
            >
              <span className="sr-only">Page not found: </span>
              This scene isn&apos;t here.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 font-medium text-stone-200/85 sm:text-lg sm:leading-8">
              The page may have moved, but the story continues.
            </p>

            <nav
              aria-label="Page not found actions"
              className="mt-8 flex flex-col items-stretch gap-3 min-[420px]:flex-row min-[420px]:items-center sm:mt-10"
            >
              <Link href={searchPath()} className={primaryActionClasses}>
                <ArrowLeft aria-hidden="true" className="h-5 w-5 shrink-0" />
                Back to Watch
              </Link>
              <Link href={videosIndexPath()} className={secondaryActionClasses}>
                <Clapperboard aria-hidden="true" className="h-5 w-5 shrink-0" />
                Browse videos
              </Link>
            </nav>
          </div>
        </section>
      </div>
    </main>
  )
}
