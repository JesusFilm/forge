import { describe, expect, it } from "vitest"
import { resolveEnrichmentMaterializationTarget } from "@/lib/enrichment-materialization"

describe("resolveEnrichmentMaterializationTarget", () => {
  it("chooses clone mode when the force flag is true", () => {
    expect(resolveEnrichmentMaterializationTarget(true)).toBe("clone")
    expect(resolveEnrichmentMaterializationTarget("true")).toBe("clone")
  })

  it("chooses direct mode when the force flag is false or missing", () => {
    expect(resolveEnrichmentMaterializationTarget(false)).toBe("direct")
    expect(resolveEnrichmentMaterializationTarget("false")).toBe("direct")
    expect(resolveEnrichmentMaterializationTarget(undefined)).toBe("direct")
  })
})
