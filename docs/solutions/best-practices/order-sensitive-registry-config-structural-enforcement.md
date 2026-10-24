---
title: "Object-key order as hidden API: @mastra/observability's first configs entry IS the process default"
date: "2026-08-05"
category: "best-practices"
module: "apps/mastra"
problem_type: "best_practice"
component: "observability"
severity: "high"
applies_when:
  - "Registering more than one config in @mastra/observability's `configs` record (the first entry becomes the default instance for every unselected trace)"
  - "Consuming any library API that assigns semantic meaning to object-literal key order or array position without a named parameter"
  - "Reviewing a diff that adds a conditional spread or reorders entries in an order-sensitive record"
tags:
  - "mastra"
  - "observability"
  - "ordering-invariant"
  - "structural-enforcement"
  - "feat-321"
related:
  - "docs/solutions/tooling-decisions/langfuse-vs-mastra-native-management-layer-20260805.md"
  - "docs/solutions/security-issues/mastra-body-merged-requestcontext-forgeable-markers.md"
---

# Object-key order as hidden API: enforce order-sensitive registry configs structurally, never by comment

## Context

feat-321 added a second observability config to `apps/mastra` — the raw
`langfuse-seeker` config beside the redacted `default` — and nearly shipped a
silent catastrophic misroute. `@mastra/observability` decides which registered
config is the PROCESS DEFAULT (the one every unselected trace flows to) by
**object-key order**: its constructor registers `configs` entries in
`Object.entries` order and marks `index === 0` as the default — the exact
condition is `!config.default?.enabled && index === 0` (verified in the dist
at 1.13.0 and re-verified at 1.16.3), so first-entry-wins holds whenever no
top-level `default: { enabled: true }` block is passed, which is `apps/mastra`
today. Nothing in the types, docs, or the
key name `default` enforces this — a config literally named `"default"`
registered second is NOT the default.

The near-miss: the first implementation spread the conditional Langfuse entry
BEFORE the default entry (`{ ...(langfuse ? {...} : {}), default: {...} }`).
That compiles, typechecks, and passes every config-shape test — and in an
enabled deployment it would have routed **every unstamped trace in the app**
(all agents, all workflows) raw to Langfuse instead of to the redacted local
store, exporting unredacted conversation content for surfaces whose redaction
posture was deliberate.

## Guidance

When a library assigns meaning to key order, make the correct order
**unrepresentable, not commented**:

1. **Confine construction to one builder** whose body hard-codes the
   order-sensitive entry first. In `apps/mastra/src/mastra/langfuse-tracing.ts`,
   `buildObservabilityConfigs(defaultConfig)` writes `default` into the record
   literal first and appends the conditional entry after — callers cannot
   express the wrong order.
2. **Assert at load time** as belt-and-braces: the builder throws if
   `Object.keys(configs)[0] !== "default"`, so a future refactor that
   reintroduces inline construction fails at boot, not silently at export.
3. **Pin with tests at two layers**: a unit test on the builder
   (`Object.keys(...)` equals the expected order, with and without the
   conditional entry) and an integration test against the REAL registry
   (`new Observability({...})` + `getSelectedInstance({})` returns the
   default instance; only the marker-stamped context returns the other one).
   The integration test is the one that survives a library rewrite of the
   selection rule.
4. **Date the dist-verification claim.** "index === 0 is the default" is an
   empirical claim about a vendored implementation, not a documented contract
   — the comment carries "verified at 1.13.0 and 1.16.3" so the next
   `@mastra/*` bump knows to re-check rather than trust.

## Why This Matters

Order-sensitivity in a config record is invisible at every checkpoint that
normally catches mistakes: the type is `Record<string, Config>` (orderless in
the type system), review reads the entries as a set, and tests that assert
each config's SHAPE pass regardless of order. The only observable difference
is which store production traces land in — here, the difference between
"redacted local spans" and "raw special-category conversation content
exported to a third party." A comment saying "ORDER MATTERS" survives exactly
until the first refactor that doesn't read it; a builder + boot assertion +
registry-level test survives indefinitely.

## When to Apply

- Adding any entry to `apps/mastra`'s observability `configs` — go through
  `buildObservabilityConfigs`, never an inline literal.
- Adopting any API where examples show a meaningful first entry (`default`,
  `primary`, fallback chains keyed by position) — check the implementation
  for positional semantics before trusting the key name, and if found, wrap
  construction in a builder that owns the order.
- Reviewing diffs that add conditional spreads into config records — ask
  "does anything downstream read the order of these keys?"

## Examples

The hazard and its structural fix, side by side:

    // HAZARD: compiles, typechecks, all shape tests green — and when the
    // conditional entry is present it becomes the PROCESS DEFAULT.
    configs: {
      ...(langfuseSeeker ? { "langfuse-seeker": langfuseSeeker } : {}),
      default: redactedDefaultConfig,
    }

    // STRUCTURAL: order is a property of the builder, not the call site.
    export function buildObservabilityConfigs(defaultConfig, deps = {}) {
      const configs = { default: defaultConfig }
      const langfuseSeeker = buildLangfuseSeekerObservabilityConfig(deps)
      if (langfuseSeeker) configs["langfuse-seeker"] = langfuseSeeker
      if (Object.keys(configs)[0] !== "default") {
        throw new Error("observabilityConfigs must register 'default' first")
      }
      return configs
    }

Live implementation: `apps/mastra/src/mastra/langfuse-tracing.ts`
(`buildObservabilityConfigs` + the ordering and real-registry tests in
`apps/mastra/src/mastra/langfuse-tracing.test.ts`).
