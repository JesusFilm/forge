# PR #2347 operator documentation follow-up

Related ticket: [feat-397](../roadmap/media-generation/feat-397-subtitle-quality-lab.md).

## Scope

Resolve the two documentation observations from the current-head queue review
of `74b341ca89692e79452d098ce1150837d0cc0d9e`: remove the orphan Workflow
credential comment in `apps/manager/.env.example` and distinguish the local
World's file storage from its process-local queue. Preserve application code
and the Lab's external recovery requirement.

## Evidence and implementation

Manager source has no singular `WORKFLOW_API_KEY` consumer. The pinned
`@workflow/world-local` 4.1.0 implementation separates `storage.js` and
`storage/` JSON files from `queue.js` in-memory delivery. Its `index.js`
`start()` initializes the data directory and calls `reenqueueActiveRuns`;
`config.js` defaults `WORKFLOW_LOCAL_DATA_DIR` to `.workflow-data`.

Document these source properties without inferring the deployed World, a
persistent volume, or a successful restart. The Admin-owned Lab run/cell ledger
and the runbook's fenced recovery route remain separate operational checks.
The broader feat-397 acceptance stays in progress.

## Review and validation

Check the exact documentation diff, formatting and whitespace, absence of
the removed credential in Manager code/configuration, and byte preservation
of executable/test and lockfile paths. Queue independent review against the
immutable resulting tree. No application test rerun is needed for these
documentation-only edits; historical runtime checks do not certify deployment.

## Durable learning

Describe workflow storage and queue lifetime separately. A local backend can
persist state on disk while losing in-memory delivery; startup may reconstruct
delivery when that state survives. Verify the configured target and recovery
outcomes before making a production durability claim.
