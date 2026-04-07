import Link from "next/link"
import type { Feature } from "@/lib/features"
import StatusBadge from "./StatusBadge"
import PriorityBadge from "./PriorityBadge"

export default function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <Link
      href={`/ticket/${feature.id}`}
      className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 transition-colors hover:border-stone-500"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-tight">{feature.title}</h3>
        <PriorityBadge priority={feature.priority} />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={feature.status} />
        <span className="text-xs text-stone-400">{feature.timeline}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-stone-400">
        <span className="capitalize">{feature.owner}</span>
        <span className="capitalize">{feature.lane.replace(/-/g, " ")}</span>
      </div>
      {feature.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {feature.tags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] text-stone-400"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}
