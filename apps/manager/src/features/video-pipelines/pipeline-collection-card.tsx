import { Monitor, Smartphone } from "lucide-react"
import {
  computeAggregateStatus,
  formatCellDate,
  type VideoPipelineCell,
  type VideoPipelineCollection,
} from "./video-pipeline-model"

function PipelineCellIcons({ cell }: { cell: VideoPipelineCell }) {
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
 * colored tile) and grouped-by-aggregate-status detail view (Generated /
 * Not Generated, no AI bucket). See Key Technical Decisions 1 and 3 in the
 * Video Pipelines plan.
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
  const generatedCells = collection.cells.filter(
    (cell) => computeAggregateStatus(cell) === "generated",
  )
  const pendingCells = collection.cells.filter(
    (cell) => computeAggregateStatus(cell) === "none",
  )

  const renderCell = (cell: VideoPipelineCell) => {
    const isSelected = selectedCellIds.has(cell.id)
    const status = computeAggregateStatus(cell)
    const statusLabel = status === "generated" ? "Generated" : "Not generated"

    return (
      <button
        key={cell.id}
        type="button"
        aria-pressed={isSelected}
        className={`tile tile--video tile--coverage pipeline-cell-tile tile--${
          status === "generated" ? "human" : "none"
        }${isSelected ? " is-selected" : ""}`}
        aria-label={`${cell.title} — ${formatCellDate(cell.date)} — ${statusLabel}`}
        onClick={() => onToggleCell(cell.id)}
        onMouseEnter={() => onHoverCell(cell)}
        onMouseLeave={() => onHoverCell(null)}
        onFocus={() => onHoverCell(cell)}
        onBlur={() => onHoverCell(null)}
      >
        <span className="tile-checkbox" aria-hidden="true">
          <span className="tile-checkbox-box" />
        </span>
      </button>
    )
  }

  return (
    <section className="collection-card">
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
        {(
          [
            {
              key: "generated" as const,
              label: "Generated",
              cells: generatedCells,
            },
            {
              key: "none" as const,
              label: "Not Generated",
              cells: pendingCells,
            },
          ] as const
        ).map((group) =>
          group.cells.length === 0 ? null : (
            <div key={group.key} className="detail-group">
              <h3
                className={`detail-group-heading detail-group-heading--${group.key}`}
              >
                {group.label}
                <span className="detail-group-count">{group.cells.length}</span>
              </h3>
              <div className="detail-group-list">
                {group.cells.map((cell) => {
                  const isSelected = selectedCellIds.has(cell.id)
                  const status = computeAggregateStatus(cell)

                  return (
                    <label
                      className="collection-detail-row pipeline-detail-row"
                      key={cell.id}
                      onMouseEnter={() => onHoverCell(cell)}
                      onMouseLeave={() => onHoverCell(null)}
                    >
                      <input
                        type="checkbox"
                        className={`detail-row-checkbox detail-row-checkbox--${
                          status === "generated" ? "human" : "none"
                        }`}
                        checked={isSelected}
                        onChange={() => onToggleCell(cell.id)}
                      />
                      <span className="detail-content">
                        {formatCellDate(cell.date)} — {cell.title}
                      </span>
                      <PipelineCellIcons cell={cell} />
                    </label>
                  )
                })}
              </div>
            </div>
          ),
        )}
      </div>

      <div className={`collection-tiles${isExpanded ? " is-hidden" : ""}`}>
        {collection.cells.map(renderCell)}
      </div>
    </section>
  )
}
