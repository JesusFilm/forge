"use client"

import { useState } from "react"
import Link from "next/link"
import type { Feature, FeatureStatus, Lane } from "@/lib/features"

const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8]

const WEEK_LABELS: Record<number, string> = {
  1: "Apr 1",
  2: "Apr 7",
  3: "Apr 14",
  4: "Apr 21",
  5: "Apr 28",
  6: "May 5",
  7: "May 12",
  8: "May 19",
}

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
  P0: "border-l-red-500",
  P1: "border-l-yellow-500",
  P2: "border-l-gray-500",
}

const LANE_COLORS: Record<Lane, string> = {
  "content-discovery": "text-purple-400",
  "topic-experiences": "text-blue-400",
  "media-generation": "text-amber-400",
  platform: "text-gray-400",
}

function parseWeekRange(timeline: string): { start: number; end: number } {
  const match = timeline.match(/Week\s+(\d+)(?:\s*-\s*(\d+))?/)
  if (!match) return { start: 1, end: 1 }
  const start = parseInt(match[1], 10)
  const end = match[2] ? parseInt(match[2], 10) : start
  return { start, end }
}

function FeatureBlock({
  feature,
  groupBy,
}: {
  feature: Feature
  groupBy: "lane" | "person"
}) {
  const { start, end } = parseWeekRange(feature.timeline)
  const subtitle =
    groupBy === "lane" ? feature.owner : feature.lane.replace(/-/g, " ")

  return (
    <Link
      href={`/ticket/${feature.id}`}
      className={`group absolute inset-y-0.5 flex items-center gap-1 overflow-hidden rounded border border-l-2 px-1.5 transition-colors sm:gap-1.5 sm:px-2 ${STATUS_COLORS[feature.status]} ${PRIORITY_BORDER[feature.priority]}`}
      style={{
        left: `${((start - 1) / WEEKS.length) * 100}%`,
        width: `${((end - start + 1) / WEEKS.length) * 100}%`,
      }}
      title={`${feature.id} — ${feature.title} (${feature.status}, ${feature.priority}, ${feature.owner})`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[feature.status]}`}
      />
      <span className="truncate text-[11px] font-medium text-gray-200 group-hover:text-white sm:text-xs">
        {feature.title}
      </span>
      <span className="ml-auto hidden shrink-0 text-[10px] capitalize text-gray-400 group-hover:inline">
        {subtitle}
      </span>
    </Link>
  )
}

type Group = {
  key: string
  label: string
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
}: {
  features: Feature[]
  lanes: Lane[]
  owners: string[]
  laneLabels: Record<Lane, string>
}) {
  const [groupBy, setGroupBy] = useState<GroupByMode>("lane")

  const groups: Group[] =
    groupBy === "lane"
      ? lanes.map((lane) => ({
          key: lane,
          label: laneLabels[lane],
          href: `/lane/${lane}`,
          colorClass: LANE_COLORS[lane],
          features: features.filter((f) => f.lane === lane),
        }))
      : owners.map((owner) => ({
          key: owner,
          label: owner,
          href: `/person/${owner}`,
          colorClass: "text-gray-300",
          features: features.filter((f) => f.owner === owner),
        }))

  const visibleGroups = groups.filter((g) => g.features.length > 0)

  return (
    <div>
      {/* Toggle */}
      <div className="mb-4 flex w-fit items-center gap-1 rounded-lg bg-gray-800 p-1">
        <button
          onClick={() => setGroupBy("lane")}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            groupBy === "lane"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-white"
          }`}
        >
          By Lane
        </button>
        <button
          onClick={() => setGroupBy("person")}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
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
        <div className="min-w-[600px]">
          {/* Week headers */}
          <div className="flex border-b border-gray-700 pb-2">
            {WEEKS.map((w) => (
              <div key={w} className="flex-1 text-center">
                <div className="text-xs font-medium text-gray-300">Wk {w}</div>
                <div className="hidden text-[10px] text-gray-500 sm:block">
                  {WEEK_LABELS[w]}
                </div>
              </div>
            ))}
          </div>

          {/* Grouped rows */}
          <div className="divide-y divide-gray-800">
            {visibleGroups.map((g) => {
              const sorted = [...g.features].sort((a, b) => {
                const aWeek = parseWeekRange(a.timeline).start
                const bWeek = parseWeekRange(b.timeline).start
                return aWeek - bWeek
              })

              return (
                <div key={g.key}>
                  <div className="flex items-center gap-2 py-2">
                    <Link
                      href={g.href}
                      className={`text-sm font-semibold capitalize ${g.colorClass} hover:underline`}
                    >
                      {g.label}
                    </Link>
                    <span className="text-xs text-gray-500">
                      {g.features.length}
                    </span>
                  </div>
                  <div className="space-y-0">
                    {sorted.map((feature) => (
                      <div key={feature.id} className="relative h-7 sm:h-8">
                        <div className="absolute inset-0 flex">
                          {WEEKS.map((w) => (
                            <div
                              key={w}
                              className="flex-1 border-r border-gray-800"
                            />
                          ))}
                        </div>
                        <FeatureBlock feature={feature} groupBy={groupBy} />
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
