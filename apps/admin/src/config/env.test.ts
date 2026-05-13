// Minimal smoke test confirming vitest + tsconfig + alias wiring.
// Later units extend this with env-validation behavior tests.

import { describe, expect, it } from "vitest"
import {
  assertBearerCsvsDisjoint,
  concurrencyEnvSchema,
  env,
} from "@/config/env"

describe("env", () => {
  it("loads with placeholder defaults in CI mode", () => {
    expect(env.NEXT_PUBLIC_APP_NAME).toBe("forge-admin")
  })

  // `createEnv` is bypassed under CI (`skipValidation`), so we test
  // the exported schema fragment directly. Importing it (rather than
  // re-declaring the zod chain inline) binds the test to the real
  // contract used by `SCENE_EMBEDDING_CONCURRENCY` /
  // `TRANSCRIPT_EMBEDDING_CONCURRENCY`. Tightening the schema later
  // (e.g. `.max(N)`) will land here too instead of silently passing.
  describe("concurrencyEnvSchema", () => {
    it("treats unset as undefined", () => {
      expect(concurrencyEnvSchema.parse(undefined)).toBeUndefined()
    })

    it("coerces a numeric string into a positive int", () => {
      expect(concurrencyEnvSchema.parse("5")).toBe(5)
      expect(concurrencyEnvSchema.parse("20")).toBe(20)
    })

    it("rejects zero, negative, and non-integer values", () => {
      expect(() => concurrencyEnvSchema.parse("0")).toThrow()
      expect(() => concurrencyEnvSchema.parse("-1")).toThrow()
      expect(() => concurrencyEnvSchema.parse("1.5")).toThrow()
    })

    it("rejects non-numeric strings", () => {
      expect(() => concurrencyEnvSchema.parse("nope")).toThrow()
    })
  })

  // PR-C P1-2 — bearer-CSV disjointness invariant. Three CSVs
  // (WORKFLOW_API_KEYS, PARITY_API_KEYS, WEB_ADMIN_API_KEYS) MUST NOT
  // share any value; the auth chain in context.ts is workflow → parity
  // → consumer → public, so a duplicated key silently widens
  // permissions to the higher-tier role.
  describe("assertBearerCsvsDisjoint", () => {
    it("passes when all three CSVs are undefined", () => {
      expect(() => assertBearerCsvsDisjoint({})).not.toThrow()
    })

    it("passes when only one CSV is set", () => {
      expect(() =>
        assertBearerCsvsDisjoint({ WEB_ADMIN_API_KEYS: "key-a,key-b" }),
      ).not.toThrow()
      expect(() =>
        assertBearerCsvsDisjoint({ PARITY_API_KEYS: "parity-a" }),
      ).not.toThrow()
      expect(() =>
        assertBearerCsvsDisjoint({ WORKFLOW_API_KEYS: "wf-a" }),
      ).not.toThrow()
    })

    it("passes when all three CSVs are disjoint", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "wf-a,wf-b",
          PARITY_API_KEYS: "parity-a,parity-b",
          WEB_ADMIN_API_KEYS: "web-a,web-b",
        }),
      ).not.toThrow()
    })

    it("throws when PARITY and WEB_ADMIN share a value", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          PARITY_API_KEYS: "shared-key,parity-only",
          WEB_ADMIN_API_KEYS: "web-only,shared-key",
        }),
      ).toThrow(/PARITY_API_KEYS and WEB_ADMIN_API_KEYS/)
    })

    it("throws when PARITY and WORKFLOW share a value", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "shared-key",
          PARITY_API_KEYS: "shared-key",
        }),
      ).toThrow(/WORKFLOW_API_KEYS and PARITY_API_KEYS/)
    })

    it("throws when WORKFLOW and WEB_ADMIN share a value", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "shared-key",
          WEB_ADMIN_API_KEYS: "shared-key",
        }),
      ).toThrow(/WORKFLOW_API_KEYS and WEB_ADMIN_API_KEYS/)
    })

    it("error message does NOT contain the offending key value", () => {
      try {
        assertBearerCsvsDisjoint({
          PARITY_API_KEYS: "the-leaked-key-aaa",
          WEB_ADMIN_API_KEYS: "the-leaked-key-aaa",
        })
        throw new Error("expected throw")
      } catch (err) {
        expect((err as Error).message).not.toContain("the-leaked-key-aaa")
      }
    })

    it("trims whitespace + ignores empty entries when comparing", () => {
      // `"   "` and `""` both parse to empty Set; no false-positive collision.
      expect(() =>
        assertBearerCsvsDisjoint({
          PARITY_API_KEYS: "  parity-a  ,  ",
          WEB_ADMIN_API_KEYS: "  ,  web-a  ",
        }),
      ).not.toThrow()
    })
  })
})
