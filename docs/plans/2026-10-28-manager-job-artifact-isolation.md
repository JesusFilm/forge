# PR1087 graph source intent and job artifact isolation

Scope: dependent recovery unit from `87054b790`. The recovery integrator owns
roadmap status, the Docker workspace correction, full Manager HTTP → Admin
GraphQL → PostgreSQL proof, and final integration/review. No new roadmap ID,
Admin schema, SQL migration, cross-app import, provider request, or deployment
belongs to this unit. The source-acquisition sibling owns `source.ts` and
`source-mux.ts`; neither file changes here.

## Contract

Manager persists `options.enrichmentArtifacts` through the existing JSON options
contract:

```ts
{
  assetId: `enrichment-job-${sha256(job.id)}`,
  status: "preparing" | "ready",
  sourceVerified: boolean
}
```

The full SHA-256 job-id digest gives a stable, safe, 79-character storage prefix.
It is independent of Mux identity; two jobs referencing the same Mux asset never
share an enrichment artifact namespace. The existing bucket and storage clients
stay unchanged. Different runs of one job share its namespace under the existing
Admin in-flight-operation and current-owner fences; ambiguous claims continue to
block ownership replacement. No automatic same-run spending replay is added.

`prepareEnrichmentArtifactNamespace` reserves `preparing` using the job revision,
retiring any old run owner in that same CAS write. Admin's existing ownership
fence denies that write if an old operation is incomplete. Only the winning
preparation may copy files. Missing revisions or adapters that do not increment revisions fail
closed before copying. A second CAS changes it to `ready`; both writes finish
before Mastra accept/start. Preparation is never automatically repeated.

Legacy jobs without a binding keep their original Mux prefix for reads. During
preparation, Manager copies only declared downloadable artifacts resolved through
its existing fixed descriptor resolver. It never lists a bucket or accepts an
arbitrary storage path. Duplicate aliases are copied once. Bounds are 256
manifest entries, 64 MiB per object and 256 MiB total; streaming reads enforce the
byte limits while consuming the body. Missing, unsupported, oversized or length-inconsistent
objects stop preparation. The old manifest and source files remain intact, and
legacy reads stay on the original prefix until the complete copy becomes ready.
Partial preparation requires explicit reconciliation; dispatch fails closed.

Copying bytes establishes read compatibility, not source approval or historical
per-job ownership of bytes from the old shared prefix. Initial
`sourceVerified` is false, including when a legacy transcript parses correctly.
Only the current owned run's completed transcription callback declaring both
canonical `transcript` and `subtitles` sets it true. Manager dispatch omits legacy
source declarations until then. Subsequent automatic runs can reuse the validated
job-owned source via the existing source parser. Explicit Mux dispatch omits
source declarations, and the actual graph independently prioritizes explicit Mux
intent over any retained transcript/VTT. Explicit ElevenLabs and automatic source
language still fail honestly before spending in the Mastra graph.

The fixed Manager `run-admission` operation now requires:

```ts
{
  kind: "run-admission",
  assetId: string,
  muxAssetId: string,
  sourceReuse: "none" | "transcript" | "subtitles"
}
```

Mastra derives `sourceReuse` with the same function used by the actual graph.
Manager checks the persisted ready namespace against the job-id-derived prefix,
checks the actual Mux id, and denies requested source reuse unless the persisted
verification flag and corresponding downloadable manifest entry both exist.
Shared, stale, foreign or unbound namespaces fail before claiming or launching
providers. The admitted input digest already includes the namespace, explicit
provider intent and source declarations. No digest bypass or new bearer lane is
introduced. Deploy the two local HTTP contract changes together before enabling
the existing default-off flags.

Manager correction, cleanup, publication, signed downloads, manual Mux override,
and generated chapter/metadata review reads resolve the same ready namespace.
Legacy and preparing jobs keep their original reads. The legacy workflow launch
also uses an existing ready namespace after an engine rollback. Mastra's source,
translation, chapters, metadata, scene and embedding branches use input `assetId`;
Mux acquisition/publication continue to target `muxAssetId`. Isolation concerns
artifact storage, not ordering of independent jobs' external Mux publication to
an intentionally shared Mux asset.

## Regression evidence

The explicit-Mux regression first failed against the committed native workflow:
it selected `transcript_artifact` despite an explicit Mux request and existing
old transcript. It passes after the graph selection fix, using the real source
leaf with a deterministic Mux adapter and real artifact writes.

Two committed native graphs now overlap at real source acquisition for separate
jobs sharing one Mux asset. They finish with distinct source and translation
bytes, chapter/metadata files in their own namespaces, and job-owned embedding
inputs. A separate Manager integration test runs real correction/storage,
artifact GET and Mux publication code concurrently against two isolated jobs;
Mux HTTP and the CAS/operation ledger are deterministic adapters. It verifies
separate corrected transcripts, correct publication previews, per-job signed
artifact URLs and the bytes those URLs serve. Other regressions cover competing
preparations, partial-copy preservation, denied foreign/stale namespaces,
unverified legacy source reuse, callback provenance, automatic owned reuse,
explicit Mux pruning, manual override and review readers.

The base commit also contained a duplicate automation-store test import that
failed TypeScript and an automation registration test requiring its workflow to
be the first registration. The unit removes the duplicate and makes that
registration assertion independent of unrelated workflow order. Neither changes
automation execution.

Validation on Node 24.22.1 with the pinned Next 16.3.8 and Mastra core 1.64.0:

- `pnpm --filter @forge/manager run test --maxWorkers=4`: 1,709 passed,
  3 skipped (271 test files passed, 1 skipped).
- `pnpm --filter @forge/mastra run test --maxWorkers=4`: 4,119 passed,
  46 skipped (346 test files passed, 16 skipped).
- Both packages' `typecheck` and `lint --max-warnings=0`: pass.
- Whole-repository `pnpm run format:check` and `git diff --check`: pass.
- The final commit uses the enabled lint-staged, repository format and commitlint
  hooks; the handoff records their actual result.

The generated review-context reader retains exactly two artifact reads in its
regression; the namespace selection adds no page-loading requests. A legacy
workflow rollback must validate any existing binding and cannot bypass a
consumed preparation by writing into the old shared prefix.
These deterministic proofs make no paid-provider or production/S3 availability
claim. They do not replace the integrator's real HTTP/GraphQL/PostgreSQL receipt
or an independent review of the integrated head. No push, merge, activation or
deployment is authorized by this completion.
