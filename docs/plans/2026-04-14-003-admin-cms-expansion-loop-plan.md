# Admin CMS Expansion Loop Plan

## Scope

Start from the post-hardening admin branch and use a compound loop to expand the
CMS without mixing that exploration back into the v1 PR branch.

This plan is the concrete follow-through from:

- `docs/handoffs/2026-04-14-admin-cms-outstanding.md`
- `apps/admin/docs/v1-operational-surfaces.md`
- `docs/roadmap/platform/feat-098-admin-cms-expansion-loop.md`

## Current Baseline

What is already operational in `apps/admin`:

- authenticated dashboard shell with route-level `ADMIN` / `EDITOR` gate
- live experience listing plus draft-shell creation on `/dashboard/experiences`
- live video catalog visibility on `/dashboard/videos`
- operational workflow, embeddings, search, users, settings, languages, and
  media surfaces

What the route audit still shows:

- there is no `/dashboard/experiences/[id]` editor route yet
- the experiences surface is still index-plus-create, not authoring-through-
  publish
- navigation is global rather than role-segmented
- videos, media, users, and settings are still mostly read-heavy operator
  surfaces
- revision history exists architecturally but is not surfaced in the product

## Planning Goal

Make the next slice of `feat-098` feel like a real CMS milestone, not another
observability pass.

The branch should prioritize the shortest path to a usable editorial workflow:

1. find a record
2. open it
3. edit locale content
4. understand draft vs published state
5. publish safely

## Workstream Triage

### Ship On `feat-098`

These are tightly connected and should stay together if scope remains bounded:

1. Experience editor route and core editing workflow.
2. Revision/publish visibility that directly supports the editor.
3. Role-shaped navigation and route affordance hardening for the edited
   surfaces.

### Candidate Follow-Up Tickets

These are important, but they risk turning the branch into a second v1 sweep if
pulled in too early:

1. User-management actions beyond visibility.
2. Settings mutation surfaces and admin-only controls.
3. Media library workflow and upload/curation flows.
4. Full video editorial lifecycle and locale editing parity.
5. Rich workflow-run timeline and deeper operator consoles.

### Document-Only Output

Regardless of implementation depth, this branch should leave behind:

1. a compact operational-vs-deferred map for admin CMS surfaces
2. follow-up roadmap tickets for anything intentionally split out
3. solution docs for reusable patterns discovered while building the editor

## Recommended Sequence

### Phase 1: Experience Editor Foundation

Primary goal: turn experiences into a real edit target.

Deliverables:

1. Add `/dashboard/experiences/[id]`.
2. Load canonical experience data plus locale rows through the existing service
   and GraphQL boundary.
3. Support editing the highest-value fields first:
   - locale title
   - locale slug
   - locale status / publish posture
   - blocks JSON or structured block editor shell, depending on what the
     current branch can absorb safely
4. Add save/update actions that use the existing service layer rather than new
   direct data paths.

Definition of done:

- an editor can move from list -> record -> edit -> save without leaving the
  admin app

### Phase 2: Publish And Revision Ergonomics

Primary goal: make editing safe enough to trust.

Deliverables:

1. Surface current canonical state versus in-progress draft state.
2. Show recent revision entries for the edited entity.
3. Add publish-focused UI feedback:
   - current locale status
   - last published timestamp
   - who changed it most recently, if already available from revision data
4. If restore is too large for this branch, explicitly defer restore while
   still landing the timeline and comparison view.

Definition of done:

- an editor can understand what will change before publishing

### Phase 3: Role-Segmented CMS Shell

Primary goal: make the app feel intentionally shaped for each operator tier.

Deliverables:

1. Filter nav items by role instead of rendering a single global menu.
2. Mark admin-only surfaces explicitly in the shell and route layer.
3. Remove dead-end affordances for roles that cannot act on a surface.
4. Ensure new editor routes respect the same permission model as GraphQL and
   services.

Definition of done:

- authenticated users see a smaller, clearer product surface aligned to their
  role

### Phase 4: Split The Next Tickets

Only after phases 1-3 are stable, create follow-up tickets for:

1. video editorial workflow expansion
2. media library workflow
3. user/settings mutation surfaces
4. workflow-run history and operator console depth
5. search-to-edit handoff improvements

## Implementation Notes

Keep the first implementation slice narrow:

- Prefer a strong single-record editor over a shallow many-surface refresh.
- Reuse existing GraphQL/service mutations before inventing new APIs.
- Keep to `apps/admin` plus roadmap/solution docs unless a small adjacent change
  is strictly required.
- If blocks editing becomes the schedule risk, land editor framing, locale
  editing, and publish/revision surfaces first, then split richer block-authoring
  into follow-up work.

## Verification Gates

Run the admin validation suite after each meaningful slice:

```bash
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin test
pnpm --filter @forge/admin lint
pnpm --filter @forge/admin build
```

Add focused tests for any new editor, permission, and revision behavior that is
introduced.

## Exit Condition

`feat-098` is successful if it does one of these cleanly:

1. lands a coherent experience-editing milestone with publish/revision support,
   or
2. leaves behind a smaller shipped slice plus explicit follow-up roadmap tickets
   that remove ambiguity about what remains
