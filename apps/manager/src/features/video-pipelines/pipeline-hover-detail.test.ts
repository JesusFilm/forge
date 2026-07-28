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
})
