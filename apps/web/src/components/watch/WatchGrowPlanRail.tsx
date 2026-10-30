"use client"

// Ported from the read-only prototype. The plan picker as a visual rail instead of a row of
// text chips: one poster per real YouVersion plan, dragged sideways on the
// shared embla carousel (same contract as the partner PDF rail).
//
// Honest limit on the artwork: YouVersion's own plan covers are not reachable
// without their API (bible.com serves a JS shell — no og:image, no public plan
// endpoint; checked 2026-09-18). So each poster is generated here from the
// plan's lane: a duotone wash in the site's earthy palette, a large glyph, and
// the lane name set big. Titles, day counts and links are the real thing.
// A real build would swap the wash for the publisher's cover.

import {
  ArrowUpRight,
  Baby,
  Briefcase,
  CalendarDays,
  Flower2,
  GraduationCap,
  Mountain,
  Send,
  Siren,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "lucide-react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import { GROW_PLANS, type GrowPlan } from "@/components/watch/grow-resources"
import { CAROUSEL_END_SPACER } from "@/lib/content-width"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"
import { cn } from "@/lib/utils"

const CAROUSEL_OPTS = {
  dragFree: true,
  containScroll: "trimSnaps",
  align: "start",
} as const

/* Earthy washes, in the register of the thumbnails rather than pure brand red. */
const LANE_ART: Record<
  string,
  { Icon: LucideIcon; from: string; to: string; tint: string }
> = {
  "At work": {
    Icon: Briefcase,
    from: "#3b3027",
    to: "#6b4a32",
    tint: "rgba(214,158,106,0.22)",
  },
  Teachers: {
    Icon: GraduationCap,
    from: "#2c3330",
    to: "#4f6551",
    tint: "rgba(150,197,158,0.20)",
  },
  "First responders": {
    Icon: Siren,
    from: "#3a2624",
    to: "#7a3a33",
    tint: "rgba(226,59,71,0.24)",
  },
  Parents: {
    Icon: Baby,
    from: "#332a33",
    to: "#5d4360",
    tint: "rgba(196,150,205,0.18)",
  },
  Athletes: {
    Icon: Trophy,
    from: "#33301f",
    to: "#6d6033",
    tint: "rgba(226,197,106,0.20)",
  },
  Women: {
    Icon: Flower2,
    from: "#312a2e",
    to: "#6a4450",
    tint: "rgba(224,150,168,0.20)",
  },
  "On mission": {
    Icon: Send,
    from: "#252e33",
    to: "#3f5c6b",
    tint: "rgba(130,186,210,0.20)",
  },
  "Walking a long road": {
    Icon: Mountain,
    from: "#2b2b2f",
    to: "#4f5260",
    tint: "rgba(168,176,204,0.18)",
  },
  "This season": {
    Icon: Sparkles,
    from: "#2e2a24",
    to: "#63513a",
    tint: "rgba(226,190,140,0.20)",
  },
}

const FALLBACK_ART = {
  Icon: CalendarDays,
  from: "#2b2724",
  to: "#57493d",
  tint: "rgba(214,180,140,0.18)",
}

export function WatchGrowPlanRail() {
  return (
    <section
      data-testid="watch-grow-match"
      aria-labelledby="watch-grow-match-heading"
      className="w-full min-w-0 pt-12 text-white md:pt-16"
    >
      <p className={WATCH_SECTION_EYEBROW_CLASS}>
        {GROW_PLANS.length} plans · free in the Bible app
      </p>
      <h2
        id="watch-grow-match-heading"
        className="mt-3 text-3xl leading-[1.08] font-semibold text-balance sm:text-4xl"
      >
        Where does your week happen?
      </h2>
      <p className="mt-3 max-w-[54ch] text-base leading-relaxed text-white/70">
        We wrote these for the job you actually do. Swipe to the one that sounds
        like your life.
      </p>

      {/* Same bleed contract as the other Watch rails: full-bleed on phones,
          contained from md up. */}
      <div className="mt-6 -mx-5 w-[calc(100%+2.5rem)] min-w-0 md:mx-0 md:w-full">
        <Carousel
          aria-label="Reading plans by who they were written for"
          opts={CAROUSEL_OPTS}
          className="w-full"
        >
          <CarouselContent
            data-testid="watch-grow-plan-rail"
            className="-ml-4 pl-5 md:pl-0"
          >
            {GROW_PLANS.map((plan) => (
              <CarouselItem key={plan.id} className="basis-auto pl-4">
                <PlanPoster plan={plan} />
              </CarouselItem>
            ))}
            <CarouselItem className="basis-auto pl-0" aria-hidden tabIndex={-1}>
              <div className={CAROUSEL_END_SPACER} />
            </CarouselItem>
          </CarouselContent>
          <CarouselPrevious label="Previous plans" />
          <CarouselNext label="More plans" />
        </Carousel>
      </div>
    </section>
  )
}

function PlanPoster({ plan }: { plan: GrowPlan }) {
  const art = LANE_ART[plan.lane] ?? FALLBACK_ART
  const { Icon } = art
  return (
    <a
      href={plan.url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="watch-grow-plan-card"
      className="group relative flex h-[19rem] w-[14rem] shrink-0 flex-col justify-between overflow-hidden rounded-2xl border border-white/10 p-5 transition-[transform,border-color] duration-200 hover:-translate-y-1 hover:border-white focus-visible:border-white focus-visible:outline-none sm:h-[21rem] sm:w-[16rem]"
      style={{
        backgroundImage: `radial-gradient(120% 90% at 20% 0%, ${art.tint} 0%, transparent 60%), linear-gradient(160deg, ${art.from} 0%, ${art.to} 100%)`,
      }}
    >
      {/* keeps the title legible over the lighter end of the wash */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/55 to-transparent"
      />

      <span className="relative flex items-start justify-between gap-3">
        <Icon aria-hidden className="size-9 text-white/90" strokeWidth={1.5} />
        <ArrowUpRight
          aria-hidden
          className="size-5 text-white/40 transition-colors group-hover:text-white"
        />
      </span>

      <span className="relative min-w-0">
        {/* Lane is the label, the plan is the headline — two plans can share a
            lane, and repeating the lane as a title reads like a duplicate. */}
        <span className="block text-[11px] font-bold tracking-[0.14em] text-white/70 uppercase">
          {plan.lane}
        </span>
        <span className="mt-2 block text-xl leading-[1.15] font-semibold text-balance">
          {plan.title}
        </span>
        <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-white/80 uppercase backdrop-blur-sm">
          <CalendarDays aria-hidden className="size-3" />
          {plan.days ? `${plan.days} days` : "Reading plan"}
        </span>
      </span>
    </a>
  )
}

/* The rail replaces the chip row, so `cn` stays imported for future variants. */
void cn
