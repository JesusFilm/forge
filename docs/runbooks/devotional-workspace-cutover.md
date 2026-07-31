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
- Mastra and Shorts Worker reference the same dedicated Railway bucket values:
  `BUCKET`, `ENDPOINT`, `REGION`, `ACCESS_KEY_ID`, and `SECRET_ACCESS_KEY`.
- A separate immutable off-bucket backup has completed and its restore drill is
  recorded. Target RPO is 24 hours; target RTO is 4 hours.
- The operator manifest inventories every authored input, used-clip record,
  pending reservation, source-media reference, and retained artifact with size
  and SHA-256. It contains no credentials or source bodies.

## Stage and verify

1. Run the database migration and confirm the expected schema version.
2. Validate the migration manifest with
   `pnpm --filter @forge/mastra devo:workspace:migrate -- <manifest.json>`.
3. Copy into a unique immutable migration prefix. Never overwrite or delete a
   conflicting destination. Reruns must report existing identical objects as
   unchanged.
4. Compare source and destination counts, sizes, and streamed SHA-256 values.
5. Reconcile the Workspace catalog. Required scripture, reflections, and safety
   configuration must be eligible; BM25, vector storage, and the embedder must
   all report ready.
6. Verify Shorts Worker can read allowed source-media keys, create immutable
   attempt outputs, read them by Range, and reject traversal/wrong-prefix keys.
7. Record readiness in PostgreSQL against the exact manifest digest only after
   the backup restore drill and all checks pass. `_system/readiness/latest.json`
   is an editor-facing projection, not the authority.

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

1. Disable starts and wait for active Worker writes to finish.
2. Create new Railway bucket credentials and update references in both Mastra
   and Worker without logging values.
3. Verify Workspace read/write/search, Worker read/write/Range, and backup
   export with the new credentials.
4. Revoke the old credentials and record actor, time, environment, verification
   evidence, and accepted bucket-wide access boundary.
5. Run daily immutable off-bucket backups and quarterly restore drills. Alert
   when the 24-hour RPO or 4-hour RTO cannot be met.
