---
title: "Langfuse vs Mastra-native as the management layer for the Seeker agent"
date: "2026-08-05"
category: "tooling-decisions"
module: "apps/mastra"
problem_type: "tooling_decision"
component: "tooling"
severity: "high"
resolution_type: "tooling_addition"
applies_when:
  - "Choosing or re-evaluating the management layer (prompt versioning, trace storage, online evals) for a Mastra-based AI agent"
  - "Deciding whether AI agent conversation traces may live in a cloud observability platform vs. a self-hosted-only store"
  - "Comparing Mastra Cloud/Studio native tracing and prompt-version linkage against Langfuse for a new or existing agent surface"
  - "Revisiting this decision after a Mastra version bump (check @mastra/core and Mastra Cloud editor versions) or a new privacy/compliance requirement (e.g. a crisis-guardrail release gate)"
symptoms:
  - "At decision time (2026-07-29), Mastra-native tracing had no prompt-version-on-trace field for editor blocks, no trace-to-dataset import, and no sessions/users views in Studio"
  - "Mastra's own docs steer production traces to self-managed ClickHouse or Mastra's own young cloud platform, not obviously 'data stays home' by default"
  - "Langfuse has no read-only API key scope on the current tier, so any leaked key carries full project read+write once tracing lands"
  - "A prior version-mismatch blocker (feat-279 peer-metadata false negative) was decision-relevant on 2026-07-29 but dissolved after the @mastra/core 1.55.0 + editor 0.13.9 bump landed on main in PR #1794 (2026-07-31)"
related_components:
  - "apps/mastra"
  - "apps/mastra/src/services/langfuse-prompt-client.ts"
  - "docs/roadmap/ai-chat (feat-321 tracing, feat-336 retention sweep, feat-337 per-user erasure, feat-339 public-release register)"
related:
  - "docs/solutions/tooling-decisions/langfuse-prompt-api-contract-and-sdk-rejection.md"
  - "docs/solutions/best-practices/order-sensitive-registry-config-structural-enforcement.md"
  - "docs/solutions/security-issues/mastra-body-merged-requestcontext-forgeable-markers.md"
  - "docs/solutions/integration-issues/mastra-editor-peer-range-false-negative-20260722.md"
tags:
  - "langfuse"
  - "mastra"
  - "tracing"
  - "observability"
  - "prompt-management"
  - "online-evals"
  - "seeker"
  - "platform-decision"
---

# Langfuse vs Mastra-native as the Seeker's prompt + trace + eval management layer (feat-321)

## Context

The Seeker agent (`apps/mastra`) needs three things managed together:
versioned system prompts, execution traces, and evaluation over those traces.
Two platforms can supply all three — Langfuse Cloud (already adopted for
managed prompts, feat-296/feat-272) or Mastra's own first-party stack
(`@mastra/editor` Studio prompt blocks, the built-in Observability/Studio
trace viewer, native Evaluation datasets/experiments). Mastra is the agent
RUNTIME and the trace-emitting ENGINE either way — `@mastra/observability`
produces the spans regardless of where they're exported. The question this
decision settles is purely about the **management layer**: where prompts are
authored/versioned, where traces are viewed/queried, and where online
judges run.

**Decision (owner, 2026-07-30 → 2026-08-05): keep Langfuse** as that layer —
prompts + traces + online evals together in the one `forge-mastra` Langfuse
Cloud (US) project (the same project feat-296 provisioned for managed
prompts). Offline evals (native search-eval datasets/experiments, CI gates)
stay Mastra-native in both options — they run the agent directly and need no
trace store.

Implementation: `apps/mastra/src/mastra/langfuse-tracing.ts` (the
`langfuse-seeker` Observability config, gated on `LANGFUSE_TRACING_ENABLED`),
wired into `apps/mastra/src/mastra/index.ts`. Ticket:
`docs/roadmap/ai-chat/feat-321-langfuse-tracing.md`. Prior art this decision
extends: `docs/roadmap/ai-chat/feat-296-langfuse-configuration.md` (prompt
provisioning) and
`docs/solutions/tooling-decisions/langfuse-prompt-api-contract-and-sdk-rejection.md`
(why `apps/mastra` hand-rolls prompt-read HTTP instead of the vendor SDK —
tracing's use of `@mastra/langfuse`, which transitively installs
`@langfuse/client` + `@langfuse/otel`, does not reopen that bar: the tracing
package is a Mastra exporter doing one-way fire-and-forget writes off the
chat-turn path, not a blocking synchronous client on it).

## Guidance

**The coupling law.** The bundle that must co-locate is prompts + traces +
**online** evals: online judges run over traces, and prompt-version
comparison needs traces stamped with a prompt version the same platform can
aggregate on. Split a component onto a different platform and the payoff —
"which prompt version produced this outcome" — becomes unanswerable, because
neither platform holds both halves of the join. Offline evals are the
exception: they invoke the agent directly against a fixed dataset, produce
their own pass/fail record, and never touch a trace store — so they stay
Mastra-native regardless of which platform owns tracing. That online/offline
seam is the one coherent hybrid; every other split is split-brain (see
Examples).

**The four decision facts** (full investigation was a gitignored working
report; this doc is its durable record):

1. **At decision time, the bundle worked end-to-end ONLY on Langfuse.**
   Managed prompts were live on `main` (feat-303/feat-296/feat-272); tracing
   plus native prompt-version linkage were implemented and verified against
   the real `forge-mastra` project on 2026-07-29 with `@mastra/langfuse
1.4.6`; a live LLM-judge over traces and add-trace-to-dataset both work on
   the free tier. Mastra-native had real gaps at the same date: no
   prompt-version-on-trace field for Editor prompt blocks, no trace→dataset
   import, no sessions/users views in Studio, no retention tooling for
   self-hosted trace stores.
2. **"Mastra everything" does not keep data home by default.** Mastra's own
   docs steer production traces to either self-managed ClickHouse (your own
   purge/erasure tooling to build) or Mastra's own young cloud platform — a
   different third party, not "no vendor." Langfuse carries a DPA on all
   tiers plus SOC 2/ISO certification and deletion APIs, which is the
   comparison that actually matters here: Seeker conversations are
   religious-belief content, special-category personal data under the GDPR.
3. **Langfuse's real weakness is governance, priced not structural.** No
   read-only key scope exists (every key carries full project read+write —
   `docs/solutions/tooling-decisions/langfuse-prompt-api-contract-and-sdk-rejection.md`),
   so a leaked key guards raw conversations once tracing is on. Label-move
   release has no technical control on the current tier (feat-296:
   protected labels are Team/Cloud-and-Enterprise, and even there they only
   block `viewer`/`member` while permitting `admin`/`owner` — inert for an
   all-developer, all-admin-or-owner organisation). Audit logs are
   Enterprise-only. None of these are architectural dead ends — they are
   priced tiers or governance process, revisitable without a platform switch.
4. **The Editor version blocker dissolved — honestly dated.** The comparison
   originally treated `@mastra/editor`'s peer-incompatibility with the pinned
   `@mastra/core` as decision-relevant: `@mastra/editor` 0.13.1–0.13.7 pull in
   `@mastra/memory` versions that hard-require core exports the app's pinned
   `1.36.0` didn't ship, so the Studio prompt-block path (feat-279) was
   blocked at boot (declared peer ranges lied; only booting caught it — see
   `docs/solutions/integration-issues/mastra-editor-peer-range-false-negative-20260722.md`,
   authored on the feat-279 branch and ported into this tree alongside this
   doc, with a dated update recording the bump). **That blocker is gone.** `apps/mastra/package.json`
   pins `@mastra/core@1.55.0` and `@mastra/editor@0.13.9` today, both bumped
   together in the same commit — **landed on `main` in PR #1794 (feat-322,
   "chore(mastra): update runtime dependencies"), 2026-07-31**, not the
   approximate 2026-08-03 the working investigation cited (that later date is
   when a _separate_, unrelated tool-registry behavior was re-verified against
   the already-bumped version — see `apps/mastra/CLAUDE.md` "Containment",
   the "Measured against @mastra/core 1.55.0 (2026-08-03)" line — not when the
   bump itself shipped; don't conflate the two). **What this does and does
   not change:** it removes the version-incompatibility argument against
   Mastra-native prompt management. It does **not** resolve fact 1's
   connective-tissue gaps — no prompt-version-on-trace field, no
   trace→dataset import, no sessions/users views, no self-hosted retention
   tooling are all still true as of this writing. Those gaps, not the version
   blocker, are now the binding facts keeping the decision on Langfuse.

   > \*\*[UPDATED 2026-08-06 — the gap list has started shrinking; decision
   >
   > > UNCHANGED.]** Recorded by the feat-321 independent verification session,
   > > which inspected the INSTALLED `@mastra/server` 1.55.0 dist. Two of fact
   > > 1's gaps are no longer absent at the wire level: dataset items now accept
   > > a `source.type` of `"trace"` carrying a trace-id `referenceId` (dist
   > > datasets chunk), and the server exposes `POST
/observability/traces/score` (run a registered scorer over traces) and
   > > `GET /observability/traces/:traceId/trajectory`. **Caveats — read before
   > > reusing this:** the evidence is wire/dist ONLY; whether Studio surfaces a
   > > one-click trace-to-dataset flow was NOT verified, so "the capability
   > > exists in the API" is not "the workflow exists in the product." **The
   > > decision does not move\*\*, because the load-bearing gap is intact:
   > > `@mastra/editor` 0.13.9's dist contains no prompt-version-on-trace
   > > stamping for Editor blocks, and no sessions/users view endpoints exist —
   > > so the prompt-version → outcome join that motivates the whole bundle
   > > still resolves only on Langfuse. Treat this as flip trigger 2's
   > > "recheck quarterly; this list can shrink without warning" firing early:
   > > the prediction was right, the threshold is not met.

**Consequent decisions riding this one (2026-08-05, operationalizing the
choice):** Langfuse-ONLY trace export — `langfuse-tracing.ts` deliberately
carries no local storage exporter, so enabled deployments write nothing raw
to the DuckDB volume and Langfuse is the single store the retention/erasure
work below governs. Retention: 30/180-day DIY sweep, tracked in
`docs/roadmap/ai-chat/feat-336-langfuse-trace-retention-job.md` (no
configurable-retention tier purchased). Per-user erasure across both stores
(Langfuse traces + `ai_chat` Postgres): `docs/roadmap/ai-chat/feat-337-per-user-erasure-capability.md`.
`LANGFUSE_MEDIA_UPLOAD_ENABLED=false` is seeded as a code default (the SDK's
media auto-upload defaults ON with no code-level override in
`@mastra/langfuse@1.4.6`). Key custody re-affirmed. All of it feeds the
public-release readiness register at
`docs/roadmap/ai-chat/feat-339-seeker-public-release-register.md`.

**The flip triggers** (what would reverse this call):

1. **A privacy hardening to "raw conversation text never leaves our
   infrastructure."** Most plausible via the crisis-guardrail release gate
   (self-harm/acute-distress handling raises what's at stake in an exported
   conversation). This kills Langfuse Cloud tracing outright; self-hosted
   everything — Mastra-native or self-hosted OSS Langfuse — becomes the right
   answer, because the constraint stops being "which vendor" and becomes "no
   vendor."
2. **Mastra ships the connective tissue** — prompt-version-on-trace for
   Editor blocks, trace→dataset import, sessions/users views in Studio.
   **Recheck this quarterly; Mastra's release pace is fast**, and fact 4
   above is the proof this list can shrink to zero without warning.
3. **Langfuse tier/pricing pushes needed controls out of reach** — e.g. if
   the governance gaps in fact 3 (read-only keys, protected labels, audit
   logs) only ever ship gated behind a tier this org won't buy.

## Why This Matters

Re-deriving this comparison from scratch is expensive and error-prone in two
specific ways this doc exists to prevent:

- **A future session could "fix" the Editor version blocker and treat that
  alone as grounds to switch.** Fact 4 shows why that's wrong: the version
  bump (PR #1794, 2026-07-31) is real and verified against the tree, but it
  resolves exactly one of the four facts. The other three — data locality,
  governance pricing, and (at the time) the connective-tissue gap list —
  don't move when a dependency version changes. Treating "the blocker is
  gone" as "therefore switch" would re-litigate a decision on 25% of its
  actual basis.
- **A future session could add tracing/evals for a new agent onto a
  different platform "for simplicity."** The coupling law says that forfeits
  the entire payoff for that agent — prompt-version-to-outcome analytics
  don't resolve across a Langfuse/Mastra-native split, and (per feat-321's
  own ticket) not even across two separate Langfuse _projects_, since
  Langfuse's prompt↔trace linkage is project-scoped with no cross-project
  join. "Just use whichever's already wired for this one agent" is the wrong
  optimization target; "which platform holds prompts AND traces AND online
  evals for this agent" is the right one.

## When to Apply

Read this doc before:

- **Reconsidering the Langfuse-vs-Mastra-native platform choice** for the
  Seeker or any future `apps/mastra` agent — check whether any of the three
  flip triggers have actually fired before treating a partial fact (like a
  dependency bump) as grounds to reopen the whole decision.
- **Adding tracing or evals for a new Mastra agent.** Default to the same
  `forge-mastra` Langfuse project for prompts+traces+online-evals (new agents
  are new prompt _names_ in the existing project, per feat-296 — never a new
  project, which breaks prompt↔trace linkage) and Mastra-native for offline
  evals. Re-verify fact 4's connective-tissue list first — it may have
  shrunk since this doc was written.
- **Reacting to a privacy-hardening decision** ("raw conversation text never
  leaves our infrastructure"). This is flip trigger 1 and the most plausible
  reversal path — check `docs/roadmap/ai-chat/feat-339-seeker-public-release-register.md`
  §1 for the live register of what's decided vs still open on that front
  before assuming Langfuse Cloud tracing is still the right call.
- **Auditing what raw conversation content Langfuse actually holds** — the
  content decision (RAW, not redacted or metadata-only — see the header
  comment in `apps/mastra/src/mastra/langfuse-tracing.ts` and the three
  options `docs/roadmap/ai-chat/feat-321-langfuse-tracing.md` posed) and the
  Langfuse-ONLY export posture (no local DuckDB raw copy) are both binding
  facts of the shipped implementation, not just this decision doc.

## Examples

Coherent configurations keep every trace's prompt-version stamp resolvable
against the platform that also runs the judge over it. Split-brain
configurations look plausible per-component but break the join that is the
entire reason to trace in the first place.

| Configuration                                        | Prompts                              | Traces                                  | Online evals                         | Offline evals                        | Coherent?                                                | Why                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------ | --------------------------------------- | ------------------------------------ | ------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Shipped (feat-321)**                               | Langfuse (`forge-mastra`)            | Langfuse (`forge-mastra`, same project) | Langfuse (LLM-judge over traces)     | Mastra-native (datasets/experiments) | Yes                                                      | Prompt version, trace, and judge outcome all resolve within one project; offline evals never needed a trace store.                                                                                                                                                                         |
| Full Mastra-native (hypothetical, version-unblocked) | `@mastra/editor` Studio prompt block | Mastra Observability / Studio           | Mastra native Evaluation over traces | Mastra-native                        | Partially — version-viable, connective-tissue-incomplete | No longer blocked at boot (fact 4), but no prompt-version-on-trace field for Editor blocks and no trace→dataset import as of this writing (fact 1) — the join exists in principle, not in the product yet.                                                                                 |
| Prompts in Langfuse, traces in Mastra-native/local   | Langfuse                             | Mastra Observability (local DuckDB)     | Mastra-native                        | Mastra-native                        | No — split-brain                                         | Traces carry no queryable link back to the Langfuse prompt version that produced them; "which prompt version is winning" becomes a manual cross-reference exercise, if it's answerable at all.                                                                                             |
| Traces in Langfuse, prompts still Editor blocks      | Editor prompt block                  | Langfuse                                | Langfuse                             | Mastra-native                        | No — split-brain                                         | Langfuse traces can carry a `promptName`/`version` metadata field, but nothing on the Langfuse side represents an Editor-authored prompt version to join against — the field would be free-text with no versioned referent.                                                                |
| Traces in a separate Langfuse project from prompts   | Langfuse (`forge-mastra`)            | Langfuse (different project)            | Langfuse                             | Mastra-native                        | No — split-brain                                         | Explicitly the case feat-321's own ticket warns against: prompt-version → generation analytics are project-scoped in Langfuse with no cross-project copy, so isolating traces into their own project forfeits the linkage that motivated tracing at all.                                   |
| Online evals in a third tool, traces in Langfuse     | Langfuse                             | Langfuse                                | Third-party eval tool                | Mastra-native                        | No — split-brain                                         | Online judges need direct trace access to score real production runs; routing evals through a tool that isn't where the traces live means either exporting traces a second time (a third copy of raw conversation content to govern) or the judge never running on real trace data at all. |
