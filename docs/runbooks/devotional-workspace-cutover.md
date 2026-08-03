# Devotional Workspace cutover

This runbook moves the video-first devotional data plane to the Mastra
`Devotional Workspace`. It does not authorize a direct Railway deploy. Ship the
code through the normal pull-request-to-main flow.

## Preconditions

- New devotional starts are disabled; status and authenticated playback remain
  available.
- Exactly one Mastra replica is configured for the owner-approved devotional
  exception.
- Active and suspended pre-cutover attempts are either completed on legacy
  storage or canceled. They are never resumed across the storage migration.
- Mastra alone references the dedicated Railway bucket `BUCKET`, `ENDPOINT`,
  `REGION`, `ACCESS_KEY_ID`, and `SECRET_ACCESS_KEY` values. Shorts Worker has
  no permanent devotional Workspace credentials; it receives short-lived,
  attempt-bound signed capabilities in authenticated jobs.
- A separate immutable off-bucket backup has completed and its restore drill is
  recorded. Target RPO is 24 hours; target RTO is 4 hours.
- The operator manifest inventories every authored input, used-clip record,
  pending reservation, source-media reference, and retained artifact with size
  and SHA-256. It contains no credentials or source bodies.

## Stage and verify

1. Run the database migration and confirm the expected schema version.
2. Validate source bytes and the manifest without changing readiness:
   `pnpm --filter @forge/mastra devo:workspace:migrate -- <manifest.json> --dry-run`.
3. Require exactly one ledger entry under `/_system/migration/`, with no live
   `reservationId` or `pendingUntil`. Authored inputs target `/inputs/`, media
   `/source-media/`, and retained artifacts `/runs/`.
4. Copy into a unique immutable `/_migrations/<runId>/...` prefix. Never overwrite or delete a
   conflicting destination. Reruns must report existing identical objects as
   unchanged.
5. Compare source, staging, and canonical counts, sizes, and streamed SHA-256 values.
6. Reconcile the Workspace catalog. Required scripture, reflections, and safety
   configuration must be eligible; BM25, vector storage, and the embedder must
   all report ready.
7. Verify Mastra can issue signed attempt inputs/uploads, Shorts Worker can
   stream them without permanent bucket credentials, Mastra can verify and
   finalize immutable outputs, authenticated playback supports Range, and
   wrong-attempt/private-host/expired capabilities are rejected.
8. Create a separate restore-attestation JSON containing the manifest digest,
   backup reference, completion time, verifier, and all six true checks:
   Workspace CRUD/search, hybrid search, signed Worker transfer, one Mastra
   replica, drained runs, and readable legacy refs.
9. Import the ledger and atomically record readiness with
   `pnpm --filter @forge/mastra devo:workspace:migrate -- <manifest.json> --restore-attestation <attestation.json>`.
   The command rejects a mismatched attestation or conflicting ledger row.
   `_system/readiness/latest.json` is an editor-facing projection, not the
   authority.

## Canary and enable

1. With starts still disabled, sign in as an existing Studio editor and prove
   list, read, create, edit, upload, search, and delete. Repeat the mutation
   check as an admin; permissions must be identical. Confirm a revoked session
   receives 403 on its next Workspace request.
2. Record visible Studio states for loading, empty results, success, unsupported
   exclusion, invalid required config, readiness blocked, revoked access, and
   corrected-file recovery.
3. Run one real canary through fresh reconciliation, content generation,
   narration, portrait and wide render, authenticated Range preview, digest-
   bound approval, publish, and one clip-usage commit.
4. Confirm legacy references remain available for status/playback only.
5. Enable new starts. Alert on storage, embedding/vector, reconciliation,
   mutation-audit, digest-integrity, or Worker-prefix failures.

## Disable and rollback

- On any invariant failure, disable new starts immediately. Do not fall back to
  compiled inputs or keyword/vector-only retrieval.
- Before enablement, rollback may use retained legacy inputs. After enablement,
  an old build must not generate until publication and clip-usage state has
  been exported and reconciled.
- Preserve both migrated and legacy files for investigation. Restore canonical
  content from the independent backup, not from editable readiness reports.
- Existing status/playback may remain up only when stored publication digests
  still match. A post-publication overwrite/delete is an integrity failure.

## Credential rotation and recurring recovery

1. Disable starts and wait for active signed Worker transfers to finish.
2. Create new Railway bucket credentials and update references in Mastra only,
   without logging values. Do not add the credentials to Shorts Worker.
3. Verify Workspace read/write/search, a fresh signed Worker transfer,
   authenticated Range playback, and backup export with the new credentials.
4. Revoke the old credentials and record actor, time, environment, verification
   evidence, and accepted bucket-wide access boundary.
5. Run daily immutable off-bucket backups and quarterly restore drills. Alert
   when the 24-hour RPO or 4-hour RTO cannot be met.

## Rolling deployment order

1. Keep `DEVOTIONAL_NEW_RUNS_ENABLED=false`.
2. Set Shorts Worker's non-secret
   `DEVOTIONAL_WORKSPACE_CAPABILITY_ORIGIN` to the exact HTTPS origin produced
   by Mastra's Workspace bucket, then deploy the capability-aware Worker. It
   accepts the legacy job shape during the rolling window but does not require
   Workspace S3 credentials.
3. Deploy Mastra with the signed transfer/finalization path and run the canary.
4. Remove any staged `DEVOTIONAL_WORKSPACE_S3_*` and
   `DEVOTIONAL_WORKSPACE_PREFIX` references from Shorts Worker. Keep the tuple
   only on Mastra. Removing variables before the old Worker revision is
   replaced can break that old revision, so verify the active deployment first.
