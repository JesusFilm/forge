import { beforeEach, describe, expect, it } from "vitest"
import {
  claimShortsLaunchSlot,
  clearShortsLaunchSlots,
  releaseShortsLaunchSlot,
} from "@/lib/shorts-claim"

beforeEach(() => {
  clearShortsLaunchSlots()
})

describe("claimShortsLaunchSlot", () => {
  it("claims a free slot and rejects a duplicate claim", () => {
    expect(claimShortsLaunchSlot("job-1")).toBe(true)
    expect(claimShortsLaunchSlot("job-1")).toBe(false)
  })

  it("keys slots per job id", () => {
    expect(claimShortsLaunchSlot("job-1")).toBe(true)
    expect(claimShortsLaunchSlot("job-2")).toBe(true)
  })

  it("re-claims after an explicit release", () => {
    expect(claimShortsLaunchSlot("job-1")).toBe(true)
    releaseShortsLaunchSlot("job-1")
    expect(claimShortsLaunchSlot("job-1")).toBe(true)
  })

  it("expires stale slots after the TTL", () => {
    let nowMs = 1_000_000
    const now = () => nowMs

    expect(claimShortsLaunchSlot("job-1", now)).toBe(true)
    nowMs += 29_999
    expect(claimShortsLaunchSlot("job-1", now)).toBe(false)
    nowMs += 2
    expect(claimShortsLaunchSlot("job-1", now)).toBe(true)
  })
})
