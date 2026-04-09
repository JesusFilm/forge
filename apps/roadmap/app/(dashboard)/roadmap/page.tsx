import Link from "next/link"
import {
  getAllFeatures,
  getStatusCounts,
  ALL_LANES,
  getAllOwners,
  getLaneLabel,
  getOwnerProfile,
  type Lane,
  type FeatureStatus,
} from "@/lib/features"
import RoadmapTimeline from "@/components/RoadmapTimeline"

const VALID_STATUSES: FeatureStatus[] = [
  "not-started",
  "in-progress",
  "complete",
  "blocked",
]

const STATUS_LABELS: Record<FeatureStatus, string> = {
  "not-started": "Not Started",
  "in-progress": "In Progress",
  complete: "Complete",
  blocked: "Blocked",
}

function formatRoadmapRange(
  features: ReturnType<typeof getAllFeatures>,
): string {
  const datedFeatures = features.filter((feature) => feature.start_date)
  if (datedFeatures.length === 0) return "No scheduled range"

  let minDate = new Date(datedFeatures[0].start_date + "T00:00:00")
  let maxDate = new Date(
    minDate.getTime() + (datedFeatures[0].duration - 1) * 86400000,
  )

  for (const feature of datedFeatures) {
    const start = new Date(feature.start_date + "T00:00:00")
    const end = new Date(start.getTime() + (feature.duration - 1) * 86400000)
    if (start < minDate) minDate = start
    if (end > maxDate) maxDate = end
  }

  const sameYear = minDate.getFullYear() === maxDate.getFullYear()
  const sameMonth = sameYear && minDate.getMonth() === maxDate.getMonth()

  if (sameMonth) {
    return minDate.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    })
  }

  if (sameYear) {
    return `${minDate.toLocaleDateString("en-US", {
      month: "long",
    })} – ${maxDate.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    })}`
  }

  return `${minDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })} – ${maxDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })}`
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status: statusParam } = await searchParams
  const activeStatus =
    statusParam && VALID_STATUSES.includes(statusParam as FeatureStatus)
      ? (statusParam as FeatureStatus)
      : null

  const allFeatures = getAllFeatures()
  const totals = getStatusCounts(allFeatures)
  const features = activeStatus
    ? allFeatures.filter((f) => f.status === activeStatus)
    : allFeatures
  const owners = getAllOwners()
  const roadmapRange = formatRoadmapRange(allFeatures)
  const laneLabels = Object.fromEntries(
    ALL_LANES.map((l) => [l, getLaneLabel(l)]),
  ) as Record<Lane, string>
  const ownerAvatars = Object.fromEntries(
    owners.map((o) => [o, getOwnerProfile(o)?.avatar ?? null]),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Roadmap</h1>
        <p className="mt-1 text-sm text-stone-400">
          {roadmapRange} · {features.length} features
          {activeStatus && ` · Filtered: ${STATUS_LABELS[activeStatus]}`}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Not Started"
          count={totals["not-started"]}
          color="text-stone-400"
          href="/roadmap?status=not-started"
          active={activeStatus === "not-started"}
        />
        <StatCard
          label="In Progress"
          count={totals["in-progress"]}
          color="text-blue-400"
          href="/roadmap?status=in-progress"
          active={activeStatus === "in-progress"}
        />
        <StatCard
          label="Complete"
          count={totals.complete}
          color="text-green-400"
          href="/roadmap?status=complete"
          active={activeStatus === "complete"}
        />
        <StatCard
          label="Blocked"
          count={totals.blocked}
          color="text-red-400"
          href="/roadmap?status=blocked"
          active={activeStatus === "blocked"}
        />
      </div>

      {/* Active filter indicator */}
      {activeStatus && (
        <div className="flex items-center gap-2 text-sm text-stone-400">
          <span>
            Showing{" "}
            <strong className="text-stone-200">
              {STATUS_LABELS[activeStatus]}
            </strong>{" "}
            tickets
          </span>
          <Link
            href="/roadmap"
            className="rounded bg-stone-800 px-2 py-0.5 text-xs text-stone-400 hover:bg-stone-700 hover:text-white"
          >
            Clear filter
          </Link>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-stone-400" />{" "}
          Not Started
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
        <span className="flex items-center gap-2 border-l border-stone-700 pl-3">
          <span className="border-l-2 border-l-red-500 pl-1">P0</span>
          <span className="border-l-2 border-l-yellow-500 pl-1">P1</span>
          <span className="border-l-2 border-l-stone-500 pl-1">P2</span>
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
  href,
  active,
}: {
  label: string
  count: number
  color: string
  href: string
  active: boolean
}) {
  return (
    <Link
      href={active ? "/roadmap" : href}
      className={`rounded-lg border p-3 transition-colors sm:p-4 ${
        active
          ? "border-stone-500 bg-stone-800"
          : "border-[var(--color-border)] bg-[var(--color-card)] hover:border-stone-500"
      }`}
    >
      <div className={`text-2xl font-bold sm:text-3xl ${color}`}>{count}</div>
      <div className="mt-1 text-xs text-stone-400 sm:text-sm">{label}</div>
    </Link>
  )
}
