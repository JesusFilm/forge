import type { ContainerSection, SectionBlock } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"

import { SectionRenderer } from "../SectionRenderer"

type ContainerPreviewProps = {
  section: ContainerSection
}

function gridColsClass(span: number): string {
  const map: Record<number, string> = {
    1: "col-span-1",
    2: "col-span-2",
    3: "col-span-3",
    4: "col-span-4",
    5: "col-span-5",
    6: "col-span-6",
    7: "col-span-7",
    8: "col-span-8",
    9: "col-span-9",
    10: "col-span-10",
    11: "col-span-11",
    12: "col-span-12",
  }
  return map[span] ?? "col-span-12"
}

export function ContainerPreview({ section }: ContainerPreviewProps) {
  return (
    <div className="grid grid-cols-12 gap-3">
      {(section.slots ?? []).map((slot, i) => (
        <div
          key={i}
          className={cn(
            gridColsClass(slot.gridSpan ?? 12),
            "space-y-2 rounded-lg border border-dashed border-neutral-300 p-3",
          )}
        >
          <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
            Slot {i + 1} ({slot.gridSpan}-col)
          </span>
          {(slot.content ?? []).map((block: SectionBlock, j: number) => (
            <SectionRenderer key={j} block={block} />
          ))}
        </div>
      ))}
    </div>
  )
}
