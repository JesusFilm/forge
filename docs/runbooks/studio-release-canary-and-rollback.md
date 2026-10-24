# Shorts release, canary and rollback

Shorts has its own authoring and release records. `VideoDub.shorts` links existing input dubs to zero or more Shorts; standalone Shorts may have no parent dub. Rendering and publication never create Video, VideoDub, VideoEdition, VideoLocale, VideoImage or MuxVideo output records. Watch is unchanged.

## Source and database

Use the normal reviewed PR-to-main deployment flow. Apply Admin `0094_shorts` and native `004-shorts-agent-execution.sql` through their respective migration runners. These replace unshipped migrations; disposable development databases with older migration histories should be recreated, not silently relabeled. Existing main migrations are unchanged.

The current creation API accepts optional `sourceVideoDubId`. The relationship is non-unique and immutable after creation. Exact source snapshots retain the composition's provenance independently of this parent relationship. Releases own title, language, dimensions, duration, output evidence and signed Mux identifiers.

## Install while disabled

1. Keep Admin `STUDIO_PRODUCTION_ENABLED=false` and `STUDIO_PUBLICATION_ENABLED=false`. Also keep the Manager render pool, native agent and Mux processing disabled until their named checks pass. Reads, editing, settlement and revocation remain available.
2. Configure durable Admin asset storage and authenticated HTTPS Manager `/api/shorts/render-pool` access. Worker keys and exact-lease capabilities are separate from user OAuth and generic Manager credentials.
3. Follow `apps/studio-render/ops/release/README.md` for reviewed artifact acquisition and `apps/studio-render/ops/README.md` for VM installation, drain, switch and rollback. The VM makes outbound requests; there is no public Docker socket, CI SSH deployment or untrusted CI runner on the VM.
4. Preload explicitly approved image digests and install a verified host bundle inactive. Missing artifacts fail closed. Do not claim existing retained images or bundles prove this renamed source is deployed.
5. Verify the actual source-review policy, release approval and candidate digest before any hosted publication or VM selection. The release workflow remains disabled until owner setup is complete.

## Bounded canary

Use one explicitly authorized fixture and budget. Check create/edit, retained proposal review, render claim, disposable render and separate verification, durable output retention, and canonical finish. Verify actual process containment and cleanup, not just requested container settings. Exercise cancellation/restart using the original lease and deadline; ambiguous operations must not be retried as new work.

For publication, use the exact retained render, interactive human approval and fresh same-release readiness. Check Short-owned publication and subsequent-request revocation through its playback endpoint. A scheduled retry uses its retained immutable envelope and accepted receipt. There is no Watch route registration, indexing or cache invalidation step.

Creative/provider quality, narration, durable production storage, actual signed provider playback, operator authentication and production configuration each require their own concrete acceptance. Local fixtures and historical logs do not establish those outcomes.

## Stop and rollback

Disable new production/publication admissions, then drain the VM before switching to an explicitly selected previously verified bundle. Process configuration takes effect only after the relevant process restarts; it is not instantaneous fleet revocation. Already consumed work keeps its settlement and retention paths.

Cancel unconsumed schedules explicitly where required. Disablement does not erase existing receipts, reset deadlines or undo completed publication. Use permanent unpublish to revoke a Short; preserve its immutable release and retained assets. Keep the receiver, storage and revocation path available while draining.

Treat an uncertain switch or unfinished physical cleanup as unavailable capacity until reconciled. Do not delete unknown runtime identities or blindly retry provider actions. No production deployment, account mutation or paid action is implied by this runbook.

## Mux transfer

The trusted VM uploads verified local output directly to a Mux Direct Upload URL after canonical render settlement. Manager supplies only a scoped upload URL and observes processing; Mux no longer fetches from Forge storage. Forge retains its review/download copy. Keep upload identity across retries; unresolved window expiry retains the local file and quarantines that cycle for reconciliation. See `apps/studio-render/ops/README.md`.
