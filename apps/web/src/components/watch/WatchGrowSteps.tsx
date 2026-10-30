"use client"

// Ported from the read-only prototype. G3: the new-believer follow-up path. Five real
// episodes of "Walking with Jesus (Africa)" that we already host, in order,
// matched to the five steps of Cru's Follow-Up Series. Every link is a real
// Watch URL.

import { ArrowRight, Play } from "lucide-react"

import {
  FOLLOW_UP_SERIES_HREF,
  FOLLOW_UP_STEPS,
} from "@/components/watch/grow-resources"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"

export function WatchGrowSteps() {
  return (
    <section
      data-testid="watch-grow-steps"
      aria-labelledby="watch-grow-steps-heading"
      className="w-full min-w-0 pt-12 text-white md:pt-16"
    >
      <p className={WATCH_SECTION_EYEBROW_CLASS}>
        Just decided to follow Jesus?
      </p>
      <h2
        id="watch-grow-steps-heading"
        className="mt-3 text-3xl leading-[1.08] font-semibold text-balance sm:text-4xl"
      >
        The first five things worth knowing.
      </h2>
      <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-white/70">
        Five short films, in order. About two hours in total — most people take
        one a week.
      </p>

      <ol className="mt-7 grid min-w-0 gap-2.5 md:grid-cols-2">
        {FOLLOW_UP_STEPS.map((s, i) => (
          <li key={s.title} className="min-w-0">
            <a
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full min-w-0 items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4 transition-colors hover:border-white hover:bg-white hover:text-stone-900 focus-visible:border-white focus-visible:bg-white focus-visible:text-stone-900 focus-visible:outline-none md:p-5"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-white/20 text-[13px] font-bold tabular-nums text-white/70 transition-colors group-hover:border-stone-300 group-hover:text-stone-500">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-tight font-semibold">
                  {s.title}
                </span>
                <span className="mt-1 block text-[13px] leading-snug text-white/60 group-hover:text-stone-600">
                  {s.step}
                </span>
                <span className="mt-2 inline-flex items-center gap-1.5 text-[12px] tabular-nums text-white/40 group-hover:text-stone-500">
                  <Play aria-hidden className="size-3" />
                  {s.runtime}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ol>

      <a
        href={FOLLOW_UP_SERIES_HREF}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex cursor-pointer items-center gap-2 text-[13px] text-white/45 transition-colors hover:text-white/80"
      >
        <span className="underline decoration-white/25 underline-offset-4">
          The whole series — Walking with Jesus
        </span>
        <ArrowRight aria-hidden className="size-4" />
      </a>
    </section>
  )
}
