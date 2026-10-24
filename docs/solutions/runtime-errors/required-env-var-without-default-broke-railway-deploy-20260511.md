---
title: "Optional integration env validation must not block Railway service startup"
category: "runtime-errors"
problem_type: "runtime_error"
component: "tooling"
root_cause: "config_error"
resolution_type: "code_fix"
severity: "high"
module: "apps/web, apps/mastra"
tags:
  - railway-deploy
  - env-schema
  - opt-in-scaffolding
  - optional-integration
  - mastra
  - discovery
  - bearer-safety
  - code-review-followup
date: "2026-05-11"
last_updated: "2026-07-14"
related_prs:
  - "JesusFilm/forge#915" # the canary PR where this bit
  - "JesusFilm/forge#1566" # Mastra discovery startup regression
related_docs:
  - "docs/solutions/auth/better-auth-secret-must-not-fallback-to-hardcoded-value.md"
  - "docs/solutions/developer-experience/env-matrix-drift-from-runtime-requirements-20260421.md"
  - "docs/solutions/platform/optional-railway-s3-local-fallback.md"
  - "docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md"
  - "docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md"
  - "docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md"
  - "docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md"
  - "docs/solutions/conventions/single-service-http-client-result-union-convention.md"
---

## Problem

This pattern has now caused two Railway incidents: an opt-in Web migration URL
became required at module load, and later an optional Mastra website discovery
integration became a production boot invariant. In both cases, configuration
that only the feature consumer needed took down the whole service before that
feature ran.

PR #915 added `ADMIN_GRAPHQL_URL` to `apps/web/src/env.ts` as a required `z.url()` with no `.optional()` and no `.default()`, even though the default `FORGE_CONTENT_API=strapi` code path never invokes the admin Apollo client. Railway's `forge - @forge/web` deploy failed at boot because the service hadn't been provisioned with the new var. The fail-fast design was intentional (the U5 plan explicitly named the trade-off and prescribed "deploy env var to all environments BEFORE PR merge" as the operational mitigation), but the mitigation wasn't executed and the boot-fast became a deploy block.

### Mastra recurrence (2026-07-14)

PR #1566 added production assertions that treated the optional website review
queue and saved-source integration as one required configuration group. A
missing or mismatched `DISCOVERY_SITE_ALLOWED_HOSTS`, partial URL/token pair, or
malformed optional URL could stop `@forge/mastra` during module startup. Studio
and unrelated agents/workflows disappeared even though website discovery
handoff is best-effort and is not a core runtime dependency.

## Symptoms

- Railway check `forge - @forge/web` returns `Deployment failed` with no detailed CI error surface
- GitHub Actions (build / lint / test / typecheck) all green — the failure is invisible to every pre-merge gate
- t3-env throws at module load when `ADMIN_GRAPHQL_URL` is unset
- Local dev unaffected (developer `.env` has the var)
- Vitest unaffected (`apps/web/vitest.setup.ts` pre-stubs the var)
- `pnpm build` unaffected (Next.js build-phase env mocking)
- Mastra logged
  `INSTAGRAM_DISCOVERY_SITE_INGEST_URL must use https and a host listed in DISCOVERY_SITE_ALLOWED_HOSTS for Mastra production`
  and exited before Studio could start

## What Didn't Work

**Round-2 ce-code-review reliability persona finding `rel-r2-1` (P2, confidence 75)** explicitly flagged this exact failure mode: _"boot fails when unset, even in default strapi mode where admin-client is never invoked."_ The orchestrator rated as "by design — required env vars must be set or boot fails" and skipped. This was the wrong call.

Pre-merge gates that did not catch it because they all run against pre-populated env shapes:

- Unit tests: pass (`vitest.setup.ts` pre-sets the var)
- `pnpm build`: pass (Next.js build-phase env mocking)
- CI Actions: pass (no Railway prod env exercise)
- Local smoke: pass (`.env` has it)

**Crucially, the U5 plan also anticipated this.** Plan section "Risks & Dependencies" (line 425) prescribes the boot-fail-fast as intentional, and the "Documentation / Operational Notes" section (line 440) writes the mitigation in one sentence (session history):

> Env var rollout order: `ADMIN_GRAPHQL_URL` deploys to all environments (dev/preview/staging/prod) BEFORE the U5 PR merges so Apollo singleton construction doesn't fail at boot.

The deploy-ordering note was treated as a routine "Documentation / Operational Notes" line, not a PR-blocking prerequisite. The mitigation never ran, so the design's failure mode landed.

Adjacent context (session history): an earlier U1 Easter-smoke-test plan went the other way — `/ce-doc-review` corrected it to `z.url().optional()` with runtime default to avoid exactly this t3-oss-validation-tripping-at-boot scenario. That plan was deleted when the brief-resume path was chosen instead; the correction did not carry forward to the U5 plan, which deliberately went required-with-allowlist.

## Solution

`apps/web/src/env.ts`: add `.optional()` after the existing `.refine()` chain.

```ts
// Before
ADMIN_GRAPHQL_URL: z
  .url()
  .refine(/* hard-reject auth.jesusfilm.org */)
  .refine(/* soft-allowlist warn */),

// After
ADMIN_GRAPHQL_URL: z
  .url()
  .refine(/* hard-reject auth.jesusfilm.org */)
  .refine(/* soft-allowlist warn */)
  .optional(),
```

`apps/web/src/lib/admin-client.ts`: coalesce to empty string at module load — `env.ADMIN_GRAPHQL_URL ?? ""`. The Apollo HttpLink is constructed with an empty URI but is never invoked in default `strapi` mode, so the empty value is inert.

```ts
const uri = typeof window === "undefined" ? (env.ADMIN_GRAPHQL_URL ?? "") : ""
```

Behavior matrix (default mode unchanged byte-for-byte):

| `FORGE_CONTENT_API` | `ADMIN_GRAPHQL_URL` | Behavior                                                                                                                              |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `strapi` (default)  | unset               | Byte-identical to current main; admin client never invoked                                                                            |
| `strapi`            | set                 | Identical to main, URL ignored                                                                                                        |
| `dual-read`         | set                 | Canary works as designed                                                                                                              |
| `dual-read`         | unset               | Fetch fails with non-URL error → caught by `fetchAdminSlugExperience` → emits `forge.parity.harness_error subkind: admin_fetch_error` |

### Mastra recurrence fix

The Mastra fix removed discovery URL/token grouping and host-allowlist checks
from `assertMastraRuntimeEnv()`, removed `DISCOVERY_SITE_ALLOWED_HOSTS`, and
parses both optional endpoint values as non-empty strings rather than URLs at
module load. The existing accessors still return `null` unless the relevant URL
and shared token are both present, so incomplete pairs disable only that
integration.

URL safety stays at the credential-bearing request boundary. The discovery
ingest and saved-source clients call `requireHttpsUrl()` before `fetch`, attach
the bearer only after that check, and set `redirect: "error"`. Malformed and
HTTP values therefore fail the optional workflow operation without exposing the
token or blocking Mastra startup.

## Why This Works

The default mode (`FORGE_CONTENT_API=strapi`) doesn't invoke the admin Apollo client at all. The empty-string URL is set at module load but Apollo HttpLink is never asked to make a fetch in default mode, so the empty URI is inert. The misconfiguration that previously bricked boot now surfaces to operators as a structured log event (`forge.parity.harness_error subkind: admin_fetch_error`) when they explicitly opt into `dual-read` mode without setting the URL — visible in logs at the moment the operator activates the canary, exactly when they have context to fix it.

The deeper "why" is about which layer should hold the precondition. The U5 plan correctly identified `ADMIN_GRAPHQL_URL must be set before this PR merges` as a real precondition; it incorrectly assigned that precondition to the operator's deploy-checklist discipline rather than to the schema. Schemas are checked automatically on every boot; deploy checklists are checked only when humans remember to read them. The fix moves the precondition into the code path that consumes it: schema accepts absence, runtime detects activation, structured log reports the gap. The class of failure moves from "silent deploy block" to "explicit operator-visible signal."

The Mastra recurrence sharpens the rule: optional credentialed endpoints may
still need strict URL validation, but that validation belongs immediately
before the outbound request. The service boot path should validate only
always-on dependencies; a best-effort integration should fail at its own typed
boundary.

## Prevention

1. **Rule of thumb**: env vars introduced for opt-in feature scaffolding must be `.optional()`. Only make a new env var required when the _default_ code path needs it. Required-at-schema-load is reserved for vars the always-on code consumes.

2. **Operational mitigations belong in operator runbooks, not as PR-blocking implementation notes.** If a plan section names a deploy-ordering prerequisite ("env var must be deployed to all environments before PR merge"), that prerequisite needs to be either (a) executed as part of the PR's own checklist (commit message, PR description acceptance criteria, blocking CI step), or (b) avoided entirely by changing the schema so the prerequisite isn't load-bearing. Notes buried in "Documentation / Operational Notes" sections of a 5-unit plan are too easy to skip.

3. **Code-review heuristic**: when a reliability persona flags "boot-fail when unset" on a new env var, the question is _"does the default code path consume this var?"_ If no, it must be optional. Do not rationalize "operators will set it" — the failure mode is a broken deploy in a service operators haven't touched yet, with no signal to know they need to.

4. **Test addition**: add a `vi.stubEnv` / `vi.unstubAllEnvs`-scoped test that imports `@/env` with the new var unset in `process.env` and asserts the import succeeds. This is the gate that would catch the same trap on the next scaffolding env var.

   For optional endpoint integrations, cover the full matrix: absent, URL-only,
   token-only, malformed, and non-HTTPS values must not block startup. Pair
   those boot tests with client tests proving malformed/non-HTTPS values never
   call `fetch` and redirects remain rejected.

```ts
// apps/web/src/env.test.ts (illustrative shape)
import { afterEach, describe, expect, it, vi } from "vitest"

describe("env.ts default-mode boot", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("imports cleanly when only the always-on env vars are set", async () => {
    vi.stubEnv("INTERNAL_GRAPHQL_URL", "http://localhost:1337/graphql")
    vi.stubEnv("NEXT_PUBLIC_GRAPHQL_URL", "http://localhost:1337/graphql")
    vi.stubEnv("STRAPI_API_TOKEN", "x")
    vi.stubEnv("STRAPI_PREVIEW_SECRET", "x")
    vi.stubEnv("REVALIDATION_SECRET", "x")
    // ADMIN_GRAPHQL_URL deliberately unset

    await expect(import("./env")).resolves.toBeDefined()
  })
})
```

5. **Codify in feat-104 plan template**: future consumer-migration scaffolding env vars (`FORGE_CONTENT_API`, `ADMIN_GRAPHQL_URL`, `FORGE_PARITY_DEBUG`, future U5b vars) are server-only and opt-in by design. Default to `.optional()` with safe-default semantics so default mode has zero new env-var prerequisites. Operators set them only when activating the feature they enable.

6. **Cross-link to the receiver-deploys-first pattern**: `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md` already codifies a related rule for cross-app triggers ("receiver deploys keyring entry FIRST; then caller deploys env var"). The U5 boot-fail is the same anti-pattern from the caller's perspective — a caller's schema required a URL before the URL was provisioned. The two docs together form a pair: **never let schema validation block a deploy that doesn't logically need the env var yet.**

## Review-loop meta

The orchestrator override of `rel-r2-1` is the highest-signal artifact from this incident. The reliability persona had the right answer with 75% confidence; the human-in-the-loop downgrade was the failure point.

**Decision rule for future loops**: reliability-persona findings on new env vars introduced under an opt-in flag get a presumption-of-correctness. Flip to `.optional()` unless the default code path provably needs the var. Apply, do not Defer. This is one concrete instance of the broader Tier-2-review-before-push discipline captured in [`docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`](../workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md).
