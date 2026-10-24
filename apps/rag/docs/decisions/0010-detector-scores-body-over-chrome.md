# ADR-0010 — The LLM detector scores the main body, not the page chrome

- Status: Accepted
- Date: 2026-07-16
- Issue/PR: [#94](https://github.com/JesusFilm/jesusfilm-rag/issues/94)
- Related: refines the detector guidance introduced by [ADR-0009](./0009-llm-language-detection-sweep.md) (the LLM language sweep). No change to the port, the sweep engine, the no-floor policy, or [ADR-0008](./0008-language-label-lifecycle.md)'s never-blank lifecycle.

**Forge migration note.** `SYSTEM_PROMPT` now lives in
`src/adapters/language/openai-compatible-language.ts`; its tests live beside the
adapter. The body-over-chrome guidance below remains current.

## Context

The first `--llm-review` dry-run of the #92 sweep against the **cru** corpus produced 190 clean null-fills but **8 relabels**, of which several were false positives: the detector labelled an **English article by its bilingual page chrome**, not its body.

- `en → es @0.8` whose only cited evidence was the footer **"©2025 Cru. todos los derechos reservados."**
- two `en → es` (@0.8 / @0.9) justified by the breadcrumb **"Comparte el evangelio"** while the body was English.
- one `es → en @0.99` whose evidence was **entirely Spanish** — internally contradictory, almost certainly wrong.

Root cause is the detector's guidance, not the sweep machinery:

1. `SYSTEM_PROMPT` asked for the single **DOMINANT** language of "the document" and a single ≤120-char **evidence quote**, with **no instruction to weigh the article body over boilerplate**. That framing lets the model rest a verdict on a salient chrome quote.
2. `cleanText()` only collapses whitespace — it does **not** strip chrome, so nav/breadcrumb/footer reach the model.
3. The sweep sends `cleanText(...).slice(0, maxDetectChars)` — the **front** of the page, which on scraped cru pages leads with nav/breadcrumb chrome.
4. `resolveFromLlm` trusts any non-null verdict as authoritative (`basis: "detected"`), and ADR-0009 deliberately **has no confidence floor** — so a confidently-wrong @0.8 chrome verdict becomes a real relabel. A floor would not have helped anyway (the worst case was @0.99).

The one lever that fixes the root cause — a model resting its verdict on the wrong region of the page — is the **guidance itself**.

## Decision

Revise `SYSTEM_PROMPT` (now `src/adapters/language/openai-compatible-language.ts`) to:

1. Identify the language of the **MAIN CONTENT / article body** — the substantive prose the page is about — not the whole document indiscriminately.
2. **Explicitly name site chrome and require it to be ignored**: navigation/menus, breadcrumbs, header, footer, copyright/legal notices, cookie/consent banners, share/social buttons, related-links, and short repeated template text — _even when it is in a different language from the body_.
3. State the tie-break directly: **when chrome and body differ in language, the body wins** — never label a page by its footer, breadcrumb, or menu.
4. Require the **evidence quote to be drawn from the body**, never from chrome (so the report's evidence is a check on the decision, not a symptom of the bug).
5. Keep everything else from ADR-0009: strict-JSON `{language, confidence, evidence}`, ISO 639-1, honest `null` abstain (now clarified: _a foreign footer does not make a page a language "mix"_), the declared-set hint, `temperature: 0`.

This is a **prompt-only** change: no port, engine, model, or policy change.

## Verification — TDD simulation (throwaway harness)

Proven red→green against the **real** `OpenRouterLanguageDetector` over OpenRouter (`google/gemini-2.5-flash-lite`, matching prod), with a minimal 7-fixture corpus across three classes — (1) already-correct, (2) clean mislabel with no chrome trap, (3) mixed body-vs-chrome — laid out chrome-first to mirror a scraped page. The harness is throwaway (it spends live LLM calls) and lives under `scratch/lang-detect-sim/`, not in CI.

- **RED** (pre-fix, real adapter): gate **exits 1** — the two mixed-chrome English pages flip `en→es@0.90`, evidence = the Spanish breadcrumb / nav+footer. Faithfully reproduces the prod false positives.
- **GREEN** (post-fix, same command, real adapter): gate **exits 0** — 7/7 including 3/3 mixed-chrome; the flips are gone and the confirmed + clean-mislabel classes are unchanged (the genuine `vi→es` and `es→en` relabels still fire).
- A **cheap offline regression test** (`openrouter-language-detector.test.ts`, mocked `fetch`) pins the wired prompt's guarantees — it must direct the model at the main body, name footer/breadcrumb chrome, keep "body wins", require body-sourced evidence, and must **not** revert to the "single DOMINANT" framing.

### Tune iterations

1. **Candidate prompt, v1** — first draft (body-over-chrome + explicit chrome list + body-wins + body-sourced evidence). Passed all 7 fixtures on the first live run; no further prompt iteration was needed.
2. **Fixture faithfulness, v1 → v2** — the initial mixed-chrome _footer_ fixture used a long, dominant English body; the current prompt still read it `en` (only the breadcrumb fixture flipped). That under-reproduced prod, whose footer flips happened on **short** pages (the sweep's actual domain). Shortening that fixture's body so the Spanish footer carries proportional weight made both mixed-chrome cases flip in RED — a faithful reproduction — after which the fix cleared both.

## Alternatives rejected

- **A confidence floor on relabels.** Already rejected by ADR-0009, and independently useless here: the chrome verdicts were @0.8–0.99. A floor strands correctable short pages without catching the actual failure.
- **Strip chrome before detection (DOM/heuristic boilerplate removal).** A larger change to the ingest/normalize text path with its own false-negative risk (stripping real body). The prompt fix addresses the root cause at one well-tested seam; body extraction remains a future option if chrome-bleed recurs on other corpora.
- **Post-hoc rule "ignore the evidence if it looks like a footer".** Brittle string-matching downstream of a model that already saw the whole page; better to tell the model what to judge.
