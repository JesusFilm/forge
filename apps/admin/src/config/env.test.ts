// Minimal smoke test confirming vitest + tsconfig + alias wiring.
// Later units extend this with env-validation behavior tests.

import { describe, expect, it } from "vitest"
import {
  assertBearerCsvsDisjoint,
  concurrencyEnvSchema,
  env,
  searchTraceRawRetentionDaysEnvSchema,
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

  describe("searchTraceRawRetentionDaysEnvSchema", () => {
    it("defaults to 29 days", () => {
      expect(searchTraceRawRetentionDaysEnvSchema.parse(undefined)).toBe(29)
    })

    it("accepts integer values from 1 through 29", () => {
      expect(searchTraceRawRetentionDaysEnvSchema.parse("1")).toBe(1)
      expect(searchTraceRawRetentionDaysEnvSchema.parse("29")).toBe(29)
    })

    it("rejects zero, fractional, negative, and 30-day retention values", () => {
      expect(() => searchTraceRawRetentionDaysEnvSchema.parse("0")).toThrow()
      expect(() => searchTraceRawRetentionDaysEnvSchema.parse("1.5")).toThrow()
      expect(() => searchTraceRawRetentionDaysEnvSchema.parse("-1")).toThrow()
      expect(() => searchTraceRawRetentionDaysEnvSchema.parse("30")).toThrow()
    })
  })

  // Bearer-CSV disjointness invariant. The bearer CSVs
  // (WORKFLOW_API_KEYS, MASTRA_TRANSCRIPT_INGEST_API_KEYS,
  // MASTRA_SCENE_INGEST_API_KEYS, MASTRA_EXPERIENCE_INGEST_API_KEYS,
  // WEB_ADMIN_API_KEYS,
  // BACKUP_DOWNLOAD_API_KEYS, SEARCH_TRACE_SAMPLING_API_KEYS)
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
        assertBearerCsvsDisjoint({
          MASTRA_TRANSCRIPT_INGEST_API_KEYS: "mastra-a",
        }),
      ).not.toThrow()
      expect(() =>
        assertBearerCsvsDisjoint({
          MASTRA_SCENE_INGEST_API_KEYS: "scene-a",
        }),
      ).not.toThrow()
      expect(() =>
        assertBearerCsvsDisjoint({
          MASTRA_EXPERIENCE_INGEST_API_KEYS: "experience-a",
        }),
      ).not.toThrow()
      expect(() =>
        assertBearerCsvsDisjoint({ BACKUP_DOWNLOAD_API_KEYS: "backup-a" }),
      ).not.toThrow()
      expect(() =>
        assertBearerCsvsDisjoint({
          SEARCH_TRACE_SAMPLING_API_KEYS: "trace-sampling-a",
        }),
      ).not.toThrow()
    })

    it("passes when all CSVs are disjoint", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "wf-a,wf-b",
          MASTRA_TRANSCRIPT_INGEST_API_KEYS: "mastra-a,mastra-b",
          MASTRA_SCENE_INGEST_API_KEYS: "scene-a,scene-b",
          MASTRA_EXPERIENCE_INGEST_API_KEYS: "experience-a,experience-b",
          WEB_ADMIN_API_KEYS: "web-a,web-b",
          BACKUP_DOWNLOAD_API_KEYS: "backup-a,backup-b",
          SEARCH_TRACE_SAMPLING_API_KEYS: "trace-sampling-a,trace-sampling-b",
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

    it("throws when WORKFLOW and MASTRA_TRANSCRIPT_INGEST share a value", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "shared-key",
          MASTRA_TRANSCRIPT_INGEST_API_KEYS: "shared-key",
        }),
      ).toThrow(/WORKFLOW_API_KEYS and MASTRA_TRANSCRIPT_INGEST_API_KEYS/)
    })

    it("throws when transcript and scene Mastra ingest keys share a value", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          MASTRA_TRANSCRIPT_INGEST_API_KEYS: "shared-key",
          MASTRA_SCENE_INGEST_API_KEYS: "shared-key",
        }),
      ).toThrow(
        /MASTRA_TRANSCRIPT_INGEST_API_KEYS and MASTRA_SCENE_INGEST_API_KEYS/,
      )
    })

    it("throws when scene and experience Mastra ingest keys share a value", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          MASTRA_SCENE_INGEST_API_KEYS: "shared-key",
          MASTRA_EXPERIENCE_INGEST_API_KEYS: "shared-key",
        }),
      ).toThrow(
        /MASTRA_SCENE_INGEST_API_KEYS and MASTRA_EXPERIENCE_INGEST_API_KEYS/,
      )
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
      expect(() =>
        assertBearerCsvsDisjoint({
          WEB_ADMIN_API_KEYS: "shared-key",
          BACKUP_DOWNLOAD_API_KEYS: "shared-key",
        }),
      ).toThrow(/WEB_ADMIN_API_KEYS and BACKUP_DOWNLOAD_API_KEYS/)
    })

    it("throws when SEARCH_TRACE_SAMPLING overlaps another bearer capability", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          SEARCH_TRACE_SAMPLING_API_KEYS: "shared-key",
          MASTRA_EXPERIENCE_INGEST_API_KEYS: "shared-key",
        }),
      ).toThrow(
        /MASTRA_EXPERIENCE_INGEST_API_KEYS and SEARCH_TRACE_SAMPLING_API_KEYS/,
      )
    })

    it("collects ALL overlapping pairs into a single error (not first-fail)", async () => {
      // Operator workflow: when a chaotic Doppler rotation produces
      // multiple overlaps simultaneously, the boot error must surface
      // every offending pair so the cleanup is one redeploy, not N.
      let caught: Error | undefined
      try {
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "shared-1",
          MASTRA_TRANSCRIPT_INGEST_API_KEYS: "mastra-a",
          MASTRA_SCENE_INGEST_API_KEYS: "scene-a",
          MASTRA_EXPERIENCE_INGEST_API_KEYS: "experience-a",
          WEB_ADMIN_API_KEYS: "shared-1,shared-2",
          BACKUP_DOWNLOAD_API_KEYS: "shared-2",
          SEARCH_TRACE_SAMPLING_API_KEYS: "shared-1",
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
      expect(caught!.message).toMatch(
        /WORKFLOW_API_KEYS and SEARCH_TRACE_SAMPLING_API_KEYS/,
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
    it("env.ts invokes assertBearerCsvsDisjoint at module load with the bearer CSV env vars", async () => {
      const { readFile } = await import("node:fs/promises")
      const { fileURLToPath } = await import("node:url")
      const source = await readFile(
        fileURLToPath(new URL("./env.ts", import.meta.url)),
        "utf8",
      )
      // The call site is asserted to exist at the bottom of env.ts.
      expect(source).toMatch(/assertBearerCsvsDisjoint\s*\(\s*\{/)
      // And it MUST reference the remaining CSV env vars from `env`.
      // The legacy SEARCH_API_KEYS was retired in Plan 003.
      expect(source).toMatch(/WORKFLOW_API_KEYS:\s*env\.WORKFLOW_API_KEYS/)
      expect(source).toMatch(
        /MASTRA_TRANSCRIPT_INGEST_API_KEYS:\s*env\.MASTRA_TRANSCRIPT_INGEST_API_KEYS/,
      )
      expect(source).toMatch(
        /MASTRA_SCENE_INGEST_API_KEYS:\s*env\.MASTRA_SCENE_INGEST_API_KEYS/,
      )
      expect(source).toMatch(
        /MASTRA_EXPERIENCE_INGEST_API_KEYS:\s*env\.MASTRA_EXPERIENCE_INGEST_API_KEYS/,
      )
      expect(source).toMatch(/WEB_ADMIN_API_KEYS:\s*env\.WEB_ADMIN_API_KEYS/)
      expect(source).toMatch(
        /BACKUP_DOWNLOAD_API_KEYS:\s*env\.BACKUP_DOWNLOAD_API_KEYS/,
      )
      expect(source).toMatch(
        /SEARCH_TRACE_SAMPLING_API_KEYS:\s*env\.SEARCH_TRACE_SAMPLING_API_KEYS/,
      )
      // Regression guard: SEARCH_API_KEYS must NOT appear in the Zod
      // schema (the receiver-side CSV is retired in Plan 003) and
      // must NOT appear as an env-var arg to `assertBearerCsvsDisjoint`.
      // The deprecation warn at module-load IS allowed (and required)
      // so operators with a stale Doppler value see a log signal.
      expect(source).not.toMatch(/SEARCH_API_KEYS:\s*z\./)
      expect(source).not.toMatch(/SEARCH_API_KEYS:\s*env\.SEARCH_API_KEYS/)
      // Positive control: the deprecation warn exists.
      expect(source).toMatch(/event=search_api_keys_env_var_retired/)
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
