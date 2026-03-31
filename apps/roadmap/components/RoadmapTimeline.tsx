"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import type { Feature, FeatureStatus, Lane } from "@/lib/features"

const DAY_MS = 86400000

const STATUS_COLORS: Record<FeatureStatus, string> = {
  "not-started": "bg-gray-700 border-gray-600 hover:bg-gray-600",
  "in-progress": "bg-blue-900/60 border-blue-500/50 hover:bg-blue-900/80",
  complete: "bg-green-900/60 border-green-500/50 hover:bg-green-900/80",
  blocked: "bg-red-900/60 border-red-500/50 hover:bg-red-900/80",
}

const STATUS_DOT: Record<FeatureStatus, string> = {
  "not-started": "bg-gray-400",
  "in-progress": "bg-blue-400",
  complete: "bg-green-400",
  blocked: "bg-red-400",
}

const PRIORITY_BORDER: Record<string, string> = {
  P0: "border-l-red-500 border-l-[3px]",
  P1: "border-l-yellow-500 border-l-[3px]",
  P2: "border-l-gray-500 border-l-[3px]",
}

const LANE_COLORS: Record<Lane, string> = {
  "content-discovery": "text-purple-400",
  "topic-experiences": "text-blue-400",
  "media-generation": "text-amber-400",
  platform: "text-gray-400",
}

type HighlightState =
  | "normal"
  | "hovered"
  | "dependency"
  | "blocked-by"
  | "dimmed"

const HIGHLIGHT_RING: Record<HighlightState, string> = {
  normal: "",
  hovered: "brightness-125 z-20",
  dependency: "brightness-125 z-20",
  "blocked-by": "brightness-125 z-20",
  dimmed: "opacity-65",
}

/** Parse YYYY-MM-DD to a Date at midnight UTC-safe local time */
function toDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00")
}

/** Build week columns spanning the timeline range, starting each Monday */
function buildWeekColumns(
  rangeStart: Date,
  rangeEnd: Date,
): { start: Date; label: string }[] {
  const columns: { start: Date; label: string }[] = []
  // Snap to the Monday on or before rangeStart
  const first = new Date(rangeStart)
  const day = first.getDay()
  const diffToMonday = day === 0 ? 6 : day - 1
  first.setDate(first.getDate() - diffToMonday)

  const cur = new Date(first)
  while (cur <= rangeEnd) {
    columns.push({
      start: new Date(cur),
      label: cur.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    })
    cur.setDate(cur.getDate() + 7)
  }
  return columns
}

function FeatureBlock({
  feature,
  rangeStart,
  totalDays,
  ownerAvatars,
  highlight,
  onHover,
  onLeave,
}: {
  feature: Feature
  rangeStart: Date
  totalDays: number
  ownerAvatars: Record<string, string | null>
  highlight: HighlightState
  onHover: () => void
  onLeave: () => void
}) {
  const start = toDate(feature.start_date)
  const daysFromStart = (start.getTime() - rangeStart.getTime()) / DAY_MS
  const leftPct = (daysFromStart / totalDays) * 100
  const widthPct = (feature.duration / totalDays) * 100
  const avatar = ownerAvatars[feature.owner]

  return (
    <Link
      href={`/ticket/${feature.id}`}
      className={`group absolute inset-y-0.5 flex cursor-pointer items-center gap-1 overflow-hidden rounded border px-1.5 transition-all duration-150 sm:gap-1.5 sm:px-2 ${STATUS_COLORS[feature.status]} ${PRIORITY_BORDER[feature.priority]} ${HIGHLIGHT_RING[highlight]}`}
      style={{
        left: `${leftPct}%`,
        width: `${Math.max(widthPct, 1)}%`,
      }}
      title={`${feature.id} | ${feature.title} (${feature.status}, ${feature.priority}, ${feature.owner})\n${feature.timeline}`}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      {avatar ? (
        <img
          src={`${avatar}&s=24`}
          alt={feature.owner}
          className="h-3.5 w-3.5 shrink-0 rounded-full bg-white"
        />
      ) : (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[feature.status]}`}
        />
      )}
      <span className="truncate text-[11px] font-medium text-gray-200 group-hover:text-white sm:text-xs">
        {feature.title}
      </span>
      {highlight === "dependency" && (
        <span className="ml-auto shrink-0 text-[9px] text-gray-400">dep</span>
      )}
      {highlight === "blocked-by" && (
        <span className="ml-auto shrink-0 text-[9px] text-gray-400">
          blocks
        </span>
      )}
    </Link>
  )
}

type Group = {
  key: string
  label: string
  avatar?: string | null
  href: string
  colorClass: string
  features: Feature[]
}

type GroupByMode = "lane" | "person"

export default function RoadmapTimeline({
  features,
  lanes,
  owners,
  laneLabels,
  ownerAvatars,
}: {
  features: Feature[]
  lanes: Lane[]
  owners: string[]
  laneLabels: Record<Lane, string>
  ownerAvatars: Record<string, string | null>
}) {
  const [groupBy, setGroupBy] = useState<GroupByMode>("lane")
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Only include features that have valid date-based timelines
  const timelineFeatures = features.filter(
    (f) => f.start_date && f.duration > 0,
  )

  // Compute the date range from all features
  const { rangeStart, totalDays, weekColumns, todayPct } = useMemo(() => {
    if (timelineFeatures.length === 0) {
      const now = new Date()
      return {
        rangeStart: now,
        totalDays: 1,
        weekColumns: [] as { start: Date; label: string }[],
        todayPct: null as number | null,
      }
    }

    let minDate = toDate(timelineFeatures[0].start_date)
    let maxDate = new Date(
      minDate.getTime() + timelineFeatures[0].duration * DAY_MS,
    )

    for (const f of timelineFeatures) {
      const s = toDate(f.start_date)
      const e = new Date(s.getTime() + f.duration * DAY_MS)
      if (s < minDate) minDate = s
      if (e > maxDate) maxDate = e
    }

    // Add a small buffer (3 days each side)
    const rStart = new Date(minDate.getTime() - 3 * DAY_MS)
    const rEnd = new Date(maxDate.getTime() + 3 * DAY_MS)
    const tDays = (rEnd.getTime() - rStart.getTime()) / DAY_MS

    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const todayOffset = (now.getTime() - rStart.getTime()) / DAY_MS
    const tPct =
      todayOffset >= 0 && todayOffset <= tDays
        ? (todayOffset / tDays) * 100
        : null

    return {
      rangeStart: rStart,
      totalDays: tDays,
      weekColumns: buildWeekColumns(rStart, rEnd),
      todayPct: tPct,
    }
  }, [timelineFeatures])

  // Precompute dependency lookup
  const depMap = useMemo(() => {
    const map = new Map<
      string,
      { dependsOn: Set<string>; blocks: Set<string> }
    >()
    for (const f of features) {
      map.set(f.id, {
        dependsOn: new Set(f.depends_on),
        blocks: new Set(f.blocks),
      })
    }
    return map
  }, [features])

  function getHighlight(featureId: string): HighlightState {
    if (!hoveredId) return "normal"
    if (featureId === hoveredId) return "hovered"
    const hovered = depMap.get(hoveredId)
    if (!hovered) return "dimmed"
    if (hovered.dependsOn.has(featureId)) return "dependency"
    if (hovered.blocks.has(featureId)) return "blocked-by"
    return "dimmed"
  }

  const groups: Group[] =
    groupBy === "lane"
      ? lanes.map((lane) => ({
          key: lane,
          label: laneLabels[lane],
          href: `/lane/${lane}`,
          colorClass: LANE_COLORS[lane],
          features: timelineFeatures.filter((f) => f.lane === lane),
        }))
      : owners.map((owner) => ({
          key: owner,
          label: owner,
          avatar: ownerAvatars[owner],
          href: `/person/${owner}`,
          colorClass: "text-gray-300",
          features: timelineFeatures.filter((f) => f.owner === owner),
        }))

  const visibleGroups = groups.filter((g) => g.features.length > 0)

  return (
    <div>
      {/* Toggle */}
      <div className="mb-4 flex w-fit items-center gap-1 rounded-lg bg-gray-800 p-1">
        <button
          onClick={() => setGroupBy("lane")}
          className={`cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            groupBy === "lane"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-white"
          }`}
        >
          By Lane
        </button>
        <button
          onClick={() => setGroupBy("person")}
          className={`cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            groupBy === "person"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-white"
          }`}
        >
          By Person
        </button>
      </div>

      {/* Timeline */}
      <div className="overflow-x-auto">
        <div className="relative min-w-[600px]">
          {/* Today hairline */}
          {todayPct !== null && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-red-500/70"
              style={{ left: `${todayPct}%` }}
            >
              <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 rounded bg-red-500 px-1 py-px text-[9px] font-medium whitespace-nowrap text-white">
                Today
              </div>
            </div>
          )}

          {/* Week column headers */}
          <div className="flex border-b border-gray-700 pb-2">
            {weekColumns.map((col, i) => {
              const colStart =
                (col.start.getTime() - rangeStart.getTime()) / DAY_MS
              const nextStart =
                i + 1 < weekColumns.length
                  ? (weekColumns[i + 1].start.getTime() -
                      rangeStart.getTime()) /
                    DAY_MS
                  : totalDays
              const widthPct = ((nextStart - colStart) / totalDays) * 100

              return (
                <div
                  key={col.start.toISOString()}
                  className="text-center"
                  style={{ width: `${widthPct}%` }}
                >
                  <div className="hidden text-[10px] text-gray-500 sm:block">
                    {col.label}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Grouped rows */}
          <div className="divide-y divide-gray-800">
            {visibleGroups.map((g) => {
              const sorted = [...g.features].sort((a, b) =>
                a.start_date.localeCompare(b.start_date),
              )

              return (
                <div key={g.key}>
                  <div className="flex items-center gap-2 py-2">
                    <Link
                      href={g.href}
                      className={`flex items-center gap-1.5 text-sm font-semibold capitalize ${g.colorClass} hover:underline`}
                    >
                      {g.avatar && (
                        <img
                          src={`${g.avatar}&s=32`}
                          alt={g.label}
                          className="h-4 w-4 rounded-full"
                        />
                      )}
                      {g.label}
                    </Link>
                    <span className="text-xs text-gray-500">
                      {g.features.length}
                    </span>
                  </div>
                  <div className="space-y-0">
                    {sorted.map((feature) => (
                      <div key={feature.id} className="relative h-7 sm:h-8">
                        {/* Grid lines at week boundaries */}
                        <div className="absolute inset-0">
                          {weekColumns.map((col) => {
                            const colLeft =
                              ((col.start.getTime() - rangeStart.getTime()) /
                                DAY_MS /
                                totalDays) *
                              100
                            return (
                              <div
                                key={col.start.toISOString()}
                                className="absolute top-0 bottom-0 w-px border-r border-gray-800"
                                style={{ left: `${colLeft}%` }}
                              />
                            )
                          })}
                        </div>
                        <FeatureBlock
                          feature={feature}
                          rangeStart={rangeStart}
                          totalDays={totalDays}
                          ownerAvatars={ownerAvatars}
                          highlight={getHighlight(feature.id)}
                          onHover={() => setHoveredId(feature.id)}
                          onLeave={() => setHoveredId(null)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
