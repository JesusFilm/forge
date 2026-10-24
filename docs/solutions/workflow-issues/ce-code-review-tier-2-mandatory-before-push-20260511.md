---
title: "Tier-2 ce-code-review is mandatory before push when shipping-workflow triggers fire"
category: "workflow-issues"
problem_type: "workflow_issue"
component: "development_workflow"
root_cause: "missing_workflow_step"
resolution_type: "workflow_improvement"
severity: "high"
module: "compound-engineering/ce-work"
applies_when:
  - "Executing /ce-work on a plan that has completed Phase 2 (implementation + tests + build green)"
  - "About to invoke /commit-push-pr, /pr, or git push from a feature branch"
  - "Diff is large+diffuse (>=400 changed lines AND >3 directories or 2 subsystems)"
  - "Diff is very large (>=1000 changed lines regardless of diffusion)"
  - "Touching sensitive surface (auth, payments, data migrations, cryptography, security-relevant config, public API/library contracts, dependency manifests)"
tags:
  - ce-work
  - ce-code-review
  - shipping-workflow
  - tier-2-review
  - pre-push-gate
  - simplify-pass
  - residual-work-gate
  - workflow-discipline
  - compound-engineering
date: "2026-05-11"
last_updated: "2026-05-11"
related_prs:
  - "JesusFilm/forge#915" # the canary PR where this gap was discovered post-push
  - "JesusFilm/forge#902" # U3 dual-client codegen — example of running the full shipping workflow correctly
related_docs:
  - "docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md"
  - "docs/solutions/workflow-issues/check-migration-playbook-before-extending-source-side-20260429.md"
  - "docs/solutions/best-practices/challenge-predecessor-plan-framing-and-read-named-memory-pointers-20260429.md"
  - "docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md"
---

## Context

When executing `/ce-work` on a substantial plan (multiple implementation units, >=30 changed lines, or sensitive surfaces), the trap is treating Phase 2 (implementation + unit tests + build green) as "done" and proceeding directly to push/PR. The skill explicitly references `references/shipping-workflow.md` at the Phase 3 transition and instructs:

> When all Phase 2 tasks are complete and execution transitions to quality check, you **must** read `references/shipping-workflow.md` for the full shipping workflow. Do not skip this.

Skipping that read produces a state that _feels_ done (green CI, self-reviewed code) but bypasses the mandatory simplify pass, multi-persona Tier-2 review, Residual Work Gate, and Operational Validation — the layers that catch design-shape bugs unit tests cannot.

This happened concretely on PR #915 (U5 web canary, feat-104 admin-core consumer migration): 4 implementation units shipped with all tests passing and build clean, then pushed without running the shipping workflow. The user caught the gap with a one-line question ("Has the ce-code-review skill been run yet, even implicitly?"). Recovery required re-running `/simplify`, then `/ce-code-review` twice, accumulating ~22 additional fixes — and a Railway deploy failure on a P2 reliability finding that the round-2 review had flagged but the orchestrator skipped (see [the related-env-var doc](../runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md)). That bug would have been a single pre-push fix had Tier-2 run before push.

The skip pattern is **specific to Tier-2 review at PR-creation time**, not a general practice gap. Session history shows `/ce-code-review` and `/ce-doc-review` running consistently during plan-writing — U3 (PR #902) executed the full shipping workflow end-to-end (plan → doc-review → work → simplify → code-review Tier 2 → compound). The discipline is taught in planning skills but not consistently checked at the push moment.

## Guidance

After Phase 2 of `/ce-work`, **always** read `references/shipping-workflow.md` before any push or PR action. Execute its required steps in order:

### 1. Simplify pass (REQUIRED for >=30 changed lines)

Run `/simplify` on the diff BEFORE code review. Simplification surfaces the cleanest version for reviewers to evaluate and avoids reviewer cycles spent on lines that should not exist. Skip only when the diff is purely mechanical (formatting, dep bumps, generated artifacts).

### 2. Code Review (REQUIRED every change)

Default to Tier 1 (harness-native `/review`). Escalate to Tier 2 (`/ce-code-review mode:autofix plan:<path>`) when **any** trigger fires (not the conjunction):

- **Sensitive surface**: auth/authz, payments/billing, data migrations or backfills, cryptography or secrets, security-relevant config, public API or library contracts, dependency manifests
- **Large + diffuse**: ≥400 changed lines AND >3 directories or 2 subsystems
- **Very large**: ≥1000 changed lines regardless of diffusion
- **Plan explicitly requests** a full / deep / thorough code review

### 3. Residual Work Gate (REQUIRED when Tier 2 ran)

After autofix completes, inspect the Residual Actionable Work summary and use the platform's blocking question tool to ask the user how to handle residual `downstream-resolver` findings — `Apply/fix now`, `File tickets`, `Accept and proceed`, or `Stop`. Never silently bypass.

### 4. Final Validation

- All tasks marked completed
- Tests pass and cover new behavior
- Lint passes
- Plan's `Requirements` section satisfied
- Any `Deferred to Implementation` questions resolved during execution
- Figma designs match (if applicable)

### 5. Operational Validation Plan (REQUIRED in PR body)

Add a `## Post-Deploy Monitoring & Validation` section to the PR description for every change. Include:

- Log queries / search terms
- Metrics or dashboards to watch
- Expected healthy signals
- Failure signals and rollback / mitigation trigger
- Validation window and owner

If there is truly no production / runtime impact, still include the section with: _"No additional operational monitoring required"_ and a one-line reason.

### Per-finding routing rule (Critical caveat)

When a reliability / security / correctness persona flags **P2+ at confidence 75+**, the default bias is **Apply, NOT Defer**. Do NOT rate "by design" without exhaustive verification. P2 findings on deploy-blocking surfaces (boot env contracts, schema validation, Apollo client construction) are concrete production risks even when CI is green.

Stage-5 step-6b routing for reference:

| `autofix_class` | `suggested_fix` present? | Recommended action |
| --------------- | ------------------------ | ------------------ |
| `safe_auto`     | (auto-applied)           | Apply              |
| `gated_auto`    | yes                      | **Apply**          |
| `gated_auto`    | no                       | Defer              |
| `manual`        | **yes**                  | **Apply**          |
| `manual`        | no                       | Defer              |
| `advisory`      | n/a                      | Acknowledge        |

A `manual` finding _with_ a `suggested_fix` recommends Apply because the persona committed to a concrete fix shape grounded in review context. Do not downgrade it to Defer without specific evidence that the fix is wrong.

## Why This Matters

Unit tests prove what code DOES is correct. They prove nothing about what code SHOULD do under adversarial conditions: sync throws in untyped payloads, env-var typos that bypass typed enums, log-aggregation leakage of CMS content, schema entries that look optional but brick boot. The Tier-2 personas (correctness, security, adversarial, reliability) construct these conditions deliberately. Skipping them skips the only review layer that catches design-shape bugs before they ship.

On PR #915 specifically, four findings invisible to unit tests + green CI:

1. **P1 (api-contract + correctness + maintainability + kieran-typescript agreement)**: `FORGE_CONTENT_API` `z.enum` would brick-boot when operators pre-set U5b values.
2. **P1 (security + adversarial + correctness agreement)**: `FORGE_PARITY_DEBUG=1` in production would leak raw CMS content into log aggregation.
3. **P1 (adversarial + reliability ×2 agreement)**: Bridge sync-throw could escape into user render despite Strapi success path.
4. **P2 (reliability, skipped)**: `ADMIN_GRAPHQL_URL` missing schema entry → Railway deploy failure. _(This one wasn't applied even when surfaced — a separate failure mode of "Tier-2 finding ignored after running it." Documented in [the related-env-var doc](../runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md).)_

A green CI badge said nothing about any of these. Tier-2 review was the _only_ layer that surfaced them.

## When to Apply

Always after Phase 2 of `/ce-work`, before push. Specifically:

- Phase 2 task list completed (tests pass, build clean, lint clean)
- About to invoke `/commit-push-pr`, `/pr`, or `git push`
- Plan is >=3 implementation units OR touches any item in the sensitive-surface list

Never skip on the grounds of "I already reviewed the code as I wrote it." Single-perspective implementer review is structurally weaker than multi-persona adversarial review. The implementer's review and the Tier-2 review answer different questions: the implementer asks "does this do what I intended?", Tier-2 asks "what breaks if a different actor pokes at this?"

## Examples

PR #915 timeline — actual vs. shipping-workflow-correct:

| Phase                     | Actual                                                                   | With shipping-workflow                                                             |
| ------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| End of `/ce-work` Phase 2 | "tests pass, build clean" → pushed                                       | "tests pass, build clean" → read `shipping-workflow.md`                            |
| Pre-push action           | Opened PR #915 directly                                                  | Run `/simplify` → `/ce-code-review` (Tier-2 triggered on size + sensitive surface) |
| Findings surfaced         | None pre-push                                                            | 3 P1 + 4 P2 BEFORE the operator-facing surface ships                               |
| Recovery cost             | ~22 additional fixes across re-runs; Railway deploy failure mid-recovery | Findings applied in one pre-push cycle; Railway deploy succeeds first try          |
| Wall-clock cost           | ~5–10× baseline                                                          | Baseline                                                                           |

Post-push recovery worked, but at multiplicative cost. The shipping workflow is not optional ceremony — it is the only checkpoint that catches the four bug classes above before they reach the operator surface.

**Failure mode to recognize**: the instant after Phase 2 where you think _"I should push now"_ is exactly the instant to instead open `references/shipping-workflow.md`. The instinct to push is itself the signal that the workflow is being skipped.

## Counter-example (when this discipline ran correctly)

PR #902 (U3 dual-client gql.tada codegen) executed the full shipping workflow end-to-end. From the session history (session `cc61ab94`):

> `/ce-plan` → `ce-doc-review` → `ce-work` (6 units, 7 commits, 109 tests) → `/simplify` → `ce-code-review Tier 2 autofix` (10 reviewers parallel, 5 safe_auto fixes) → `ce-compound`

The result was a clean Tier-2 pass with no post-push recovery rounds. Same orchestrator, same shape of work, but the shipping-workflow read happened at Phase 3 transition rather than being skipped. The discipline is reproducible — what makes it slip is treating the "I should push now" instinct as a green light instead of the trigger to open the workflow doc.
