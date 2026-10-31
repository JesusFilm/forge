import { describe, expect, it } from "vitest"

import { createClientId } from "./clientId"

describe("client IDs", () => {
  it("creates valid UUIDs without crypto.randomUUID", () => {
    expect(createClientId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(createClientId()).not.toBe(createClientId())
  })
})
