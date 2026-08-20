import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { VideoPipelinesClient } from "./video-pipelines-client"

describe("VideoPipelinesClient", () => {
  it("renders the header, description, stat diagram, and the Devotions - August collection", () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoPipelinesClient),
    )

    expect(markup).toContain("Video Pipelines")
    expect(markup).toContain(
      "Track the development and status of video production workflows.",
    )
    expect(markup).toContain("Devotions - August")
    expect(markup).toContain("Basic")
    expect(markup).toContain("31 videos")
    expect(markup).toContain("Generated")
    expect(markup).toContain("Not Generated")
  })

  it("renders a section for every month, August through December", () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoPipelinesClient),
    )

    expect(markup).toContain("Devotions - August")
    expect(markup).toContain("Devotions - September")
    expect(markup).toContain("Devotions - October")
    expect(markup).toContain("Devotions - November")
    expect(markup).toContain("Devotions - December")
  })

  it("renders a Media Type dropdown alongside the search input", () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoPipelinesClient),
    )

    expect(markup).toContain("Media Type")
    expect(markup).toContain('aria-haspopup="listbox"')
  })

  it("never renders an 'AI' stat segment or an 'Enrich Now' action", () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoPipelinesClient),
    )

    expect(markup).not.toContain("AI")
    expect(markup).not.toContain("Enrich Now")
  })

  it("shows no job-order sidebar content when nothing is selected", () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoPipelinesClient),
    )

    expect(markup).not.toContain("Run Now")
    expect(markup).not.toContain("video selected")
  })
})
