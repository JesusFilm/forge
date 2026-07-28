import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { VideoPipelineCollectionCard } from "./pipeline-collection-card"
import {
  buildDevotionsAugustCollection,
  type VideoPipelineCollection,
} from "./video-pipeline-model"

function renderCard(
  overrides: Partial<{
    collection: VideoPipelineCollection
    isExpanded: boolean
    selectedCellIds: ReadonlySet<string>
  }> = {},
) {
  return renderToStaticMarkup(
    React.createElement(VideoPipelineCollectionCard, {
      collection: overrides.collection ?? buildDevotionsAugustCollection(),
      isExpanded: overrides.isExpanded ?? false,
      onHoverCell: vi.fn(),
      onToggleCell: vi.fn(),
      onToggleExpanded: vi.fn(),
      selectedCellIds: overrides.selectedCellIds ?? new Set(),
    }),
  )
}

describe("VideoPipelineCollectionCard", () => {
  it("renders the title, Basic tag, and cell count", () => {
    const markup = renderCard()

    expect(markup).toContain("Devotions - August")
    expect(markup).toContain("Basic")
    expect(markup).toContain("31 videos")
  })

  it("shows the collapsed tile grid and 'Show details' when not expanded", () => {
    const markup = renderCard({ isExpanded: false })

    expect(markup).toContain("Show details")
    expect(markup).not.toContain("Hide details")
    expect(markup).toContain("pipeline-collection-tiles")
    expect(markup).not.toMatch(/collection-details is-open/)
  })

  it("shows the expanded detail list and 'Hide details' when expanded", () => {
    const markup = renderCard({ isExpanded: true })

    expect(markup).toContain("Hide details")
    expect(markup).not.toContain("Show details")
    expect(markup).toMatch(/collection-details is-open/)
    expect(markup).toMatch(/pipeline-collection-tiles is-hidden/)
  })

  it("groups the expanded list into Generated / Not Generated headings", () => {
    const markup = renderCard({ isExpanded: true })

    expect(markup).toContain("Generated")
    expect(markup).toContain("Not Generated")
  })

  it("colors each cell's mobile/desktop icons independently of the aggregate bucket", () => {
    const collection = buildDevotionsAugustCollection()
    // Aug 2 is mobile-only generated per the deterministic fixture pattern.
    const partialCell = collection.cells.find(
      (cell) => cell.date === "2026-08-02",
    )
    if (!partialCell) throw new Error("expected Aug 2 fixture cell")
    expect(partialCell.mobileGenerated).toBe(true)
    expect(partialCell.desktopGenerated).toBe(false)

    const markup = renderCard({ collection })

    expect(markup).toContain("pipeline-cell-icon--generated")
    expect(markup).toContain("pipeline-cell-icon--pending")
  })

  it("marks selected cells as pressed", () => {
    const collection = buildDevotionsAugustCollection()
    const firstCellId = collection.cells[0]?.id
    if (!firstCellId) throw new Error("expected a first cell")

    const selectedMarkup = renderCard({
      collection,
      selectedCellIds: new Set([firstCellId]),
    })
    const unselectedMarkup = renderCard({ collection })

    expect(selectedMarkup.match(/aria-pressed="true"/g)?.length).toBe(1)
    expect(unselectedMarkup).not.toContain('aria-pressed="true"')
  })
})
