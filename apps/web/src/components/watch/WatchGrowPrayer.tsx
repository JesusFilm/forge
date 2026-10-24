"use client"

import { useId, useState } from "react"
import {
  WATCH_GROW_PRAYER,
  type WatchGrowPrayerGuide,
} from "@/lib/watch-grow-content"

export function WatchGrowPrayer({
  guide = WATCH_GROW_PRAYER,
}: {
  guide?: WatchGrowPrayerGuide
}) {
  const titleId = useId()
  const selectId = useId()
  const [request, setRequest] = useState(0)
  return (
    <section
      aria-labelledby={titleId}
      className="mt-10 min-w-0 rounded-2xl border border-white/15 bg-white/5 p-5 text-white sm:p-7"
    >
      <p className="text-sm text-white/65">Prayer guide · {guide.month}</p>
      <h3 id={titleId} className="mt-2 text-2xl font-semibold">
        Pray for {guide.country}
      </h3>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-white/70">
        From Jesus Film Project’s {guide.month} guide, “For the Least Reached: A
        Year of Prayer.” These are dated prayer requests from that guide.
      </p>
      <label htmlFor={selectId} className="mt-5 block text-sm font-semibold">
        Choose a prayer request
      </label>
      <select
        id={selectId}
        value={request}
        onChange={(event) => setRequest(Number(event.target.value))}
        className="mt-2 min-h-11 max-w-full rounded-lg border border-white/30 bg-stone-900 p-2 text-base text-white"
      >
        {guide.requests.map((_, index) => (
          <option key={index} value={index}>
            Request {index + 1}
          </option>
        ))}
      </select>
      <p
        className="mt-5 max-w-prose text-lg leading-relaxed"
        aria-live="polite"
      >
        {guide.requests[request]}
      </p>
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
        {guide.pdf ? (
          <a
            href={guide.pdf}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Open {guide.month} source PDF
          </a>
        ) : null}
        <a
          href={guide.hub}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          Browse published prayer guides
        </a>
      </div>
      <p className="mt-2 text-xs text-white/60">
        If the PDF cannot open, the source archive lists the published guides.
      </p>
    </section>
  )
}
