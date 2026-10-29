import { describe, expect, it } from "vitest"

import {
  DEFAULT_ENGINE,
  ENGINE_STAMPS,
  readEngineStamp,
} from "@/lib/engine-stamp"

describe("readEngineStamp", () => {
  it("returns the stamped engine when present", () => {
    expect(readEngineStamp({ engine: "mastra" })).toBe("mastra")
    expect(readEngineStamp({ engine: "workflow" })).toBe("workflow")
  })

  it("defaults to workflow when the stamp is missing", () => {
    expect(readEngineStamp({})).toBe("workflow")
    expect(readEngineStamp(undefined)).toBe("workflow")
    expect(readEngineStamp(null)).toBe("workflow")
  })

  it("defaults to workflow on an unknown or corrupt stamp", () => {
    // Only-this-branch tests: a value that is neither valid literal must fall back,
    // not pass through (real-shape discipline — the gate reads this on every callback).
    expect(readEngineStamp({ engine: "vercel" as never })).toBe("workflow")
    expect(readEngineStamp({ engine: 123 as never })).toBe("workflow")
    expect(readEngineStamp({ engine: "" as never })).toBe("workflow")
  })

  it("exposes the closed set with workflow as the default", () => {
    expect(DEFAULT_ENGINE).toBe("workflow")
    expect([...ENGINE_STAMPS]).toEqual(["workflow", "mastra"])
  })
})
