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
    expect(markup).toMatch(/class="collection-tiles"/)
    expect(markup).not.toMatch(/collection-details is-open/)
  })

  it("shows the expanded detail list and 'Hide details' when expanded", () => {
    const markup = renderCard({ isExpanded: true })

    expect(markup).toContain("Hide details")
    expect(markup).not.toContain("Show details")
    expect(markup).toMatch(/collection-details is-open/)
    expect(markup).toMatch(/collection-tiles is-hidden/)
  })

  it("groups the expanded list into Generated / Not Generated headings", () => {
    const markup = renderCard({ isExpanded: true })

    expect(markup).toContain("Generated")
    expect(markup).toContain("Not Generated")
  })

  it("renders collapsed cells as plain colored tiles, like the Subtitles report", () => {
    // The expanded detail rows (with mobile/desktop icons) are always present
    // in the markup and only CSS-hidden when collapsed -- see
    // "still shows independent mobile/desktop icons in the expanded detail
    // rows" below. This asserts the *collapsed grid* button itself renders a
    // plain colored tile with no icon children, not that the string
    // "pipeline-cell-icon" is absent from the whole document.
    const markup = renderCard({ isExpanded: false })
    const tileButtonMatch = markup.match(
      /<button[^>]*class="tile tile--video[^"]*"[^>]*>(.*?)<\/button>/,
    )

    expect(tileButtonMatch).not.toBeNull()
    expect(markup).toContain("tile--coverage")
    expect(markup).toContain("pipeline-cell-tile")
    expect(tileButtonMatch?.[1]).not.toContain("pipeline-cell-icon")
    expect(tileButtonMatch?.[1]).toContain("tile-checkbox")
  })

  it("colors collapsed tiles green for fully generated cells and red for anything else", () => {
    const collection = buildDevotionsAugustCollection()
    const generatedCell = collection.cells.find(
      (cell) => cell.mobileGenerated && cell.desktopGenerated,
    )
    const pendingCell = collection.cells.find(
      (cell) => !cell.mobileGenerated || !cell.desktopGenerated,
    )
    if (!generatedCell || !pendingCell) {
      throw new Error(
        "expected both a generated and a non-generated fixture cell",
      )
    }

    const markup = renderCard({
      collection: { ...collection, cells: [generatedCell, pendingCell] },
      isExpanded: false,
    })

    expect(markup).toContain("tile--human")
    expect(markup).toContain("tile--none")
  })

  it("still shows independent mobile/desktop icons in the expanded detail rows", () => {
    const collection = buildDevotionsAugustCollection()
    // Aug 2 is mobile-only generated per the deterministic fixture pattern.
    const partialCell = collection.cells.find(
      (cell) => cell.date === "2026-08-02",
    )
    if (!partialCell) throw new Error("expected Aug 2 fixture cell")
    expect(partialCell.mobileGenerated).toBe(true)
    expect(partialCell.desktopGenerated).toBe(false)

    const markup = renderCard({ collection, isExpanded: true })

    expect(markup).toContain("pipeline-cell-icon--generated")
    expect(markup).toContain("pipeline-cell-icon--pending")
  })

  it("renders each expanded row as 'Aug D - Devotional'", () => {
    const markup = renderCard({ isExpanded: true })

    expect(markup).toContain("Aug 1 - Devotional")
  })

  it("renders a checkbox for each cell in the expanded detail rows", () => {
    const collection = buildDevotionsAugustCollection()
    const firstCellId = collection.cells[0]?.id
    if (!firstCellId) throw new Error("expected a first cell")

    const markup = renderCard({
      collection,
      isExpanded: true,
      selectedCellIds: new Set([firstCellId]),
    })

    expect(markup.match(/type="checkbox"/g)?.length).toBe(
      collection.cells.length,
    )
    expect(markup).toMatch(/detail-row-checkbox--(human|none)/)
    expect(markup.match(/checked=""/g)?.length).toBe(1)
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
