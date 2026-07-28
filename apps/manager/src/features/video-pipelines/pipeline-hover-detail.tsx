import type { CSSProperties } from "react"
import type { VideoPipelineCell } from "./video-pipeline-model"
import { formatCellDate } from "./video-pipeline-model"

/**
 * Replaces the coverage report's description-style hover detail with a
 * thumbnail, title, and date — reusing the existing
 * `.translation-bar.is-detail.is-preview` markup pattern so the visual
 * treatment matches the reference report.
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
              className="detail-thumb"
              src={hoveredCell.thumbnailUrl}
              alt={hoveredCell.title}
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
          </div>
        </div>
      </div>
    </div>
  )
}
