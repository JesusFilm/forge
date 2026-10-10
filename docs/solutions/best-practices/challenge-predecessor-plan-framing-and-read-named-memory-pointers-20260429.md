---
title: "Challenge predecessor-plan framing; treat MEMORY.md entries as forced-read pointers"
category: "best-practices"
problem_type: "best_practice"
component: "development_workflow"
root_cause: "missing_workflow_step"
resolution_type: "workflow_improvement"
severity: "medium"
module: "compound-engineering"
tags:
  - ce-plan
  - planning-hygiene
  - predecessor-plan
  - memory-md
  - inherited-framing
  - workflow
date: "2026-04-29"
related_prs:
  - "JesusFilm/forge#849"
  - "JesusFilm/forge#852"
related_docs:
  - "docs/solutions/workflow-issues/check-migration-playbook-before-extending-source-side-20260429.md"
---

## Problem

`/ce:plan` runs that build on a predecessor plan can silently inherit
the predecessor's framing — including decisions that were correct at
the time but are wrong now, or that were never deeply justified. The
new plan reads the old one for context, copies its scope/sequencing
language, and the inherited framing reaches review unexamined. Compounding
the trap: `MEMORY.md` entries that name a doc by path (a playbook, a
runbook, a migration plan) are sometimes treated as summaries rather
than as _pointers_ — the planner reads the memory blurb and skips
the referenced source, missing facts that would change the plan.

## Symptoms

- A new plan reuses the predecessor plan's "ships to X first, port to
  Y later" justification verbatim. The justification was never
  re-derived from current repo state.
- Reviewer asks: "the predecessor plan was 2 weeks ago — has anything
  changed? Has the destination shipped any of the migration stages
  since then?" Plan author can't answer without re-reading.
- A `MEMORY.md` entry says `project_admin_migration_status.md` —
  "R4 (hybrid search API) shipped PR #837, merged 2026-04-23. Awaiting
  R0 (Core sync) before R1 produces work in prod." The planner reads
  this summary and proceeds; the named playbook
  (`docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`)
  is never opened.
- Plan ships, work merges, then a reviewer asks: "if R4 already shipped,
  why didn't we build on top of that?" Recovery is a port plus a
  deprecation.

## What Didn't Work

- **Trusting the predecessor plan's "Decisions" section as load-bearing.**
  Decisions sections record what was decided then, not whether the
  decision still holds. Repo state moves; plans rarely get rewritten.
- **Treating MEMORY.md entries as compressed truth.** Memory entries
  are summaries cached at write-time. The body of a playbook can change
  in ways the summary doesn't reflect. A summary saying "R4 shipped"
  doesn't tell you whether feat-109's work belongs _on_ R4.
- **Reading the predecessor plan thoroughly without an explicit
  challenge phase.** Comprehension isn't critique. Without a
  structured prompt to falsify each inherited assumption, the planner
  defaults to confirmation.

## Solution

Add two workflow rules to `/ce:plan` (and any planning workflow that
references prior artifacts):

### 1. "Inherited assumptions to challenge" section in the new plan

Every plan that builds on a predecessor plan MUST include a section
named exactly `## Inherited assumptions to challenge`, listing each
load-bearing assumption from the predecessor and the result of
re-deriving it from current state. Template:

```markdown
## Inherited assumptions to challenge

| Inherited assumption                                 | Predecessor source                       | Re-derived from current state                                                                                                                        | Still valid?                     |
| ---------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| "Ships to apps/cms first; admin port is a follow-up" | `docs/plans/2026-04-28-001-...md` §Notes | Admin R4 shipped PR #837 on 2026-04-23. Schema and dev fixtures present. Empty prod tables are a deploy-timing concern, not a code-location concern. | **No** — should ship to admin R4 |
| "<other inherited claim>"                            | <ref>                                    | <re-derivation>                                                                                                                                      | yes/no                           |
```

Empty re-derivation cells = blocking review comment. The discipline
is filling the table, not its contents — an honest "still valid"
answer beats no table at all.

### 2. Memory-pointer escalation rule

When a `MEMORY.md` entry's body names a doc by path (any reference of
the form "see `<path>`", "captured in `<path>`", "tracked in `<path>`"),
`/ce:plan` MUST open `<path>` before drafting. Memory entries are
_pointers_, not _summaries_. Cache-warm context is not a substitute
for the source of truth.

Concretely, in the `/ce:plan` Phase 1 research:

```bash
# Walk MEMORY.md entries; extract any referenced doc paths.
for md in $(grep -rE '`docs/[^`]+\.md`' "$MEMORY_DIR/MEMORY.md" \
            "$MEMORY_DIR"/*.md 2>/dev/null \
            | grep -oE 'docs/[^` ]+\.md' | sort -u); do
  if [ -f "$md" ]; then
    echo "Memory references $md — reading before plan drafting:"
    # Open and incorporate into research context.
  fi
done
```

The memory-walk should run BEFORE the parallel research subagents are
spawned, so the planner's prompt to those subagents already includes
the named-pointer content rather than the memory blurb.

## Why This Works

The two rules attack two different failure modes that share a root
cause: **comprehension by reference, not by reading**. The planner
reads the predecessor plan's table of contents and assumes the
decisions are good. The planner reads the memory entry and assumes
the summary is the doc.

The "Inherited assumptions" table forces an explicit comprehension
audit per assumption — you can't fill a re-derivation cell without
actually re-deriving. The memory-pointer rule replaces the summary
with the source: by the time the planner reasons about the work, it
has the playbook in front of it, not just a one-line note saying the
playbook exists.

## Prevention

1. **`/ce:plan` template change.** Add the "Inherited assumptions to
   challenge" section as a default for any plan that has an `origin:`,
   `supersedes:`, or `predecessor:` frontmatter field, or that
   references a prior plan in the body.
2. **`/ce:plan` Phase 1 step.** Walk `MEMORY.md` entries for path
   references; open any referenced docs before drafting.
3. **`ce:review` lint.** Persona reviewers (correctness, maintainability)
   should flag: a plan that names a predecessor without an "Inherited
   assumptions to challenge" section is incomplete.
4. **MEMORY.md authoring rule.** When writing a memory entry that
   summarizes a longer doc, explicitly mark it as a pointer (e.g.,
   "Pointer to `docs/path/...`. Read the doc; this entry is a
   navigation aid, not a substitute"). Authors of memory entries
   share responsibility for whether they're treated as summaries or
   pointers.

## Triggers — when this rule fires

- Any plan that supersedes another plan
- Any plan whose `origin:` field points at another plan or brainstorm
- Any plan whose body says "extends", "ports", "follows", "follow-up to"
- Any plan that runs `/ce:plan` against a feature ticket whose
  description references prior work
- Any planning context that loads a `MEMORY.md` entry naming a
  migration / playbook / runbook / architecture doc by path

## Related

- `docs/solutions/workflow-issues/check-migration-playbook-before-extending-source-side-20260429.md` —
  the playbook-discovery learning that triggered this sibling. Both
  apply to `/ce:plan`; this one generalizes beyond migrations.
- `docs/plans/2026-04-28-001-feat-search-keyword-first-mode-plan.md` —
  the predecessor whose framing was inherited unchallenged.
- `docs/plans/2026-04-29-001-feat-search-keyword-first-mode-plan.md` —
  the new plan that should have run the "Inherited assumptions"
  audit and the memory-pointer escalation.
