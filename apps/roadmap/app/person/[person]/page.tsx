import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import {
  getFeaturesByOwner,
  getAllOwners,
  getLaneLabel,
  ALL_LANES,
  type Feature,
  type FeatureStatus,
  type Lane,
} from "@/lib/features"
import StatusBadge from "@/components/StatusBadge"
import { StatusCard } from "@/components/StatusBoard"
import { OwnerAvatar } from "@/components/OwnerAvatar"

export function generateStaticParams() {
  return getAllOwners().map((person) => ({ person }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ person: string }>
}): Promise<Metadata> {
  const { person } = await params
  return {
    title: `${person} — JFP DS AI Roadmap`,
  }
}

const STATUS_COLUMNS: { status: FeatureStatus; accent: string }[] = [
  { status: "blocked", accent: "border-red-500/50" },
  { status: "not-started", accent: "border-gray-500/50" },
  { status: "in-progress", accent: "border-blue-500/50" },
  { status: "complete", accent: "border-green-500/50" },
]

const LANE_COLORS: Record<Lane, string> = {
  "content-discovery": "border-purple-500/30 text-purple-400",
  "topic-experiences": "border-blue-500/30 text-blue-400",
  "media-generation": "border-amber-500/30 text-amber-400",
  platform: "border-gray-500/30 text-gray-400",
}

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2 }

function sortByPriority(features: Feature[]): Feature[] {
  return [...features].sort(
    (a, b) =>
      (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9),
  )
}

export default async function PersonPage({
  params,
}: {
  params: Promise<{ person: string }>
}) {
  const { person } = await params
  if (!getAllOwners().includes(person)) notFound()

  const features = getFeaturesByOwner(person)
  const activeLanes = ALL_LANES.filter((lane) =>
    features.some((f) => f.lane === lane),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-bold">
          <OwnerAvatar owner={person} size="large" linked={false} />
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          {features.length} features assigned
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
            {activeLanes.map((lane) => {
              const laneFeatures = features.filter((f) => f.lane === lane)
              return (
                <div key={lane} className="py-3">
                  <Link
                    href={`/lane/${lane}`}
                    className={`mb-2 inline-flex items-center gap-2 text-xs font-semibold ${LANE_COLORS[lane]} hover:underline`}
                  >
                    {getLaneLabel(lane)}
                    <span className="text-gray-500">{laneFeatures.length}</span>
                  </Link>
                  <div className="grid grid-cols-4 gap-4">
                    {STATUS_COLUMNS.map(({ status }) => {
                      const items = sortByPriority(
                        laneFeatures.filter((f) => f.status === status),
                      )
                      return (
                        <div key={status} className="space-y-2">
                          {items.map((f) => (
                            <StatusCard
                              key={f.id}
                              feature={f}
                              subtitleField="lane"
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
