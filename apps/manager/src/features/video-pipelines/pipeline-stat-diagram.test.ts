import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PipelineStatDiagram } from "./pipeline-stat-diagram"

describe("PipelineStatDiagram", () => {
  it("renders rounded Generated/Not Generated percentages", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PipelineStatDiagram, {
        counts: { generated: 10, none: 21 },
      }),
    )

    expect(markup).toContain("Generated")
    expect(markup).toContain("Not Generated")
    expect(markup).toContain("32")
    expect(markup).toContain("68")
  })

  it("never renders an AI segment", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PipelineStatDiagram, {
        counts: { generated: 5, none: 5 },
      }),
    )

    expect(markup).not.toContain("AI")
  })

  it("renders 0% for both segments without dividing by zero", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PipelineStatDiagram, {
        counts: { generated: 0, none: 0 },
      }),
    )

    const zeroPercentMatches = markup.match(/>0<span/g)
    expect(zeroPercentMatches).toHaveLength(2)
  })
})
