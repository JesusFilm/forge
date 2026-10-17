---
module: Studio authoring
problem_type: architecture_pattern
tags: [studio, deletion, postgres, mcp, revisions]
date: 2026-10-09
---

# Studio workspace deletion retains evidence

`StudioAuthoringService.delete` in
`apps/admin/src/services/studio-authoring/index.ts` marks `Short.deletedAt` rather
than cascading deletes through immutable revisions, receipts, attempts, source
usage or shared media. Tombstoned IDs cannot be reused or restored by authoring
commands. This is workspace removal, not storage reclamation.

The command checks authenticated human ownership before returning an existing
receipt. The hash includes the authenticated actor and validated revision/key;
another owner, payload or delegated client cannot claim the original retry.
Deletion does not advance the composition revision. The sole exception to
`lockProject` visibility filtering is this command's exact retry lookup.

Publication must be revoked interactively first. Reject active attempts,
unsettled production calls, Mux jobs that have not reached READY/FAILED, and any
planning-calendar assignment. A succeeded render can still have active Mux
processing; checking only attempt status would strand its worker. Background
Mux discovery must filter `short.deleted_at IS NULL` before pagination.

Migration `0139_studio_project_deletion` permits only the isolated, one-way
tombstone update. It retains the permanent publication latch and blocks new
revision/approval/attempt/calendar writes to deleted projects. Row locking
serializes deletion with edits, admissions and calendar assignments.

Both Manager interactive RPC and `shorts.deleteProject` execute the canonical
command. MCP requires existing `shorts:edit` consent and current operator
membership, preserving delegated attribution. Tool guidance requires explicit
user deletion intent; destructive/idempotent annotations support client review.
The browser confirms the project name and reuses its key after a lost response.

## Verification

`deletion.db.test.ts` covers ownership, exact/concurrent retries, stale revisions,
delegated consent, published/unpublished state, active attempts, Mux processing,
calendar removal/reassignment, database guards, retained evidence and edit races.
Use only its explicitly allowlisted disposable loopback database.

The feat-630 checks passed 14 Admin tests, 25 Manager tests and 46 portable contract
tests, all three touched-package typechecks, touched-file ESLint, formatting and
Manager's production build. The built dashboard smoke used a local mock session
and intercepted command responses; canonical backend behavior was tested against
Postgres separately. No production project was deleted or code deployed.

`docs/validation/shorts-project-deletion/` contains the browser reports. Six
alternating fresh-context samples per version used the actual minified component:
median project readiness was 399.9 ms before / 399.5 ms after, initial requests
remained four (one command request), and transferred resources increased by 1,459
bytes. DCL medians were 290.3 / 326.6 ms amid overlapping 230–463 ms samples;
this is component-level evidence, not a full-app performance or field claim.
