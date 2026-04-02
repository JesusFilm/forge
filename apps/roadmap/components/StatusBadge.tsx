import type { FeatureStatus } from "@/lib/features"

const STATUS_STYLES: Record<FeatureStatus, string> = {
  "not-started": "bg-gray-500/20 text-gray-400 border-gray-500/30",
  "in-progress": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  complete: "bg-green-500/20 text-green-400 border-green-500/30",
  blocked: "bg-red-500/20 text-red-400 border-red-500/30",
}

const STATUS_LABELS: Record<FeatureStatus, string> = {
  "not-started": "Not Started",
  "in-progress": "In Progress",
  complete: "Complete",
  blocked: "Blocked",
}

export default function StatusBadge({ status }: { status: FeatureStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
