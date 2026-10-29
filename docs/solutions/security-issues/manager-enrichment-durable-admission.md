---
module: apps/manager
problem_type: security_issue
component: enrichment_execution
tags:
  - manager
  - mastra
  - run-ownership
  - idempotency
related_features:
  - feat-788
---

# Durable enrichment admission and fixed Manager operations

Accepting a run ID without persisting its input binding allowed arbitrary starts,
changed-input starts, and repeated spending after transport loss. New dispatches
also kept failed step states, so a new valid run could never repair those steps.

The Mastra accept route now persists the server-minted run ID, job ID, and stable
SHA-256 input digest in `enrichment_admission.runs` before acknowledging. Migration
`apps/mastra/migrations/005-enrichment-admission.sql` supplies this isolated ledger.
Start atomically consumes an accepted reservation, rejects changed identities and
inputs, and checks Manager admission before launching. Completed start handoffs
acknowledge duplicates without launching again. A starting or ambiguous handoff
stays consumed across process restarts. Unstarted reservations expire after 24
hours; that expiry never permits replay of consumed work. Recovery creates a new
run only after reconciling any ambiguous external operation.

Manager's `/api/internal/enrichment-execution` uses the callback service bearer
lane, with admin-trigger keys remaining disjoint, authenticated parsing and a
64-KiB streaming request limit. Requests carry `jobId`, `runId`, `inputDigest` and
one strict `operation`:

- `run-admission`: canonical `assetId` and `muxAssetId` must match the job.
- `audio-cleanup`: targets come from the persisted job.
- `apply-transcript-corrections`: bounded Mastra judgments are applied using
  Manager's existing exact-match guards to the canonical stored transcript.
- `mux-publication`: at most 50 owned language results; Manager resolves artifact
  keys and persists the Mux report before the caller evaluates comparison failure.

The bridge calls Admin's `claimManagerExecutionOperation` with fixed operation ID
and stable operation digest. Admin must atomically check engine, current run and
nonterminal job; bind the immutable run input digest; serialize operation claims;
and deny ownership replacement while a claim is in flight. A preliminary Manager
read alone is not distributed fencing. Completed identical operations replay the
bounded result. In-flight, changed-input, and stale operations cannot spend.
`completeManagerExecutionOperation` receives the same fence, claim token and
bounded result and returns `status: "replayed"` on successful completion. An
uncertain provider or completion outcome leaves its claim consumed. The bridge
never releases an ambiguous claim or automatically retries paid side effects.

New-run dispatch clears step states, errors and callback sequences. Re-dispatch
of the same run is an idempotent read that preserves terminal state. Same-run
step transitions remain monotone. Callbacks permit only step-owned correction,
raw, canonical, translation and validation artifacts; language artifacts and
metadata require job-owned language codes. Each callback supports 50 language
results and 151 artifact keys, with the 64-KiB HTTP and sender limits unchanged.
Large failures must be summarized before sending. Strict schemas admit child-run
correlation, correction/validation summaries, routing host/attempt metadata and
Mux reports without granting arbitrary artifact-metadata writes. URLs and raw
transcription bodies are outside the routing callback contract.

Callback delivery retries the identical run/step/sequence at most four times,
within 90 seconds, for network errors and 429/503. It honors `Retry-After` only
when it fits the remaining budget, rejects redirects, and bounds acknowledgement
reads to 4 KiB. An applied callback or duplicate sequence receipt is success;
other dropped callbacks stop the runner as lost ownership. Check duplicate
sequence before terminal-job rejection so a lost terminal-success response can be
retried without falsely failing the workflow.

Tests reproduced the original dispatch/contract/retry failures. A disposable
PostgreSQL test used two independent pools and eight competing starts, finding
exactly one winner; digest changes, restart adapters, ambiguous starts and expired
reservations were also checked. Deterministic local artifact tests preserve raw
bytes and verify corrected canonical transcript/VTT output. These are not paid
provider, production ingress, or full Admin-to-Manager live-path proofs. Root
integration owns the Admin schema/atomic ledger, generated contracts and the later
execution graph. The subsequent graph unit replaces the fail-only registration; see
`docs/plans/2026-10-28-manager-enrichment-graph.md`. Both
engine flags remain default-off. Every later provider-spending graph step must
obtain an operation-specific ownership claim; the initial run-admission receipt
alone cannot fence subsequent provider calls.

The graph bridge adds fixed `mastra-stage-claim` and `mastra-stage-complete`
operations for source, correction, translation, chapters, metadata, embeddings,
and optional scene analysis. The ledger identity is `mastra:<stage>` with a
SHA-256 digest of stage inputs. The separate completion request checks current
ownership again and supplies the claim token plus a bounded status receipt.
Different stage claims may run concurrently; any incomplete claim continues to
block ownership transfer and terminal status. A generic exception, timeout, or
lost completion response leaves the claim consumed. Stage-local provider context
also catches transport errors swallowed by advisory correction/translation/scene
services. Reconciliation is manual; a replayed completed claim never authorizes
another provider call. Terminal callback waits for every parallel branch and all
stage completions. The graph's deterministic local HTTP test proves artifact and
transport contracts, not actual Admin database persistence or production traffic.

A real embeddings result uses `sourceContentHash: "sha256:<hex>"`. Both local
callback schemas accept that precise form alongside legacy bare SHA-256 hex;
keep the producer value intact rather than rewriting its provenance in the graph.
