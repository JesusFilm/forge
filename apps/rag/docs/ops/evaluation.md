# RAG retrieval evaluation operations

The Forge evaluation is retrieval-only. It proves that the same corpus and
retrieval configuration continue to return the reviewed relevant documents; it
does not judge generated answers or consumer policy. Detailed attempts are
written beneath ignored `eval/attempts/`. Only reviewed, redacted comparison
evidence belongs in `docs/roadmap/rag/evidence/`.

## Comparison contract

The retained pre-copy control contains 416 cases with recall@10 `1.000` and
coverage `0.887`. Compare it only with `--case-set control-2026-08-06`; the nine
newer cases in the 425-case golden file are deliberately excluded from that
identity. A `current` run needs a new identity-matched control.

Before applying the two-percent relative tolerance, `eval:compare` requires
identical canonical selected golden cases, ordered case set, registry, corpus
revision, embedding model, query instruction, top-k, score floor, and metric
implementation. An
identity mismatch is `refused`, not a failed metric run. At matching identity,
the provisional primary floors are recall@10 `0.980` and coverage `0.86926`.
An exact two-percent regression passes; anything beyond it fails. Every per-case
loss must also have one of the bounded dispositions accepted by the comparator.

## Run the local copied corpus

Use the approved local environment without printing its values. Set
`JFRAG_EVAL_CORPUS_REVISION` to the reviewed, non-secret corpus-copy identity
used by both candidates, then run:

```sh
pnpm --filter @forge/rag eval --case-set control-2026-08-06
```

The command prints only the attempt path. Keep that JSON untracked and inspect
it locally. It contains case IDs, ranks, and counts, but no questions, URLs,
retrieved text, scores, embeddings, or credentials.

## Run Forge production read-only

Production access requires fresh authority for the exact `forge-rag/prd`
`production-read` target. The database credential must belong to the dedicated
least-privilege evaluation/dashboard principal, and the operator must first
have evidence that it cannot perform DDL or DML. Inject values directly from
Doppler; do not retrieve or echo them:

```sh
doppler run --project forge-rag --config prd -- \
  pnpm --filter @forge/rag env:check production-read
doppler run --project forge-rag --config prd -- \
  pnpm --filter @forge/rag eval:production --case-set control-2026-08-06
```

Stop if target validation fails, the expected database host is absent, the
read-only principal has not been provisioned and tested, or the local and
production runs cannot use the same non-secret corpus revision.

## Compare and promote evidence

Run the comparator separately for the retained control versus the copied-local
attempt and the retained control versus the Forge-production attempt:

```sh
pnpm --filter @forge/rag eval:compare \
  /approved/path/control.json apps/rag/eval/attempts/local-RUN.json
pnpm --filter @forge/rag eval:compare \
  /approved/path/control.json apps/rag/eval/attempts/production-read-RUN.json
```

If losses exist, create an operator-local YAML map from case ID to one of
`ranking-only`, `relevance-set-correction`, `approved-corpus-change`,
`retrieval-regression`, or `unresolved`, and pass it as the optional third
argument. Never replace those values with free-form explanations. A comparison
that is `refused` or `fail` must not be promoted as passing evidence.

After both comparisons pass, create the canonical redacted
`docs/roadmap/rag/evidence/feat-432/eval-comparison.json` from aggregate
identity, metrics, floors, dispositions, and run provenance only. Before commit,
scan it for questions, hit content, URLs, connection strings, tokens, keys,
embeddings, raw errors, and local absolute paths. Approval of canonical golden
case changes is a separate capability and is never implied by running an eval.

## Failure handling

- `refused`: reconcile identity; do not weaken or omit an identity field.
- metric `fail`: investigate corpus and retrieval behavior; do not change the
  control, tolerance, or golden expectations to make the run pass.
- unresolved case loss: inspect detailed attempts locally and assign a truthful
  bounded disposition; `retrieval-regression` remains failing.
- interrupted run: discard the incomplete attempt and rerun. Atomic, unique run
  IDs prevent another local or production attempt from being overwritten.
