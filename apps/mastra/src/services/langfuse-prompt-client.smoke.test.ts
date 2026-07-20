import { describe, expect, it } from "vitest"

import { env, getLangfuseConfig } from "../config/env"
import {
  createManagedPromptCache,
  fetchLangfusePrompt,
  getManagedPrompt,
} from "./langfuse-prompt-client"

/**
 * Opt-in REAL-CREDENTIAL Langfuse smoke (2026-07-20 langfuse-prompt-helper
 * plan, U4). Proves the live Langfuse v2 Prompts API contract end to end —
 * real `getLangfuseConfig()` env config, the REAL global fetch, no mocks
 * anywhere in this file. Skipped (and REPORTED as skipped) in every default
 * run: only `LANGFUSE_PROMPT_SMOKE_TEST=1` enables it, mirroring the
 * env-gated smoke precedent in
 * `apps/admin/src/services/video-mapper-catalog.db.test.ts`.
 *
 * ONE-TIME SEEDING CONVENTION (manual, via the Langfuse UI — the test never
 * self-seeds; retrieval is this helper's whole boundary, plan R4):
 *
 *   - Project:  the dev Langfuse project the LANGFUSE_* env vars point at
 *   - Prompt:   name `forge-mastra-smoke/text-prompt`
 *               (the `/` in the name is deliberate — resolving it live
 *               doubles as proof of the client's URL path-segment encoding)
 *   - Type:     text (NOT chat)
 *   - Versions: ONE prompt, TWO versions, TWO labels (idiomatic Langfuse).
 *               The bodies are EXACT — the tests assert strict equality, not
 *               "any non-empty text":
 *
 *       Version 1 — label `production`, body EXACTLY:
 *         "forge-mastra smoke sentinel: managed prompt retrieval works."
 *       Version 2 — label `smoke`, body EXACTLY:
 *         "forge-mastra smoke sentinel: non-default label selection works."
 *
 *   WHY two labels with DIFFERENT bodies: `production` is ALSO Langfuse's
 *   documented default when the `label` param is omitted, so a
 *   production-labeled prompt alone cannot prove the client actually sends
 *   (and Langfuse honors) `?label=`. Fetching label `smoke` and receiving
 *   its distinct sentinel body is possible ONLY if label selection worked
 *   end to end.
 *
 * FAIL-LOUD CONTRACT: when credentials are present (the suite is enabled)
 * but a seeded prompt version is missing, this suite FAILS — it never skips.
 * The seeded-prompt tests below turn a `rejected`/404 into an actionable
 * assertion failure pointing back at this header.
 *
 * To run:
 *   LANGFUSE_PROMPT_SMOKE_TEST=1 LANGFUSE_BASE_URL=... \
 *   LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=... \
 *   pnpm --filter @forge/mastra test -- langfuse-prompt-client.smoke
 */

const RUN_LANGFUSE_SMOKE = env.LANGFUSE_PROMPT_SMOKE_TEST === "1"

const SMOKE_PROMPT_NAME = "forge-mastra-smoke/text-prompt"
const SMOKE_PROMPT_LABEL = "production"
// Non-default label carrying a DIFFERENT body than `production` — the only
// way to prove `?label=` is sent AND honored (production is also Langfuse's
// omitted-label default, so it can never prove label selection by itself).
const SMOKE_NON_DEFAULT_LABEL = "smoke"
// EXACT seeded bodies (see the ONE-TIME SEEDING CONVENTION above). These are
// the required version bodies, not examples — the tests assert strict
// equality against them.
const SMOKE_SENTINEL_TEXT =
  "forge-mastra smoke sentinel: managed prompt retrieval works."
const SMOKE_LABEL_SENTINEL_TEXT =
  "forge-mastra smoke sentinel: non-default label selection works."
// A name that must not exist in the project; slashed like the real one so the
// negative path also exercises the encoded-name route.
const NONEXISTENT_PROMPT_NAME = "forge-mastra-smoke/does-not-exist"
const SMOKE_FALLBACK_TEXT =
  "SMOKE-FALLBACK: compiled-in instructions served because Langfuse had no managed prompt."

// Network-bound: generous per-test timeout, well above the client's own
// LANGFUSE_TIMEOUT_MS single-attempt budget.
const SMOKE_TEST_TIMEOUT_MS = 15_000

describe.skipIf(!RUN_LANGFUSE_SMOKE)(
  "langfuse prompt client real-credential smoke",
  () => {
    const config = getLangfuseConfig()

    it(
      "resolves the manually seeded smoke prompt (fails LOUD with seeding guidance when it is missing)",
      async () => {
        const result = await fetchLangfusePrompt({
          name: SMOKE_PROMPT_NAME,
          label: SMOKE_PROMPT_LABEL,
          config,
        })

        if (!result.ok) {
          // Fail-loud contract (smoke requirement 3): credentials are present
          // — a failure here is a real signal, never a skip. A rejected/404
          // almost always means the one-time manual seeding step has not been
          // done in this Langfuse project.
          expect.unreachable(
            `Expected the seeded smoke prompt "${SMOKE_PROMPT_NAME}" ` +
              `(label "${SMOKE_PROMPT_LABEL}") to resolve, but got ` +
              `reason=${result.reason}` +
              (result.status !== undefined ? ` status=${result.status}` : "") +
              (result.detail !== undefined ? ` detail=${result.detail}` : "") +
              `. If this is rejected/404, seed the prompt manually in the ` +
              `dev Langfuse project per the ONE-TIME SEEDING CONVENTION in ` +
              `this file's header (the test never self-seeds).`,
          )
        }

        // EXACT body, not just non-empty: proves Langfuse served the seeded
        // production-version sentinel, and (paired with the smoke-label test
        // below) that label→body mapping is intact.
        expect(result.text).toBe(SMOKE_SENTINEL_TEXT)
        expect(typeof result.version).toBe("number")
        expect(Number.isFinite(result.version)).toBe(true)
        expect(result.labels).toContain(SMOKE_PROMPT_LABEL)
      },
      SMOKE_TEST_TIMEOUT_MS,
    )

    it(
      "honors the label param end to end: label `smoke` serves the DISTINCT non-default-label sentinel",
      async () => {
        const result = await fetchLangfusePrompt({
          name: SMOKE_PROMPT_NAME,
          label: SMOKE_NON_DEFAULT_LABEL,
          config,
        })

        if (!result.ok) {
          // Same fail-loud contract as the production-label test above: a
          // rejected/404 here almost always means version 2 (label `smoke`)
          // of the smoke prompt has not been seeded yet.
          expect.unreachable(
            `Expected the seeded smoke prompt "${SMOKE_PROMPT_NAME}" ` +
              `(label "${SMOKE_NON_DEFAULT_LABEL}") to resolve, but got ` +
              `reason=${result.reason}` +
              (result.status !== undefined ? ` status=${result.status}` : "") +
              (result.detail !== undefined ? ` detail=${result.detail}` : "") +
              `. Seed version 2 of the prompt under label ` +
              `"${SMOKE_NON_DEFAULT_LABEL}" per the ONE-TIME SEEDING ` +
              `CONVENTION in this file's header (the test never self-seeds).`,
          )
        }

        // The `smoke` label carries a DIFFERENT exact body than `production`
        // (Langfuse's omitted-label default), so this equality can only hold
        // if the client sent `?label=` AND Langfuse honored it — receiving
        // the production sentinel here would mean label selection silently
        // broke while staying green on non-empty-text assertions.
        expect(result.text).toBe(SMOKE_LABEL_SENTINEL_TEXT)
        expect(typeof result.version).toBe("number")
        expect(Number.isFinite(result.version)).toBe(true)
        expect(result.labels).toContain(SMOKE_NON_DEFAULT_LABEL)
      },
      SMOKE_TEST_TIMEOUT_MS,
    )

    it(
      "returns the rejected union branch (no throw) for a nonexistent prompt, and getManagedPrompt serves the fallback",
      async () => {
        const missing = await fetchLangfusePrompt({
          name: NONEXISTENT_PROMPT_NAME,
          label: SMOKE_PROMPT_LABEL,
          config,
        })

        expect(missing.ok).toBe(false)
        if (!missing.ok) {
          // Live proof of the documented not-found contract: 404 rides the
          // non-retryable `rejected` branch, never a throw.
          expect(missing.reason).toBe("rejected")
          expect(missing.retryable).toBe(false)
          expect(missing.status).toBe(404)
        }

        // Isolated cache so nothing bleeds between tests (or into the
        // module-level default cache other suites reset).
        const managed = await getManagedPrompt({
          name: NONEXISTENT_PROMPT_NAME,
          label: SMOKE_PROMPT_LABEL,
          fallback: SMOKE_FALLBACK_TEXT,
          config,
          cache: createManagedPromptCache(),
          // Keep the (correct) failure log line out of smoke output.
          logSink: () => {},
        })

        expect(managed.source).toBe("fallback")
        expect(managed.text).toBe(SMOKE_FALLBACK_TEXT)
        expect(managed.reason).toBe("rejected")
      },
      SMOKE_TEST_TIMEOUT_MS,
    )
  },
)
