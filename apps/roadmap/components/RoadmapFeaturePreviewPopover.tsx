import type { Feature } from "@/lib/features"
import StatusBadge from "./StatusBadge"
import PriorityBadge from "./PriorityBadge"

type Props = {
  feature: Feature
  laneLabel: string
  ownerAvatar?: string | null
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function MetaLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">
      {children}
    </div>
  )
}

export default function RoadmapFeaturePreviewPopover({
  feature,
  laneLabel,
  ownerAvatar,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  return (
    <div
      className="pointer-events-auto fixed bottom-4 left-4 z-50 flex h-[min(38rem,calc(100vh-2rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-sm"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="mb-3 flex items-center justify-between gap-3 text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">
        <span>{laneLabel}</span>
        <span className="font-mono">{feature.id}</span>
      </div>

      <div className="mb-4 flex items-start gap-3">
        <PriorityBadge priority={feature.priority} />
        <h3 className="min-w-0 flex-1 text-base font-semibold leading-tight text-white">
          {feature.title}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <div>
          <MetaLabel>Status</MetaLabel>
          <StatusBadge status={feature.status} />
        </div>
        <div>
          <MetaLabel>Timeline</MetaLabel>
          <div className="text-sm text-stone-200">{feature.timeline}</div>
        </div>
        <div>
          <MetaLabel>Owner</MetaLabel>
          <div className="flex items-center gap-2 text-sm">
            {ownerAvatar ? (
              <img
                src={`${ownerAvatar}&s=40`}
                alt={feature.owner}
                className="h-5 w-5 rounded-full bg-white"
              />
            ) : (
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-stone-700 text-[9px] font-medium uppercase text-stone-400">
                {feature.owner[0]}
              </span>
            )}
            <span className="capitalize text-stone-200">{feature.owner}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        {feature.tags.length > 0 && (
          <div className="col-span-2">
            <MetaLabel>Tags</MetaLabel>
            <div className="flex flex-wrap gap-1.5">
              {feature.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-stone-800 px-2 py-0.5 text-xs text-stone-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <h4 className="border-b border-[var(--color-border)] pb-2 text-lg font-semibold text-white">
          Problem
        </h4>
        <p
          className="mt-3 overflow-hidden text-sm leading-7 text-stone-300 [display:-webkit-box] [-webkit-box-orient:vertical]"
          style={{ WebkitLineClamp: 11 }}
        >
          {feature.problemPreview}
        </p>
      </div>
    </div>
  )
}
