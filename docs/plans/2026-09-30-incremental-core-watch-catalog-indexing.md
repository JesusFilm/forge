# Incremental Core-to-Watch catalog indexing

1. Capture source changes in a durable per-video queue. Child media and
   relation changes also queue affected containers. Keep queue entries until
   their exact revision is applied; retries re-read current source state.
2. Bootstrap a separately owned live catalog from the existing projection,
   preserving the qualified Candidate as the engine baseline and fallback.
   Rebuild the live catalog only when absent or contract-incompatible.
3. For each queued video, build catalog, availability, and lexical documents
   from a bounded source query. Compare against persisted fingerprints, remove stale
   children, and write only changed documents. Recheck concurrent queue
   revisions before acknowledging. Refresh curation pins from only their
   target videos. Keep manifest and Web delivery independent.
4. Test projection scope, deletion, retries, coalescing, and baseline safety.
   Verify formatting, lint, and TypeScript.

Focused tests: `apps/admin/src/services/watch-catalog-live-index.test.ts`
checks one-video scope, no-op writes, an uncheckpointed value that reverts,
and uncheckpointed child removal. `watch-catalog-publication-worker.test.ts`
checks request coalescing, retry, and independent Web delivery.
`core-sync/phases/sync-videos.core-auth.test.ts` checks the public Core
eligibility query. The ID scan must reject a count mismatch and never remove
CORE rows after an incomplete page. The bootstrap and retirement tests keep
concurrent dirty revisions and draining collections. Fresh build identities
avoid reusing a collection while a reader may still hold its name.

Live content collections are mutable and separately owned. Readers can see a
brief mixed per-video state during a multi-collection write or worker crash;
the durable intent ledger and queue guarantee convergence on retry. This is
eventual consistency, not snapshot isolation. Qualified Candidate generations
remain immutable, and SERVING/EVALUATION pointers never move during sync.
The private SERVING probe runs under the publication lock for live content;
EVALUATION retains its immutable Candidate lease.
