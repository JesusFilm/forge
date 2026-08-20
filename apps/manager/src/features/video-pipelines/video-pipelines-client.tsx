"use client"

import { useEffect, useMemo, useState } from "react"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CoverageFilterDropdown } from "@/features/coverage/coverage-filter-dropdown"
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
  buildAllDevotionCollections,
  computeAggregateStatus,
  type VideoPipelineCell,
} from "./video-pipeline-model"

export function VideoPipelinesClient() {
  const shell = useOptionalManagerShellState()
  const collections = useMemo(() => buildAllDevotionCollections(), [])

  const [expandedCollectionIds, setExpandedCollectionIds] = useState<
    Set<string>
  >(() => new Set())
  const [selectedCellIds, setSelectedCellIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [hoveredCell, setHoveredCell] = useState<VideoPipelineCell | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [mediaTypeFilter, setMediaTypeFilter] = useState("all")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<EnrichFeedback | null>(null)

  // Mount-only: `shell` is a new object reference every time reportType
  // changes (see ManagerDashboardShell's contextValue memo), so depending on
  // `shell` here would re-fire this effect the instant the switcher sets a
  // *different* report type and flip it straight back to "video-pipelines".
  useEffect(() => {
    shell?.setReportType("video-pipelines")
  }, [])

  const counts = useMemo(() => {
    return collections.reduce(
      (acc, collection) => {
        for (const cell of collection.cells) {
          acc[computeAggregateStatus(cell)] += 1
        }
        return acc
      },
      { generated: 0, none: 0 },
    )
  }, [collections])

  const filteredCollections = useMemo(
    () =>
      collections.map((collection) => ({
        ...collection,
        cells: filterCellsByQuery(collection.cells, searchQuery),
      })),
    [collections, searchQuery],
  )

  const visibleCollections = useMemo(
    () =>
      filteredCollections.filter(
        (collection) =>
          mediaTypeFilter === "all" || mediaTypeFilter === collection.label,
      ),
    [filteredCollections, mediaTypeFilter],
  )

  // Clear the hover preview once a search query filters its cell out of
  // view, so the detail bar can't keep showing a cell no longer rendered.
  useEffect(() => {
    if (
      hoveredCell &&
      !filteredCollections.some((collection) =>
        collection.cells.some((cell) => cell.id === hoveredCell.id),
      )
    ) {
      setHoveredCell(null)
    }
  }, [filteredCollections, hoveredCell])

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
      <header className="studio-page-intro studio-page-intro--coverage">
        <div className="studio-page-intro-copy">
          <span className="studio-page-eyebrow">Video production</span>
          <h1>Video Pipelines</h1>
          <p>Track the development and status of video production workflows.</p>
        </div>
        <div className="studio-page-intro-diagram">
          <PipelineStatDiagram counts={counts} />
        </div>
      </header>

      <section className="relative z-[60] mb-5">
        <div
          className="flex w-[calc(100vw-2.5rem)] max-w-full flex-row items-center gap-2 sm:w-full"
          id="video-pipelines-filters"
        >
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-[color:var(--ds-muted)]"
              aria-hidden="true"
            />
            <Input
              type="search"
              className="h-10 rounded-xl border-[color:color-mix(in_srgb,var(--ds-black)_14%,transparent)] bg-transparent pl-10 pr-10 text-sm font-medium text-[color:var(--ds-ink)] shadow-none ring-0 transition-colors duration-75 placeholder:text-[color:var(--ds-soft)] hover:bg-[color:color-mix(in_srgb,var(--ds-black)_6%,transparent)] active:bg-[color:color-mix(in_srgb,var(--ds-black)_10%,transparent)] focus-visible:border-[color:var(--ds-black)] focus-visible:bg-[color:color-mix(in_srgb,var(--ds-black)_3%,transparent)] focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)] [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
              placeholder="Search by name or date..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1.5 top-1/2 size-7 -translate-y-1/2 rounded-lg text-[color:var(--ds-muted)] transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_6%,transparent)] hover:text-[color:var(--ds-ink)]"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                <X className="size-[18px]" aria-hidden="true" />
              </Button>
            )}
          </div>
          <CoverageFilterDropdown
            value={mediaTypeFilter}
            onChange={setMediaTypeFilter}
            options={[
              { value: "all", label: "Media Type" },
              {
                value: collections[0]?.label ?? "basic",
                label: collections[0]?.labelDisplay ?? "Basic",
              },
            ]}
          />
        </div>
      </section>

      <div className="pipeline-collection-stack">
        {visibleCollections.map((collection) => (
          <VideoPipelineCollectionCard
            key={collection.id}
            collection={collection}
            isExpanded={expandedCollectionIds.has(collection.id)}
            onHoverCell={setHoveredCell}
            onToggleCell={(cellId) =>
              setSelectedCellIds((prev) => toggleSetMember(prev, cellId))
            }
            onToggleExpanded={() =>
              setExpandedCollectionIds((prev) =>
                toggleSetMember(prev, collection.id),
              )
            }
            selectedCellIds={selectedCellIds}
          />
        ))}
      </div>

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
