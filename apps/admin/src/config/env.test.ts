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
    expect(env.DATABASE_URL).toContain("forge_admin")
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

  // Bearer-CSV disjointness invariant. The bearer CSVs
  // (WORKFLOW_API_KEYS, WEB_ADMIN_API_KEYS, BACKUP_DOWNLOAD_API_KEYS,
  // SEARCH_API_KEYS) MUST NOT share any value; the auth chains
  // mint distinct principals / passports, so a duplicated key silently
  // widens permissions or passes a passport it shouldn't.
  describe("assertBearerCsvsDisjoint", () => {
    it("passes when all CSVs are undefined", () => {
      expect(() => assertBearerCsvsDisjoint({})).not.toThrow()
    })

    it("passes when only one CSV is set", () => {
      expect(() =>
        assertBearerCsvsDisjoint({ WEB_ADMIN_API_KEYS: "key-a,key-b" }),
      ).not.toThrow()
      expect(() =>
        assertBearerCsvsDisjoint({ WORKFLOW_API_KEYS: "wf-a" }),
      ).not.toThrow()
      expect(() =>
        assertBearerCsvsDisjoint({ SEARCH_API_KEYS: "search-a" }),
      ).not.toThrow()
    })

    it("passes when all CSVs are disjoint", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "wf-a,wf-b",
          WEB_ADMIN_API_KEYS: "web-a,web-b",
          BACKUP_DOWNLOAD_API_KEYS: "backup-a,backup-b",
          SEARCH_API_KEYS: "search-a,search-b",
        }),
      ).not.toThrow()
    })

    it("throws when WORKFLOW and WEB_ADMIN share a value", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "shared-key",
          WEB_ADMIN_API_KEYS: "shared-key",
        }),
      ).toThrow(/WORKFLOW_API_KEYS and WEB_ADMIN_API_KEYS/)
    })

    it("throws when backup download keys overlap another bearer CSV", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "wf-a",
          BACKUP_DOWNLOAD_API_KEYS: "wf-a",
        }),
      ).toThrow(/WORKFLOW_API_KEYS and BACKUP_DOWNLOAD_API_KEYS/)
    })

    it("throws when WEB_ADMIN_API_KEYS overlaps BACKUP_DOWNLOAD_API_KEYS", () => {
      // Closes the matrix: the 4-CSV invariant has 6 pairs, this is
      // the one not covered above. A regression that mis-indexed the
      // inner-loop start (`j = i + 1` → `j = i + 2`) or swapped the
      // sets tuple order could break this single pair without any
      // other test failing.
      expect(() =>
        assertBearerCsvsDisjoint({
          WEB_ADMIN_API_KEYS: "shared-key",
          BACKUP_DOWNLOAD_API_KEYS: "shared-key",
        }),
      ).toThrow(/WEB_ADMIN_API_KEYS and BACKUP_DOWNLOAD_API_KEYS/)
    })

    it("throws when SEARCH_API_KEYS overlaps WORKFLOW_API_KEYS", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "shared-key",
          SEARCH_API_KEYS: "shared-key",
        }),
      ).toThrow(/WORKFLOW_API_KEYS and SEARCH_API_KEYS/)
    })

    it("throws when SEARCH_API_KEYS overlaps WEB_ADMIN_API_KEYS", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WEB_ADMIN_API_KEYS: "shared-key",
          SEARCH_API_KEYS: "shared-key",
        }),
      ).toThrow(/WEB_ADMIN_API_KEYS and SEARCH_API_KEYS/)
    })

    it("throws when SEARCH_API_KEYS overlaps BACKUP_DOWNLOAD_API_KEYS", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          BACKUP_DOWNLOAD_API_KEYS: "shared-key",
          SEARCH_API_KEYS: "shared-key",
        }),
      ).toThrow(/BACKUP_DOWNLOAD_API_KEYS and SEARCH_API_KEYS/)
    })

    it("error message does NOT contain the offending key value", () => {
      try {
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "the-leaked-key-aaa",
          BACKUP_DOWNLOAD_API_KEYS: "the-leaked-key-aaa",
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
          WORKFLOW_API_KEYS: "  wf-a  ,  ",
          WEB_ADMIN_API_KEYS: "  ,  web-a  ",
        }),
      ).not.toThrow()
    })
  })
})
