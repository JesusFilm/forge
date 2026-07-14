import { describe, expect, it } from "vitest"

import { mapWithConcurrency } from "./bounded-parallel"

describe("mapWithConcurrency", () => {
  it("caps in-flight work while preserving input order", async () => {
    let inFlight = 0
    let observedMaxInFlight = 0
    const release: Array<() => void> = []

    const pending = mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      inFlight += 1
      observedMaxInFlight = Math.max(observedMaxInFlight, inFlight)
      await new Promise<void>((resolve) => release.push(resolve))
      inFlight -= 1
      return value * 2
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(observedMaxInFlight).toBe(2)
    release.shift()?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    release.shift()?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    release.shift()?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    release.shift()?.()

    await expect(pending).resolves.toEqual([2, 4, 6, 8])
  })
})
