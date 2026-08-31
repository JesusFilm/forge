# feat-432 dashboard publication evidence

Status: **prepared locally; not published, verified, or accepted**

This record deliberately does not certify the feat-432 publication gate. It
records the locally reproducible publication boundary so an authorized operator
can append immutable deployment evidence after the reviewed commit reaches
`main`.

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

## External gates still required

An authorized operator must complete all of these before changing this record to
accepted or marking feat-432 complete:

1. Provision and prove a dedicated least-privilege production-read database
   principal, including rejected DDL and DML, without recording credentials.
2. Generate and validate a fresh production snapshot through Doppler target
   `forge-rag/prd`; CI and the Pages workflow must not receive the credential.
3. Produce passing identity-matched copied-local and Forge-production eval
   comparisons and commit only the redacted canonical receipt.
4. Confirm Forge project Pages ownership, project URL/base path, Actions source,
   and `github-pages` environment protection without displacing another site.
5. Merge the exact reviewed release commit through the normal PR flow and allow
   the repository workflow to publish it. Do not deploy a local worktree.
6. Record the main commit, assembled SHA-256 digest, workflow run and deployment
   IDs, reported public URL, and checked-at timestamp.
7. Browser-check the root and `/rag-status/`, reconcile visible counts to the
   compiled JSON, prove there are no runtime requests, and record the three-run
   transfer/request/DOMContentLoaded comparison defined in
   `apps/rag/docs/ops/dashboard.md`.
8. Confirm the page serves the certified commit independently of Railway health,
   then obtain repository-owner acceptance.

Until those facts are present, this file is preparation evidence only and must
not be consumed by feat-433 or later tickets as a migration gate.
