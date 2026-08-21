// Minimal smoke test confirming vitest + tsconfig + alias wiring.
// Later units extend this with env-validation behavior tests.

import { describe, expect, it, vi } from "vitest"
import {
  assertBearerCsvsDisjoint,
  assertTypesenseCredentialsDisjoint,
  concurrencyEnvSchema,
  constrainedDecodingTrustedEnvSchema,
  DEFAULT_WEB_CANONICAL_ORIGIN,
  env,
  experienceAiMaxRepairAttemptsEnvSchema,
  fleetSearchCeilingEnforceEnvSchema,
  fleetSearchGlobalCeilingPerMinEnvSchema,
  searchTraceRawRetentionDaysEnvSchema,
  resolveWatchSearchRuntimeEnv,
  resolveUserPlaylistRuntimeControls,
  watchSearchDefaultShadowEnabledEnvSchema,
  watchSearchFleetPrimaryEnabledEnvSchema,
  watchSearchPrimaryModeEnvSchema,
  watchSearchTypesenseProfileEnvSchema,
  watchSearchCandidateComparisonEnabledEnvSchema,
  watchSearchTranscriptProjectionRevisionEnvSchema,
  webCanonicalOriginEnvSchema,
  workflowStartupTransientAttemptsEnvSchema,
  workflowStartupTransientDelayMsEnvSchema,
  youVersionPassageCacheTtlSecondsEnvSchema,
} from "@/config/env"

describe("env", () => {
  it("loads with placeholder defaults in CI mode", () => {
    expect(env.DATABASE_URL).toContain("forge_admin")
  })

  it("defaults visitor-facing web links to the canonical www watch origin", () => {
    expect(env.WEB_CANONICAL_ORIGIN).toBe(DEFAULT_WEB_CANONICAL_ORIGIN)
  })

  describe("user playlist rollout controls", () => {
    it("defaults authoring and anonymous public reads off", () => {
      expect(
        resolveUserPlaylistRuntimeControls({
          authoringEnabled: undefined,
          anonymousPublicReadEnabled: undefined,
          emergencyPublicReadDisabled: undefined,
        }),
      ).toMatchObject({
        authoringEnabled: false,
        anonymousPublicReadEnabled: false,
      })
    })

    it("fails malformed Admin controls closed", () => {
      expect(
        resolveUserPlaylistRuntimeControls({
          authoringEnabled: "invalid",
          anonymousPublicReadEnabled: "true",
          emergencyPublicReadDisabled: "invalid",
        }),
      ).toEqual({
        authoringEnabled: false,
        anonymousPublicReadEnabled: false,
        emergencyPublicReadDisabled: true,
        malformed: true,
      })
    })
  })

  describe("Watch search Web routing", () => {
    it("normalizes and caches the production resolver path under CI", async () => {
      vi.resetModules()
      vi.stubEnv("CI", "true")
      vi.stubEnv("WATCH_SEARCH_DEFAULT_SHADOW_ENABLED", "false")
      vi.stubEnv("WATCH_SEARCH_FLEET_PRIMARY_ENABLED", "true")
      vi.stubEnv("WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED", "false")
      vi.stubEnv("WATCH_SEARCH_TRANSCRIPT_PROJECTION_REVISION", "1")

      try {
        const runtimeConfig = await import("@/config/env")
        const first = runtimeConfig.resolveWatchSearchRuntimeEnv()

        expect(first).toEqual({
          defaultShadowEnabled: false,
          fleetPrimaryEnabled: true,
          candidateComparisonEnabled: false,
          transcriptProjectionRevision: 1n,
        })
        expect(runtimeConfig.resolveWatchSearchRuntimeEnv()).toBe(first)
      } finally {
        vi.unstubAllEnvs()
        vi.resetModules()
      }
    })

    it("normalizes raw CI runtime values before search safety checks", () => {
      expect(
        resolveWatchSearchRuntimeEnv({
          defaultShadowEnabled: "true",
          fleetPrimaryEnabled: "false",
          candidateComparisonEnabled: "false",
          transcriptProjectionRevision: "1",
        }),
      ).toEqual({
        defaultShadowEnabled: true,
        fleetPrimaryEnabled: false,
        candidateComparisonEnabled: false,
        transcriptProjectionRevision: 1n,
      })
    })

    it("preserves validated values and fails invalid raw controls closed", () => {
      expect(
        resolveWatchSearchRuntimeEnv({
          defaultShadowEnabled: false,
          fleetPrimaryEnabled: true,
          candidateComparisonEnabled: true,
          transcriptProjectionRevision: 2n,
        }),
      ).toMatchObject({
        defaultShadowEnabled: false,
        fleetPrimaryEnabled: true,
        candidateComparisonEnabled: true,
        transcriptProjectionRevision: 2n,
      })
      expect(
        resolveWatchSearchRuntimeEnv({
          defaultShadowEnabled: "invalid",
          fleetPrimaryEnabled: "invalid",
          candidateComparisonEnabled: "invalid",
          transcriptProjectionRevision: "invalid",
        }),
      ).toEqual({
        defaultShadowEnabled: true,
        fleetPrimaryEnabled: false,
        candidateComparisonEnabled: false,
        transcriptProjectionRevision: undefined,
      })
    })

    it("defaults canonical browser traffic to MODERN with DEFAULT shadow enabled", () => {
      expect(watchSearchPrimaryModeEnvSchema.parse(undefined)).toBe("MODERN")
      expect(watchSearchDefaultShadowEnabledEnvSchema.parse(undefined)).toBe(
        true,
      )
    })

    it("accepts the independent DEFAULT rollback and shadow kill switch", () => {
      expect(watchSearchPrimaryModeEnvSchema.parse("DEFAULT")).toBe("DEFAULT")
      expect(watchSearchDefaultShadowEnabledEnvSchema.parse("false")).toBe(
        false,
      )
    })

    it("keeps omitted-mode authenticated fleet promotion disabled by default", () => {
      expect(watchSearchFleetPrimaryEnabledEnvSchema.parse(undefined)).toBe(
        false,
      )
      expect(watchSearchFleetPrimaryEnabledEnvSchema.parse("true")).toBe(true)
      expect(watchSearchFleetPrimaryEnabledEnvSchema.parse("false")).toBe(false)
      expect(() =>
        watchSearchFleetPrimaryEnabledEnvSchema.parse("yes"),
      ).toThrow()
    })

    it("defaults the private Typesense selector and comparison switch off safely", () => {
      expect(watchSearchTypesenseProfileEnvSchema.parse(undefined)).toBe(
        "CURRENT",
      )
      expect(
        watchSearchCandidateComparisonEnabledEnvSchema.parse(undefined),
      ).toBe(false)
      expect(
        watchSearchTranscriptProjectionRevisionEnvSchema.parse(undefined),
      ).toBeUndefined()
    })

    it("accepts one exact candidate pin and rejects malformed selectors", () => {
      expect(
        watchSearchTypesenseProfileEnvSchema.parse("CANDIDATE:generation-7"),
      ).toBe("CANDIDATE:generation-7")
      expect(watchSearchTranscriptProjectionRevisionEnvSchema.parse("17")).toBe(
        17n,
      )
      for (const value of [
        "CANDIDATE",
        "CANDIDATE:",
        "candidate:generation-7",
        "CANDIDATE:../generation",
        "SERVING:generation-7",
      ]) {
        expect(() =>
          watchSearchTypesenseProfileEnvSchema.parse(value),
        ).toThrow()
      }
    })
  })

  describe("fleetSearchGlobalCeilingPerMinEnvSchema", () => {
    it("defaults to 6000 when unset", () => {
      expect(fleetSearchGlobalCeilingPerMinEnvSchema.parse(undefined)).toBe(
        6000,
      )
    })
    it("coerces a numeric string", () => {
      expect(fleetSearchGlobalCeilingPerMinEnvSchema.parse("4800")).toBe(4800)
    })
    it("accepts 0 as the operator kill-switch", () => {
      expect(fleetSearchGlobalCeilingPerMinEnvSchema.parse("0")).toBe(0)
    })
    it("rejects a negative ceiling", () => {
      expect(() =>
        fleetSearchGlobalCeilingPerMinEnvSchema.parse("-1"),
      ).toThrow()
    })
  })

  describe("fleetSearchCeilingEnforceEnvSchema", () => {
    it("defaults to false (alert-first)", () => {
      expect(fleetSearchCeilingEnforceEnvSchema.parse(undefined)).toBe("false")
    })
    it("accepts the two enum values", () => {
      expect(fleetSearchCeilingEnforceEnvSchema.parse("true")).toBe("true")
      expect(fleetSearchCeilingEnforceEnvSchema.parse("false")).toBe("false")
    })
    it("rejects any other string", () => {
      expect(() => fleetSearchCeilingEnforceEnvSchema.parse("yes")).toThrow()
    })
  })

  describe("webCanonicalOriginEnvSchema", () => {
    it("normalizes HTTP(S) URLs to origins", () => {
      expect(
        webCanonicalOriginEnvSchema.parse(
          "https://example.com/some/path?x=1#top",
        ),
      ).toBe("https://example.com")
      expect(webCanonicalOriginEnvSchema.parse("http://localhost:3000/")).toBe(
        "http://localhost:3000",
      )
    })

    it("rejects non-HTTP visitor link origins", () => {
      expect(() =>
        webCanonicalOriginEnvSchema.parse("ftp://example.com"),
      ).toThrow(/HTTP\(S\)/)
      expect(() =>
        webCanonicalOriginEnvSchema.parse("javascript:alert(1)"),
      ).toThrow(/HTTP\(S\)|Invalid/)
    })
  })

  // `createEnv` is bypassed under CI (`skipValidation`), so we test
  // the exported schema fragment directly. Importing it (rather than
  // re-declaring the zod chain inline) binds the test to the real
  // contract used by `TRANSCRIPT_EMBEDDING_CONCURRENCY`. Tightening the schema later
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

  // AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED (U4). `createEnv` is
  // skipped under CI, so the schema fragment is exercised directly —
  // binding the test to the real `.optional().default("false")` contract.
  describe("constrainedDecodingTrustedEnvSchema", () => {
    it('defaults to "false" when absent', () => {
      expect(constrainedDecodingTrustedEnvSchema.parse(undefined)).toBe("false")
    })

    it('accepts the literal "true"', () => {
      expect(constrainedDecodingTrustedEnvSchema.parse("true")).toBe("true")
    })

    it('accepts the literal "false"', () => {
      expect(constrainedDecodingTrustedEnvSchema.parse("false")).toBe("false")
    })

    it("rejects any other non-empty value", () => {
      expect(() => constrainedDecodingTrustedEnvSchema.parse("1")).toThrow()
      expect(() => constrainedDecodingTrustedEnvSchema.parse("yes")).toThrow()
      expect(() => constrainedDecodingTrustedEnvSchema.parse("TRUE")).toThrow()
    })
  })

  // EXPERIENCE_AI_MAX_REPAIR_ATTEMPTS (U5). Schema fragment exercised
  // directly (createEnv is skipped under CI) so the test binds to the real
  // `z.coerce.number().int().min(0).max(5).optional().default(2)` contract.
  describe("experienceAiMaxRepairAttemptsEnvSchema", () => {
    it("defaults to 2 when absent", () => {
      expect(experienceAiMaxRepairAttemptsEnvSchema.parse(undefined)).toBe(2)
    })

    it("coerces a numeric string and accepts 0 through 5", () => {
      expect(experienceAiMaxRepairAttemptsEnvSchema.parse("0")).toBe(0)
      expect(experienceAiMaxRepairAttemptsEnvSchema.parse("2")).toBe(2)
      expect(experienceAiMaxRepairAttemptsEnvSchema.parse("5")).toBe(5)
    })

    it("rejects negative, fractional, and out-of-range values", () => {
      expect(() => experienceAiMaxRepairAttemptsEnvSchema.parse("-1")).toThrow()
      expect(() =>
        experienceAiMaxRepairAttemptsEnvSchema.parse("1.5"),
      ).toThrow()
      expect(() => experienceAiMaxRepairAttemptsEnvSchema.parse("6")).toThrow()
      expect(() =>
        experienceAiMaxRepairAttemptsEnvSchema.parse("nope"),
      ).toThrow()
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

  describe("workflowStartupTransientAttemptsEnvSchema", () => {
    it("defaults to 12 attempts", () => {
      expect(workflowStartupTransientAttemptsEnvSchema.parse(undefined)).toBe(
        12,
      )
    })

    it("coerces a positive integer attempt count", () => {
      expect(workflowStartupTransientAttemptsEnvSchema.parse("3")).toBe(3)
    })

    it("rejects invalid attempt counts", () => {
      expect(() =>
        workflowStartupTransientAttemptsEnvSchema.parse("0"),
      ).toThrow()
      expect(() =>
        workflowStartupTransientAttemptsEnvSchema.parse("1.5"),
      ).toThrow()
      expect(() =>
        workflowStartupTransientAttemptsEnvSchema.parse("nope"),
      ).toThrow()
    })
  })

  describe("workflowStartupTransientDelayMsEnvSchema", () => {
    it("defaults to a ten-second retry delay", () => {
      expect(workflowStartupTransientDelayMsEnvSchema.parse(undefined)).toBe(
        10_000,
      )
    })

    it("coerces a positive integer delay", () => {
      expect(workflowStartupTransientDelayMsEnvSchema.parse("250")).toBe(250)
    })

    it("rejects invalid delay values", () => {
      expect(() =>
        workflowStartupTransientDelayMsEnvSchema.parse("0"),
      ).toThrow()
      expect(() =>
        workflowStartupTransientDelayMsEnvSchema.parse("1.5"),
      ).toThrow()
      expect(() =>
        workflowStartupTransientDelayMsEnvSchema.parse("nope"),
      ).toThrow()
    })
  })

  describe("youVersionPassageCacheTtlSecondsEnvSchema", () => {
    it("defaults to a two-week cache ttl", () => {
      expect(youVersionPassageCacheTtlSecondsEnvSchema.parse(undefined)).toBe(
        60 * 60 * 24 * 14,
      )
    })

    it("coerces positive integer ttl seconds", () => {
      expect(youVersionPassageCacheTtlSecondsEnvSchema.parse("60")).toBe(60)
    })

    it("rejects invalid ttl values", () => {
      expect(() =>
        youVersionPassageCacheTtlSecondsEnvSchema.parse("0"),
      ).toThrow()
      expect(() =>
        youVersionPassageCacheTtlSecondsEnvSchema.parse("abc"),
      ).toThrow()
    })
  })

  // Bearer-CSV disjointness invariant. The bearer CSVs
  // (WORKFLOW_API_KEYS, VIDEO_MAPPER_ADMIN_API_KEYS,
  // MASTRA_TRANSCRIPT_INGEST_API_KEYS,
  // MASTRA_EXPERIENCE_INGEST_API_KEYS,
  // WEB_ADMIN_API_KEYS,
  // WATCH_PROGRESS_ADMIN_API_KEYS,
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
        assertBearerCsvsDisjoint({
          WATCH_PROGRESS_ADMIN_API_KEYS: "watch-progress-a",
        }),
      ).not.toThrow()
      expect(() =>
        assertBearerCsvsDisjoint({ WORKFLOW_API_KEYS: "wf-a" }),
      ).not.toThrow()
      expect(() =>
        assertBearerCsvsDisjoint({
          VIDEO_MAPPER_ADMIN_API_KEYS: "mapper-a",
        }),
      ).not.toThrow()
      expect(() =>
        assertBearerCsvsDisjoint({
          MASTRA_TRANSCRIPT_INGEST_API_KEYS: "mastra-a",
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
          VIDEO_MAPPER_ADMIN_API_KEYS: "mapper-a,mapper-b",
          MASTRA_TRANSCRIPT_INGEST_API_KEYS: "mastra-a,mastra-b",
          MASTRA_EXPERIENCE_INGEST_API_KEYS: "experience-a,experience-b",
          WEB_ADMIN_API_KEYS: "web-a,web-b",
          FLEET_ADMIN_API_KEYS: "fleet-a,fleet-b",
          WATCH_PROGRESS_ADMIN_API_KEYS: "watch-progress-a,watch-progress-b",
          BACKUP_DOWNLOAD_API_KEYS: "backup-a,backup-b",
          SEARCH_TRACE_SAMPLING_API_KEYS: "trace-sampling-a,trace-sampling-b",
        }),
      ).not.toThrow()
    })

    it("throws when FLEET_ADMIN and WEB_ADMIN share a value", () => {
      // The fleet CSV must stay disjoint from the web SSR CSV — sharing a
      // value would give a fleet key web's per-key bucket (or vice versa).
      expect(() =>
        assertBearerCsvsDisjoint({
          WEB_ADMIN_API_KEYS: "shared-fleet-key",
          FLEET_ADMIN_API_KEYS: "shared-fleet-key",
        }),
      ).toThrow(/WEB_ADMIN_API_KEYS and FLEET_ADMIN_API_KEYS/)
    })

    it("throws when WORKFLOW and WEB_ADMIN share a value", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "shared-key",
          WEB_ADMIN_API_KEYS: "shared-key",
        }),
      ).toThrow(/WORKFLOW_API_KEYS and WEB_ADMIN_API_KEYS/)
    })

    it("throws when WORKFLOW and VIDEO_MAPPER share a value", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "shared-key",
          VIDEO_MAPPER_ADMIN_API_KEYS: "shared-key",
        }),
      ).toThrow(/WORKFLOW_API_KEYS and VIDEO_MAPPER_ADMIN_API_KEYS/)
    })

    it("throws when WORKFLOW and MASTRA_TRANSCRIPT_INGEST share a value", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "shared-key",
          MASTRA_TRANSCRIPT_INGEST_API_KEYS: "shared-key",
        }),
      ).toThrow(/WORKFLOW_API_KEYS and MASTRA_TRANSCRIPT_INGEST_API_KEYS/)
    })

    it("throws when transcript and experience Mastra ingest keys share a value", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          MASTRA_TRANSCRIPT_INGEST_API_KEYS: "shared-key",
          MASTRA_EXPERIENCE_INGEST_API_KEYS: "shared-key",
        }),
      ).toThrow(
        /MASTRA_TRANSCRIPT_INGEST_API_KEYS and MASTRA_EXPERIENCE_INGEST_API_KEYS/,
      )
    })

    it("throws when ADMIN_AGENT_TOOLS shares a value with experience ingest (U7)", () => {
      // The new agent-tools receiver CSV joins the disjointness invariant — an
      // operator who pastes the same value into two CSVs hits a fail-fast boot.
      expect(() =>
        assertBearerCsvsDisjoint({
          ADMIN_AGENT_TOOLS_API_KEYS: "shared-key",
          MASTRA_EXPERIENCE_INGEST_API_KEYS: "shared-key",
        }),
      ).toThrow(/ADMIN_AGENT_TOOLS_API_KEYS|MASTRA_EXPERIENCE_INGEST_API_KEYS/)
    })

    it("does not throw when ADMIN_AGENT_TOOLS is disjoint from the other CSVs (U7)", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WORKFLOW_API_KEYS: "wf-a",
          MASTRA_EXPERIENCE_INGEST_API_KEYS: "experience-a",
          ADMIN_AGENT_TOOLS_API_KEYS: "agent-tools-a,agent-tools-b",
        }),
      ).not.toThrow()
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

    it("throws when WATCH_PROGRESS_ADMIN_API_KEYS overlaps another bearer capability", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          WEB_ADMIN_API_KEYS: "shared-key",
          WATCH_PROGRESS_ADMIN_API_KEYS: "shared-key",
        }),
      ).toThrow(/WEB_ADMIN_API_KEYS and WATCH_PROGRESS_ADMIN_API_KEYS/)
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
          VIDEO_MAPPER_ADMIN_API_KEYS: "mapper-a",
          MASTRA_TRANSCRIPT_INGEST_API_KEYS: "mastra-a",
          MASTRA_EXPERIENCE_INGEST_API_KEYS: "experience-a",
          WEB_ADMIN_API_KEYS: "shared-1,shared-2",
          WATCH_PROGRESS_ADMIN_API_KEYS: "watch-progress-a",
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

  describe("search credential separation", () => {
    it("keeps dedicated Typesense search and operator credentials disjoint", () => {
      expect(() =>
        assertTypesenseCredentialsDisjoint({
          searchKey: "search-only",
          operatorKey: "operator-only",
        }),
      ).not.toThrow()
      expect(() =>
        assertTypesenseCredentialsDisjoint({
          searchKey: "shared",
          operatorKey: "shared",
        }),
      ).toThrow(/must be disjoint/)
    })

    it("keeps candidate evaluation credentials disjoint from sampling", () => {
      expect(() =>
        assertBearerCsvsDisjoint({
          SEARCH_TRACE_SAMPLING_API_KEYS: "shared-eval",
          CANDIDATE_SEARCH_EVAL_API_KEYS: "shared-eval",
        }),
      ).toThrow(
        /SEARCH_TRACE_SAMPLING_API_KEYS and CANDIDATE_SEARCH_EVAL_API_KEYS/,
      )
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
        /VIDEO_MAPPER_ADMIN_API_KEYS:\s*env\.VIDEO_MAPPER_ADMIN_API_KEYS/,
      )
      expect(source).toMatch(
        /MASTRA_TRANSCRIPT_INGEST_API_KEYS:\s*env\.MASTRA_TRANSCRIPT_INGEST_API_KEYS/,
      )
      expect(source).toMatch(
        /MASTRA_EXPERIENCE_INGEST_API_KEYS:\s*env\.MASTRA_EXPERIENCE_INGEST_API_KEYS/,
      )
      expect(source).toMatch(/WEB_ADMIN_API_KEYS:\s*env\.WEB_ADMIN_API_KEYS/)
      // Boot-call arg is load-bearing: the `satisfies` guard only aligns the
      // mapped type, so a missing arg here silently skips the fleet disjointness
      // check. This grep fails if FLEET_ADMIN_API_KEYS is dropped from the call.
      expect(source).toMatch(
        /FLEET_ADMIN_API_KEYS:\s*env\.FLEET_ADMIN_API_KEYS/,
      )
      expect(source).toMatch(
        /WATCH_PROGRESS_ADMIN_API_KEYS:\s*env\.WATCH_PROGRESS_ADMIN_API_KEYS/,
      )
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

    it("does not expose removed Admin search-eval harness env keys", async () => {
      const { readFile } = await import("node:fs/promises")
      const { fileURLToPath } = await import("node:url")
      const source = await readFile(
        fileURLToPath(new URL("./env.ts", import.meta.url)),
        "utf8",
      )

      expect(source).not.toMatch(/\bSEARCH_API_KEY:\s*z\./)
      expect(source).not.toMatch(/\bSEARCH_API_KEY:\s*emptyToUndefined/)
      expect(source).not.toMatch(/\bOPENROUTER_JUDGE_MODEL\b/)
      expect(source).not.toMatch(/\bEVAL_JUDGE_CONCURRENCY\b/)
      expect(source).not.toMatch(/\bEVAL_SEARCH_CONCURRENCY\b/)
      expect(source).not.toMatch(/\bEVAL_GIT_SHA\b/)
    })

    it("does not expose removed Admin search-eval harness package scripts", async () => {
      const { readFile } = await import("node:fs/promises")
      const { fileURLToPath } = await import("node:url")
      const packageJson = JSON.parse(
        await readFile(
          fileURLToPath(new URL("../../package.json", import.meta.url)),
          "utf8",
        ),
      ) as { scripts?: Record<string, string> }

      expect(Object.keys(packageJson.scripts ?? {})).not.toContain(
        "eval:search",
      )
      expect(JSON.stringify(packageJson.scripts ?? {})).not.toContain(
        "eval-search.ts",
      )
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
