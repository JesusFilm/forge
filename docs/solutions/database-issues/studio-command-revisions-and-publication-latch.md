---
module: Studio authoring
problem_type: architecture_pattern
tags: [studio, postgres, revisions, idempotency, publication]
date: 2026-09-07
---

# Studio commands, revision history and the permanent publication latch

Admin owns `StudioAuthoringService` in `apps/admin/src/services/studio-authoring/`.
GraphQL and Manager call this boundary; future MCP and background adapters must do
the same. The neutral package contains data contracts, not persistence or policy.

## Transaction boundaries

Each existing-project command locks the project row in one interactive Prisma
transaction, checks a durable retry receipt, validates lifecycle/revision, and
commits all changes plus the receipt together. Creation serializes the absent ID
with an advisory transaction lock. A receipt hashes validated input, command name
and authenticated actor; a different payload or actor cannot reuse its key.
An exact retry can return old accepted evidence even after later edits/publication;
it performs no new mutation or external side effect.

Revision numbers advance only for accepted composition changes. Request, start,
approve and operational completion keep the same revision unless a fresh generation
result applies operations. All side-effect admission commits an attempt before
external work starts. Actual providers, dispatch/outbox reconciliation and asset
registration belong to downstream tickets.

Script review follows ordered speech dependencies: start frame, track order, then
item ID break ties. The identity includes all speech fields, suppression choices,
roles, author language, voice/provider/model/settings and optional pronunciation.
Absolute visual placement/timing does not enter the hash when spoken order is
unchanged. Publication approval includes the complete revision, render input hash
and immutable manifest identity. Changing any composition content makes old
publication approval and renders ineligible without discarding their evidence.

## Content immutability versus operational completion

Publication sets `firstPublishedAt` once. Unpublish changes visibility lifecycle,
never editability. Database triggers reject revision/approval/receipt overwrites,
project identity changes, new revision/attempt/approval writes after publication,
and backward lifecycle transitions. The current-revision foreign key is deferred
so a project and its first immutable snapshot can be inserted in one transaction.

Work admitted before publication may finish afterward. The only allowed attempt
update then is QUEUED/RUNNING to STALE, preserving input/job identity and retaining
result references, cost and completion actor. It cannot create a revision or change
the published project. Terminal results remain immutable. This avoids losing paid
work/provenance while keeping the publication promise intact.

`publication.ts` is an internal transaction seam, absent from the public module,
GraphQL and Manager adapter. Its required verifier runs inside the same transaction;
feat-460 must implement catalog/source/language/Mux/schedule checks and visibility
writes there. Rendering and network calls must finish before that transaction.
No public publish bypass is available in feat-454.

## Actor and asset boundaries

Human identity comes from an authenticated Admin principal with Admin or Manager
operator authority. Service identities remain visibly services and cannot approve
human review. Manager's adapter accepts an authenticated transport; its existing
backend transport carries service authority. The signed-in Manager/MCP principal
integration is owned by feat-456/457, not an actor ID supplied in a JSON payload.

The document stores asset/version/digest references, exact source video/dub/edition,
language, subtitle track and trim mapping, component code/dependency identities and
editable controls. It stores no media bytes, generated TSX, signed URLs or provider
credentials. Registry resolution and durable asset usage edges are feat-455 work.

## Verification

`commands.db.test.ts` executes the real service and GraphQL schema against a
dedicated loopback Postgres database. It refuses other hosts/database names. Tests
cover independent-client edit races, retries, stale results, narration approval,
publication/edit serialization, immutable history and late operational completion.
Use the explicit `STUDIO_TEST_DATABASE_URL`; never use a shared DATABASE_URL as
test authorization. Completion evidence and commands are in the feat-454 ticket.

## Editor project settings (2026-10-20)

Project title and dimensions live in a lazy-loaded Project settings modal, not
the no-selection item inspector. Stage values locally and apply via a single
`EditorSession.edit` so validation, undo and autosave use the same document path.
Cancel/Escape must not edit the session; preserve read-only gating. Component
control labels are display-only formatting: never rename stored property keys
when humanising camelCase. Use the same generic formatter for every property;
do not introduce field-specific aliases.

## Live inspector scrubbing (2026-10-21)

`use-inspector-preview.ts` holds a temporary document only for the player and
canvas selection overlay. Numeric labels schedule the latest draft once per
animation frame; the inspector continues reading the committed document so its
inputs and pointer capture stay mounted. Drafts are bound to the originating
document identity and selection, and discarded on cancellation, capture loss,
window blur or unmount. A release clears the draft and makes one ordinary
`EditorSession.edit`. Never send these intermediate documents through session
edits: doing so would pollute history, recovery and autosave. Source preparation
is still keyed by `previewSignature`, so appearance changes reuse prepared media
and the mounted player. Integration tests observe the actual Preview's player
props, request count and mount count through a drag and undo.
