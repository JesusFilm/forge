# Import an editorial list into saved recommendation comparisons

The adapter imports existing choices through Admin's deployed protocol-1
`start` / `source` / `complete` producer contract. It makes no model calls,
does not create fake model-call or transcript receipts, and never changes an
existing generation. The input is a new `content_only` generation labeled
`codex-editorial-session`, with explicit metadata evidence.
The empty import model-call ledger does not mean curation consumed zero tokens:
the originating Codex conversation's usage is recorded separately. This adapter
only transfers existing decisions and creates no additional inference calls.

This is a compatibility adapter for saved-list comparison and private A/B
selection. It does not claim execution by the newer `full-library-v1` producer
or transplant its private artifacts, usage receipts, or subtitle references.
Existing Admin review and private visit admission already accept complete saved
generations regardless of which producer authored their lists.

## Prepare without writes

From `apps/admin`, using the target Admin's normal validated environment and
database credentials, run:

```sh
pnpm exec tsx --tsconfig tsconfig.json scripts/import-editorial-recommendations.ts \
  --source ../../docs/recommendations/editorial-2026-10-19/recommendations.json \
  --generation editorial-catalog-20261019-v1 \
  --cutoff 2026-10-19T03:02:29.357Z \
  --plan ../../output/editorial-import/plan.json \
  --report ../../output/editorial-import/preflight.json
```

Create the output directory first. For a new generation, use its own fresh
generation ID, a current UTC cutoff, and new output paths. The example cutoff
identifies this import; it is not a reusable fresh cutoff. Ready profile state
does not establish source quality. The five flagged evidence mismatches retain
empty source rows until verified. Their coverage is explicit rather than absent.

The read-only preflight calls the existing `validatePrecomputedChoices` function
for at most four sources concurrently, retaining the input source order.
Where a source's six choices conflict with the producer's canonical identity
rules, it admits the first valid choices in their original editorial order,
records every exclusion, and closes rank gaps. It supplies the original set
rationale as parent/chapter added viewing value. It never generates replacement
recommendations or relaxes the producer's checks. Unexpected infrastructure
errors abort preparation. Inspect all reported omissions before executing.

## Execute or explicitly resume the same plan

```sh
pnpm exec tsx --tsconfig tsconfig.json scripts/import-editorial-recommendations.ts \
  --execute \
  --endpoint https://admin.jesusfilm.org/api/internal/mastra/precomputed-recommendations \
  --plan ../../output/editorial-import/plan.json \
  --report ../../output/editorial-import/receipt.json
```

The HTTPS endpoint must match `ADMIN_BASE_URL`. The credential comes from
`MASTRA_RECOMMENDATION_INGEST_API_KEYS`; never put it in arguments or artifacts.
The manifest digest binds the complete plan, including artifact bytes, original
profile generation, review basis, cutoff, admitted decisions and exclusions.
The source-set digest uses JavaScript's default sorted ID order. Execution sends
at most four requests concurrently. A failed write stops new dispatch and drains
already-started requests; it does not automatically retry or mark the generation
complete. An operator may explicitly rerun the same immutable plan with a new
receipt path. The deployed contract makes exact replays idempotent and rejects
changed decisions, generation collisions, retired IDs, or stale input. Do not
move a cutoff or alter a plan to bypass a rejection; prepare a new generation.

Verify completion and persisted source/link counts, then compare the new
generation at `/dashboard/recommendations/precomputed?generation=GENERATION_ID&source=VIDEO_ID&audio=english`.
The existing private A/B configuration at
`/dashboard/recommendations/precomputed/visits` can select the completed
generation. Creating an experiment and enabling public traffic remain separate
operator decisions; the importer does neither. Current language, publication,
visibility and playback checks still apply on delivery, so six stored choices
do not guarantee six playable cards in every locale.
