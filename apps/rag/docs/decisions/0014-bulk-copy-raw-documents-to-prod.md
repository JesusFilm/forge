# ADR-0014 — Bulk-copy `raw_documents` local→prod: an optional promotion path for walled/metered sources

- Status: Accepted decision; standalone `copy-raws.sh` mechanics are
  Forge-superseded by the bounded `raws:promote` command.
- Date: 2026-07-28
- Issue/PR: [#115](https://github.com/JesusFilm/jesusfilm-rag/issues/115) (spec) · [#120](https://github.com/JesusFilm/jesusfilm-rag/pull/120) (mechanism) · part of [#112](https://github.com/JesusFilm/jesusfilm-rag/issues/112)
- Related: [ADR-0012](./0012-firecrawl-fetch-strategy-walled-sources.md) (walled-source fetch via Firecrawl); Forge's current procedure in [`../ops/corpus-maintenance.md`](../ops/corpus-maintenance.md).

## Forge migration note — 2026-09-04

Forge preserves this decision through
`pnpm --filter @forge/rag raws:promote --source <key>`. The TypeScript command
replaces the standalone `scripts/copy-raws.sh`; its current target guards,
dry-run/apply flow, atomic copy, and reconciliation procedure are documented in
[`corpus-maintenance.md`](../ops/corpus-maintenance.md#promote-locally-acquired-raw-documents).
References below to `copy-raws.sh`, `prod-ingest.md`, and bare `pnpm` commands
describe the historical standalone implementation and are not Forge operator
instructions.

## Context

Promoting a source to prod normally runs `acquire:production` (crawl + stage rows into the prod `raw_documents` table) then `index:production` (normalize → chunk → embed → write). For a plain-HTTP source, re-acquiring in prod is **free**, so this is the right default.

For a **walled** source acquired through Firecrawl (ADR-0012), acquisition is **metered**: `acquire:production` re-runs Firecrawl against prod and pays the credit cost a **second time**, for content already acquired locally to develop and validate the slice. everystudent (en/ar/fr) cost ~264 Firecrawl credits locally; `acquire:production` would spend ~264 again in prod for byte-identical pages.

The pipeline already has the seam to avoid this. `raw_documents` is flat, keyed by `source_key` (plain text, **no foreign keys**), so a source's staged rows copy local→prod as a single-table operation (#115). `index:production` **only drains pending raws** — it never fetches. So seeding prod's `raw_documents` from the local rows and running `index:production` embeds in prod without re-acquiring. #115 specified the mechanism; #120 built `scripts/copy-raws.sh`; this ADR records the decision now that it has run (en/ar/fr).

## Decision

Adopt an **optional** promotion path, `scripts/copy-raws.sh`, whose justifying case is a **walled/metered (Firecrawl) source** where re-acquiring in prod would double a real credit cost. It is **not** a replacement for `acquire:production`: for a free-to-acquire source, `acquire:production` (crawl-in-prod, resumable) remains the normal path. `copy-raws.sh` _works_ on a non-walled source too — it skips a re-crawl — but with nothing metered to save there is no reason to prefer it over the simpler path, so choosing it there is a deliberate exception, not the default. The operator recognises a source as walled/metered and chooses this path deliberately.

**Historical standalone flow** (retained as provenance; use the Forge migration note and current runbook operationally):

1. `pnpm acquire` (local, pays Firecrawl **once**)
2. `pnpm index` + `pnpm eval` (local — validate the source before prod sees it)
3. Historical `scripts/copy-raws.sh` — copy the source's `raw_documents` local→prod, **omitting `id` and `ingested_at`** so prod regenerates the uuid and leaves each row **pending** (a copied-in already-stamped row would make `index:production` a silent no-op; #115)
4. `pnpm index:production` (embed in prod)
5. `pnpm eval:production` (certify)

**Embedding happens twice** (local + prod). This is accepted: embedding is comparatively cheap, and the goal is to pay the metered **acquire** once, not the embed.

**It runs within the existing local-or-VM prod-promotion model.** The `:production` scripts and `copy-raws.sh` are safe **by design** — redacted-host preview, Y/N gates, `--expect-host`, `JFRAG_ALLOW_PROD_WRITE`, and `copy-raws.sh`'s own host guard — regardless of _where_ they run. The VM is a single-operator resource; a contributor without it promotes **locally** via Doppler `prd`, which is a first-class path, not a degraded one. The general "long local prod op" keep-awake guidance (tmux / always-on session) already in `docs/ops/prod-ingest.md` applies unchanged — bulk-copy adds **no new class of risk**. The everystudent en/ar/fr promotion both used and **validated** this local contributor path.

## Alternatives rejected

- **Always `acquire:production`, even for walled sources.** Pays Firecrawl twice for identical content. Avoiding that double spend is the entire justification for this path.
- **Copy the full corpus (`documents`/`chunks`/`chunk_embeddings`) local→prod to skip prod embedding too.** Requires UUID foreign-key remapping across four tables (`sources`→`documents`→`chunks`→`chunk_embeddings`) and moves large embedding blobs. Embedding twice is cheap by comparison, so the added complexity and risk are not worth it (considered in #115).
- **Make bulk-copy the general promotion path for any source.** Invites the extra copy step and its handling into cases where `acquire:production` does the job at no cost saving. Scoped to metered sources instead, where it earns its keep.
- **Mandate new guardrails for the local run.** The laptop-shutdown consideration is the pre-existing _general_ local-prod-op hazard (already documented in `prod-ingest.md`), not something bulk-copy introduces. No new risk class → no new mandate.

## Consequences

- (+) A walled source is acquired (metered) **exactly once**; prod promotion costs **zero Firecrawl**. Especially valuable for a contributor paying Firecrawl from their own account (e.g. a personal free tier).
- (+) The copy uses the intended Acquisition→Ingestion seam (`raw_documents`); no schema change and no new persistent write surface beyond the documented script.
- (+) Validated end-to-end on everystudent en/ar/fr, which doubled as a proving run of the local contributor promotion path.
- (−) Embedding is done twice (local + prod). Accepted.
- (−) `copy-raws.sh` writes to the prod corpus while bypassing `acquire:production`'s crawl+gate path. It carries its own host guard, but it is a distinct write path an operator must invoke deliberately.
- (−) Optional and situational: the operator must correctly identify a source as walled/metered and choose this path deliberately. On a non-walled source it still works but buys nothing — an extra step off the normal `acquire:production` path.
