import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PipelineHoverDetailBar } from "./pipeline-hover-detail"
import { buildDevotionsAugustCollection } from "./video-pipeline-model"

describe("PipelineHoverDetailBar", () => {
  it("shows the empty-state hint when nothing is hovered", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PipelineHoverDetailBar, { hoveredCell: null }),
    )

    expect(markup).toContain("Hover any cell to see its details.")
  })

  it("shows the hovered cell's title and formatted date", () => {
    const cell = buildDevotionsAugustCollection().cells[2]
    if (!cell) throw new Error("expected a cell fixture")

    const markup = renderToStaticMarkup(
      React.createElement(PipelineHoverDetailBar, { hoveredCell: cell }),
    )

    expect(markup).toContain(cell.title)
    expect(markup).toContain("August 3, 2026")
    expect(markup).toContain(`alt="${cell.title}"`)
    expect(markup).not.toContain("Hover any cell to see its details.")
  })

  it("shows the mobile/desktop generated-state icons for the hovered cell", () => {
    const collection = buildDevotionsAugustCollection()
    // Aug 8 is mobile-only generated per the deterministic fixture pattern.
    const partialCell = collection.cells.find(
      (cell) => cell.date === "2026-08-08",
    )
    if (!partialCell) throw new Error("expected Aug 8 fixture cell")
    expect(partialCell.mobileGenerated).toBe(true)
    expect(partialCell.desktopGenerated).toBe(false)

    const markup = renderToStaticMarkup(
      React.createElement(PipelineHoverDetailBar, {
        hoveredCell: partialCell,
      }),
    )

    expect(markup).toContain("pipeline-cell-icon--generated")
    expect(markup).toContain("pipeline-cell-icon--pending")
  })

  it("falls back to the empty thumbnail placeholder when thumbnailUrl is null", () => {
    const cell = {
      ...buildDevotionsAugustCollection().cells[0]!,
      thumbnailUrl: null,
    }

    const markup = renderToStaticMarkup(
      React.createElement(PipelineHoverDetailBar, { hoveredCell: cell }),
    )

    expect(markup).toContain("detail-thumb--empty")
    expect(markup).not.toContain("has-detail-bg")
    expect(markup).not.toContain("<img")
  })
})
