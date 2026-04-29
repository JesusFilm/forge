// Minimal smoke test confirming vitest + tsconfig + alias wiring.
// Later units extend this with env-validation behavior tests.

import { describe, expect, it } from "vitest"
import { env } from "@/config/env"

describe("env", () => {
  it("loads with placeholder defaults in CI mode", () => {
    expect(env.NEXT_PUBLIC_APP_NAME).toBe("forge-admin")
  })
})
