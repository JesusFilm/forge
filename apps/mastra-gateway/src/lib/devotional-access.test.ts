import { describe, expect, it } from "vitest"

import { isDevotionalNativeWorkflowPath } from "./devotional-access"

describe("devotional native workflow path detection", () => {
  it("matches parent, legacy, and child workflow paths", () => {
    expect(
      isDevotionalNativeWorkflowPath([
        "workflows",
        "video-first-devotional",
        "runs",
        "run-1",
      ]),
    ).toBe(true)
    expect(
      isDevotionalNativeWorkflowPath(["workflows", "devotional-approve"]),
    ).toBe(true)
    expect(
      isDevotionalNativeWorkflowPath(["workflows", "daily-devotional"]),
    ).toBe(true)
  })

  it("does not match unrelated native API paths", () => {
    expect(
      isDevotionalNativeWorkflowPath(["workflows", "offline-search-eval"]),
    ).toBe(false)
    expect(isDevotionalNativeWorkflowPath(["agents", "smoke"])).toBe(false)
  })
})
