import Link from "next/link"
import type { CSSProperties } from "react"
import { ArrowRight } from "lucide-react"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { languagesIndexPath } from "@/lib/routes"

import { RotatingGlobe } from "./RotatingGlobe"

type WatchHomeLanguagesProps = {
  sectionKey?: string | null
}

const languages = [
  {
    nativeName: "Kiswahili",
    englishName: "Swahili",
    className: "left-[2%] top-[18%] sm:left-[3%] sm:top-[20%]",
  },
  {
    nativeName: "العربية",
    englishName: "Arabic",
    className: "right-[1%] top-[29%] sm:right-[3%] sm:top-[30%]",
  },
  {
    nativeName: "हिन्दी",
    englishName: "Hindi",
    className: "bottom-[29%] left-[3%] sm:bottom-[27%] sm:left-[7%]",
  },
  {
    nativeName: "日本語",
    englishName: "Japanese",
    className: "right-[2%] bottom-[16%] sm:right-[7%] sm:bottom-[17%]",
  },
] as const

export function WatchHomeLanguages({ sectionKey }: WatchHomeLanguagesProps) {
  return (
    <section
      data-testid="watch-home-languages"
      data-section-key={sectionKey ?? undefined}
      className="relative isolate overflow-hidden border-y border-white/5 bg-[#050505] py-16 text-white sm:py-20 lg:py-24"
    >
      <div
        className="absolute inset-0 bg-[url(/watch/images/overlay.svg)] bg-repeat opacity-25 mix-blend-screen"
        aria-hidden="true"
      />

      <div
        className={`${WATCH_PAGE_CONTENT_CLASSES} relative grid items-center gap-10 lg:min-h-[38rem] lg:grid-cols-[minmax(0,0.88fr)_minmax(31rem,1.12fr)] lg:gap-6`}
      >
        <div className="relative z-10 max-w-xl py-3 lg:py-12">
          <p className="text-[0.7rem] font-semibold tracking-[0.32em] text-red-200/70 uppercase sm:text-xs">
            The gospel in every heart language
          </p>
          <h2 className="mt-5 max-w-lg text-4xl leading-[1.03] font-semibold tracking-[-0.04em] text-balance sm:text-5xl lg:text-6xl">
            A story for every language.
          </h2>
          <div className="mt-6 h-px w-16 bg-red-400/70" aria-hidden="true" />
          <p className="mt-7 max-w-lg text-base leading-7 text-white/68 sm:text-lg sm:leading-8">
            Explore films and stories of Jesus in more than 2,000 languages —
            created so people everywhere can hear the good news in the words
            that feel like home.
          </p>

          <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-5">
            <Link
              href={languagesIndexPath()}
              className="group inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              Explore all languages
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
            <span className="text-xs leading-5 text-white/45 sm:max-w-36">
              Browse by region, country, or language
            </span>
          </div>
        </div>

        <div
          data-testid="living-atlas-visual"
          className="living-atlas-visual relative mx-auto aspect-square w-full max-w-[43rem] lg:-mr-10 lg:max-w-[48rem] xl:-mr-16"
          aria-hidden="true"
        >
          <div className="living-atlas-stars living-atlas-stars-far absolute inset-[4%]" />
          <div className="living-atlas-stars living-atlas-stars-near absolute inset-[2%]" />
          <div className="living-atlas-globe-motion absolute inset-0">
            <div className="living-atlas-atmosphere absolute inset-[8%] rounded-full" />
            <div className="living-atlas-globe-mask absolute inset-0">
              <RotatingGlobe />
            </div>
            <div className="living-atlas-shimmer absolute inset-[10%] rounded-full" />
          </div>

          {languages.map((language, index) => (
            <div
              key={language.englishName}
              className={`living-atlas-language absolute ${language.className} rounded-xl border border-black/10 bg-white/94 px-3 py-2 text-black shadow-[0_18px_50px_rgba(0,0,0,0.38)] backdrop-blur-sm sm:px-4 sm:py-2.5 [animation-delay:calc(var(--language-index)*-1.7s)]`}
              style={{ "--language-index": index } as CSSProperties}
            >
              <p
                className="text-sm leading-none font-semibold sm:text-base"
                dir="auto"
              >
                {language.nativeName}
              </p>
              <p className="mt-1 text-[0.6rem] leading-none font-medium tracking-[0.12em] text-black/45 uppercase sm:text-[0.65rem]">
                {language.englishName}
              </p>
            </div>
          ))}

          <p className="absolute right-[7%] bottom-[4%] text-[0.6rem] font-semibold tracking-[0.26em] text-white/45 uppercase sm:text-[0.68rem]">
            One library · Every region
          </p>
        </div>
      </div>
    </section>
  )
}
