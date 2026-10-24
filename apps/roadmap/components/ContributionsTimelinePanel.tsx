"use client"

import { useState } from "react"
import type { Feature, Lane } from "@/lib/features"
import RoadmapTimeline, { type GroupByMode } from "./RoadmapTimeline"

export default function ContributionsTimelinePanel({
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

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
            Tasks view
          </div>
          <p className="mt-1 text-sm text-stone-400">
            Live contribution schedule from docs/roadmap.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex w-fit items-center gap-1 rounded-lg bg-stone-800 p-1">
            <button
              onClick={() => setGroupBy("lane")}
              className={`cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                groupBy === "lane"
                  ? "bg-stone-700 text-white"
                  : "text-stone-400 hover:text-white"
              }`}
            >
              By Lane
            </button>
            <button
              onClick={() => setGroupBy("person")}
              className={`cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                groupBy === "person"
                  ? "bg-stone-700 text-white"
                  : "text-stone-400 hover:text-white"
              }`}
            >
              By Person
            </button>
          </div>
        </div>
      </div>

      <RoadmapTimeline
        features={features}
        lanes={lanes}
        owners={owners}
        laneLabels={laneLabels}
        ownerAvatars={ownerAvatars}
        groupBy={groupBy}
      />
    </div>
  )
}
