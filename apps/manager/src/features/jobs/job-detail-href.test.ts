import { describe, expect, it } from "vitest"
import { buildJobDetailHref } from "./job-detail-href"

describe("job detail href", () => {
  it("preserves the current query suffix when building detail links", () => {
    expect(buildJobDetailHref("job-42", "?languageId=529%2C6414")).toBe(
      "/dashboard/jobs/job-42?languageId=529%2C6414",
    )
  })

  it("omits the suffix when no language filter is active", () => {
    expect(buildJobDetailHref("job-42", "")).toBe("/dashboard/jobs/job-42")
  })
})
