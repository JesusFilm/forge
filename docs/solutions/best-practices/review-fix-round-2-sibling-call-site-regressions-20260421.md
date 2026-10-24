---
title: Round 2 of ce:review catches sibling-call-site regressions and self-coverage gaps that round-1 fixes leave behind
date: 2026-04-21
category: best-practices
problem_type: best_practice
component: development_workflow
root_cause: missing_workflow_step
resolution_type: workflow_improvement
severity: medium
tags:
  [
    ce-review,
    review-fix-loop,
    sibling-call-sites,
    regression-prevention,
    test-coverage,
    compound-engineering,
  ]
---

## Problem

When a code-review round fixes a bug **class** — "unbounded timeout on
the S3 client", "misclassify config errors as operator-fault", "unguarded
`Number(process.env...)` parse" — the same class usually recurs at
sibling call sites the reviewer never cited, and the fix itself typically
adds new branches that no test exercises. A single-round review declares
victory when CI goes green, even though both regressions and coverage
gaps cluster exactly in the just-changed code.

## Symptoms

- CI is green after round-1 fixes land; reviewers mark findings
  "applied".
- Round 2 (or worse, production) surfaces the **same** bug class at a
  sibling site.
- The fix commit's new branches (prod fail-fast, new env parse, new SDK
  handler wiring) have zero tests pinning them.

Concrete example from PR #819 (JesusFilm/forge, 2026-04-21):

| Round 1 fix                                                                                                                                | Round 2 found                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F17: added `NodeHttpHandler({ connectionTimeout: 5_000, requestTimeout: 30_000 })` to `apps/admin/src/storage/s3.ts::getS3()`.             | F20: `apps/admin/src/scripts/refresh-core-id-mapping.ts::uploadToS3` constructs its own inline `new S3Client({ ... })` with no `requestHandler`. Operator-run CLI pointed at a stalled Railway endpoint would hang indefinitely.                                                                                                     |
| F1: replaced a brittle message regex in `isStorageMissingError` with typed `name` / `code` checks PLUS `$metadata.httpStatusCode === 404`. | F22: the bare-404 check matches `NoSuchBucket` (config error) as well as `NoSuchKey` (really missing). A misconfigured bucket gets reported as `mapping_missing`, telling the operator "re-run the refresh CLI" instead of "page platform". Same class of "misclassify config error as operator-fault" bug round 1 was meant to fix. |
| F2: added `const DUMP_TIMEOUT_MS = Number(process.env.DUMP_TIMEOUT_MS ?? 10 * 60 * 1000)` + SIGTERM / SIGKILL escalation.                  | F21: `Number("10m") === NaN`, and `setTimeout(NaN)` coerces to ~1ms. Every dump SIGTERMs instantly with "cms dump exceeded NaNms; sent SIGTERM".                                                                                                                                                                                     |
| F17 + F2 + F4 added new branches (timeouts, prod fail-fast, escalation timer).                                                             | F23 / F24 / F29: none of the new branches had dedicated tests — the fix existed but was not pinned.                                                                                                                                                                                                                                  |

## What Didn't Work

- **Single-round review with the always-on personas.** Round 1 cited
  the sites it saw; it did not rescan the diff for new-branch coverage
  or for sibling construction sites.
- **Relying on TypeScript to catch omissions.** Both S3 clients
  type-check fine — `requestHandler` is optional. Omitting it is a
  runtime / operational bug invisible to the compiler. Same for
  `Number("10m")` returning `NaN`: the type is still `number`.
- **Searching by file path only.** F17 was identified as a
  `storage/s3.ts` problem, so the fix stayed there. The sibling in
  `scripts/refresh-core-id-mapping.ts` only surfaces when you search by
  **pattern** (`new S3Client(`), not by file.
- **Re-running the same round-1 reviewer prompt over the full PR.** It
  re-finds the originals and misses the regressions that were
  introduced **by** the fixes.

## Solution

Two-part process addition. Adopt both; either alone misses the other
class of gap.

### (1) Before marking any round-1 finding "applied": grep for sibling call sites of the pattern

The reviewer cites one site. The fix belongs at every site of that
pattern. A few seconds of `rg` catches what the reviewer's scope didn't.

```bash
# Before calling F17 "applied", search for every S3Client construction:
rg -n 'new S3Client\(' apps/ packages/
# Would have caught apps/admin/src/scripts/refresh-core-id-mapping.ts::uploadToS3.

# Before calling F1 "applied", search for every HTTP-status classifier:
rg -n 'httpStatusCode\s*===\s*404|statusCode\s*===\s*404' apps/ packages/

# Before calling the DUMP_TIMEOUT_MS fix "applied", search for other
# bare Number(process.env...) parses that could hit the same NaN trap:
rg -n 'Number\(process\.env\.' apps/ packages/

# General "timeout wired at construction" sites:
rg -n 'setTimeout\([^,]+,\s*[A-Z_]+\)' apps/ packages/
```

If a sibling turns up, fix it in the same commit as the primary finding,
or open an explicit sibling-finding in the review report. PR #819's
round-2 report did this with F20, F21, F22.

### (2) After round-1 fixes land: run round 2 scoped to the fix-commit diff, not the full PR

```bash
# round1_commit = commit before fixes were applied (e.g. 19c82e8 for PR #819)
# fix_commit    = HEAD after round-1 fixes landed (e.g. 93cb17b for PR #819)
git diff -U10 ${round1_commit}..${fix_commit} -- 'apps/admin/**' \
  > /tmp/round2-scope.diff
wc -l /tmp/round2-scope.diff
```

Feed that narrower diff to the round-2 reviewers with a prompt that
explicitly reframes the question:

```
Round 2 review of PR #XXX. Scope is ONLY the diff between the round-1
commit <SHA_A> and the fix commit <SHA_B>, at /tmp/round2-scope.diff.

Focus on:
- Does every new branch in this diff have a test that exercises it?
- Does the pattern fixed here recur at any sibling site outside this diff?
- Did the fix itself introduce a new bug class (NaN env parse, overly
  broad classifier, missing timeout on a sibling client)?
```

This is exactly what PR #819 round 2 did. Five reviewers scoped to the
round-1 fix diff (~1000 lines) produced F20 / F21 / F22 plus
coverage-gap findings F23 / F24 / F29 — each one a regression or
coverage hole introduced **by** the round-1 fixes, not present in the
original PR.

## Why This Works

- **Cheap.** A scoped round 2 is an hour or two; a full-PR re-review is
  half a day and produces noise from re-finding round-1 originals.
- **High signal.** The diff is exactly where new bugs were introduced.
  Everything outside it was already reviewed in round 1.
- **Maps to the skill's conventions.** `ce:review` already ships with
  `max_rounds: 2`; this gives round 2 a concrete scope and prompt
  instead of "run it again and see".
- **Catches both failure modes in one pass.** Sibling-site regressions
  (F20, F22) and self-coverage gaps (F23, F24, F29) cluster in the same
  place: the fix diff and its immediate neighbors.

## Prevention

### Checklist when applying any review finding

Before marking a finding "applied":

- **(a) Grep for sibling call sites of the pattern.** Examples adjusted
  per finding:

  ```bash
  rg -n 'new S3Client\('                       # client-construction siblings
  rg -n 'httpStatusCode\s*===\s*\d{3}'          # status-code classifiers
  rg -n 'Number\(process\.env\.'                # unguarded env-number parses
  rg -n 'setTimeout\([^,]+,\s*[A-Z_]+\)'        # timeout wiring sites
  ```

  If a sibling matches, fix it or explicitly defer it in the same PR.

- **(b) Verify the fix has a test that exercises its own new branch.**
  Not the scenario that motivated the fix — the **branch** the fix
  added. Examples from PR #819 round 2:
  - F17 added `NodeHttpHandler` wiring → new test asserts the handler
    is constructed with `{ connectionTimeout: 5_000, requestTimeout:
30_000 }` and that the `S3Client` config carries it.
  - `parseTimeoutMs` → test feeds `"10m"`, asserts fallback + stderr
    warning.
  - `isStorageMissingError` tightening → test pins `NoSuchBucket`
    (404 + `name: "NoSuchBucket"`) as `mapping_read_failed`, not
    `mapping_missing`.

- **(c) Run round 2 scoped to the fix-commit diff, not the full PR.**

  ```bash
  git diff -U10 ${round1_commit}..${fix_commit} -- 'apps/admin/**' \
    | tee /tmp/round2-scope.diff
  ```

  Give the reviewer prompt the scope explicitly, and ask the
  narrow-question set from Solution (2) above — not the broad "review
  this PR" prompt that re-finds round-1 originals.

### Why we don't try to catch this statically

We could add a codegen step or a structural lint to detect "two
`S3Client` constructions in one app", but (a) the pattern is
finding-specific (today S3 clients, tomorrow something else), and
(b) the fix is cheap: a few `rg` lines per finding plus a scoped
round-2 diff. Investment in tooling only pays off once the same class
of miss happens a third time.

### Carry-forward

- The review-fix preference in `~/.claude/projects/-workspace/memory/feedback_review_fix_loop.md`
  (auto memory [claude]) — "apply gated_auto fixes when verifiable" —
  still holds. The round-2 additions here are complementary: round 1
  applies the verifiable fixes aggressively; round 2 verifies that the
  fixes themselves didn't regress.
- The `ce:review` skill's persona selection for round 2 should narrow
  to reviewers whose bar is most relevant to the round-1 fix diff
  (correctness, testing, reliability, the stack-specific persona, plus
  security if any boundary shifted). Agent-native, maintainability,
  api-contract, learnings-researcher usually do not need to re-run on a
  fix diff — their round-1 output is still valid for the broader PR.

## Related

- `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`
  — nearest prevention primitive (its "Grep check" step lists every
  consumer of a `"use workflow"` function before shipping). Different
  root cause (directive inert in tests), same shape of "find every site
  of the pattern before declaring the fix done".
- `docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md`
  — meta-pattern about ACK-looks-green-but-prod-disagrees. The
  round-2-scoped review is the code-review analogue of
  verify-via-independent-read.
- `docs/solutions/developer-experience/env-matrix-drift-from-runtime-requirements-20260421.md`
  — same incident family (plan / review didn't catch what prod did),
  different remedy (derive env from code).
- `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`
  — another learning surfaced during an earlier `ce:review` loop on
  R1; scoped to typed-error classification, not the review process.
- PR #819 round-1 fix commit `93cb17b`, round-2 fix commit `4724707`.
