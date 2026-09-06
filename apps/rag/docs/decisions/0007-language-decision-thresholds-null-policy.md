# ADR-0007 — Language decision thresholds and the `null` policy

- Status: Accepted
- Date: 2026-07-13
- Issue/PR: [#74](https://github.com/JesusFilm/jesusfilm-rag/issues/74) (implemented in PR [#77](https://github.com/JesusFilm/jesusfilm-rag/pull/77)); evidence from the [#73](https://github.com/JesusFilm/jesusfilm-rag/issues/73) corpus audit + the reproduced `lang-detect-bench` sweep (2026-07-13)
- Related: [ADR-0006](./0006-per-document-language-detection.md) — supersedes its **low-confidence fallback** clause; everything else there (per-document content-based detection, `tinyld`, sources-by-domain, declared-set cross-check) stands.

## Context

ADR-0006 established content-based per-document detection but sketched the gate as
"low confidence, single-language source → fall back to that declared language."
The #73 corpus audit then showed both halves of that fallback are unsafe: source
declarations are **unverified** (`thelife` declares `["en"]` yet serves French), and
the detector is **confidently wrong** precisely on sparse short documents (a
251-char English listing page reads `hi`@1.000 — no confidence threshold catches a
wrong maximum). The forcing question: what do we store when detection cannot be
trusted?

## Decision

`documents.language` is decided by one pure primitive
(`src/indexing/decide-language.ts` in Forge), shared by ingest and #73's cleanup pass:

1. cleaned content **< 500 chars** → `null` (detection floor — every observed
   confidently-wrong case is sparse non-prose under ~260 chars; 500 clears them
   with margin and blanks only ~37 of ~8,993 real docs);
2. confidence **< 0.75** → `null` (sweep: verdicts at/above the gate are 99.7%
   correct — 700/702);
3. else **trust the verdict, even outside the source's declared set** (content
   wins), storing it and logging a ⚠ warning.

**`null` means "not confidently detected" — never a guess, never a default to the
declared language.** Blank rows stay retrievable unfiltered, are excluded from
`language:<code>` filters, and form a queryable worklist (`WHERE language IS NULL`)
for #73. Both thresholds are exported constants; #73's corpus audit tunes them.

## Alternatives rejected

- **Fall back to the declared language on low confidence** (ADR-0006's sketch) —
  declarations are unverified (thelife's French under `["en"]`); a fallback silently
  re-creates exactly the mislabel class this work removes. A blank is queryable; a
  wrong label is invisible.
- **Confidence gate alone, no length floor** — `tinyld`'s score measures surviving
  candidates, not correctness; sparse non-prose collapses to one wrong candidate at
  1.000. Only a floor catches it (and with the floor, zero confidently-wrong cases
  remain).
- **Surface low-confidence multi-language docs to the operator at ingest**
  (ADR-0006's other clause) — the `null` worklist replaces per-ingest interruptions
  with bulk review in #73's re-runnable cleanup script.
- **`franc`** — claims ~1.000 confidence on nearly everything, including 27 wrong
  answers in the sweep; no usable gate signal (re-affirms ADR-0006's `tinyld` pick
  with new evidence).
- **Two-detector must-agree (`tinyld` + `franc`)** — measured in the sweep: adds
  cost, no accuracy gain.
- **LLM escalation for hard cases** — deferred, unchanged from ADR-0006; `null` is
  detector-agnostic, so nothing forces the decision now.

## Consequences

- (+) A stored label is either content-derived at high confidence or absent —
  labels never lie; over-blanking is harmless (excluded from filters, present in
  unfiltered search).
- (+) The leftover work is a trivially queryable worklist for #73's cleanup pass.
- (−) ~37 genuine documents sit blank at the current thresholds until #73 fills
  them; short foreign-language pages cannot self-label.
- (−) Two magic numbers (500 / 0.75) to keep honest — cautious #74 defaults,
  owned and tuned by #73.
