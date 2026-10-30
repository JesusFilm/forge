# ADR-0013 — Language sweep runs on-demand, null-only by default; residual nulls are accepted

- Status: Accepted and implemented by [#126](https://github.com/JesusFilm/jesusfilm-rag/issues/126).
- Date: 2026-07-28
- Issue/PR: [#126](https://github.com/JesusFilm/jesusfilm-rag/issues/126) (implements the default flip in code + docs; separately tracked)
- Related: builds the **operational policy** on top of [ADR-0009](./0009-llm-language-detection-sweep.md) (the sweep's detection _mechanism_); depends on [ADR-0007](./0007-language-decision-thresholds-null-policy.md)'s `null` policy and [ADR-0008](./0008-language-label-lifecycle.md)'s never-blank lifecycle.

**Forge migration note.** The current command is
`pnpm --filter @forge/rag language:sweep`; `--mode blanks` remains its default.
The implementation is split between `scripts/language-sweep.ts`,
`scripts/lib/maintenance-args.ts`, and `src/indexing/resolve-language.ts`.

## Context

[ADR-0009](./0009-llm-language-detection-sweep.md) settled _how_ the corrective sweep detects language — an LLM behind the reserved `LanguageDetector` port, no length floor (the model abstains instead), label-only and revertible. It did **not** settle the operational questions this ADR answers: _when_ do we run the sweep, _what do residual `null` labels mean_, and _which mode is the routine one_.

Two facts frame the decision:

1. **Ingest legitimately produces `null`.** Below the 500-char floor / 0.75 confidence gate, ingest stores `null` rather than guessing (ADR-0007). As new sources are ingested, a residue of `null`-language documents **accumulates** — the honest output of a cautious detector on genuinely hard pages, not a defect. everystudent is the current example: 9 of 108 en docs landed `null` (the confidence gate, not the content).

2. **The sweep has two modes, and its pre-#126 default was set for a one-time cleanup.** The current Forge sweep supports:
   - `--mode full` — re-detect **every** document. Can relabel an _established_ label, so it catches mislabels; its cost scales with the **whole corpus** (one LLM detector call per doc).
   - `--mode blanks` — scope to `where documents.language is null`. Fills only the accumulated nulls; cost scales with the (small) null set.

   Both are **label-only** (no re-embed; ADR-0009). Before #126, the default was `full` — the right default for the #73/#84 corrective cleanup that introduced the sweep (a corpus full of pre-detector mislabels), but the **wrong** routine default afterward: post-cleanup, ingest abstains rather than mislabels, so what accumulates is _nulls_, not _mislabels_. Running `full` routinely re-audits the entire corpus for no incremental gain.

## Decision

1. **`--mode blanks` is the default.** Routine `pnpm --filter @forge/rag language:sweep` targets only `null`-language documents. `full` is an explicit opt-in, reserved for a **detector change** (a new model or prompt) where re-auditing established labels is the actual point.

2. **Residual `null`s are accepted, not an error state.** A permanent residue of nulls is the expected, correct output of a detector that abstains on hard cases. Null rows stay fully retrievable _unfiltered_ (ADR-0007) and are excluded only from `language:` filters.

3. **Nulls are monitored on the public dashboard.** The dashboard surfaces per-source null counts / share; it is the _signal_ an operator watches, not an automated gate.

4. **The sweep runs on-demand.** It is triggered by an operator or stakeholder noticing null growth on the dashboard — **operator judgment, no hard threshold**. It is not run on every ingest and not automated: it costs money (LLM calls) and, in `full` mode, scales with the whole corpus, so it is a deliberate, occasional corrective pass.

5. **No automatic integration into `/slice` or the production promotion — for now.** Auto-running `--mode blanks` after a slice's ingest is a plausible future (cheap, targeted at exactly the new nulls). It is **considered but deferred**, recorded here so the option is not re-derived; adopting it is a separate decision.

## Alternatives rejected

- **Keep `full` as the default.** Re-audits the whole corpus on every routine run for no gain once ingest no longer mislabels — thousands of LLM calls to fill a handful of new nulls. The cost is what makes the sweep occasional; a whole-corpus default fights that.
- **Drop `full` entirely (null-fill only).** Loses the ability to re-catch mislabels after a detector change — precisely the #73/#84 scenario `full` exists for. Kept as a one-flag opt-in instead.
- **Auto-run the sweep after every ingest.** Turns a deliberate, metered corrective pass into an implicit per-slice cost. Since residual nulls are _accepted_, there is no urgency that justifies automating the spend.
- **A hard null-count / percentage threshold that triggers a run.** False precision — "too many nulls" depends on _which_ docs are null and _why_ (flagship pieces vs thin stubs). A human reading the dashboard is the right trigger.

## Consequences

- (+) Routine sweeps are cheap and targeted (nulls only), so running one when the dashboard shows growth is a small, safe, low-cost action.
- (+) The corpus-quality posture is explicit and visible: nulls accumulate, are shown on the dashboard, and are accepted until worth a pass — no silent debt, no over-engineering toward an unattainable zero-null corpus.
- (+) `full` remains available for the one case that needs it (a detector-model/prompt change) without being the accidental, expensive default.
- (−) Existing operator commands that intend a whole-corpus re-audit must pass `--mode full` explicitly.
- (−) `blanks` never re-audits established labels, so a mislabel from a _future_ ingest-detector regression would not be caught by routine sweeps — only by an intentional `full` run. Accepted: ingest abstains rather than guesses (ADR-0007), so mislabels are unlikely, and `full` is one flag away.
