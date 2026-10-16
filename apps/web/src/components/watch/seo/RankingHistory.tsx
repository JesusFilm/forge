"use client"

import { useId, useState } from "react"

import {
  displayDate,
  displayNumber,
  displayWindow,
  Metric,
  seoFocusClass,
} from "./presentation"
import type { RankingEvidence } from "./types"

export function RankingHistory({ data }: { data: RankingEvidence }) {
  const id = useId()
  const [active, setActive] = useState<number | null>(null)
  const points = data.points
    .filter((point) => Number.isFinite(Date.parse(point.date)))
    .slice()
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  const validPosition = (position: number | null): position is number =>
    position != null && Number.isFinite(position) && position >= 1
  const ceiling = Math.max(
    10,
    ...points.map((point) =>
      validPosition(point.position) ? Math.ceil(point.position) : 1,
    ),
  )
  const first = points.length ? Date.parse(points[0].date) : 0
  const last = points.length
    ? Date.parse(points[points.length - 1].date)
    : first
  const x = (date: string) =>
    last === first
      ? 340
      : 64 + ((Date.parse(date) - first) / (last - first)) * 536
  const y = (position: number) => 28 + ((position - 1) / (ceiling - 1)) * 152
  const segments: { date: string; position: number }[][] = []
  let segment: { date: string; position: number }[] = []
  for (const point of points) {
    const previous = segment[segment.length - 1]
    if (
      !validPosition(point.position) ||
      (previous &&
        Date.parse(point.date) - Date.parse(previous.date) > 86_400_000)
    ) {
      if (segment.length) segments.push(segment)
      segment = []
    }
    if (validPosition(point.position))
      segment.push({ date: point.date, position: point.position })
  }
  if (segment.length) segments.push(segment)
  const activePoint = active == null ? null : points[active]
  return (
    <div>
      <dl className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        <Metric label="Average search position" value={data.averagePosition} />
        <Metric label="Search clicks" value={data.clicks} />
        <Metric label="Search appearances" value={data.impressions} />
        <Metric label="Click-through rate" value={data.ctrPercent} suffix="%" />
      </dl>
      <p className="mt-5 text-sm font-medium text-stone-100">
        Higher is better on this graph. Position 1 is best in search results.
      </p>
      <p className="mt-1 text-sm text-stone-300">
        Click-through rate is the share of search appearances that led to a
        click.
      </p>
      {points.some((point) => validPosition(point.position)) ? (
        <div
          className="relative mt-4"
          onKeyDown={(event) => {
            if (event.key === "Escape") setActive(null)
          }}
        >
          <svg
            viewBox="0 0 640 270"
            className="block h-auto w-full overflow-visible text-stone-300"
            role="img"
            aria-labelledby={`${id}-title ${id}-desc`}
          >
            <title id={`${id}-title`}>
              Ranking history. Higher is better. Position 1 is best.
            </title>
            <desc id={`${id}-desc`}>
              Average search position by date. Missing observations are gaps.
              Use the observation table for every value.
            </desc>
            {[1, Math.round((ceiling + 1) / 2), ceiling].map((tick) => (
              <g key={tick}>
                <line
                  x1="64"
                  x2="600"
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="currentColor"
                  opacity="0.25"
                />
                <text
                  x="52"
                  y={y(tick) + 4}
                  fill="currentColor"
                  textAnchor="end"
                  className="text-[30px] sm:text-xs"
                >
                  {tick}
                </text>
              </g>
            ))}
            <text
              x="64"
              y="12"
              fill="currentColor"
              className="text-[30px] sm:text-xs"
            >
              Average search position
            </text>
            {segments
              .filter((run) => run.length > 1)
              .map((run) => (
                <polyline
                  key={run[0].date}
                  points={run
                    .map((point) => `${x(point.date)},${y(point.position)}`)
                    .join(" ")}
                  stroke="var(--color-brand-red, #ef3340)"
                  strokeWidth="3"
                  fill="none"
                />
              ))}
            {points.map((point, index) =>
              validPosition(point.position) ? (
                <circle
                  key={`${point.date}-${index}`}
                  cx={x(point.date)}
                  cy={y(point.position)}
                  r="5"
                  fill="var(--color-brand-red, #ef3340)"
                  stroke="currentColor"
                  strokeWidth="2"
                  tabIndex={0}
                  className="cursor-help focus-visible:stroke-white focus-visible:stroke-[4] focus-visible:outline-none"
                  aria-label={`${displayDate(point.date)}: position ${displayNumber(point.position)}`}
                  aria-describedby={
                    active === index ? `${id}-tooltip` : undefined
                  }
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(null)}
                >
                  <title>
                    {displayDate(point.date)}: position{" "}
                    {displayNumber(point.position)}
                  </title>
                </circle>
              ) : null,
            )}
            <text
              x="64"
              y="214"
              fill="currentColor"
              className="text-[30px] sm:text-xs"
            >
              {displayDate(points[0].date)}
            </text>
            {last !== first ? (
              <text
                x="600"
                y="214"
                fill="currentColor"
                textAnchor="end"
                className="text-[30px] sm:text-xs"
              >
                {displayDate(points[points.length - 1].date)}
              </text>
            ) : null}
            <text
              x="332"
              y="260"
              fill="currentColor"
              textAnchor="middle"
              className="text-[30px] sm:text-xs"
            >
              Date
            </text>
          </svg>
          {activePoint && validPosition(activePoint.position) ? (
            <div
              id={`${id}-tooltip`}
              role="tooltip"
              className="pointer-events-none absolute top-0 right-0 max-w-full rounded-lg border border-stone-500 bg-stone-950 px-3 py-2 text-sm text-stone-100 shadow-lg"
            >
              {displayDate(activePoint.date)}: position{" "}
              {displayNumber(activePoint.position)}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-5 text-sm text-stone-300">
          Ranking history unavailable. No measured positions were supplied.
        </p>
      )}
      <p className="mt-2 flex items-center gap-2 text-xs text-stone-300">
        <span
          aria-hidden="true"
          className="inline-block h-0.5 w-6 shrink-0 bg-brand-red"
        />
        Average search position. Gaps mean no observation; they do not mean
        zero.
      </p>
      {data.comparisonWindow ? (
        <p className="mt-2 text-xs text-stone-300">
          Comparison window: {displayWindow(data.comparisonWindow)}. No change
          is inferred from missing comparison values.
        </p>
      ) : null}
      <details className="mt-4 text-sm">
        <summary
          className={`w-fit cursor-pointer py-2 text-stone-100 ${seoFocusClass}`}
        >
          View ranking observations
        </summary>
        <table
          aria-label="Ranking observations"
          className="mt-2 w-full text-left text-stone-200"
        >
          <thead>
            <tr className="border-b border-stone-600">
              <th scope="col" className="py-2 pr-3 font-medium">
                Date
              </th>
              <th scope="col" className="py-2 font-medium">
                Average position
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr
                key={`${point.date}-${index}`}
                className="border-b border-stone-700"
              >
                <th scope="row" className="py-2 pr-3 font-normal">
                  {displayDate(point.date)}
                </th>
                <td className="py-2 tabular-nums">
                  {displayNumber(
                    validPosition(point.position) ? point.position : null,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
