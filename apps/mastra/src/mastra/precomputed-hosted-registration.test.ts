import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8")

describe("precomputed hosted registration", () => {
  it("does not register source or catalog generation on the native workflow API", () => {
    const start = indexSource.indexOf("  workflows: {")
    const end = indexSource.indexOf("\n  logger:", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(indexSource.slice(start, end)).not.toContain("precomputed")
    expect(indexSource).toContain(
      'registerApiRoute("/forge-precomputed-catalog-generation"',
    )
    expect(indexSource).toContain(
      'registerApiRoute("/forge-precomputed-source-generation"',
    )
    expect(indexSource).toContain(
      "startPrecomputedRuntimeRetention(observabilityStore.observability)",
    )
  })
})
