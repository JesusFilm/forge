---
title: "Datadog RUM env tag: unify every app on one canonical value (prod)"
date: "2026-07-22"
category: "conventions"
module: "Datadog RUM / cross-app observability (web + mobile + TV)"
problem_type: "convention"
component: "tooling"
severity: "medium"
applies_when:
  - "Filtering, monitoring, or dashboarding Datadog RUM across the web, mobile, and TV apps by env tag"
  - "Adding a new Forge app to the RUM fleet and choosing its production env tag"
  - "Changing web's normalizeDatadogEnv canonical values in apps/web/src/env.ts"
  - "Setting or leaving unset EXPO_PUBLIC_DATADOG_ENV on a mobile/TV EAS environment"
  - "Auditing why an env:production filter under-reports fleet-wide RUM sessions"
tags:
  - "datadog"
  - "rum"
  - "observability"
  - "env-tag"
  - "cross-app"
  - "mobile"
  - "tv"
  - "web"
related_components:
  - "apps/web/src/env.ts"
  - "apps/mobile/src/lib/datadog.ts"
  - "apps/tv/src/lib/datadog.ts"
---

# Datadog RUM env tag: unify every app on one canonical value (prod)

## Context

Three JesusFilm Forge apps ship Datadog RUM to the same Datadog org — `apps/web` (`service:forge-web`), `apps/mobile` (`service:forge-mobile`), and `apps/tv` (`service:forge-tv`). To split production telemetry from dev/preview noise, every session carries an `env` tag. The `service` tag is a hardcoded per-app literal and does NOT distinguish prod from dev — the `env` tag is the only lever that does. So a fleet-wide production query like "p75 load time across all three apps in prod" leans entirely on `env` matching the same canonical value in every app.

It did not. The two ends computed the tag by different mechanisms and, critically, emitted different literals for the same concept:

- **Web canonicalizes.** `apps/web/src/env.ts` runs a server-side fallback chain `NEXT_PUBLIC_DATADOG_ENV ?? RAILWAY_ENVIRONMENT_NAME ?? VERCEL_ENV ?? NODE_ENV` (`datadogEnvFallback()`, `apps/web/src/env.ts:88-95`) through a canonicalization switch `normalizeDatadogEnv()` (`apps/web/src/env.ts:65-86`). That switch collapses many aliases onto five canonical values: `production|prod → "prod"`, `staging|stage → "stage"`, `preview → "preview"`, `development|dev → "development"`, `test → "test"`. In production web tags `env:prod`.

- **Mobile/TV emitted a raw literal.** Both RN/Expo apps derived the tag from the React Native `__DEV__` build flag with no normalization step:
  `env.EXPO_PUBLIC_DATADOG_ENV ?? (__DEV__ ? "development" : "production")`.
  A release build with the env var unset tagged `env:production` — the un-canonicalized long form.

**Failure mode.** Because web tags `env:prod` but mobile/TV tagged `env:production`, a single Datadog filter of `env:production` silently MISSED web, and a filter of `env:prod` silently MISSED mobile and TV. Spanning the whole production fleet required the disjunction `env:(prod OR production)`. Nothing errors — every app reports healthy RUM; the filter just quietly returns a partial fleet, so any monitor, saved view, dashboard, or ad-hoc percentile keyed on one spelling computes over a subset while looking complete. The divergence is invisible until someone notices a count is too low or a service is absent from a "whole fleet" panel.

**Fix — shipped in PR #1665** (`chore(mobile,tv): tag Datadog RUM env as prod to match web`, branch `chore/mobile-tv-datadog-env-prod`, opened this session with green CI; as of writing the PR is still OPEN / unmerged, so `main` retains the old `"production"` literal and the branch tree carries `"prod"`). The change flips the mobile/TV release-build fallback literal from `"production"` to `"prod"` so all three apps tag `env:prod`:

- `apps/mobile/src/lib/datadog.ts:82` — `envName: env.EXPO_PUBLIC_DATADOG_ENV ?? (__DEV__ ? "development" : "prod")`
- `apps/tv/src/lib/datadog.ts:67` — same line.

It also adds a **release-branch unit test** in both apps that forces `global.__DEV__ = false` and asserts `getDatadogRumConfig()?.envName === "prod"`. This closed a real coverage gap: the pre-existing tests only exercised the `__DEV__ = true` dev path (`envName: "development"`) and the explicit-override passthrough — the release branch that actually ships to production had NO coverage, which is exactly the branch that carried the wrong literal. Finally, a prose sweep corrected every doc that described the old behavior in present tense: `apps/tv/CLAUDE.md`, `apps/tv/.env.example`, `docs/observability/datadog.md`, `docs/roadmap/platform/feat-225-tv-datadog-production-activation.md`, and `docs/solutions/best-practices/datadog-rum-deep-instrumentation-semantics.md` (item 6, ~line 206).

## Guidance

**Unify every app in a Datadog org on ONE canonical value per environment.** Pick the canonical spelling once (here `"prod"`, chosen because web already canonicalized to it and web is the highest-traffic app) and make every app emit that exact string. The `env` tag is the only cross-app prod/dev discriminator — the `service` tag is a fixed per-app literal and can't do this job — so a spelling mismatch in `env` is a silent, fleet-splitting bug, not a cosmetic one.

**An RN/Expo app must not emit a literal that web would canonicalize away.** Web's `normalizeDatadogEnv()` coerces `"production" → "prod"`, `"dev" → "development"`, `"stage" → "stage"`, etc. Any client that hardcodes a value web would rewrite (`"production"`, `"dev"`, `"staging"`) re-introduces the split. The mobile/TV apps have no normalize step — the literal they write is the literal Datadog ingests — so the literal in code MUST already be web's canonical form. When in doubt, write the value `normalizeDatadogEnv` would return, not the human-friendly long form.

**Cover the branch that ships.** The dangerous literal lived on the `__DEV__ === false` (release) branch, which jest never hits by default (`__DEV__` is `true` under jest). A test suite that only checks the dev path and the explicit-override path is blind to exactly the code that reaches production. For any build-flag-gated config value, add a test that toggles the flag to its production setting and asserts the shipped literal — restore the flag in a `finally`.

**Watch the un-normalized explicit-override passthrough.** Mobile/TV pass an explicit `EXPO_PUBLIC_DATADOG_ENV` through VERBATIM — there is no normalize on the override path (asserted by the passthrough test: `EXPO_PUBLIC_DATADOG_ENV = "production"` yields `envName: "production"`). This is intentional and is safe ONLY because production EAS environments are documented to leave the var UNSET so the `"prod"` default ships. An operator who "helpfully" sets `EXPO_PUBLIC_DATADOG_ENV=production` on a prod EAS environment re-splits the filter — the override defeats the fix. If you ever need the override to be safe against long-form spellings, normalize it too; today the guard is documentation, not code.

Before/after of the shipped line (identical in both `apps/mobile/src/lib/datadog.ts` and `apps/tv/src/lib/datadog.ts`):

```ts
// BEFORE — release builds tagged env:production, which web's env:prod filter misses
envName: env.EXPO_PUBLIC_DATADOG_ENV ?? (__DEV__ ? "development" : "production"),

// AFTER (PR #1665) — release builds tag env:prod, matching web's canonical value
envName: env.EXPO_PUBLIC_DATADOG_ENV ?? (__DEV__ ? "development" : "prod"),
```

## Why This Matters

- **Silent cross-app filter miss.** No app errors; RUM flows from all three. The bug surfaces only as a filter that returns a partial fleet while presenting as complete — the hardest kind of observability defect to notice, because the tooling looks healthy.
- **Percentiles and counts computed on partial fleets are wrong, not just incomplete.** A p75 or error-rate over `env:production` that silently excludes web (or `env:prod` that excludes mobile+TV) is a number someone will trust and act on. Aggregates over a subset are more dangerous than a visibly empty panel because they look authoritative.
- **Monitors keyed on the wrong value misfire or never fire.** An alert scoped to `env:production` for `forge-web` never evaluates web sessions at all — a monitor that can't fire is worse than no monitor, because it manufactures false confidence.

## When to Apply

- **Adding RUM (or any tagged telemetry) to a new app in the same Datadog org.** Before writing the `env`/`service` config, check what the existing apps emit and match the canonical `env` value exactly. Grep the other apps' datadog config for the literal, don't guess the spelling.
- **Changing any app's canonical env value.** If web ever changes what `normalizeDatadogEnv()` returns (e.g. `"prod" → "production"`), the same value is now hardcoded in THREE independent definitions — web's switch return, the mobile literal, and the TV literal — with no shared constant and nothing automated to catch drift. Changing one without the others silently re-splits the fleet. Treat the canonical value as a cross-app contract and update all three in the same PR.
- **Auditing any cross-app `env:` filter, monitor, or dashboard.** When a "whole fleet" panel looks low or a service is missing, first suspect an `env`-spelling mismatch. Confirm by comparing raw `env` tag values per service in the RUM explorer before trusting any aggregate.

## Examples

**1. The envName fallback, before and after (the load-bearing one-line change).**

```ts
// apps/mobile/src/lib/datadog.ts  and  apps/tv/src/lib/datadog.ts
// BEFORE: env:production  →  missed by web's env:prod filter
envName: env.EXPO_PUBLIC_DATADOG_ENV ?? (__DEV__ ? "development" : "production"),
// AFTER (PR #1665): env:prod  →  matches web
envName: env.EXPO_PUBLIC_DATADOG_ENV ?? (__DEV__ ? "development" : "prod"),
```

**2. Web's canonical set — the target every app must hit.** `normalizeDatadogEnv()` (`apps/web/src/env.ts:65-86`) collapses aliases onto five values:

```ts
switch (normalized.toLowerCase()) {
  case "production":
  case "prod":
    return "prod"
  case "staging":
  case "stage":
    return "stage"
  case "preview":
    return "preview"
  case "development":
  case "dev":
    return "development"
  case "test":
    return "test"
  default:
    return normalized
}
```

Run through `datadogEnvFallback()` (`apps/web/src/env.ts:88-95`) over the chain `NEXT_PUBLIC_DATADOG_ENV ?? RAILWAY_ENVIRONMENT_NAME ?? VERCEL_ENV ?? NODE_ENV`. Mobile/TV have no equivalent normalize step, so their literal must already BE the canonical form — `"prod"`, not `"production"`.

**3. Operational caveat — the EAS explicit-override footgun.** The override path is un-normalized and passes through verbatim:

```ts
mockEnv.EXPO_PUBLIC_DATADOG_ENV = "production"
// → envName: "production"   (NOT coerced to "prod")
```

So the fix depends on prod EAS environments leaving `EXPO_PUBLIC_DATADOG_ENV` UNSET. Setting it to `production` on a production EAS environment re-splits the fleet. (The preview EAS environment DOES set it — to `"preview"` — deliberately, because preview is a release build that would otherwise default to `env:prod` and pollute production dashboards with external-tester sessions.)

**4. Operational caveat — monitors/saved-views keyed on `env:production` must move to `env:prod`.** Any Datadog monitor, saved view, or dashboard a human keyed on `env:production` for `forge-tv` or `forge-mobile` must be re-scoped to `env:prod`. In-repo monitors key on `service:` (not `env:`), so none break automatically. Blast radius is low because TV/mobile production RUM provisioning was still pending (feat-225), so there are few or no historical `env:production` sessions to lose — and the value change takes effect only on NEW release builds; already-ingested `env:production` sessions are not retroactively re-tagged. Verify by listing distinct `env` values for `service:forge-tv` / `service:forge-mobile` in the RUM explorer after the first post-merge release build lands.

## Related

- [Datadog RUM deep instrumentation semantics](../best-practices/datadog-rum-deep-instrumentation-semantics.md) — parent doc; its item 6 (EAS env defaulting) covers pinning `EXPO_PUBLIC_DATADOG_ENV` for preview. This convention extends it from "pin preview" to "match web's canonical `prod` value fleet-wide." PR #1665 edited that item's quoted literal from `"production"` to `"prod"`.
- [Datadog tvOS observability pipeline — QoE and guardrails](../best-practices/datadog-tvos-observability-pipeline-qoe-and-guardrails.md) — web/TV signal parity holds only when the `env` tag VALUE also matches (`env:prod`), or TV sessions fall outside web's filters.
- [Mobile Datadog rich-posture data governance](../best-practices/mobile-datadog-rich-posture-data-governance-20260714.md) — mobile and web share the default Logs index; cross-app correlation requires the `env` tag to unify on `prod`.
- [Datadog Mobile RUM tvOS integration](../integration-issues/datadog-mobile-rum-tvos-integration.md) — build/toolchain layer of the same TV Datadog feature family; this is the runtime env-tag-value layer above it.
- [Canonical server search analytics + supplemental RUM pattern](../architecture-patterns/canonical-server-search-analytics-supplemental-rum-pattern.md) — the cross-app "RUM is supplemental" philosophy; canonical env tagging is what makes the cross-app supplemental view queryable.
- [Retired-mechanism docs prose sweep](../workflow-issues/mechanism-retirement-docs-prose-sweep.md) — the prose-sweep convention this change applied when reconciling the `"production"` → `"prod"` literal across apps and their docs.
