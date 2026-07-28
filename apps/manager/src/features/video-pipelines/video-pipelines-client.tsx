"use client"

import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { EnrichActionControls } from "@/features/coverage/enrich-action-controls"
import type { EnrichFeedback } from "@/features/enrich-selection"
import {
  ManagerShellSidebarSlot,
  useOptionalManagerShellState,
} from "@/features/shell/manager-shell"
import { apiFetch } from "@/lib/api-fetch"
import { filterCellsByQuery, toggleSetMember } from "./cell-filter"
import { PipelineHoverDetailBar } from "./pipeline-hover-detail"
import { VideoPipelineCollectionCard } from "./pipeline-collection-card"
import { PipelineStatDiagram } from "./pipeline-stat-diagram"
import { resolveRunSelectionOutcome } from "./run-selection"
import {
  buildDevotionsAugustCollection,
  computeAggregateStatus,
  type VideoPipelineCell,
} from "./video-pipeline-model"

export function VideoPipelinesClient() {
  const shell = useOptionalManagerShellState()
  const collection = useMemo(() => buildDevotionsAugustCollection(), [])

  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedCellIds, setSelectedCellIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [hoveredCell, setHoveredCell] = useState<VideoPipelineCell | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<EnrichFeedback | null>(null)

  // Mount-only: `shell` is a new object reference every time reportType
  // changes (see ManagerDashboardShell's contextValue memo), so depending on
  // `shell` here would re-fire this effect the instant the switcher sets a
  // *different* report type and flip it straight back to "video-pipelines".
  useEffect(() => {
    shell?.setReportType("video-pipelines")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const counts = useMemo(() => {
    return collection.cells.reduce(
      (acc, cell) => {
        acc[computeAggregateStatus(cell)] += 1
        return acc
      },
      { generated: 0, none: 0 },
    )
  }, [collection.cells])

  const filteredCollection = useMemo(
    () => ({
      ...collection,
      cells: filterCellsByQuery(collection.cells, searchQuery),
    }),
    [collection, searchQuery],
  )

  // Clear the hover preview once a search query filters its cell out of
  // view, so the detail bar can't keep showing a cell no longer rendered.
  useEffect(() => {
    if (
      hoveredCell &&
      !filteredCollection.cells.some((cell) => cell.id === hoveredCell.id)
    ) {
      setHoveredCell(null)
    }
  }, [filteredCollection, hoveredCell])

  const handleRunNow = async () => {
    setIsSubmitting(true)
    setFeedback(null)

    try {
      const response = await apiFetch("/api/video-pipelines/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds: Array.from(selectedCellIds) }),
      })

      if (!response.ok) {
        setFeedback({
          tone: "error",
          message: "Failed to queue videos to run.",
        })
        return
      }

      const body = (await response.json()) as {
        created: number
        failed: number
      }
      const outcome = resolveRunSelectionOutcome(selectedCellIds, body)
      setSelectedCellIds(outcome.nextSelectedIds)
      setFeedback(outcome.feedback)
    } catch {
      setFeedback({
        tone: "error",
        message: "Failed to queue videos to run.",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="studio-page studio-page--coverage">
      <div className="studio-page-header">
        <p className="studio-page-eyebrow">VIDEO PRODUCTION</p>
        <h1>Video Pipelines</h1>
        <p>Track the development and status of video production workflows.</p>
      </div>

      <PipelineStatDiagram counts={counts} />

      <div className="translation-toolbar">
        <div className="relative w-full">
          <Search
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--ds-muted)]"
            aria-hidden="true"
          />
          <Input
            aria-label="Search Devotions - August"
            placeholder="Search by name or date..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <VideoPipelineCollectionCard
        collection={filteredCollection}
        isExpanded={isExpanded}
        onHoverCell={setHoveredCell}
        onToggleCell={(cellId) =>
          setSelectedCellIds((prev) => toggleSetMember(prev, cellId))
        }
        onToggleExpanded={() => setIsExpanded((prev) => !prev)}
        selectedCellIds={selectedCellIds}
      />

      <PipelineHoverDetailBar hoveredCell={hoveredCell} />

      {selectedCellIds.size > 0 ? (
        <ManagerShellSidebarSlot>
          <div className="translation-view">
            <p className="translation-summary">
              {selectedCellIds.size} video
              {selectedCellIds.size === 1 ? "" : "s"} selected
            </p>
            <EnrichActionControls
              actionLabel="Run Now"
              submittingLabel="Running..."
              enrichActionReady={selectedCellIds.size > 0}
              enrichFeedback={feedback}
              isEnrichSubmitting={isSubmitting}
              languageSelectionRequired={false}
              onCancel={() => {
                setSelectedCellIds(new Set())
                setFeedback(null)
              }}
              onEnrich={handleRunNow}
            />
          </div>
        </ManagerShellSidebarSlot>
      ) : null}
    </div>
  )
}
