import { describe, expect, it } from "vitest"

import { isBlockedDevotionalNativeMutation } from "./devotional-native-route-guard"

describe("devotional native workflow route guard", () => {
  it.each([
    "/api/workflows/daily-devotional/start",
    "/api/workflows/video-first-devotional/create-run",
    "/api/workflows/devotional-source/stream",
    "/api/workflows/devotional-approve/resume",
    "/api/workflows/devotional-publish/runs/run-1/cancel",
  ])("blocks native devotional mutations at %s", (pathname) => {
    expect(isBlockedDevotionalNativeMutation("POST", pathname)).toBe(true)
  })

  it("allows read-only inspection and unrelated workflow mutations", () => {
    expect(
      isBlockedDevotionalNativeMutation(
        "GET",
        "/api/workflows/video-first-devotional/runs/run-1",
      ),
    ).toBe(false)
    expect(
      isBlockedDevotionalNativeMutation(
        "POST",
        "/api/workflows/offline-search-eval/start",
      ),
    ).toBe(false)
  })
})
