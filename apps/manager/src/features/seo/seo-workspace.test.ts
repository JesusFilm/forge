import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { buildSeoDemoWorkspace } from "./seo-contract"
import { SeoWorkspace } from "./seo-workspace"

function render(view: "overview" | "proposals" | "reconciliation") {
  return renderToStaticMarkup(
    React.createElement(SeoWorkspace, {
      initialWorkspace: buildSeoDemoWorkspace(),
      initialView: view,
      initialCsrfToken: "csrf-test-token",
      isDemo: true,
    }),
  )
}

describe("SeoWorkspace", () => {
  it("renders a top-level semantic workspace with all five keyboard tabs", () => {
    const markup = render("overview")
    expect(markup).toContain("SEO workspace")
    expect(markup).toContain('aria-label="SEO workspace views"')
    expect(markup.match(/role="tab"/g)).toHaveLength(5)
    expect(markup).toContain("What needs an operator now")
    expect(markup).toContain("Provider and coverage status")
    expect(markup).toContain("Grounded search")
    expect(markup).toContain("unavailable")
  })

  it("renders exact accessible current/proposed diffs, evidence hierarchy, and recovery consequences", () => {
    const markup = render("proposals")
    expect(markup).toContain('role="table"')
    expect(markup).toContain("Current")
    expect(markup).toContain("Proposed")
    expect(markup).toContain("Exact editorial diff")
    expect(markup).toContain("Approve only the immutable version shown here")
    expect(markup).toContain("Why this action exists")
    expect(markup).not.toContain("<img")
    expect(markup).not.toContain("dangerouslySetInnerHTML")
  })

  it("renders immutable reconciliation details with bind or fail actions and no create action", () => {
    const markup = render("reconciliation")
    expect(markup).toContain("Automatic creation is paused")
    expect(markup).toContain("Bind selected existing ticket")
    expect(markup).toContain("Mark delivery failed")
    expect(markup).not.toContain("Create ticket")
  })
})
