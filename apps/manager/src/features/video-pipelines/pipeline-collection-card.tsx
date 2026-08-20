import { ArrowUpRight, Monitor, Smartphone } from "lucide-react"
import {
  computeAggregateStatus,
  formatCellDate,
  formatCellRowLabel,
  getCellDayOfMonth,
  type VideoPipelineCell,
  type VideoPipelineCollection,
} from "./video-pipeline-model"

export function PipelineCellIcons({ cell }: { cell: VideoPipelineCell }) {
  return (
    <span className="pipeline-cell-icons">
      <Smartphone
        className={`pipeline-cell-icon${
          cell.mobileGenerated
            ? " pipeline-cell-icon--generated"
            : " pipeline-cell-icon--pending"
        }`}
        size={14}
        aria-label={
          cell.mobileGenerated ? "Mobile generated" : "Mobile pending"
        }
      />
      <Monitor
        className={`pipeline-cell-icon${
          cell.desktopGenerated
            ? " pipeline-cell-icon--generated"
            : " pipeline-cell-icon--pending"
        }`}
        size={14}
        aria-label={
          cell.desktopGenerated ? "Desktop generated" : "Desktop pending"
        }
      />
    </span>
  )
}

/**
 * Video Pipelines' equivalent of coverage-report-client.tsx's CollectionCard
 * — expand-by-click, hover-to-preview — but with its own cell shape (two
 * independent mobile/desktop generated icons instead of a single-status
 * colored tile). The expanded detail list is ordered by date (Aug 1 -> Aug
 * 31), not grouped by generation status; a finished day (both aspects
 * generated) gets an external-link icon that opens its preview page. See
 * Key Technical Decisions 1 and 3 in the Video Pipelines plan.
 */
export function VideoPipelineCollectionCard({
  collection,
  isExpanded,
  onHoverCell,
  onToggleCell,
  onToggleExpanded,
  selectedCellIds,
}: {
  collection: VideoPipelineCollection
  isExpanded: boolean
  onHoverCell: (cell: VideoPipelineCell | null) => void
  onToggleCell: (cellId: string) => void
  onToggleExpanded: () => void
  selectedCellIds: ReadonlySet<string>
}) {
  const total = collection.cells.length

  const renderCell = (cell: VideoPipelineCell) => {
    const isSelected = selectedCellIds.has(cell.id)
    const status = computeAggregateStatus(cell)
    const isFinished = status === "generated"
    const statusLabel = isFinished ? "Generated" : "Not generated"

    return (
      <button
        key={cell.id}
        type="button"
        aria-pressed={isSelected}
        className={`tile tile--video tile--coverage pipeline-cell-tile tile--${
          isFinished ? "human" : "pipeline-pending"
        }${isSelected ? " is-selected" : ""}`}
        aria-label={`${cell.title} — ${formatCellDate(cell.date)} — ${statusLabel}`}
        onClick={() => onToggleCell(cell.id)}
        onMouseEnter={() => onHoverCell(cell)}
        onMouseLeave={() => onHoverCell(null)}
        onFocus={() => onHoverCell(cell)}
        onBlur={() => onHoverCell(null)}
      >
        <span
          className={`pipeline-tile-day${
            isFinished
              ? " pipeline-tile-day--generated"
              : " pipeline-tile-day--pending"
          }`}
          aria-hidden="true"
        >
          {getCellDayOfMonth(cell.date)}
        </span>
        <span className="tile-checkbox" aria-hidden="true">
          <span className="tile-checkbox-box" />
        </span>
      </button>
    )
  }

  return (
    <section className="collection-card collection-card--pipeline">
      <div
        className="collection-header"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={onToggleExpanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onToggleExpanded()
          }
        }}
      >
        <div className="collection-title-row">
          <div className="collection-title-block">
            <div className="collection-title-line">
              <h2 className="collection-title">{collection.title}</h2>
              <span
                className={`collection-label collection-label--${collection.label}`}
                aria-label={`Media type: ${collection.labelDisplay}`}
              >
                {collection.labelDisplay}
              </span>
            </div>
            <div className="collection-meta-row">
              <p className="collection-meta">
                {total} video{total === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className={`collection-divider${isExpanded ? " is-open" : ""}`}>
        <button
          type="button"
          className="collection-toggle"
          onClick={(event) => {
            event.stopPropagation()
            onToggleExpanded()
          }}
          aria-expanded={isExpanded}
        >
          {isExpanded ? "Hide details" : "Show details"}
        </button>
      </div>

      <div className={`collection-details${isExpanded ? " is-open" : ""}`}>
        <div
          className="detail-group-list"
          style={{
            gridTemplateRows: `repeat(${Math.max(
              1,
              Math.ceil(total / 2),
            )}, auto)`,
          }}
        >
          {collection.cells.map((cell) => {
            const isSelected = selectedCellIds.has(cell.id)
            const status = computeAggregateStatus(cell)
            const isFinished = status === "generated"

            return (
              <div
                className="collection-detail-row pipeline-detail-row"
                key={cell.id}
                onMouseEnter={() => onHoverCell(cell)}
                onMouseLeave={() => onHoverCell(null)}
              >
                <label className="pipeline-detail-row-select">
                  <input
                    type="checkbox"
                    className={`detail-row-checkbox ${
                      isFinished
                        ? "detail-row-checkbox--human"
                        : "detail-row-checkbox--pipeline-pending"
                    }`}
                    checked={isSelected}
                    onChange={() => onToggleCell(cell.id)}
                  />
                  <span className="detail-content">
                    {formatCellRowLabel(cell)}
                  </span>
                </label>
                {isFinished ? (
                  <a
                    className="pipeline-preview-link"
                    href={`/dashboard/video-pipelines/${cell.id}/preview`}
                    aria-label={`Preview ${cell.title} videos`}
                    title="Preview videos"
                  >
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div className={`collection-tiles${isExpanded ? " is-hidden" : ""}`}>
        {collection.cells.map(renderCell)}
      </div>
    </section>
  )
}
