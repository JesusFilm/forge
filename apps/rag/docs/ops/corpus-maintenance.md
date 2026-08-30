# Corpus maintenance operations

These commands are the Forge equivalents of the legacy RAG acquire, ingest,
reindex, language-repair, and schema-check scripts. They operate on the
Forge-owned RAG database. They do not copy or rebuild the legacy production
corpus.

## Safety contract

- Start with one named source and a small limit. Do not run a full-corpus
  acquisition, index, reindex, or language sweep as part of migration issue
  `JesusFilm/jesusfilm-rag#164`.
- Every index invocation must name exactly one scope: `--source <source-key>`
  or the deliberately explicit `--all`.
- Every production index or language write must include an explicit positive
  `--limit`. Production `--force-all` is therefore refused; use bounded
  resumable `--force` batches. A production reversal also refuses a changelog
  containing more rows than its explicit limit. Production language sweeps are
  source-scoped because a per-source limit would not bound an `--all` run.
- Omit `--apply` for a dry run. A write requires `--apply`; production writes
  additionally require `--production`, exact `JFRAG_ALLOW_PROD_WRITE=1`, and an
  exact `JFRAG_EXPECTED_POSTGRES_HOST` match.
- Inject production values from Doppler `forge-rag/prd`. Never paste or print a
  database URL, provider key, Firecrawl key, corpus text, or changelog content.
- Keep concurrency at or below four. Prefer `--resume` for interrupted
  acquisition and ordinary `--force` for an interrupted model migration.
  `--force-all` deliberately bypasses the model-aware resume gate and requires
  explicit operator justification.
- Production code reaches Railway only through PR-to-main autodeploy. These
  maintenance commands do not authorize `railway up` or another direct deploy.

Run the environment preflight before any production command:

```sh
doppler run --project forge-rag --config prd -- \
  pnpm --filter @forge/rag env:check production-write
```

The preflight reports names and status only. For read-only inspection use the
`production-read` target instead.

## DNS-rebinding decision

The direct HTTP adapter checks that a destination resolves only to public
addresses before each request and repeats that check for every redirect. It
does not pin the validated address to Node's later connection lookup. The team
accepts that DNS time-of-check/time-of-use residual risk for the current
maintenance surface because URLs come only from reviewed, compiled registry
entries and commands are operator-run; no public or runtime-configured URL can
reach the fetcher.

This acceptance is narrow. Protocol, URL credentials, source allow patterns,
redirect destinations, and private/reserved addresses remain fail-closed. Add
connection-level address pinning or route acquisition through an egress proxy
before introducing runtime-managed sources, public URL input, or deployment in
a network where crawler egress can reach sensitive internal services. A
registered domain transfer, expiry, or DNS compromise is also a reason to stop
that source until its ownership and resolution are re-verified.

## Acquire and stage

Dry-run one source first, then repeat with the write gate. `--resume` excludes
canonical URLs already staged and is the Forge equivalent of resuming an
interrupted acquisition.

```sh
pnpm --filter @forge/rag acquire --source <source-key> --dry-run
pnpm --filter @forge/rag acquire --source <source-key> --resume --apply
```

For production, inject the namespaced database/provider values through Doppler:

```sh
doppler run --project forge-rag --config prd -- \
  pnpm --filter @forge/rag acquire:production --source <source-key> --resume --apply
```

If and only if the registry entry selects `fetchStrategy: "firecrawl"`, ensure
`FIRECRAWL_API_KEY` exists in that Doppler config before the preflight. The key
is injected into the operator process; it is not copied into Railway merely to
run acquisition. A source using plain HTTP does not require Firecrawl.

## Index and reindex

An ordinary index drains pending staging rows. Start with a source and limit:

```sh
pnpm --filter @forge/rag index --source <source-key> --limit 10
pnpm --filter @forge/rag index --source <source-key> --limit 10 --apply
```

The first command connects read-only and reports the actual bounded candidate
count and staging-row IDs for the requested source/model selection; it does not
embed, mark staging rows, or write corpus data. The applied run embeds, writes
the corpus, and records the canonical embedding model on each embedding row.
Document/chunk replacement and the staging row's attempted-model state commit
in the same database transaction, so overlapping model runs cannot leave one
model's vectors paired with another run's completion marker. Repeating an
ordinary run drains no already-ingested staging rows, and unchanged content is
deduplicated by content hash.

Source-scoped reindexing is the Forge equivalent of the legacy reindex command:

```sh
pnpm --filter @forge/rag index --source <source-key> --limit 10 --force
pnpm --filter @forge/rag index --source <source-key> --limit 10 --force --apply
```

`--force` re-reads ingested staging rows but skips documents already stored with
the target `EMBED_MODEL_ID`, so a model migration can be resumed safely. The
model filter is applied before `--limit`, which means repeated bounded runs
advance through old-model documents instead of repeatedly selecting the oldest
already-migrated rows. A fresh un-ingested snapshot is always eligible even when
the existing document already uses the target model. If an old-model snapshot
cannot produce indexable content, its attempted model is recorded so it cannot
occupy every later bounded batch; investigate the reported skipped row before
retrying it under a different model or with corrected source content.
`--force-all` re-embeds even rows already on that model and should be reserved
for an intentional same-model chunker rebuild. It cannot be combined with
`--limit`: without persisted run state, bounded force-all runs would repeatedly
select the same prefix. For production, use
`index:production` with an explicit `--limit` under the same Doppler injection
and write preflight shown
above. Record source key, limit, model identifier, summary counts, and pass/fail
only.

## Language sweep and guarded reversal

Default to blank-language rows, one source, a small limit, and dry run:

```sh
pnpm --filter @forge/rag language:sweep --source <source-key> --mode blanks --limit 10
pnpm --filter @forge/rag language:sweep --source <source-key> --mode blanks --limit 10 --apply --out-dir <secure-output-dir>
```

An applied sweep writes each language change and its immutable audit row in one
database transaction, then exports the committed rows to a JSONL changelog.
Both records contain row identifiers, old/new languages, source keys,
detector-model provenance, and the printed `auditRunId`. Treat them as
restricted operational data: keep the JSONL outside the repository and do not
paste either record set into logs or tickets. If JSONL export fails, the command
performs a compare-and-set compensating reversal and exits non-zero. If the
process terminates after the transaction but before export, recover the exact
committed set by `auditRunId` from `language_change_audits` before attempting a
reversal.

`--mode full` revisits already labelled rows. Continue a bounded source sweep
with the `nextCursor` from the previous summary:

```sh
pnpm --filter @forge/rag language:sweep --source <source-key> --mode full --limit 10 --after-id <nextCursor>
```

The command rejects `--all --mode full --limit`: cursors are source-scoped, so
that combination would rescan the same prefix. Run each source separately when
a full sweep must be bounded.

Read-only audit recovery query:

```sql
SELECT document_id, source_key, old_language, new_language, detector_model
FROM language_change_audits
WHERE run_id = '<auditRunId>'
ORDER BY created_at, document_id;
```

Reverse exactly a reviewed changelog with an initial dry run:

```sh
pnpm --filter @forge/rag language:sweep --revert <changelog.jsonl>
pnpm --filter @forge/rag language:sweep --revert <changelog.jsonl> --apply
```

Reversal validates every JSONL record before querying or writing. Its dry run
executes the same compare-and-set predicate and reports reversible and refused
counts. A row changes only when its current language still equals the
changelog's proposed language. Production uses
`language:sweep:production` under Doppler injection and the production write
gate. Archive or destroy the changelog according to the approved evidence
policy after the rollback window closes.

For production apply, add a positive `--limit` to both sweeps and reversals.
The reversal refuses the entire operation when the validated changelog exceeds
that cap; it never silently truncates the requested rollback.

## Prisma migration and checks

Forge replacements for the legacy migration/check scripts are:

```sh
pnpm --filter @forge/rag db:generate
pnpm --filter @forge/rag db:schema:check
pnpm --filter @forge/rag db:migrate:deploy
pnpm --filter @forge/rag db:migrate:status
pnpm --filter @forge/rag db:drift:check
pnpm --filter @forge/rag db:verify
```

`db:verify` is the real-Postgres adapter integration suite and intentionally
fails rather than skips when `DATABASE_URL` is absent. Follow
[`postgres-and-schema.md`](postgres-and-schema.md) for the fresh-database,
idempotent second migration, drift, metadata-only production proof, and
rollback procedure.

## Completion evidence

For a bounded rehearsal, retain only command, source key, requested limit,
model identifier, summary counts, and pass/fail. Confirm that a repeated index
is empty or unchanged, embedding rows report the intended model, and no
full-corpus command was run. Never retain secret values, database URLs, raw
exceptions, corpus text, or language changelog rows in the evidence.
