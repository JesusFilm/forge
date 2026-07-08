---
title: "Ship a removal-recipe ticket in the same PR as phase-scoped scaffolding"
date: "2026-07-08"
category: "workflow-issues"
module: "roadmap + compound-engineering"
problem_type: "workflow_issue"
component: "development_workflow"
severity: "medium"
related_components:
  - "roadmap"
  - "feature-flags"
applies_when:
  - "Shipping scaffolding with an explicit future removal trigger (dogfood gate, canary flag, migration shim, temporary compat layer)"
  - "The scaffolding PR also introduces permanent infrastructure a naive revert would wrongly delete"
  - "Removal has a hard precondition that does not exist yet"
tags:
  - "roadmap"
  - "feature-flags"
  - "scaffolding"
  - "teardown"
  - "removal-ticket"
  - "compound-engineering"
---

# Ship a removal-recipe ticket in the same PR as phase-scoped scaffolding

## Context

> **Exemplar status (2026-07-08, feat-239):** the feat-233 gate this learning
> uses as its worked example has since moved off LaunchDarkly — chat's
> membership source is now the `SEEKER_ALLOWED_EMAILS` env CSV. The LD-era
> symbols in the examples below (`chatSeekerDogfood`,
> `FORGE_CHAT_SEEKER_DOGFOOD_DEFAULT`, the `lib/feature-flags.ts` conditional)
> are the worked example as written at the time. The pattern itself —
> keep-list, drift-resistant greps + rename covenant, precondition-first
> step 0, operator-teardown category — is unchanged, and feat-239 honored it:
> feat-236's grep patterns were updated in the same PR that moved the symbols.

feat-233 shipped a LaunchDarkly dogfood gate that is **deliberately temporary**:
the plan's own scope boundaries say widening past the named-person list needs a
different mechanism, so the gate does not survive the dogfood phase whichever way
it ends. The person who _builds_ such scaffolding holds a complete teardown map
in their head at ship time — what deletes cleanly, what must **not** be deleted,
and the ordering hazards. That map decays fast: within weeks the code moves,
other tickets reshape the same files, and the author's context is gone. A future
"just revert it" session then re-derives the map from scratch and gets it wrong.

The learning: when you ship phase-scoped scaffolding, write its **removal-recipe
ticket in the same PR**, while the map is still known. (Worked example:
`docs/roadmap/ai-chat/feat-236-chat-remove-seeker-dogfood-gate.md`, shipped
alongside the feat-233 gate.)

## Guidance

The removal ticket is not "TODO: remove the flag later." It is an
agent-executable recipe with five load-bearing parts a naive teardown gets wrong.

### 1. A binding KEEP-list — the pieces a `git revert` would wrongly delete

A scaffolding PR almost always also lands **permanent, backward-compatible
infrastructure**. A wholesale `git revert` of the PR deletes it along with the
scaffolding. Enumerate what stays and why:

- feat-233's outcome-preserving `booleanVariationDetail` stays — it is shared
  infra and `booleanVariation` now delegates through it.
- The additive `emailVerified` claim threading stays — any future per-user
  feature needs it again.
- The `SEEKER_CHAT_ENABLED` kill switch stays — it reverts to being the sole
  gate.

State plainly: **a wholesale `git revert` of the PR is the wrong move.**

### 2. Drift-resistant delete/revert lists — greps and conditionals, not file:line

The code _will_ move during the phase (other tickets touch the same files), so a
hard-coded file+line list rots. Write the recipe as:

- **grep patterns** that locate the removal sites wherever they end up:
  `resolveSeekerGate|chatSeekerDogfood|gate_denied|FORGE_CHAT_SEEKER_DOGFOOD_DEFAULT`.
- **conditionals** on what else exists at removal time: "delete `lib/feature-flags.ts`
  _only if_ `chatSeekerDogfood` is still chat's only flag" (a second flag flips
  that deletion to a keep).
- an explicit line: **the greps are the source of truth, not the file list.**
- a **rename covenant**, because grep-as-source-of-truth fails _vacuously_ on a
  rename: if a mid-phase refactor renames a grepped symbol (`resolveSeekerGate` →
  `resolveGate`), the old pattern returns empty and reads as "already removed."
  State that any PR renaming a grepped symbol must update the ticket's patterns in
  the same PR, and compose the pattern set from **independent literal families**
  (a function name, an env-var name, a wire string) so one rename can't blank the
  whole set.

### 3. Precondition-first ordering — the step 0 that does not exist yet

Removal often has a hard precondition that isn't built yet. For feat-233 it is a
per-caller rate/concurrency cap — removing the gate re-creates the original
"paid generation on a public endpoint" risk the gate was compensating for. Make
it **step 0, non-negotiable**, and note that the precondition ticket should be
added to the removal ticket's `depends_on` when it is created.

### 4. Verification keyed on grep-empty + typecheck-green, not a checklist

Completion checks must also be drift-proof: `grep <patterns>` returns empty, and
`typecheck` is green (a removed discriminated-union member compile-forces every
client site to be cleaned). A file checklist would be stale by removal time.
(Grep-empty only _proves_ removal if the patterns are still current — see the
rename covenant in part 2; pairing it with typecheck-green catches a pattern that
silently went stale.)

### 5. Operator/dashboard teardown — the part no merged PR can claim

Some of the removal is **not code** and cannot be checked off by merging a PR:
archiving the flag in the vendor dashboard, removing the deployed env vars,
decommissioning a dedicated flag environment, disbanding the write-access
operator group, discarding any PII mapping (e.g. a `sub`↔email record) the
scaffolding relied on, and re-running any exposure/security review the launch
required. List these as a distinct operator checklist the flip owner runs
separately — a copier who keeps only the code steps silently drops this whole
category. (Sequencing is usually forgiving in the removal direction: leftover env
vars are inert once the code stops reading them, and an archived flag serves only
the fail-closed fallback.)

## Why This Matters

The teardown map is **most accurate at ship time and decays fast**. Deferring the
recipe to "when we remove it" means re-deriving it when the author's context is
gone and the code has moved — and the natural failure mode is the expensive one:
a `git revert` that deletes the permanent shared infrastructure (the detail
variant, the additive claim) along with the scaffolding, or a removal that ships
before its safety precondition (the rate cap) lands. Capturing the keep-list,
the grep-based sites, and the precondition ordering _now_ turns a risky
archaeology exercise into a mechanical, verifiable one.

It also makes the temporary nature of the scaffolding a **first-class, tracked
fact** rather than tribal knowledge — the removal ticket's existence is the
standing reminder that the gate is scaffolding, and its `blocks`/`depends_on`
edges keep the dependency graph honest.

## When to Apply

- Any scaffolding with an explicit removal trigger: dogfood/canary feature-flag
  gates, dual-source migration shims, temporary compatibility layers,
  tombstones-in-waiting, backfill toggles.
- Especially when the same PR also introduces permanent infrastructure (a shared
  helper, an additive schema/claim field, a kept env var) — that is exactly the
  keep-list a naive revert destroys.

Skip it for scaffolding with no removal trigger (it is not temporary) or when the
scaffolding is trivially self-contained (one file, no permanent infra landed
with it, no precondition) — there the removal is obvious and a recipe adds noise.

## Examples

Removal-ticket skeleton (adapt to the roadmap lane's conventions):

```markdown
## What To Build

0. <hard precondition that must land first — non-negotiable; add to depends_on when its ticket exists>
1. Delete (with re-verify greps): <grep patterns + conditionals>
2. Revert (compile-forced where possible): <union member removal -> follow the compiler>
3. Keep — do NOT revert: <the permanent infra a git revert would wrongly delete, + why each stays>
4. Docs re-amendment: <the doc edits that shipped with the scaffolding, in reverse>
5. Operator teardown (NOT claimable from a merged PR — flip owner checks off separately): <dashboard flag archival, env-var removal, access-group + PII-mapping cleanup, exposure re-check>

## Verification

- grep "<removal patterns>" -> empty (patterns kept current per the rename covenant)
- typecheck / test green (compile-forced cleanup proof)
- keep-list infra tests still present and passing (proves the keep held)
```

## Related

- `docs/roadmap/ai-chat/feat-236-chat-remove-seeker-dogfood-gate.md` — the worked removal recipe this learning generalizes.
- `docs/solutions/architecture-patterns/fail-closed-by-construction-feature-flag-gate-20260708.md` — the scaffolding whose teardown feat-236 captures.
- `docs/solutions/architecture-patterns/legacy-embedding-pipeline-retirement-tombstone-pattern.md` — a related "planned removal" shape (tombstone) for a different scaffolding kind.
