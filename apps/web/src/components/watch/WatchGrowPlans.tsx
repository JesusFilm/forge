"use client"

import { useId, useState } from "react"
import { GROW_PLANS, GROW_PLAN_LANES } from "@/lib/watch-grow-content"

export function WatchGrowPlans() {
  const titleId = useId()
  const [lane, setLane] = useState<string | null>(null)
  const plans = lane
    ? GROW_PLANS.filter((plan) => plan.lane === lane)
    : GROW_PLANS
  return (
    <section aria-labelledby={titleId} className="mt-10 min-w-0 text-white">
      <h3 id={titleId} className="text-2xl font-semibold">
        A reading plan for your week
      </h3>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-white/70">
        Explore plans on YouVersion. Topics are grouped here to help you choose;
        each source page credits its author.
      </p>
      <div
        className="mt-5 flex flex-wrap gap-2"
        role="group"
        aria-label="Reading plan topics"
      >
        {[null, ...GROW_PLAN_LANES].map((item) => (
          <button
            key={item ?? "all"}
            type="button"
            aria-pressed={lane === item}
            onClick={() => setLane(item)}
            className={`min-h-11 cursor-pointer rounded-full border px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${lane === item ? "border-white bg-white text-stone-950" : "border-white/25 text-white/80 hover:bg-white/10"}`}
          >
            {item ?? "All plans"}
          </button>
        ))}
      </div>
      <p role="status" className="mt-4 text-sm text-white/60">
        Showing {plans.length} of {GROW_PLANS.length} plans
      </p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <li
            key={plan.id}
            className="flex min-w-0 flex-col rounded-2xl border border-white/15 bg-white/5 p-5"
          >
            <p className="text-sm text-white/60">
              {plan.lane}
              {plan.days ? ` · ${plan.days} days` : ""}
            </p>
            <a
              href={plan.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-11 items-center text-lg font-semibold underline decoration-white/30 underline-offset-4 hover:decoration-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              {plan.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
