---
title: "@mastra/editor declared peer ranges lie: build smoke passes, only boot catches the core incompatibility"
date: "2026-07-22"
last_updated: "2026-08-05"
category: integration-issues
module: apps/mastra
problem_type: integration_issue
component: dependencies
severity: high
symptoms:
  - "mastra dev hard-crashes at boot: SyntaxError: The requested module '@mastra/core/llm' does not provide an export named 'modelSupportsAttachments' (from @mastra/memory dist pulled in by @mastra/editor)"
  - "pnpm install resolves silently — zero peer warnings — because the declared peer range (@mastra/core >=1.34.0) is satisfied on paper"
  - "pnpm --filter @forge/mastra build (mastra build --studio) PASSES with the broken dependency wired in"
tags:
  - mastra
  - mastra-editor
  - peer-dependencies
  - build-smoke-false-negative
  - rollup-externalization
  - boot-smoke
  - feat-279
---

# @mastra/editor: declared peer ranges lie, and the build smoke can't catch it — only boot can

**Context:** feat-279 (Seeker prompt as a Mastra Editor prompt block), plan
`docs/plans/2026-07-21-001-feat-seeker-prompt-studio-block-plan.md` (on the
unmerged `feat/seeker-prompt-studio-block` branch, not `main`), U2 stop
condition.

**Related learnings:**
`docs/solutions/tooling-decisions/mastra-dev-tsx-loader-for-raw-ts-workspace-deps.md`
(the prior apps/mastra case where only boot — not build/tsc/vitest — caught the
failure) and
`docs/solutions/conventions/mastra-inline-gateway-construction-createrequire.md`
(the opposite Rollup failure mode: static `@ai-sdk/*` imports cause a
false-positive build FAILURE, where this case is a false-negative build PASS
for externalized `@mastra/*`). Together they characterize the Mastra Rollup
deployer's risk surface in this app.

## What happened

The plan added `@mastra/editor@0.13.7` (+ `@mastra/mcp` peer) to
`apps/mastra` (pinned `@mastra/core@1.36.0`). Three gates all said "fine":

1. **Declared peers:** editor declares `@mastra/core >=1.34.0-0 <2.0.0-0` —
   1.36.0 satisfies it on paper.
2. **`pnpm install`:** resolved with **zero** new peer warnings for the app.
3. **`pnpm --filter @forge/mastra build`** (`mastra build --studio`) —
   the plan's designated compatibility-validation moment — **passed** with
   the editor imported and constructed in `apps/mastra/src/mastra/index.ts`.

Then `mastra dev` hard-crashed at boot:

```
@mastra/memory/dist/chunk-6ACCFKAN.js:3
import { modelSupportsAttachments, resolveModelConfig } from '@mastra/core/llm';
SyntaxError: The requested module '@mastra/core/llm' does not provide an
export named 'modelSupportsAttachments'
```

## Root cause

- `@mastra/editor` 0.13.1–0.13.7 pin `@mastra/memory` 1.21.1–1.23.0 as
  **hard dependencies** (exact versions, not peers). Every one of those
  memory versions statically imports `modelSupportsAttachments` from
  `@mastra/core/llm`, an export that first ships in **core 1.37.0**.
- Editor 0.13.7 itself imports `SourceAgentsSourceControl` from
  `@mastra/core/storage`, first shipped in **core 1.43.0**. Clean-room
  probes: editor 0.13.7 constructs against core 1.43.0; fails against
  1.36.0 and 1.37.0. The real floor is core ≥ 1.43.0 despite the declared
  `>=1.34.0`.
- The build passed because the Mastra Rollup deployer **externalizes**
  `@mastra/*` packages — it never link-checks their import graphs. ESM named
  imports fail at module evaluation, i.e. at **boot**, not at bundle time.

## The laws

1. **In the `@mastra/*` ecosystem, declared peer ranges are advisory, not a
   contract.** The only trustworthy compatibility check is importing and
   BOOTING the composed app (or a clean-room probe: minimal package.json
   with the exact pins + `node -e 'import("@mastra/editor")'`). This is the
   package-manifest sibling of the repo's mocked-shape-vs-real-contract
   discipline: `pnpm install` + declared ranges prove manifest SHAPE; only a
   real import proves the runtime contract.
2. **`mastra build --studio` is NOT a compatibility gate for externalized
   deps.** Any plan that says "validated by the build smoke" for a new
   `@mastra/*` dependency must say "validated by booting `mastra dev`"
   instead. Budget the boot smoke as the gate; treat a passing build as
   silence, not evidence.
3. **A transitive hard-dep can raise your effective core floor.** Editor →
   memory (exact pin) → core-export requirement means TWO import graphs to
   probe, not one. Grep the candidate package's _and its hard deps'_ dists
   for `from '@mastra/core/...'` imports and diff against the pinned core's
   actual exports when a bump is in question.

## How to probe fast (repeatable recipe)

```bash
# Does the pinned core export the symbol?
rg -c "modelSupportsAttachments" node_modules/.pnpm/@mastra+core@<ver>*/node_modules/@mastra/core/dist \
  || echo ABSENT
# What does the candidate really need? (tarball probe, no install)
npm pack @mastra/memory@1.21.1 --silent && tar -xzf *.tgz package/dist \
  && rg -l "modelSupportsAttachments" package/dist
# Full truth: clean-room boot probe against candidate core versions.
```

## Outcome

feat-279 is blocked on a `@mastra/core` ≥ 1.43 bump — its own ticket-sized
effort because the repo pins verified-dist behavioral facts to 1.36.0
(ai-chat fail-mode contract, recall ordering, retry-loop semantics; see
`apps/mastra/CLAUDE.md`). The editor-independent U1 (byte-identity
`SEEKER_SYSTEM_PROMPT` constant) shipped anyway; it serves either
prompt-management path in the feat-272-vs-feat-279 comparison. The
incompatibility itself is a comparison datum: the first-party Studio path is
coupled to `@mastra/*` release lockstep in a way the Langfuse vendor path is
not.

> **[UPDATED 2026-08-05 — the version blocker has dissolved; the detection lesson stands.]**
> This doc was authored on the feat-279 branch (`feat/seeker-prompt-studio-block`,
> unmerged) and ported to `main` by the feat-321 PR so its citations from
> `docs/solutions/tooling-decisions/langfuse-prompt-api-contract-and-sdk-rejection.md`
> resolve. (Heads-up on the id: the Studio-block **feat-279** ticket lives only
> on that branch — on `main` the bare id `feat-279` resolves to two unrelated
> tickets in the `platform` and `topic-experiences` lanes. Cross-lane duplicate
> ids are tolerated by the ai-chat lane's conventions.) Since it was written, the bump it named as feat-279's blocker LANDED:
> [PR #1794](https://github.com/JesusFilm/forge/pull/1794) (feat-322, merged
> 2026-07-31) moved `apps/mastra` to `@mastra/core@1.55.0` + `@mastra/editor@0.13.9`
> in lockstep, and `apps/mastra/CLAUDE.md` now records behavioral facts re-verified
> against 1.55.0. (The feat-321 platform investigation that re-examined this
> blocker is distilled in the tooling-decision doc linked below.) What this changes: the Outcome's "blocked on a core ≥ 1.43 bump"
> is no longer true — the Editor prompt-block path is version-viable again, and any
> resumption of feat-279 starts from a clean-room boot probe (the detection method
> below remains the ONLY trustworthy check; the declared peer ranges were still
> `>=1.34.0` when they lied). What this does NOT change: the platform decision to
> keep the Seeker's management layer on Langfuse rests on connective-tissue gaps,
> not this version blocker — see
> `docs/solutions/tooling-decisions/langfuse-vs-mastra-native-management-layer-20260805.md`
> (its "fact 4") before treating version-viability as grounds to switch.
