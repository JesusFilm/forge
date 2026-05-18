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
  // (WORKFLOW_API_KEYS, WEB_ADMIN_API_KEYS, BACKUP_DOWNLOAD_API_KEYS)
  // MUST NOT share any value; the auth chains mint distinct
  // principals / passports, so a duplicated key silently widens
  // permissions or passes a passport it shouldn't. The legacy
  // `SEARCH_API_KEYS` CSV was retired in Plan 003 (partner-key store
  // PR3); external partner credentials now live in `PartnerApiKey`.
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
        assertBearerCsvsDisjoint({ BACKUP_DOWNLOAD_API_KEYS: "backup-a" }),
      ).not.toThrow()
    })

    it("passes when all CSVs are disjoint", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "wf-a,wf-b",
          WEB_ADMIN_API_KEYS: "web-a,web-b",
          BACKUP_DOWNLOAD_API_KEYS: "backup-a,backup-b",
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

    it("throws when WORKFLOW and BACKUP_DOWNLOAD share a value", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "wf-a",
          BACKUP_DOWNLOAD_API_KEYS: "wf-a",
        }),
      ).toThrow(/WORKFLOW_API_KEYS and BACKUP_DOWNLOAD_API_KEYS/)
    })

    it("throws when WEB_ADMIN_API_KEYS overlaps BACKUP_DOWNLOAD_API_KEYS", () => {
      // Closes the matrix: the 3-CSV invariant has 3 pairs and this
      // covers the WEB_ADMIN ↔ BACKUP_DOWNLOAD pair. A regression
      // that mis-indexed the inner-loop start (`j = i + 1` →
      // `j = i + 2`) or swapped the sets tuple order could break
      // this single pair without any other test failing.
      expect(() =>
        assertBearerCsvsDisjoint({
          WEB_ADMIN_API_KEYS: "shared-key",
          BACKUP_DOWNLOAD_API_KEYS: "shared-key",
        }),
      ).toThrow(/WEB_ADMIN_API_KEYS and BACKUP_DOWNLOAD_API_KEYS/)
    })

    it("collects ALL overlapping pairs into a single error (not first-fail)", async () => {
      // Operator workflow: when a chaotic Doppler rotation produces
      // multiple overlaps simultaneously, the boot error must surface
      // every offending pair so the cleanup is one redeploy, not N.
      let caught: Error | undefined
      try {
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "shared-1",
          WEB_ADMIN_API_KEYS: "shared-1,shared-2",
          BACKUP_DOWNLOAD_API_KEYS: "shared-2",
        })
      } catch (err) {
        caught = err as Error
      }
      expect(caught).toBeDefined()
      // Both offending pairs surface in the same error.
      expect(caught!.message).toMatch(
        /WORKFLOW_API_KEYS and WEB_ADMIN_API_KEYS/,
      )
      expect(caught!.message).toMatch(
        /WEB_ADMIN_API_KEYS and BACKUP_DOWNLOAD_API_KEYS/,
      )
      // And the rotation runbook is referenced.
      expect(caught!.message).toMatch(/Search API authentication/)
      // Key values stay redacted.
      expect(caught!.message).not.toContain("shared-1")
      expect(caught!.message).not.toContain("shared-2")
    })
  })

  // Module-load side-effect lock. The disjointness invariant is
  // exercised by direct calls above, but the module-load auto-invocation
  // at the bottom of env.ts (`assertBearerCsvsDisjoint({...env vars})`)
  // has no other regression guard. A refactor deleting or gating that
  // call would silently disable the boot-time invariant in production.
  // We source-grep env.ts (parallel to the permissions.test.ts bearer-
  // isolation grep) to lock the call site in place.
  describe("env module-load wiring", () => {
    it("env.ts invokes assertBearerCsvsDisjoint at module load with the 3 CSV env vars", async () => {
      const { readFile } = await import("node:fs/promises")
      const { fileURLToPath } = await import("node:url")
      const source = await readFile(
        fileURLToPath(new URL("./env.ts", import.meta.url)),
        "utf8",
      )
      // The call site is asserted to exist at the bottom of env.ts.
      expect(source).toMatch(/assertBearerCsvsDisjoint\s*\(\s*\{/)
      // And it MUST reference the three remaining CSV env vars from
      // `env`. The legacy SEARCH_API_KEYS was retired in Plan 003.
      expect(source).toMatch(/WORKFLOW_API_KEYS:\s*env\.WORKFLOW_API_KEYS/)
      expect(source).toMatch(/WEB_ADMIN_API_KEYS:\s*env\.WEB_ADMIN_API_KEYS/)
      expect(source).toMatch(
        /BACKUP_DOWNLOAD_API_KEYS:\s*env\.BACKUP_DOWNLOAD_API_KEYS/,
      )
      // Regression guard: SEARCH_API_KEYS must NOT appear in the boot
      // invocation (or anywhere else in env.ts).
      expect(source).not.toMatch(/SEARCH_API_KEYS/)
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
