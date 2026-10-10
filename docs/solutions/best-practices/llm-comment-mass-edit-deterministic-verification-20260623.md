---
title: "Safe LLM-driven comment-only mass edits — deterministic byte-identity gate + prose-line counting"
date: 2026-06-23
problem_type: best_practice
component: tooling
root_cause: inadequate_documentation
resolution_type: workflow_improvement
severity: medium
module: cross-cutting
applies_when:
  - "Running an LLM-agent-driven mass edit that must change ONLY comments and leave code byte-identical"
  - "Condensing or rewriting many code comments to a line/length budget across a TS/Expo monorepo"
  - "Trusting an LLM agent's self-reported residual count after a threshold-cleanup pass"
  - "Writing a scanner that detects comment patterns near string literals, template literals, or URLs"
tags:
  - llm-mass-edit
  - comment-condensation
  - deterministic-verification
  - byte-identity
  - llm-satisficing
  - meta-pattern
  - best-practice
related:
  - "docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md"
  - "docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md"
  - "docs/solutions/best-practices/idempotence-property-test-vacuous-on-malformed-fixed-point-20260528.md"
  - "docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md"
---

# Safe LLM-driven comment-only mass edits

An LLM is the right tool to _condense_ prose and the wrong tool to _verify_ its
own condensation. Delegate the rewrite; keep verification deterministic and
central.

This is a new worked instance of the [[mocked-shape-vs-real-contract-discipline]]
META pattern: the deterministic comment-stripper proves the PRODUCTION CONTRACT
(code byte-identity), while a prose-based re-scan proves the BRANCH SHAPE (no
residual over-limit comments). The scanner false-positive traps are the same
hazard as a regex backstop eating a load-bearing branch's signal — and the same
vacuous-pass shape as [[idempotence-property-test-vacuous-on-malformed-fixed-point]].
What is _new_ here is the LLM-condensation failure surface (satisficing at the
threshold; fabricating specifics) that the META does not yet name.

## Context

A 209-file pass across `apps/tv` + `apps/mobile` condensed every comment longer
than 3 lines down to <=3 prose lines, shipped as PR #1337 with CI fully green.
The work is mechanically simple to _describe_ ("only touch comments, keep each
under N lines") but has a sharp failure surface: the editing agent can silently
alter code, mis-count what "N lines" means, and — worst — rewrite the meaning of
the comments it condenses.

## Guidance

**1. Prove code-identity with a deterministic comment-stripper, not by eyeballing the diff.**
For each changed file, run the SAME deterministic comment-stripping state machine
over both the HEAD version and the working version, then diff the two stripped
outputs. Identical stripped output means the code is byte-identical — regardless
of the stripper's own imperfections. A mis-tokenized regex or string literal is
mis-tokenized _identically_ on both sides; since only comments are removed, only
comments can account for any difference. This is strictly stronger than "the git
diff looks comment-only" or trusting the agent's self-report.

**2. Count PROSE lines, not physical lines — define the rule precisely up front.**
A naive raw-span scanner over-counts wildly. Exempt: JSDoc `@`-tag lines, the
`/**` and `*/` delimiter lines, and `// -- Heading --` section-decorator lines.
On this pass, raw span > 3 flagged **382** "violations"; prose-only counting
dropped that to **153**; exempting heading decorators gave the **137** true
residuals. Without a precise rule you chase ~245 phantom violations.

**3. Harden the scanner against literal-content false positives.** Two real traps:

- `/*` _inside a string_ (e.g. `"https://*"` as a WebView `originWhitelist`) makes
  a naive block-comment scanner swallow 167 lines hunting a far-off `*/`. Fix:
  only treat `/*` / `{/*` as a comment start when it begins the _trimmed_ line.
- A `//` inside a JS template literal (e.g. injected Swift in a backtick string)
  is _string content_, not a comment. Editing it is a CODE change — and the
  deterministic stripper from rule 1 correctly flags it as such, so it gets left
  alone.

**4. Take the residual set from a deterministic central re-scan, not from agent counts.**
Verify-agents _satisfice at the threshold and under-report_: across two
adversarial passes they repeatedly left comments at exactly 4 lines (one over a
<=3 limit) and under-counted residuals — one agent reported 4 residual blocks in
`VideoPlayer.tsx` where a deterministic re-scan found **17**. For
"get everything under threshold N" work, the agent shrinks; the scanner counts.

**5. Diff every condensed comment against its original and cross-check authoritative sources.**
Aggressive LLM summarization fabricates plausible-but-wrong specifics. Here a
comment that originally said `failed with "Not authorized to resolve
Query.experiences"` was condensed to `...and 403'd for TV` — inventing an HTTP
403 that was never in the source and _contradicting_ both the regression-guard
test (`queries.test.ts`) and a sibling comment, which both said **401**. Caught
only by an accuracy pass that diffed condensed-vs-original and cross-checked the
test. Numbers, status codes, identifiers, and error strings are exactly what
summarization invents.

**6. Name the inherent tension instead of pretending it resolves.** You cannot
simultaneously hold (<=N lines) + (preserve every reference) + (keep every line
short) for reference-dense comments. Pick a priority and state it. Here, refs +
<=3 lines won, accepting a few ~130-150-char lines — don't claim all three.

**Operational caveat (fresh worktree):** a fresh git worktree has no
`node_modules`, so the pre-commit hook (husky + lint-staged: eslint + prettier)
and `tsc` can't run until `pnpm install`. Worse, `pnpm --filter @forge/tv
typecheck` returned **exit 0** while the real output was `sh: tsc: command not
found`. Read the log; do not trust the pnpm wrapper exit code when verifying in a
fresh worktree.

## Why This Matters

A comment-only refactor _feels_ zero-risk, which is exactly why it ships
unverified. But the editing agent operates on the file as text, so it can
(a) alter code while "only touching comments," (b) silently miss the threshold it
was given, and (c) rewrite the truth value of the comments. The first is
invisible in a quick diff scan, the second balloons into phantom-violation churn
or leaves the job half-done, and the third actively corrupts the codebase's
documentation — replacing a correct `401` with a fabricated `403` is worse than
the long comment you started with. Deterministic central verification converts
"trust the agent" into "prove it," and the proof is cheap: a state-machine strip
plus a diff.

## When to Apply

- Any **LLM-agent-driven mass edit** scoped to a single mechanical property
  ("only comments," "only formatting," "rename X to Y everywhere") where you need
  a guarantee the rest of the file is untouched.
- Any **"get everything under threshold N"** cleanup, where agents will satisfice
  at N+1 and under-count residuals.
- Any time you **delegate prose condensation/summarization** of text carrying
  load-bearing specifics — status codes, IDs, error strings, version numbers,
  file paths. Diff against the original; cross-check tests and siblings.
- Verifying _anything_ in a **fresh git worktree** before `pnpm install` —
  distrust wrapper exit codes, read the actual log.

Do NOT lean on agent self-verification as the source of truth for any of the
above.

## Examples

**Code-identity proof (the load-bearing check):**

```bash
for f in $(git diff --name-only HEAD); do
  diff <(strip_comments <(git show HEAD:"$f")) <(strip_comments "$f") >/dev/null \
    && echo "MATCH $f" || echo "CODE CHANGED $f"
done
# 209/209 MATCH  ->  provably comment-only
```

`strip_comments` is a deterministic state machine (code | line-comment | block |
single/double/template string) that deletes comment spans and leaves everything
else byte-for-byte. It does not need to be a perfect tokenizer — only
_deterministic_, so identical code strips identically on both sides.

**Prose-line counting rule (what "<=3 lines" actually means):** count only prose
lines; exempt `/**`, `*/`, `@param`/`@returns` tag lines, and `// -- ... --`
decorators. (382 raw -> 137 true on this pass.)

**Scanner false-positive guard:** treat `/*` or `{/*` as a comment-open ONLY when
it starts the trimmed line — so `originWhitelist={["https://*"]}` doesn't open a
167-line phantom comment.

**Fabrication caught by cross-check:** original `Not authorized to resolve
Query.experiences` -> condensed `403'd for TV`; `queries.test.ts` and a sibling
comment both say **401** -> the condensed `403` is fabricated and must be
corrected.

**Don't trust the wrapper:** `pnpm --filter @forge/tv typecheck` -> exit `0`, but
the log shows `sh: tsc: command not found` (no `node_modules` in the fresh
worktree). The "pass" is a lie; run `pnpm install` first.
