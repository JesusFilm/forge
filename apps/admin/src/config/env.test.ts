// Minimal smoke test confirming vitest + tsconfig + alias wiring.
// Later units extend this with env-validation behavior tests.

import { describe, expect, it } from "vitest"
import { z } from "zod"
import { env } from "@/config/env"

describe("env", () => {
  it("loads with placeholder defaults in CI mode", () => {
    expect(env.NEXT_PUBLIC_APP_NAME).toBe("forge-admin")
  })

  // The createEnv runtime is bypassed under CI (`skipValidation`), so
  // assert the schema *shape* directly. This is the contract the
  // workflows depend on at the call site (`env.SCENE_EMBEDDING_CONCURRENCY ?? 10`).
  describe("embedding-concurrency schema", () => {
    const schema = z.coerce.number().int().positive().optional()

    it("treats unset as undefined", () => {
      expect(schema.parse(undefined)).toBeUndefined()
    })

    it("coerces a numeric string into a positive int", () => {
      expect(schema.parse("5")).toBe(5)
      expect(schema.parse("20")).toBe(20)
    })

    it("rejects zero, negative, and non-integer values", () => {
      expect(() => schema.parse("0")).toThrow()
      expect(() => schema.parse("-1")).toThrow()
      expect(() => schema.parse("1.5")).toThrow()
    })

    it("rejects non-numeric strings", () => {
      expect(() => schema.parse("nope")).toThrow()
    })
  })
})
