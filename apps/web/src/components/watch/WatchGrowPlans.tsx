"use client"

// Ported from the read-only prototype. G2: the fifteen Jesus Film Project reading plans that
// already exist on YouVersion, presented the way they were actually written —
// as life lanes, not Bible topics. Titles, ids and links are real; the lane
// each plan sits in is our grouping.

import { ArrowUpRight, CalendarDays } from "lucide-react"
import { useState, type ComponentProps } from "react"

import {
  GROW_PLANS,
  GROW_PLAN_LANES,
  type GrowPlan,
} from "@/components/watch/grow-resources"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"
import { cn } from "@/lib/utils"

import { useWatchResourceTabs } from "./use-watch-resource-tabs"

export function WatchGrowPlans() {
  const [lane, setLane] = useState<string | null>(null)
  const tabs = useWatchResourceTabs([null, ...GROW_PLAN_LANES], lane, setLane)
  const shown: GrowPlan[] = lane
    ? GROW_PLANS.filter((p) => p.lane === lane)
    : GROW_PLANS

  return (
    <section
      data-testid="watch-grow-plans"
      aria-labelledby="watch-grow-plans-heading"
      className="w-full min-w-0 pt-12 text-white md:pt-16"
    >
      <p className={WATCH_SECTION_EYEBROW_CLASS}>
        {GROW_PLANS.length} plans · free in the Bible app
      </p>
      <h2
        id="watch-grow-plans-heading"
        className="mt-3 text-3xl leading-[1.08] font-semibold text-balance sm:text-4xl"
      >
        A plan written for your week, not just your beliefs.
      </h2>
      <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-white/70">
        We wrote these for the job you actually do. Pick the one that sounds
        like your life.
      </p>

      <div
        role="tablist"
        aria-label="Who the plan is for"
        lang="en"
        dir="ltr"
        className="mt-6 flex min-w-0 flex-wrap gap-2"
      >
        <LaneChip
          label="All"
          count={GROW_PLANS.length}
          selected={lane === null}
          tabProps={tabs.tabProps(null)}
        />
        {GROW_PLAN_LANES.map((l) => (
          <LaneChip
            key={l}
            label={l}
            count={GROW_PLANS.filter((p) => p.lane === l).length}
            selected={lane === l}
            tabProps={tabs.tabProps(l)}
          />
        ))}
      </div>

      <div {...tabs.panelProps}>
        <ul className="mt-6 grid min-w-0 gap-2.5 md:grid-cols-2">
          {shown.map((p) => (
            <li key={p.id} className="min-w-0">
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-full min-w-0 items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4 transition-colors hover:border-white hover:bg-white hover:text-stone-900 focus-visible:border-white focus-visible:bg-white focus-visible:text-stone-900 focus-visible:outline-none md:p-5"
              >
                <CalendarDays
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-white/60 group-hover:text-brand-red"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-tight font-semibold">
                    {p.title}
                  </span>
                  <span className="mt-1.5 block text-[12px] text-white/45 group-hover:text-stone-500">
                    {p.lane}
                    {p.days ? ` · ${p.days} days` : ""}
                  </span>
                </span>
                <ArrowUpRight
                  aria-hidden
                  className="size-4 shrink-0 text-white/35 group-hover:text-stone-500"
                />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function LaneChip({
  label,
  count,
  selected,
  tabProps,
}: {
  label: string
  count: number
  selected: boolean
  tabProps: ComponentProps<"button">
}) {
  return (
    <button
      type="button"
      {...tabProps}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
        selected
          ? "border-white bg-white text-stone-900"
          : "border-white/15 bg-transparent text-white/70 hover:border-white/40 hover:text-white",
      )}
    >
      {label}
      <span
        className={cn(
          "text-[11px] tabular-nums",
          selected ? "text-stone-500" : "text-white/40",
        )}
      >
        {count}
      </span>
    </button>
  )
}
