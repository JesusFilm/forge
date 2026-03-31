import Link from "next/link"
import type { Feature, FeatureStatus } from "@/lib/features"
import StatusBadge from "./StatusBadge"
import PriorityBadge from "./PriorityBadge"
import { CopyBrainstormButton } from "./CopyBrainstormButton"
import { OwnerAvatar } from "./OwnerAvatar"

const COLUMNS: { status: FeatureStatus; accent: string }[] = [
  { status: "blocked", accent: "border-red-500/50" },
  { status: "not-started", accent: "border-gray-500/50" },
  { status: "in-progress", accent: "border-blue-500/50" },
  { status: "complete", accent: "border-green-500/50" },
]

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2 }

export function StatusCard({
  feature,
  subtitleField,
}: {
  feature: Feature
  subtitleField: "owner" | "lane"
}) {
  return (
    <div className="relative cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 transition-colors hover:border-gray-500">
      <Link
        href={`/ticket/${feature.id}`}
        className="absolute inset-0 z-0 rounded-lg"
        aria-label={feature.title}
      />
      <div className="pointer-events-none relative z-10 mb-2 flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-tight text-gray-200">
          {feature.title}
        </span>
        <PriorityBadge priority={feature.priority} />
      </div>
      <div className="pointer-events-none relative z-10 mb-2 text-xs text-gray-500">
        {feature.timeline}
      </div>
      <div className="relative z-10 flex items-center justify-between">
        <span className="pointer-events-none text-xs text-gray-400">
          {subtitleField === "owner" ? (
            <OwnerAvatar owner={feature.owner} size="small" linked={false} />
          ) : (
            <span className="capitalize">
              {feature.lane.replace(/-/g, " ")}
            </span>
          )}
        </span>
        <span className="pointer-events-auto">
          <CopyBrainstormButton filePath={feature.filePath} size="small" />
        </span>
      </div>
      {feature.depends_on.length > 0 && (
        <div className="pointer-events-none relative z-10 mt-2 border-t border-gray-800 pt-2">
          <span className="text-[10px] text-gray-500">
            Depends on: {feature.depends_on.join(", ")}
          </span>
        </div>
      )}
      {feature.blocks.length > 0 && (
        <div className="pointer-events-none relative z-10 mt-2 border-t border-gray-800 pt-2">
          <span className="text-[10px] text-yellow-500">
            Blocks: {feature.blocks.join(", ")}
          </span>
        </div>
      )}
    </div>
  )
}

function sortByPriority(features: Feature[]): Feature[] {
  return [...features].sort(
    (a, b) =>
      (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9),
  )
}

export function StatusBoard({
  features,
  subtitleField,
}: {
  features: Feature[]
  subtitleField: "owner" | "lane"
}) {
  const byStatus = new Map<FeatureStatus, Feature[]>()
  for (const f of features) {
    const list = byStatus.get(f.status) ?? []
    list.push(f)
    byStatus.set(f.status, list)
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {COLUMNS.map(({ status, accent }) => {
        const items = sortByPriority(byStatus.get(status) ?? [])
        return (
          <div key={status}>
            <div
              className={`mb-3 flex items-center gap-2 border-t-2 pt-2 ${accent}`}
            >
              <StatusBadge status={status} />
              <span className="text-xs text-gray-500">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((f) => (
                <StatusCard
                  key={f.id}
                  feature={f}
                  subtitleField={subtitleField}
                />
              ))}
              {items.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-800 p-4 text-center text-xs text-gray-600">
                  None
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
