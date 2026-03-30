import Link from "next/link"
import type { Feature, FeatureStatus } from "@/lib/features"

type Props = {
  label: string
  href: string
  features: Feature[]
}

const STATUS_BG: Record<FeatureStatus, string> = {
  "not-started": "bg-gray-700 border-gray-600",
  "in-progress": "bg-blue-900/60 border-blue-500/50",
  complete: "bg-green-900/60 border-green-500/50",
  blocked: "bg-red-900/60 border-red-500/50",
}

const STATUS_DOT: Record<FeatureStatus, string> = {
  "not-started": "bg-gray-400",
  "in-progress": "bg-blue-400",
  complete: "bg-green-400",
  blocked: "bg-red-400",
}

const PRIORITY_ACCENT: Record<string, string> = {
  P0: "border-l-red-500",
  P1: "border-l-yellow-500",
  P2: "border-l-gray-500",
}

export default function ProgressBar({ label, href, features }: Props) {
  if (features.length === 0) return null

  const complete = features.filter((f) => f.status === "complete").length
  const inProgress = features.filter((f) => f.status === "in-progress").length
  const blocked = features.filter((f) => f.status === "blocked").length
  const pct = Math.round((complete / features.length) * 100)

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <Link href={href} className="font-semibold capitalize hover:text-white">
          {label}
        </Link>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {blocked > 0 && (
            <span className="text-red-400">{blocked} blocked</span>
          )}
          {inProgress > 0 && (
            <span className="text-blue-400">{inProgress} active</span>
          )}
          <span>
            {complete}/{features.length}{" "}
            <span className="text-gray-500">({pct}%)</span>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {features.map((f) => (
          <Link
            key={f.id}
            href={`/ticket/${f.id}`}
            title={`${f.id} — ${f.title} (${f.status}, ${f.priority}, ${f.owner})`}
            className={`flex items-center gap-1 rounded border border-l-2 px-2 py-1 text-xs transition-colors hover:brightness-125 ${STATUS_BG[f.status]} ${PRIORITY_ACCENT[f.priority]}`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[f.status]}`}
            />
            <span className="max-w-32 truncate text-gray-200">{f.title}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
