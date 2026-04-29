import Link from "next/link"
import {
  getAllFeatures,
  getStatusCounts,
  ALL_LANES,
  getAllOwners,
  getLaneLabel,
  getOwnerProfile,
  type Lane,
} from "@/lib/features"
import ContributionsTimelinePanel from "@/components/ContributionsTimelinePanel"

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

export default function ContributionsPage() {
  const features = getAllFeatures()
  const totals = getStatusCounts(features)
  const owners = getAllOwners()
  const roadmapRange = formatRoadmapRange(features)
  const laneLabels = Object.fromEntries(
    ALL_LANES.map((l) => [l, getLaneLabel(l)]),
  ) as Record<Lane, string>
  const ownerAvatars = Object.fromEntries(
    owners.map((o) => [o, getOwnerProfile(o)?.avatar ?? null]),
  )

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-6 pb-2 pt-8 lg:flex-row lg:justify-between">
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">
            Work Tracking
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Tasks
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-stone-400">
            {roadmapRange} · {features.length} features
          </p>
        </div>

        <div className="self-start lg:self-center lg:text-right">
          <Link
            href="/roadmap"
            className="inline-flex items-center gap-2 rounded-xl border border-stone-700 bg-stone-900 px-3.5 py-2.5 text-base font-semibold text-white transition-colors hover:border-stone-500 hover:bg-stone-800"
          >
            <svg
              className="h-3.5 w-3.5 text-stone-300"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M3.5 15.5V6.5M8.25 15.5V9.5M13 15.5V4.5M17 15.5H3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Open Roadmap View</span>
          </Link>
          <p className="mt-2 max-w-[240px] text-sm leading-snug text-stone-500/80 lg:ml-auto">
            See the strategic roadmap and phased release plan
          </p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Not Started"
          count={totals["not-started"]}
          color="text-stone-400"
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

      <ContributionsTimelinePanel
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
      <div className="mt-1 text-xs text-stone-400 sm:text-sm">{label}</div>
    </div>
  )
}
