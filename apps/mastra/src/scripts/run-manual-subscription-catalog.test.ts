import { describe, expect, it } from "vitest"

import { parseManualCatalogCommand } from "./run-manual-subscription-catalog"

describe("manual subscription catalog command", () => {
  it("requires an explicit local execution flag before parsing operator input", () => {
    expect(() =>
      parseManualCatalogCommand({}, ["--config", "/tmp/reviewed.json"]),
    ).toThrow("manual_operator_only")
    expect(() =>
      parseManualCatalogCommand({}, ["--config", "reviewed.json", "--execute"]),
    ).toThrow("manual_operator_only")
  })
})
