import { describe, expect, it } from "vitest"
import { inSearchStage, safeSearchFailure } from "./search-failure.js"
const privateData = "private-message-sql-url-bearer-stack"
describe("closed search error classification", () => {
  it("preserves the exact model/vector exception and CLI message", async () => {
    const original = Object.assign(new Error(privateData), { code: "P2024" })
    await expect(
      inSearchStage("vector_search", async () => {
        throw original
      }),
    ).rejects.toBe(original)
    expect(original.message).toBe(privateData)
    expect(safeSearchFailure(original)).toEqual({
      stage: "vector_search",
      category: "database",
      detail: "P2024",
    })
  })
  it("returns a fixed unknown diagnostic for secret-bearing throwing getters", () => {
    const error = new Error(privateData)
    Object.defineProperty(error, "code", {
      get() {
        throw new Error(privateData)
      },
    })
    Object.defineProperty(error, "name", {
      get() {
        throw new Error(privateData)
      },
    })
    expect(safeSearchFailure(error)).toEqual({
      stage: "http",
      category: "unknown",
      detail: "unclassified",
    })
    expect(JSON.stringify(safeSearchFailure(error))).not.toContain(privateData)
  })
  it("does not propagate arbitrary names, codes, stacks or causes", () => {
    const error = Object.assign(new Error(privateData), {
      name: privateData,
      code: privateData,
      cause: { secret: privateData },
    })
    expect(safeSearchFailure(error)).toEqual({
      stage: "http",
      category: "unknown",
      detail: "unclassified",
    })
  })
  it("snapshots allowlisted fields once so changing getters cannot leak a later value", () => {
    let reads = 0
    const error = new Error(privateData)
    Object.defineProperty(error, "code", {
      get() {
        return reads++ === 0 ? "P1001" : privateData
      },
    })
    expect(safeSearchFailure(error)).toEqual({
      stage: "http",
      category: "database",
      detail: "P1001",
    })
    expect(reads).toBe(1)
  })
})
