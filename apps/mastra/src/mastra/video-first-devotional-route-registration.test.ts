import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8")

describe("video-first devotional route registration", () => {
  it("points the canonical daily route at the human-approved video workflow", () => {
    const routeStart = source.indexOf(
      'registerApiRoute("/forge-daily-devotional"',
    )
    const nextRoute = source.indexOf("registerApiRoute(", routeStart + 1)
    const route = source.slice(routeStart, nextRoute)

    expect(routeStart).toBeGreaterThan(-1)
    expect(route).toContain("handleVideoFirstStartRequest")
    expect(route).not.toContain("handleDailyDevotionalRouteRequest")
  })

  it("registers start, status, resume, cancel, and retry primitives", () => {
    expect(source).toContain(
      'registerApiRoute("/forge-video-first-devotional",',
    )
    expect(source).toContain(
      'registerApiRoute("/forge-video-first-devotional/:runId",',
    )
    expect(source).toContain(
      'registerApiRoute("/forge-video-first-devotional/:runId/resume",',
    )
    expect(source).toContain("serviceKeys: devotionalApprovalKeys")
    expect(source).toContain(
      'registerApiRoute("/forge-video-first-devotional/:runId/cancel",',
    )
    expect(source).toContain(
      'registerApiRoute("/forge-video-first-devotional/:runId/retry",',
    )
    expect(source).toContain(
      '"/forge-video-first-devotional/assets/:assetId/:artifactType/:ext"',
    )
  })
})
