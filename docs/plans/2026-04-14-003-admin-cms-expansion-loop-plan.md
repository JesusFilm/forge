# Admin CMS Expansion Loop Plan

## Scope

Start from the post-hardening admin branch and use a compound loop to expand the
CMS without mixing that exploration back into the v1 PR branch.

## Starting Point

- Branch: `feat/admin-cms-expansion-loop`
- Current operational baseline:
  `apps/admin/docs/v1-operational-surfaces.md`
- Roadmap anchor:
  `docs/roadmap/platform/feat-098-admin-cms-expansion-loop.md`

## Immediate Sequence

1. Audit the current admin surface for the highest-value missing CMS workflows.
2. Group findings into:
   - ship now on this branch
   - needs its own follow-up ticket
   - document-only learning
3. Implement the first bounded slice that improves real CMS functionality
   without destabilizing the validated v1 base.
4. Re-run the admin validation suite after each meaningful slice.
5. Compound the findings back into roadmap and solution docs.

## First Exploration Targets

1. Editorial experience management beyond creation-only.
2. Revision visibility and publish-state ergonomics.
3. Workflow/run observability beyond sync lock and watermark state.
4. Safer admin actions for embeddings and sync controls.
5. Search diagnostics and operator affordances.

## Exit Condition

This branch should either:

- land a coherent next functional slice of the CMS, or
- split the work into additional roadmap tickets with enough detail that the
  next engineering pass can continue without rediscovery.
