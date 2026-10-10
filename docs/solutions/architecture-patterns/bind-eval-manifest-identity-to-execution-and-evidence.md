---
title: "Bind eval manifest identity through execution and evidence publication"
date: 2026-08-10
last_updated: "2026-09-29"
category: architecture-patterns
module: "Seeker and recommendation shadow evaluations"
problem_type: architecture_pattern
component: testing_framework
severity: high
applies_when:
  - "An evaluation manifest declares the prompt, model, question set, judge, retrieval, decoding, runtime, or comparison axis"
  - "Evaluation attempts can reuse prior evidence or publish immutable completion artifacts"
  - "Operator retries must preserve evaluation parameters through terminal workflow receipts"
tags:
  - seeker
  - evals
  - experiment-identity
  - reproducibility
  - immutable-evidence
  - schema-validation
  - exact-retry
  - workflow-receipts
related_components:
  - assistant
  - development_workflow
  - tooling
---

# Bind eval manifest identity through execution and evidence publication

## Context

A reproducible evaluation is more than a directory of plausible answers and
scores. The evidence must prove that the policy declared by the experiment
manifest is the policy that produced those artifacts. For Seeker, that identity
includes the managed prompt revision and hash, ordered model routes, decoding,
question set, criteria, judge, retrieval corpus, and runtime configuration
(`apps/mastra/src/evals/seeker/experiments/types.ts:27`). The manifest also
allows a candidate to change only its declared comparison axis
(`apps/mastra/src/evals/seeker/experiments/manifest.ts:85`).

Review of PR #1884 exposed a dangerous gap: a manifest could describe a precise
identity while leaf processes still used implicit defaults. Reuse could accept
evidence after eligibility policy changed, generated output crossed an open
coordinator boundary, and a completion marker could appear before its required
inventoried evidence was scanned. The package looked reproducible without
proving what it measured.

Earlier experiment runs also showed why the boundary must remain append-only
(session history): missing configuration, provider limits, and evaluator fixes
all need new attempts. Rewriting an old attempt would erase the distinction
between an execution failure and a later correction.

## Guidance

Treat the manifest as an executable contract. Thread every supported
configuration dimension into execution, attest every declared dimension in the
result, and refuse configurations the leaf pipeline cannot execute exactly.

1. **Validate and freeze the policy before generation.** Parse the complete
   manifest, derive a canonical policy hash, resolve exact managed prompt
   identities, and re-read the manifest before generation so it cannot change
   during preflight (`apps/mastra/src/evals/seeker/experiments/runner.ts:90`,
   `apps/mastra/src/evals/seeker/experiments/runner.ts:104`,
   `apps/mastra/src/evals/seeker/experiments/runner.ts:215`).

2. **Drive supported execution dimensions from the declaration and attest the
   whole identity.** The current coordinator passes declared routes, prompt
   identity, runtime identity, and comparison axis into leaf commands
   (`apps/mastra/src/evals/seeker/experiments/command.ts:288`). It then compares
   all identity fields stamped by answer and judge artifacts with the manifest
   (`apps/mastra/src/evals/seeker/experiments/command.ts:131`,
   `apps/mastra/src/evals/seeker/experiments/command.ts:340`). The current leaf
   pipeline supports provider-default decoding and canonical fixture, criteria,
   and judge configuration; a manifest declaring unsupported alternatives must
   refuse on attestation instead of silently completing. Argument threading
   alone does not prove that defaults were not substituted downstream.

3. **Bound the execution lifecycle.** A hung leaf must not leave an attempt in
   an indefinitely ambiguous state. Use an overall deadline, terminate the
   process group, and escalate from `SIGTERM` to `SIGKILL` after a bounded grace
   period (`apps/mastra/src/evals/seeker/experiments/command.ts:50`).

4. **Make reuse policy-bound, not merely candidate-bound.** Verify the prior
   completion inventory and checksums, then require both the manifest policy
   hash and resolved candidate identities to match
   (`apps/mastra/src/evals/seeker/experiments/runner.ts:219`). Store the policy
   hash with each new attempt (`apps/mastra/src/evals/seeker/experiments/runner.ts:264`).
   A threshold, criterion, benchmark, fixture, rubric, route, or other gate-input
   change requires a fresh run.

5. **Parse evidence envelopes at the coordinator boundary.** Accept only the
   expected versioned aggregate files and reject extra top-level keys
   (`apps/mastra/src/evals/seeker/experiments/runner.ts:29`). Parse the complete
   generator result before writing any of it
   (`apps/mastra/src/evals/seeker/experiments/runner.ts:273`). Coordinator-owned
   identity and completion records stay outside generator authority.

6. **Publish completion last and exclusively.** Before creating
   `completion.json`, require the complete artifact set, scan content and JSON
   keys for sensitive values, and calculate inventory hashes
   (`apps/mastra/src/evals/seeker/experiments/artifacts.ts:200`). Publish with an
   exclusive write so concurrent or repeated work cannot replace historical
   evidence (`apps/mastra/src/evals/seeker/experiments/artifacts.ts:125`,
   `apps/mastra/src/evals/seeker/experiments/artifacts.ts:264`). A package scan
   then verifies the published inventory and rejects untracked sidecars
   (`apps/mastra/src/evals/seeker/experiments/artifacts.ts:312`).

7. **Enforce append-only history at the Git merge boundary.** Runtime writers
   cannot prevent a later commit from editing historical JSON. Compare the PR's
   base and head trees in an always-reporting, dependency-free CI check
   (`scripts/check-seeker-experiment-ledger.mjs`). Preserve every file already
   on the base branch, allow only a genuinely new attempt or the first terminal
   verdict for an open experiment, and seal the whole experiment after that
   verdict. Test the policy independently of Git traversal
   (`scripts/check-seeker-experiment-ledger.test.mjs`) and make the CI job a
   required status check (`.github/workflows/ci.yml`).

## Why This Matters

Eval evidence can authorize a prompt or model promotion. If identity is only
documentary, two runs can appear comparable while using different defaults,
fixtures, judge rubrics, runtime configuration, or retrieval corpora. If reuse
ignores policy, authentic bytes can be reinterpreted under a criterion they
never ran against. If completion appears too early, downstream automation can
treat an invalid or sensitive package as terminal.

With this pattern, `completion.json` is a commit point rather than a success
log. It means the required inventoried evidence exists, its aggregate envelope
schema was accepted, its bytes were scanned and inventoried, its executed
identity matched the manifest, and any reused evidence came from the same
policy. Package eligibility additionally requires the post-publication package
scan that rejects untracked sidecars.

## When to Apply

- An evaluation declares reproducibility dimensions separately from the code
  invoking models, judges, retrievers, or gates.
- Attempts can resume or reuse prior output.
- Evidence will be committed, reviewed, promoted, or consumed by automation.
- Leaf defaults can diverge from coordinator configuration.
- Another process treats a terminal marker as proof of completeness.

The same pattern applies to benchmark, build, migration, and batch-job
manifests: declaration, execution, emitted identity, reuse eligibility, and
terminal publication must form one continuous chain of proof.

Application-level exclusive writes protect one execution process; base-vs-head
CI protects the historical ledger from later pull requests. Both boundaries are
required. A local hook is insufficient because authors can bypass it, while a
required repository check runs in the merge path and reports even on unrelated
PRs (where it exits immediately with no ledger changes).

Keep semantic policies separate. Citation aliases, managed-prompt runtime
caching, and which comparison axes are supported are product decisions. They
may contribute versioned identity fields, but this integrity pattern does not
choose their semantics.

## Examples

### Declared identity without execution authority

A manifest names prompt revision `2`, a paid Sonnet route, fixed questions, and
a judge rubric, while a leaf uses its own default model or fixtures. Storing the
result beneath the declared candidate ID does not prove what was measured.

Instead, serialize the declared values into the leaf invocation and reject the
attempt unless answer and judge artifacts attest the same identity.

### Candidate-only reuse

A prior attempt has the same prompt and model, so its scores are reused after
the threshold or benchmark policy changes. The bytes remain authentic, but they
are not eligible evidence for the new policy.

Instead, persist a hash of the parsed manifest and require both that hash and
the resolved execution identities to match before reuse.

### Completion before validation

Writing `completion.json` and then scanning artifacts can leave a terminal
marker after a failed secret or inventory check.

Instead, validate required paths, reject unsafe content, compute hashes, parse
the completion contract, and publish `completion.json` as the final exclusive
write.

### Retry identity lost at invocation or terminalization

The co-watch CLI previously generated a fresh evaluation UUID and moving 24-hour
window on every invocation. An operator retry after an uncertain response could
therefore create a different evaluation despite the service's exact-retry checks.
Separately, successful and fenced jobs replaced ledger `details` without
`minimumRuns`; later retries could no longer compare that completion threshold.
These were code-level defects, not observed production duplicate dispatches.

[PR #2448](https://github.com/JesusFilm/forge/pull/2448) closes both identity gaps:

- `apps/admin/src/scripts/run-recommendation-cowatch-shadow-evaluation.ts`
  requires an explicit evaluation UUID, window, sample size and minimum-run
  threshold. It validates and emits that tuple before importing or dispatching
  the runtime. Retain the tuple before execution and reuse it unchanged after
  uncertainty; ordinary retention and window validation still apply. Unexpected
  runtime errors produce a generic diagnostic rather than exposing private data.
- `apps/admin/src/services/recommendations/shadow-evaluation/job.ts` preserves
  `minimumRuns` when replacing successful or fenced terminal details. The failed
  path already leaves those details intact. The existing operator can then
  compare the original threshold after terminalization. Historical receipts
  already missing the field are not repaired.

The regression must cross both boundaries: advance the clock while reusing CLI
arguments, and retry both `SUCCEEDED` and `SKIPPED` receipts with the original
threshold and a conflicting threshold. Assert that identical retries return
the existing workflow, conflicts reject, and neither dispatches new work.
The fix passed 44 focused CLI, workflow and operator tests; the
[operational record](../../operations/recommendation-cowatch-preflight-2026-09-29.md)
retains the broader validation and production preflight limits.

Exact retry comparison does not provide atomic dispatch. Concurrent same-ID
calls and a crash between ledger creation and runtime attachment remain separate
uncertainties tracked by
[feat-563](../../roadmap/content-discovery/feat-563-shadow-evaluation-dispatch-recovery.md).
Serialize invocations, inspect ledger and runtime evidence after an uncertain
result, and never mint another ID to bypass it. Preserving the tuple establishes
what work was requested, not that exactly one worker started or that production
evaluation gates passed.

### September 29 dispatch follow-up

Feat-563 now reserves a deterministic ledger identity and uses a database
compare-and-set to claim start ownership. Persist intent before crossing the
external queue boundary. A prepared reservation can be resumed; an attempted
reservation without acknowledgement remains uncertain because the installed
Workflow runtime cannot disprove acceptance. Runtime self-attachment and
terminal updates must match both dispatch input and attached runtime identity.
Never overwrite the immutable tuple with result fields, and never turn a
missing runtime ID or a failed ledger status into automatic permission to start.

The [operator record](../../operations/recommendation-shadow-dispatch-2026-09-29.md)
documents native concurrent-admission/crash tests, bounded reconciliation and
the residual acknowledgement uncertainty. This supersedes the earlier
application-level concurrent-admission gap; it does not claim exactly-once
external queue delivery or authorize a production evaluation.

## Related

- [Mastra offline search eval orchestration boundary pattern](mastra-offline-search-eval-orchestration-boundary-pattern.md)
- [Provider-bound content embedding backfill gate pattern](provider-bound-content-embedding-backfill-gate-pattern.md)
- [Mastra native Evaluation search-eval bridge pattern](mastra-native-evaluation-search-eval-bridge-pattern.md)
- [Langfuse prompt API contract and SDK rejection](../tooling-decisions/langfuse-prompt-api-contract-and-sdk-rejection.md)
- PR #1884 — Seeker prompt experiment workflow implementation of this pattern
