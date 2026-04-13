import { describe, expect, it } from "vitest"

import {
  buildDashboardHrefWithReportQuery,
  buildDashboardNavHref,
} from "./dashboard-nav-model"

describe("dashboard nav model", () => {
  it("carries the canonical report language query across dashboard tabs", () => {
    expect(buildDashboardNavHref("/dashboard/jobs", "languageId=529")).toBe(
      "/dashboard/jobs?languageId=529",
    )

    expect(buildDashboardNavHref("/dashboard/coverage", "languageId=529")).toBe(
      "/dashboard/coverage?languageId=529",
    )

    expect(buildDashboardNavHref("/dashboard/agents", "languageId=529")).toBe(
      "/dashboard/agents?languageId=529",
    )
  })

  it("canonicalizes legacy languageIds query params", () => {
    expect(
      buildDashboardNavHref("/dashboard/agents", "languageIds=529,21028"),
    ).toBe("/dashboard/agents?languageId=529%2C21028")
  })

  it("carries the report language query to dashboard job detail handoffs", () => {
    expect(
      buildDashboardHrefWithReportQuery(
        "/dashboard/jobs/job-1",
        "languageIds=529,21028",
      ),
    ).toBe("/dashboard/jobs/job-1?languageId=529%2C21028")
  })

  it("drops unsupported query params instead of carrying hidden dashboard state", () => {
    expect(
      buildDashboardNavHref(
        "/dashboard/coverage",
        "languageId=529&refresh=1&status=failed",
      ),
    ).toBe("/dashboard/coverage?languageId=529")

    expect(buildDashboardNavHref("/dashboard/jobs", "status=failed")).toBe(
      "/dashboard/jobs",
    )
  })

  it("returns bare tab paths when no report language is selected", () => {
    expect(buildDashboardNavHref("/dashboard/coverage", "")).toBe(
      "/dashboard/coverage",
    )

    expect(buildDashboardNavHref("/dashboard/jobs", "languageId=")).toBe(
      "/dashboard/jobs",
    )
  })
})
