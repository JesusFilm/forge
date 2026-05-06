import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DashboardRouteSkeleton } from "./dashboard-route-skeleton"

describe("dashboard-route-skeleton", () => {
  it("renders a jobs-shaped loading surface inside the page shell", () => {
    const markup = renderToStaticMarkup(
      React.createElement(DashboardRouteSkeleton, { variant: "jobs" }),
    )

    expect(markup).toContain("Loading jobs")
    expect(markup).toContain("dashboard-route-skeleton-table")
    expect(markup).toContain("studio-page studio-page--jobs")
  })

  it("renders a job-detail loading surface without the generic workspace card", () => {
    const markup = renderToStaticMarkup(
      React.createElement(DashboardRouteSkeleton, { variant: "job-detail" }),
    )

    expect(markup).toContain("Loading job detail")
    expect(markup).toContain("studio-page studio-page--job-detail")
    expect(markup).not.toContain("Loading workspace")
  })
})
