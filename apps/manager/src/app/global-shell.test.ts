import { describe, expect, it } from "vitest"

import { shouldHideGlobalHeader } from "./global-shell"

describe("GlobalShell route boundaries", () => {
  it("suppresses the operator header throughout the reviewer-only lane", () => {
    expect(shouldHideGlobalHeader("/subtitle-review")).toBe(true)
    expect(shouldHideGlobalHeader("/subtitle-review/assignment-1")).toBe(true)
  })
})
