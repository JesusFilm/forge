---
title: "Retiring a mechanism: sweep docs prose for its names, not just code symbols"
date: "2026-07-08"
category: "workflow-issues"
module: "roadmap + docs-solutions"
problem_type: "workflow_issue"
component: "documentation"
severity: "medium"
applies_when:
  - "Retiring or replacing a mechanism (CMS removal, feature-flag vendor swap, auth mechanism change, external service drop)"
  - "The removal sweep greps for code symbols only (function names, env vars, registry keys) and skips docs prose"
  - "Roadmap tickets reference the retired mechanism in entry points, constraints, or grep patterns as if it were live"
  - "Completed tickets carry 'pending operator work' paragraphs that read as immutable history but contain live instructions"
  - "Not-started tickets name the retired mechanism in forward-looking implementation guidance"
tags:
  - "retirement"
  - "docs-sweep"
  - "roadmap"
  - "supersession-note"
  - "stale-docs"
  - "prose-references"
  - "teardown"
  - "hygiene"
related_components:
  - "roadmap"
  - "docs-solutions"
  - "feature-flags"
---

# Retiring a mechanism: sweep docs prose for its names, not just code symbols

## Context

When feat-239 ([PR #1498](https://github.com/JesusFilm/forge/pull/1498))
replaced the chat seeker's LaunchDarkly dogfood gate with the
`SEEKER_ALLOWED_EMAILS` env allowlist, the retirement got the standard
verification: code-symbol greps (`chatSeekerDogfood`,
`FORGE_CHAT_SEEKER_DOGFOOD_DEFAULT`, `LAUNCHDARKLY` — all empty in
`apps/chat`) plus supersession banners on every doc that **describes** the
retired mechanism (banners and the supersession notes below are the same
dated-note artifact — one convention, stamped wherever the hit lives). It
passed. And it still missed a live instruction:
feat-233's Resolution (`docs/roadmap/ai-chat/feat-233-chat-seeker-ld-dogfood-gate.md`,
`status: complete`) carried an **"Operational tail (pending)"** paragraph
telling a future operator to provision the LaunchDarkly flag, SDK key, and
targeting at flip time. An operator following it would have provisioned a flag
nothing reads. It was caught only by an independent fresh-session review.

The same failure class had already been sitting in the repo for weeks from
the Strapi retirement ([PR #1013](https://github.com/JesusFilm/forge/pull/1013)
deleted `apps/cms`): feat-068's Entry Points still send an agent to
`apps/cms/schema.graphql` ("user and role primitives already available from
Strapi"), and feat-038's Constraints still say "Do NOT replace Strapi admin
with a full general-purpose editor" — about a system that no longer exists.

The learning: **a retirement's code-symbol sweep cannot find forward-looking
prose that treats the retired mechanism as live.** Retirement needs a second,
docs-level sweep keyed on the mechanism's _names_, with every hit classified
as historical record (leave) or forward-looking instruction (stamp).

## Guidance

At mechanism retirement/replacement time, run **two** sweeps, not one. The
code-symbol sweep (function names, env-var names, registry keys) stays as-is.
The second sweep is over **every tracked markdown file** — roadmap tickets in
**every** lane, `docs/solutions/`, `CONCEPTS.md` (repo root), and every README
and CLAUDE.md, root and per-app (the "how to dogfood/deploy" recipes live
outside `docs/`) — keyed on the mechanism's **names as prose writes them**:

- the product noun ("Strapi", "LaunchDarkly"),
- abbreviations prose actually uses ("LD"),
- generic aliases ("the CMS", "the flag vendor"),
- env-var names as words (`SEARCH_API_KEYS`, `LAUNCHDARKLY_SDK_KEY`),
- dashboard/console terms ("the flag", "targeting", "Strapi admin"),
- service and path names (`apps/cms`).

**Harvest the name set first — the sweep's recall is bounded by it.** Build
the term list from the mechanism's own plan/ticket/CLAUDE.md prose, not from
memory: repo prose writes bare "LD" and calls the retired CMS just "the CMS",
and alias-only prose survives a sweep keyed on the formal noun — turning
staleness into false confidence ("we swept"). Role-word terms ("the flag",
"targeting") are noise-dominated when grepped bare: scope them to files
already hit by a noun or env-var key, and read the three highest-risk
surfaces below in full even when the noun grep returns zero hits there —
prose that names the mechanism only by role words is invisible to any grep,
and that is this method's recall boundary.

```bash
git grep -niE 'strapi|launchdarkly|\bLD\b|SEARCH_API_KEYS' -- '*.md'
```

### Classify every hit — two buckets, two actions

- **HISTORICAL RECORD** — past-tense narrative describing what was done
  (Resolution history, plan narratives). **Leave untouched.** Rewriting these
  is rewriting history.
- **FORWARD-LOOKING INSTRUCTION** — entry points, constraints, "pending"
  operator steps, verification recipes, local-dev setup instructions. **Stamp
  a short dated supersession note naming the successor**, adjacent to the
  stale paragraph, keeping the original body as the historical record. The
  intervention is additive — never a deletion, never an in-place rewrite.

**Classify by content, never by document type.** A plan or a completed ticket
is not historical wholesale: a never-executed operator section inside an
otherwise-historical document — a plan's Rollout Runbook, a flip-time
checklist, a Definition-of-Done step — is a FORWARD-LOOKING INSTRUCTION and
gets stamped. Worked middle case: the feat-233 plan
(`docs/plans/2026-07-03-002-feat-chat-seeker-ld-flag-plan.md`) carries a
Rollout Runbook whose LD provisioning steps never ran, and feat-233's own
stamped Resolution still points readers at it ("per the plan's Rollout
Runbook") — the runbook needed its own stamp, which a doc-type rule would
have skipped.

**Have someone who didn't author the retirement verify the classification.**
Every stale instance in the evidence survived its author and was caught by an
independent reader — feat-233's stale paragraph survived the very session
that retired the mechanism. Self-classifying your own retirement's hits is
the practice's known blind spot; a fresh session or reviewer checking the
sweep's leave/stamp calls is the control that has actually caught the misses.

### Scaling the sweep — triage order, not per-line heroics

A core mechanism's noun returns thousands of lines (`strapi` alone: ~2,700
lines across ~335 files under `docs/` today), so "classify every hit" cannot
mean reading every line. Triage:

1. **Exhaustive, always:** the three highest-risk surfaces below, per-line.
2. **Per-file, in priority order:** remaining roadmap tickets, then
   `docs/solutions/`, then `docs/plans/` + `docs/brainstorms/` (predominantly
   past-tense narrative) — classify at file granularity, opening a file only
   when its hits could plausibly be instructions.
3. **First-pass filter for the tail:** co-occurrence of instruction markers
   (`pending`, `provision`, `at flip time`, `Do NOT`, how-to headings) near
   the mechanism name.
4. **Record what was triaged out** in the retirement PR description as an
   accepted residual, so the unswept tail is auditable rather than invisible.

### The highest-risk surfaces — check these explicitly

1. **Completed tickets' Resolution sections.** The least obvious bucket:
   `status: complete` reads as immutable history, so authors deliberately skip
   these files ("don't rewrite history") without noticing the file contains an
   _instruction_, not just a record. Grep for `pending`, `at flip time`,
   `operator`, `provision` near the mechanism name.
2. **Not-started tickets' Entry Points / Grep These / Constraints.** Nothing
   compiles a roadmap ticket, so no typecheck forces the cleanup; the agent
   who eventually picks up the ticket dead-ends (feat-068) or obeys a
   constraint about a ghost (feat-038).
3. **Lane README / CLAUDE.md recipes** — any "how to dogfood", "how to
   deploy", "how to provision" walkthrough that routes through the retired
   mechanism.

### Why the code-symbol sweep structurally misses this

Prose names mechanisms by product nouns and role words ("Strapi admin", "the
LaunchDarkly flag", "the dashboard"), not identifiers — so identifier greps
return empty over exactly the files that matter. And the two guardrails that
catch stale _code_ references (compilation, mechanism-doc banners) don't reach
instructions embedded in tickets whose status field says the file is done.

### Boundaries

- **This complements, never replaces, the code-symbol sweep.** Both run at
  retirement time.
- **No license to rewrite history.** Past-tense mentions stay verbatim. The
  only edit is the adjacent dated supersession note.
- **Not the removal-recipe pattern.** The removal-recipe ticket
  (`removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md`) is
  written **in advance, at ship time**, for _planned_ removals of phase-scoped
  scaffolding. This sweep fires **at retirement time** and applies to _any_
  retirement, including unplanned/organic ones — Strapi was not phase-scoped
  scaffolding and its retirement had no recipe.
- **Not the tombstone pattern.** The 410 tombstone is a _code-level_ artifact
  that gives old HTTP callers an observable retirement signal. The
  supersession note is its _docs-level_ analogue for future doc-followers.
- **One practice, no automation.** The sweep covers every hit class the same
  way — dead file paths and prose instructions alike are classified and
  stamped in the same pass. There is no CI companion to this practice and
  none is planned.

## Why This Matters

Retirements are not rare here — at least four substantial ones in under five
months of repo history: the Strapi CMS arc (#1013, #1011, #974, #966, #941),
the legacy scene embedding pipeline (#1427, the 410 tombstone, the cleanup
CLI), the `SEARCH_API_KEYS` env-CSV partner auth replaced by the DB-backed
`PartnerApiKey` store (#976), and the LD seeker gate (feat-239, #1498) — with
the planned feat-236 gate removal still ahead. Every one of them creates the
conditions for this failure class.

And the miss is **systematic, not sloppiness**: of the three observed stale
instances, two (feat-068, feat-038) went uncaught for ~6 weeks across
multiple sessions working in those lanes, and the third (feat-233) survived
its own authoring session — written the same day the mechanism was retired —
and was caught only by an independent fresh-session review. The costs are
concrete: an agent dead-ends on a nonexistent entry point, or an operator
provisions vendor infrastructure (flag, SDK key, targeting rules) that no code
reads — spend and grant-surface with zero function.

## When to Apply

- **Any mechanism retirement or replacement**: an app deletion, a pipeline
  retirement, an auth-mechanism migration, a feature-flag mechanism swap —
  planned or organic.
- **At retirement time**, as a peer step to the code-symbol sweep, in the same
  PR/arc that removes or replaces the mechanism.
- **Multi-PR and phased retirements**: the sweep belongs to the PR that makes
  the old mechanism unreadable by code — the app-deletion PR, the
  dual-accept→required-only flip — and that PR is named as sweep owner in the
  arc's tracking ticket. During a dual-running period the old mechanism's
  prose is still true: the sweep is deferred, not skipped.
- **Forward-looking only**: this practice applies to retirements from here
  on. Retirements that predate it (including Strapi) are NOT retroactively
  swept — their stale prose is left as-is unless a specific instance is
  causing active harm and the owner decides otherwise.
- The sweep is cheap only when the mechanism is rarely referenced; for a
  heavily-referenced one the triage order in Guidance IS the procedure. Do
  not skip it on the guess that "the docs only describe history" — feat-233
  was exactly the file everyone would have guessed was pure history.

## Examples

**The stamped instruction (feat-233).** Before feat-239's sweep-and-review,
the Resolution's operational-tail paragraph read as a live instruction:

> **Operational tail (pending).** The code merges fail-closed — the dogfood
> _flip itself_ is operator work, not done here: the LaunchDarkly
> flag/SDK-key/targeting provisioning and the pre-prod, deployed, and
> gate-walk verification rows (Verification Contract rows 4–6) run at flip
> time per the plan's Rollout Runbook. Production serves stub to everyone
> until then.

After (the paragraph stays; the supersession note lands directly adjacent):

> **Superseded (2026-07-08, feat-239):** the flip never happened, and the LD
> provisioning steps above are obsolete — feat-239 replaced the membership
> source with the `SEEKER_ALLOWED_EMAILS` env CSV and the code no longer reads
> LaunchDarkly. Do not provision the flag, SDK key, or targeting; the
> flip-time operator work now lives in feat-239. The rest of this ticket stays
> as the historical record.

The note's shape is the pattern: **dated**, **names the successor**, states
the **imperative** ("Do not provision…"), points to **where the live work now
lives**, and closes with the history-preservation line.

**The cost of not sweeping (feat-068).** Entry point 5 of
`docs/roadmap/platform/feat-068-partner-publishing-and-user-accounts.md`
reads: `apps/cms/schema.graphql` — "user and role primitives already available
from Strapi". `apps/cms` was deleted in PR #1013 (merged 2026-05-25), ~6
weeks before the stale reference was discovered — an agent picking up the
ticket dead-ends on its first Read, then has to re-derive where user/role
primitives actually live.
The "Do NOT replace Strapi admin…" constraint in
`docs/roadmap/media-generation/feat-038-ai-uploading-publishing-studio.md` is
the same class in the Constraints slot. (Both are cited here as _evidence_
only — this practice is forward-looking, and stamping pre-practice
retirements is deliberately out of scope; see When to Apply.)

## Related

- `docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md`
  — the planned-removal sibling: it writes a teardown recipe **in advance at
  ship time** for phase-scoped scaffolding; this sweep fires **at retirement
  time** for any retirement, including organic ones with no recipe. Its
  skeleton's "Docs re-amendment" step reverses the doc edits that _shipped
  with_ the scaffolding — this sweep covers the prose in _other_ documents
  that independently treats the mechanism as live.
- `docs/solutions/architecture-patterns/legacy-embedding-pipeline-retirement-tombstone-pattern.md`
  — the code-level analogue: a 410 tombstone gives old HTTP callers an
  observable retirement signal. It already states that documentation is part
  of the retirement surface but prescribes no discovery method — this doc
  supplies the how (noun-keyed sweep + dated supersession notes).
- `docs/solutions/workflow-issues/roadmap-status-drift-audit-recipe-20260507.md`
  — sibling drift audit on a different axis: it reconciles roadmap `status:`
  frontmatter against shipped PRs; this doc targets forward-looking prose in
  ticket _bodies_.
- `docs/solutions/best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md`
  — the same grep-blindness meta-pattern in code: a single-pattern sweep
  silently drops the second syntactic family. Here the missed family is
  mechanism nouns in prose.
- `docs/roadmap/ai-chat/feat-233-chat-seeker-ld-dogfood-gate.md` — the stamped
  worked example (Resolution → Operational tail → supersession blockquote).
- [PR #1498](https://github.com/JesusFilm/forge/pull/1498) (feat-239, LD gate
  → env allowlist) and [PR #1013](https://github.com/JesusFilm/forge/pull/1013)
  (Strapi CMS runtime removal) — the two retirements behind the worked
  instances.
