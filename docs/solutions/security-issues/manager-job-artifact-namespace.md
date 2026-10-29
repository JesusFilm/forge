---
module: apps/manager
problem_type: security_issue
component: enrichment_artifact_storage
tags:
  - manager
  - mastra
  - artifact-isolation
  - run-ownership
  - revision-cas
related_features:
  - feat-909
---

# Job claims must own their artifact namespace

An atomic job/run operation claim prevents two owners spending for one job. It
does not isolate two legitimate jobs that write `{muxAssetId}/transcript.json` in
the same bucket. Shared Mux identity is an acquisition/publication target, not
artifact ownership.

Manager now prepares a deterministic job-owned namespace in existing JSON
options before Mastra accept/start. A revision-checked preparation latch reserves
copy ownership; a second revision-checked write activates the namespace. Retiring
the old run also invokes Admin's incomplete-operation fence. Missing/partial
copies remain consumed for explicit reconciliation, with legacy reads intact.
The shared bucket stays unchanged, and no new Admin field/migration is needed.

Copy only manifest-declared fixed descriptors through bounded Manager-owned
storage reads. Do not make Mastra search arbitrary legacy prefixes. Preserving
legacy bytes does not approve their source provenance: the initial verification
flag is false. The owned source-completion callback establishes verified source
for later reuse; admission checks that flag, the source declaration, the actual
Mux id and the deterministic persisted namespace. Existing cue validation still
checks reusable source bytes.

Explicit source intent must also reach the execution graph. Clearing derived
outputs alone leaves a retained transcript eligible for reuse. The graph and
start admission now share the same source-selection function: explicit Mux
always reacquires; automatic intent may reuse verified job-owned source.
Manager's transcription rerun removes canonical source declarations as well.
Explicit ElevenLabs and automatic source language retain their honest
pre-spend failures in the Mastra engine.

Every reader must resolve the same canonical prefix: cleanup, exact-match
correction, Mux publication, signed downloads, manual Mux overrides and generated
chapter/metadata review. After an engine rollback, legacy workflow execution
must retain an already prepared namespace too.

The regressions execute concurrent committed graphs and real leaf artifact
writes, plus real Manager correction/download/publication readers with
simulated Mux and persistence adapters. These are local artifact/contract
proofs, not a paid-provider, production S3 or real Admin database proof. The
integrator separately owns the full HTTP/GraphQL/PostgreSQL receipt. Exact
interfaces, preparation limits and rollout conditions are documented in
`docs/plans/2026-10-28-manager-job-artifact-isolation.md`.
