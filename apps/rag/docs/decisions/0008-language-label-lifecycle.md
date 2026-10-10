# ADR-0008 — Language label lifecycle: preserve established labels; the sweep resolves what ingest leaves null

- Status: Accepted
- Date: 2026-07-15
- Issue/PR: [#73](https://github.com/JesusFilm/jesusfilm-rag/issues/73) (PR [#88](https://github.com/JesusFilm/jesusfilm-rag/pull/88))
- Related: [ADR-0007](./0007-language-decision-thresholds-null-policy.md) — **amends** its "over-blanking is harmless" consequence (an _established_ label is now never blanked); its ingest-time floor/gate/thresholds and "`null` = not confidently detected" all still stand for the pure `decide-language.ts` primitive. [ADR-0006](./0006-per-document-language-detection.md).

**Forge migration note.** The policy now lives in `src/indexing`; persistence is
implemented by `src/adapters/postgres/index.ts`, which writes
`doc.language ?? existing.language`. The semantic `coalesce(new, existing)`
described below still governs the write even though Prisma performs the lookup.

## Context

ADR-0007 made ingest cautiously abstain to `null` below a 500-char floor or 0.75
gate, and treated over-blanking as harmless. Two things then surfaced that the
null-first stance did not cover. (1) The #73 corrective sweep is a paid, deliberate
pass — re-leaving obviously-in-set short pages `null` defeats its purpose. (2) A
re-embed (`--force`/model migration) re-runs `normalize` → `replaceDocument`, whose
upsert overwrote `language` with the freshly-decided value — so a below-floor doc
re-decided to `null` and **silently erased** a label a human or the sweep had
established. Forcing question: how do labels evolve across ingest, sweep, and
re-embed without losing established information?

## Decision

An established language label is **authoritative** — replaced only by a confident
content detection, never nulled out or overridden by a weak signal. At the two
seams that touch the column:

1. **Ingest write never nulls out a label.** `replaceDocument` writes
   `language = coalesce(new, existing)`: a fresh `null` (below floor/gate) preserves
   the existing label; a confident new detection still overwrites. Re-embeds and
   re-crawls therefore preserve swept/human labels — re-running the sweep after a
   re-embed is **not** required.
2. **The corrective sweep resolves more than cautious ingest.** A new policy layer
   (`ingestion/resolve-language.ts`) sits on `decide-language.ts`: a below-floor
   detection **inside** the source's declared set is labelled (the floor guards
   confidently-wrong _out-of-set_ calls — Hindi on an English listing — not in-set
   ones); a single-language source's unsure doc falls back to its declared language;
   a multi-language source stays `null` only when the detection is out-of-set or
   undetectable (the LLM-escalation tail). The sweep only ever **fills** a `null` or
   relabels on a confident detection — a weak signal never overrides or blanks an
   existing label (property-tested).

Ingest stays cautious; the sweep is corrective; `coalesce` reconciles them.

## Alternatives rejected

- **Overwrite `language` on every re-ingest** (prior behaviour) — a re-embed
  re-decides from content, so below-floor docs re-decide to `null` and erase labels
  the sweep/human set. `coalesce` preserves them at no cost to genuine re-detection.
- **Wire the sweep's aggressive ladder into ingest too** — removes the divergence,
  but re-opens confidently-wrong risk on first ingest of sparse pages and enlarges
  the ADR-0007 change. Kept ingest cautious, reconciled by `coalesce`.
- **Leave below-floor docs `null` (strict ADR-0007)** — defeats the point of a paid
  corrective pass; the out-of-set guard already keeps the confidently-wrong cases
  `null`.
- **Fall back to `declared[0]` for below-floor multi-language docs** — reintroduces
  the `languages[0]` mislabel ADR-0006/0007 removed; those stay `null`.

## Consequences

- (+) A label, once established (confident detection, the sweep, or a human),
  survives re-embeds and re-crawls — model migrations no longer silently null the
  corpus.
- (+) The sweep drives `null`s toward zero (local corpus: 190 → 3) while the
  out-of-set guard keeps confidently-wrong labels out.
- (−) Ingest and the sweep apply **different** resolution policies (cautious vs
  corrective) — intentional, and a reader must know both live. `coalesce` keeps them
  consistent over time.
- (−) `language = coalesce(new, existing)` makes the language column special vs the
  other upserted columns — implemented in `src/adapters/postgres/index.ts` and called out here so it is
  not "simplified" back to a plain overwrite.
