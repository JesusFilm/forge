# Corpus maintenance operations

These commands are the Forge equivalents of the legacy RAG acquire, ingest,
reindex, language-repair, and schema-check scripts. They operate on the
Forge-owned RAG database. They do not copy or rebuild the legacy production
corpus.

## Safety contract

- Start with one named source and a small limit. Do not run a full-corpus
  acquisition, index, reindex, or language sweep as part of migration issue
  `JesusFilm/jesusfilm-rag#164`.
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

The first command is a dry run. The applied run embeds, writes the corpus, and
records the canonical embedding model on each embedding row. Repeating an
ordinary run drains no already-ingested staging rows, and unchanged content is
deduplicated by content hash.

Source-scoped reindexing is the Forge equivalent of the legacy reindex command:

```sh
pnpm --filter @forge/rag index --source <source-key> --limit 10 --force
pnpm --filter @forge/rag index --source <source-key> --limit 10 --force --apply
```

`--force` re-reads ingested staging rows but skips documents already stored with
the target `EMBED_MODEL_ID`, so a model migration can be resumed safely.
`--force-all` re-embeds even rows already on that model and should be reserved
for an intentional same-model chunker rebuild. For production, use
`index:production` under the same Doppler injection and write preflight shown
above. Record source key, limit, model identifier, summary counts, and pass/fail
only.

## Language sweep and guarded reversal

Default to blank-language rows, one source, a small limit, and dry run:

```sh
pnpm --filter @forge/rag language:sweep --source <source-key> --mode blanks --limit 10
pnpm --filter @forge/rag language:sweep --source <source-key> --mode blanks --limit 10 --apply --out-dir <secure-output-dir>
```

An applied sweep writes a JSONL changelog containing row identifiers, old/new
languages, source keys, and detector-model provenance. Treat it as restricted
operational data: keep it outside the repository and do not paste it into logs
or tickets. `--mode full` revisits already labelled rows; use it only for a
bounded, approved repair.

Reverse exactly a reviewed changelog with an initial dry run:

```sh
pnpm --filter @forge/rag language:sweep --revert <changelog.jsonl>
pnpm --filter @forge/rag language:sweep --revert <changelog.jsonl> --apply
```

Reversal is compare-and-set guarded: a row changes only when its current
language still equals the changelog's proposed language. Production uses
`language:sweep:production` under Doppler injection and the production write
gate. Archive or destroy the changelog according to the approved evidence
policy after the rollback window closes.

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
