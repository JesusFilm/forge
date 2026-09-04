# ADR-0009 — The corrective sweep detects language with an LLM (behind the reserved port)

- Status: Accepted
- Date: 2026-07-15
- Issue/PR: [#84](https://github.com/JesusFilm/jesusfilm-rag/issues/84) (also [#73](https://github.com/JesusFilm/jesusfilm-rag/issues/73))
- Related: **un-defers the "LLM escalation deferred" clause of [ADR-0006](./0006-per-document-language-detection.md) and [ADR-0007](./0007-language-decision-thresholds-null-policy.md)** — for the corrective sweep only. Ingest-time detection (the pure `tinyld` primitive, its 500-char floor and 0.75 gate) is **unchanged**; [ADR-0008](./0008-language-label-lifecycle.md)'s never-blank lifecycle still holds and is load-bearing here.

**Forge migration note.** The current entry point is
`scripts/language-sweep.ts`; policy lives in
`src/indexing/resolve-language.ts`, and the OpenAI-compatible detector lives in
`src/adapters/language/openai-compatible-language.ts`. Use the package commands
`language:sweep` and `language:sweep:production`. The operational contract is
consolidated in [`../ops/corpus-maintenance.md`](../ops/corpus-maintenance.md).

## Context

The #73 corrective sweep (PR [#88](https://github.com/JesusFilm/jesusfilm-rag/pull/88)) reused the pure `tinyld` ingest detector under a 500-char floor. But `tinyld` is _confidently wrong_ on short prose (ADR-0007: a 251-char English listing reads `hi`@1.000), so the exact class the sweep exists to fix survived it: short foreign pages left `null` or given the source's declared language — [#84](https://github.com/JesusFilm/jesusfilm-rag/issues/84) (a Spanish cru page tagged `vi`; ~190 cru nulls).

A paid, deliberate corrective pass that repeats the ingest detector's blind spot corrects nothing new. The sweep's whole point is to be **more accurate than ingest**, which for short documents means an LLM. ADR-0006/0007 already anticipated exactly this: they **reserved a `LanguageDetector` port** for an LLM escalation and _deferred_ it ("becomes ~free once a local GPU server exists"). The forcing event: the LLM was the sweep's intended detector from the start; the requirement was lost to a voice-capture gap and the deferral was never revisited. This ADR revisits it.

## Decision

The corrective sweep (now `scripts/language-sweep.ts`, via the policy in `src/indexing/resolve-language.ts`) detects language with an **LLM behind the `LanguageDetector` port** (`src/contracts/ports.ts`), the seam ADR-0006 reserved. Concretely:

1. **LLM detection, over an OpenAI-compatible endpoint.** The adapter (now `src/adapters/language/openai-compatible-language.ts`) POSTs a strict-JSON classification to `/chat/completions`, default model `google/gemini-2.5-flash-lite` (`LANG_DETECT_MODEL_ID`), using `LANG_DETECT_BASE_URL` when configured and otherwise hosted OpenRouter. It is constructed in `main.ts`. Same transient-retry discipline as the embedder (#64). **Ingest stays `tinyld`** — real-time, free, high-volume; the LLM is the deliberate corrective layer, not the ingest path.
2. **No length floor on the LLM path.** A non-null verdict is authoritative at **any** length — this is what corrects a short French page stamped `en`. The model's own **abstention (`null`)** replaces the 500-char floor as the safety valve: `tinyld` needs the floor because it can't tell it's wrong on short text; the LLM can, and says so.
3. **Never-blank still holds (ADR-0008).** `decideSweep` lets a confident verdict relabel or fill, but a weak/abstain signal only _fills a null_ — never overrides or blanks an established label. So trusting the LLM can only _add_ information; the worst case of a wrong verdict is a surfaced relabel, revertible in one command, not a lost label.
4. **Whole document, not a chunk** — the cleaned document text (up to `--max-detect-chars`, default 8000) is sent, so detection sees representative prose, never a single chunk.
5. **Local + production, one engine.** `pnpm --filter @forge/rag language:sweep` and `pnpm --filter @forge/rag language:sweep:production` share the core. Production execution uses Forge's target validation and explicit `--apply` acknowledgements. The operation is label-only, dry-run by default, and revertible from its durable audit.

## Alternatives rejected

- **Keep `tinyld` for the sweep (the shipped #88 behaviour).** It _is_ the reason #84 exists — a corrective pass with the same blind spot as ingest leaves the short-foreign-page class wrong. Rejected: the sweep must beat ingest to justify its cost.
- **Switch ingest to an LLM too.** Rejected on ADR-0006's own grounds — cost + latency on a real-time, high-volume path for no gain on the article-length prose that dominates ingest. The sweep is the low-frequency, deliberate place to spend an LLM call. Not rejected forever; revisit if a ~free local GPU model lands.
- **A hard confidence floor on the LLM verdict.** Reintroduces the very floor the LLM exists to remove. The model abstains (`null`) when unsure, and the never-blank policy already stops a low-confidence verdict from harming an existing label — a floor would only re-strand correctable short pages.
- **Ollama/Gemma local-only, or Claude direct.** Rejected in favour of **OpenRouter as the single gateway**: the key is already wired for embeddings, and the model is swappable via `LANG_DETECT_MODEL_ID` / `LANG_DETECT_BASE_URL`, so pointing at a local `/v1` (Ollama) or a Claude slug is a config change, not code. Portable for whoever runs it next.

## Consequences

- (+) Short foreign pages are corrected regardless of length — #84's `vi`-tagged Spanish page reads `es`; cru's nulls fill. The sweep is now genuinely more accurate than ingest.
- (+) The LLM enters exactly where the architecture reserved it — the `LanguageDetector` port; `ingestion` stays pure (the adapter is the only I/O), enforced by dependency-cruiser.
- (+) One credential, swappable model; a full-corpus run costs cents to a few dollars at the default model.
- (−) The sweep now costs money and depends on a provider. Mitigated: transient failures retry with backoff, and a per-document failure is a logged **anomaly** (row left untouched), never a crashed run.
- (−) A confident-but-wrong LLM relabel is possible. Mitigated by the never-blank policy (ADR-0008), the report's "Eyeball these" list, the optional `--llm-review` pass, and one-command `--revert`.
- (−) Ingest and the sweep now use **different** detectors. A re-embed re-runs `tinyld`, but ADR-0008's `coalesce(new, existing)` preserves the sweep's label unless `tinyld` is _confident_ — and where the LLM corrected a short page, `tinyld` abstains — so the sweep's corrections survive a re-embed. Documented in [`../ops/corpus-maintenance.md`](../ops/corpus-maintenance.md).
