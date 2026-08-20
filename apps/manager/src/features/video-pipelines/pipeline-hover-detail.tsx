import type { CSSProperties } from "react"
import { PipelineCellIcons } from "./pipeline-collection-card"
import type { VideoPipelineCell } from "./video-pipeline-model"
import { computeAggregateStatus, formatCellDate } from "./video-pipeline-model"

/**
 * Replaces the coverage report's description-style hover detail with a
 * thumbnail, title, date, and the mobile/desktop generated-state icons —
 * reusing the existing `.translation-bar.is-detail.is-preview` markup
 * pattern so the visual treatment matches the reference report. The device
 * icons live only here, not inline in the expanded list rows.
 */
export function PipelineHoverDetailBar({
  hoveredCell,
}: {
  hoveredCell: VideoPipelineCell | null
}) {
  if (!hoveredCell) {
    return (
      <div className="translation-bar is-detail is-preview">
        <div className="translation-view translation-view--detail">
          <div className="translation-empty">
            Hover any cell to see its details.
          </div>
        </div>
      </div>
    )
  }

  const isFinished = computeAggregateStatus(hoveredCell) === "generated"

  return (
    <div
      className={`translation-bar is-detail is-preview${
        hoveredCell.thumbnailUrl ? " has-detail-bg" : ""
      }`}
      style={
        hoveredCell.thumbnailUrl
          ? ({
              "--detail-bg-image": `url("${hoveredCell.thumbnailUrl}")`,
            } as CSSProperties)
          : undefined
      }
      role="status"
      aria-live="polite"
    >
      <div className="translation-view translation-view--detail">
        <div className="detail-media">
          {hoveredCell.thumbnailUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              className={`detail-thumb${isFinished ? "" : " detail-thumb--pending"}`}
              src={hoveredCell.thumbnailUrl}
              alt={
                isFinished
                  ? hoveredCell.title
                  : `${hoveredCell.title} — not generated yet`
              }
            />
          ) : (
            <div
              className="detail-thumb detail-thumb--empty"
              aria-hidden="true"
            />
          )}
          <div className="detail-info">
            <div className="translation-summary">
              <div className="translation-count">{hoveredCell.title}</div>
              <div className="translation-target">
                {formatCellDate(hoveredCell.date)}
              </div>
            </div>
            <PipelineCellIcons cell={hoveredCell} />
          </div>
        </div>
      </div>
    </div>
  )
}
