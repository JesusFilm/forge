import {
  getAllFeatures,
  getStatusCounts,
  ALL_LANES,
  getAllOwners,
  getLaneLabel,
  getOwnerProfile,
  type Lane,
} from "@/lib/features"
import RoadmapTimeline from "@/components/RoadmapTimeline"

export default function DashboardPage() {
  const features = getAllFeatures()
  const totals = getStatusCounts(features)
  const owners = getAllOwners()
  const laneLabels = Object.fromEntries(
    ALL_LANES.map((l) => [l, getLaneLabel(l)]),
  ) as Record<Lane, string>
  const ownerAvatars = Object.fromEntries(
    owners.map((o) => [o, getOwnerProfile(o)?.avatar ?? null]),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">DS Year 1 Roadmap</h1>
        <p className="mt-1 text-sm text-gray-400">
          April – May 2026 · {features.length} features
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Not Started"
          count={totals["not-started"]}
          color="text-gray-400"
        />
        <StatCard
          label="In Progress"
          count={totals["in-progress"]}
          color="text-blue-400"
        />
        <StatCard
          label="Complete"
          count={totals.complete}
          color="text-green-400"
        />
        <StatCard label="Blocked" count={totals.blocked} color="text-red-400" />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-gray-400" /> Not
          Started
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-400" /> In
          Progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-green-400" />{" "}
          Complete
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-red-400" />{" "}
          Blocked
        </span>
        <span className="flex items-center gap-2 border-l border-gray-700 pl-3">
          <span className="border-l-2 border-l-red-500 pl-1">P0</span>
          <span className="border-l-2 border-l-yellow-500 pl-1">P1</span>
          <span className="border-l-2 border-l-gray-500 pl-1">P2</span>
        </span>
      </div>

      {/* Roadmap timeline with toggle */}
      <RoadmapTimeline
        features={features}
        lanes={ALL_LANES}
        owners={owners}
        laneLabels={laneLabels}
        ownerAvatars={ownerAvatars}
      />
    </div>
  )
}

function StatCard({
  label,
  count,
  color,
}: {
  label: string
  count: number
  color: string
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 sm:p-4">
      <div className={`text-2xl font-bold sm:text-3xl ${color}`}>{count}</div>
      <div className="mt-1 text-xs text-gray-400 sm:text-sm">{label}</div>
    </div>
  )
}
