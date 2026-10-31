import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { WATCH_SEARCH_DEADLINE_EXCEEDED_EVENT } from "./watch-search-request-deadline"

describe("Watch search deadline monitor", () => {
  it("counts the emitted event without query or identifier grouping", () => {
    const monitor = JSON.parse(
      readFileSync(
        new URL(
          "../../../../infra/datadog-monitors/watch-search/deadline-exceeded.json",
          import.meta.url,
        ),
        "utf8",
      ),
    )
    expect(monitor.type).toBe("log alert")
    expect(monitor.query).toContain(
      `event=${WATCH_SEARCH_DEADLINE_EXCEEDED_EVENT}`,
    )
    expect(monitor.query).toContain("service:forge-admin env:prod")
    expect(monitor.query).toContain('.rollup("count").last("5m") >= 3')
    expect(monitor.options.thresholds.critical).toBe(3)
    expect(monitor.options.enable_logs_sample).toBe(false)
    expect(monitor.query).not.toMatch(/\.by\(|request_id|user_id|query_text/)
    expect(monitor.tags).toEqual([
      "service:forge-admin",
      "env:prod",
      "team:forge",
      "feature:watch-search",
    ])
  })
})
