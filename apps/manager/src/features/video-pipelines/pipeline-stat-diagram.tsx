"use client"

import type { VideoPipelineAggregateStatus } from "./video-pipeline-model"

export type PipelineStatCounts = { generated: number; none: number }

function formatPercent(count: number, total: number): number {
  if (total === 0) return 0
  return Math.round((count / total) * 100)
}

/**
 * Two-segment stat cards (Generated / Not Generated) for the Video
 * Pipelines report. Deliberately a small local component rather than a
 * variant of the shared CoverageNumberDiagram, which is coupled to the
 * human/ai/none CoverageStatus union used by the real per-language
 * coverage engine — see Key Technical Decision 3 in the Video Pipelines
 * plan. There is no "AI" segment here by construction, not by hiding one.
 */
export function PipelineStatDiagram({
  counts,
  ariaLabel = "Video pipeline generation status",
}: {
  counts: PipelineStatCounts
  ariaLabel?: string
}) {
  const total = counts.generated + counts.none
  const generatedPercent = formatPercent(counts.generated, total)
  const nonePercent = total === 0 ? 0 : Math.max(0, 100 - generatedPercent)

  const segments: Array<{
    key: VideoPipelineAggregateStatus
    label: string
    percent: number
  }> = [
    { key: "generated", label: "Generated", percent: generatedPercent },
    { key: "none", label: "Not Generated", percent: nonePercent },
  ]

  return (
    <div className="coverage-number-diagram" aria-label={ariaLabel}>
      {segments.map((segment) => (
        <span
          key={segment.key}
          className={`coverage-number-item coverage-number-item--${
            segment.key === "generated" ? "human" : "none"
          }`}
          aria-label={`${segment.label} ${segment.percent}%`}
        >
          <span className="coverage-number-value">
            {segment.percent}
            <span className="coverage-number-percent">%</span>
          </span>
          <span className="coverage-number-label">{segment.label}</span>
        </span>
      ))}
    </div>
  )
}
