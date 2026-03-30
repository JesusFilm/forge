import { notFound } from "next/navigation"
import Link from "next/link"
import {
  getFeaturesByLane,
  getLaneLabel,
  getAllOwners,
  ALL_LANES,
  type Lane,
  type Feature,
  type FeatureStatus,
} from "@/lib/features"
import StatusBadge from "@/components/StatusBadge"
import { StatusCard } from "@/components/StatusBoard"

export function generateStaticParams() {
  return ALL_LANES.map((lane) => ({ lane }))
}

const STATUS_COLUMNS: { status: FeatureStatus; accent: string }[] = [
  { status: "blocked", accent: "border-red-500/50" },
  { status: "not-started", accent: "border-gray-500/50" },
  { status: "in-progress", accent: "border-blue-500/50" },
  { status: "complete", accent: "border-green-500/50" },
]

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2 }

function sortByPriority(features: Feature[]): Feature[] {
  return [...features].sort(
    (a, b) =>
      (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9),
  )
}

export default async function LanePage({
  params,
}: {
  params: Promise<{ lane: string }>
}) {
  const { lane } = await params
  if (!ALL_LANES.includes(lane as Lane)) notFound()

  const features = getFeaturesByLane(lane as Lane)
  const activeOwners = getAllOwners().filter((owner) =>
    features.some((f) => f.owner === owner),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{getLaneLabel(lane as Lane)}</h1>
        <p className="mt-1 text-sm text-gray-400">
          {features.length} features in this lane
        </p>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* Column headers */}
          <div className="mb-2 grid grid-cols-4 gap-4">
            {STATUS_COLUMNS.map(({ status, accent }) => {
              const count = features.filter((f) => f.status === status).length
              return (
                <div
                  key={status}
                  className={`flex items-center gap-2 border-t-2 pt-2 ${accent}`}
                >
                  <StatusBadge status={status} />
                  <span className="text-xs text-gray-500">{count}</span>
                </div>
              )
            })}
          </div>

          {/* Swimlanes */}
          <div className="divide-y divide-gray-800">
            {activeOwners.map((owner) => {
              const ownerFeatures = features.filter((f) => f.owner === owner)
              return (
                <div key={owner} className="py-3">
                  <Link
                    href={`/person/${owner}`}
                    className="mb-2 inline-flex items-center gap-2 text-xs font-semibold capitalize text-gray-300 hover:underline"
                  >
                    {owner}
                    <span className="text-gray-500">
                      {ownerFeatures.length}
                    </span>
                  </Link>
                  <div className="grid grid-cols-4 gap-4">
                    {STATUS_COLUMNS.map(({ status }) => {
                      const items = sortByPriority(
                        ownerFeatures.filter((f) => f.status === status),
                      )
                      return (
                        <div key={status} className="space-y-2">
                          {items.map((f) => (
                            <StatusCard
                              key={f.id}
                              feature={f}
                              subtitle={f.owner}
                            />
                          ))}
                        </div>
                      )
                    })}
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
