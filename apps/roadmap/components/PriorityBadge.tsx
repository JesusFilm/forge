import type { Priority } from "@/lib/features"

const PRIORITY_STYLES: Record<Priority, string> = {
  P0: "bg-red-500/20 text-red-400 border-red-500/30",
  P1: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  P2: "bg-stone-500/20 text-stone-400 border-stone-500/30",
}

export default function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${PRIORITY_STYLES[priority]}`}
    >
      {priority}
    </span>
  )
}
