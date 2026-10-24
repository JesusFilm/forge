# feat-432 dashboard publication evidence

Status: **published and reachability-verified; detailed performance verification
and repository-owner acceptance are not recorded**

This record distinguishes the publication that subsequently occurred from the
broader acceptance checks that were never committed. It must not be read as a
completed performance comparison or repository-owner acceptance.

## Published deployment

- Workflow run:
  [`33469924736`](https://github.com/JesusFilm/forge/actions/runs/33469924736)
  (`verify` and `deploy` both succeeded on 2026-09-01).
- Published commit recorded by the workflow:
  `3cc4a88dfa507ef76119ad1bb3eccc6378bb2b76`.
- Assembled artifact digest:
  `sha256:4b313a002bd290d58b0731517d9457e66decf4323eef286d55df956b78401648`.
- Reported project URL: `https://jesusfilm.github.io/forge/`.
- Basic recovery audit on 2026-09-04: both the project root and
  `/forge/rag-status/` returned HTTP 200, and the dashboard provenance artifact
  was reachable. This was a reachability/provenance check, not the three-run
  browser performance comparison required below.

## Locally established boundary

- Publisher: the sole `.github/workflows/rag-pages.yml` workflow.
- Manifest: `docs/pages/manifest.yaml`.
- RAG public subpath: `/rag-status/`.
- Inputs: committed static files only; the workflow has no production database
  credential and does not query production.
- Release authority: merge of the exact reviewed Pages-scoped commit, followed
  by any repository-owner approval required by the protected `github-pages`
  environment.
- Rollback: reviewed revert or restoration of the complete last-known-good site
  through `main`; owner-only unpublish is reserved for sensitive-content
  containment.

The local verification commands and resulting candidate digest are intentionally
not described as deployment evidence:

```sh
pnpm --filter @forge/rag dashboard:build
pnpm --filter @forge/rag dashboard:verify
candidate_dir="$(mktemp -d)/site"
pnpm --filter @forge/rag pages:assemble -- "$candidate_dir"
```

On 2026-09-01, those checks passed on the reviewed working tree based on
`c7ec5f56ba7fb8144810315447849a11d5ab0fdc`. The verifier reconciled 59 canonical
source rows, 12 documented rows, and 4 unclassified rows. The assembler emitted
exactly `index.html`, `rag-status/.dashboard-commit.json`, and
`rag-status/index.html`, with candidate tree digest
`sha256:b8587773a26de60fa918322bd6f9fe42368056d130ef94bb04ad951a73f31e27`.
This digest is local preparation evidence; a later release must record and match
the digest produced from its exact reviewed commit.

## Acceptance evidence still unavailable

The original receipt required the following evidence, but it was not committed
before feat-432 closed:

1. Provision and prove a dedicated least-privilege production-read database
   principal, including rejected DDL and DML, without recording credentials.
2. Generate and validate a fresh production snapshot through Doppler target
   `forge-rag/prd`; CI and the Pages workflow must not receive the credential.
3. Produce passing identity-matched copied-local and Forge-production eval
   comparisons and commit only the redacted canonical receipt.
4. Confirm Forge project Pages ownership, project URL/base path, Actions source,
   and `github-pages` environment protection without displacing another site.
5. Browser-check the root and `/rag-status/`, reconcile visible counts to the
   compiled JSON, prove there are no runtime requests, and record the three-run
   transfer/request/DOMContentLoaded comparison defined in
   `apps/rag/docs/ops/dashboard.md`.
6. Confirm the page serves the certified commit independently of Railway health,
   then obtain repository-owner acceptance.

The publication facts above repair the stale claim that the page was never
published. The missing acceptance evidence is not reconstructed from memory.
`feat-435` must establish any quality or operational proof needed for final
retirement using a new observed run.
