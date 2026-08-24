---
title: An invisible-character gap in a redaction sanitizer leaks a live internal URL into a Linear ticket
date: 2026-08-20
category: security-issues
module: apps/mastra
problem_type: security_issue
component: service_object
symptoms:
  - A crafted Datadog error title with an invisible character inside the URL scheme survives redaction, so the raw internal URL and its query-string token reach the Linear ticket.
  - The URL placeholder is absent from the ticket even though the source text plainly contains an https URL.
  - The invisible-character pre-pass deletes only format and control characters, so about 4,000 default-ignorable code points pass through untouched.
  - Re-admitting separators through a whitespace shorthand class re-opens the identical leak for the byte-order mark.
  - The v-flag set-difference form of the character class throws a SyntaxError at module load unless both operands are bracketed.
root_cause: missing_validation
resolution_type: code_fix
severity: high
framework_version: "@mastra/core 1.55.0, node 24.14.1"
related_components:
  - apps/mastra/src/services/datadog-triage/ticket-draft.ts
  - apps/mastra/src/services/datadog-triage/linear-client.ts
  - apps/mastra/src/services/datadog-triage/detect.ts
tags:
  - input-sanitization
  - untrusted-content
  - information-disclosure
  - unicode
  - regex
  - mastra
  - datadog-triage
  - defense-in-depth
---

# An invisible-character gap in a redaction sanitizer leaks a live internal URL into a Linear ticket

## Problem

A redaction sanitizer replaced URLs in untrusted Datadog text with a placeholder, but a pre-pass removed only `Cf` and `Cc` characters. An invisible character outside that set, placed inside `https:`, defeated the URL match and let an internal host and its query-string token reach a Linear ticket as readable text.

The precondition is narrow but not exotic. An attacker must control the exact characters next to the scheme in a string the mobile client sends to Datadog — a client's own error messages reach the issue title verbatim. The same characters also arrive without an attacker: `U+FE0F` is the variation selector that rides along with ordinary emoji, so copy-pasted text can carry one into a log line by accident.

## Symptoms

- Untrusted evidence text such as `failed for https:<U+FE0F>//internal-admin.example/a?token=sk_live_9f3` produced a ticket that still contained `internal-admin.example` and `sk_live_9f3`.
- The surviving text read as an ordinary link. Nothing in the ticket showed that redaction had been attempted and had failed.
- The existing test for this behaviour passed. It used `U+200B` (ZERO WIDTH SPACE), which is `Cf`, so the old class already removed it.

The failing class is wider than one code point. A verification run on Node v24.14.1 measured **4,036** default-ignorable code points that are **not** in `Cf ∪ Cc` (of 4,174 default-ignorable code points in total). Four families were confirmed to leak against the old class: variation selector (`U+FE0F`), combining grapheme joiner (`U+034F`), Hangul filler (`U+3164`), and Mongolian free variation selector (`U+180B`).

## What Didn't Work

**1. Keeping the class and spacing the invisibles instead of deleting them.**
The earliest form replaced each invisible character with a space. `https:<U+0001>//host` then became `https: //host`. That still leaks the host and the query string, in a form a reader can copy. The fix must _delete_, and the pinned test comment at `apps/mastra/src/services/datadog-triage/ticket-draft.test.ts:90-95` records this.

**2. `\s` as the keep-set for separators.**
The first repair widened the class and then re-admitted "whitespace" with `/\s/u`. This silently restored the leak for one character: **JS `\s` matches `U+FEFF`** (verified, Node v24.14.1). A byte-order mark inside the scheme was therefore preserved, survived the URL match, and collapsed to a space. In the measured comparison the `\s` keep-set leaked the BOM case while the original class did not — the repair made one case _worse_. The BOM row of the `it.each` table at `ticket-draft.test.ts:113-131` is the discriminating test for this decision, and it is the test that caught it.

**3. `v`-flag set difference.**
The intuitive expression of "this class, minus the separators" was `[\p{Cf}\p{Cc}--[\t\n\v\f\r]]` under the `v` flag. It does not compile:

```
SyntaxError: Invalid regular expression: /[\p{Cf}\p{Cc}--[\t\n]]/v:
Invalid set operation in character class
```

The `v`-flag difference operator requires **both** operands to be bracketed. `[[\p{Cf}\p{Cc}]--[\t\n]]` does compile (both forms re-checked on Node v24.14.1). The single-bracket form is the shape most people write first.

**4. An explicit control-character class.**
Writing the keep-set as a literal class containing `\t`, `\n`, `\v`, `\f`, and `\r` inside a regex triggers ESLint `no-control-regex`. That rule ships in `js.configs.recommended`, which this repo extends at `eslint.config.mjs:18`, and no config disables it. The lint gate blocks the change before CI.

## Solution

Widen the deleted class to include `Default_Ignorable_Code_Point`, and re-admit the separators from an explicit `Set` rather than from a regex shorthand.

Before:

```ts
const INVISIBLE_RUN = /[\p{Cf}\p{Cc}]+/gu
```

After (`apps/mastra/src/services/datadog-triage/ticket-draft.ts:45-59`):

```ts
const INVISIBLE_RUN = /[\p{Cf}\p{Cc}\p{Default_Ignorable_Code_Point}]+/gu

const SEPARATORS = new Set(["\t", "\n", "\v", "\f", "\r"])

function deleteInvisible(value: string): string {
  return value.replace(INVISIBLE_RUN, (run) =>
    [...run].filter((ch) => SEPARATORS.has(ch)).join(""),
  )
}
```

The `Set` sits outside the regex, so `no-control-regex` does not apply, and the kept characters are enumerated where a reader can see them.

Order is part of the control. `stripInvisibleStructure` deletes invisible characters and only then drops HTML comments (`ticket-draft.ts:74-76`); `neutralizeTriageText` replaces URLs after both (`ticket-draft.ts:89-91`). Both `safeTriageText` (`ticket-draft.ts:97-107`) and `safeTriageTitleText` (`ticket-draft.ts:134-144`) run that sequence. Each bounds its input first — the body at `BODY_SOURCE_MAX_CHARS = 16_384` (`ticket-draft.ts:66`).

The behaviour is pinned by a table-driven test over eight invisible characters, `"omits a URL whose scheme is split by %s"` (`ticket-draft.test.ts:113-131`), plus `"keeps whitespace controls as separators"` (`ticket-draft.test.ts:109`) and `"strips a comment whose markers are split by an invisible character"` (`ticket-draft.test.ts:133`). Per this session's mutation run, reverting `INVISIBLE_RUN` to `[\p{Cf}\p{Cc}]+` turns the suite red.

## Why This Works

The root cause is a wrong set, not a wrong algorithm. `Cf ∪ Cc` is the set of _format and control_ characters. It is not the set of characters that render as nothing. The measured gap is 4,036 code points, and several of them are ordinary text characters that a font draws with zero width. A redaction pattern is only as good as the normalization that runs before it, so any character its pre-pass fails to remove becomes a way to break the pattern.

The second cause is the same mistake at a smaller scale. `\s` looks like "the whitespace characters", but its real membership includes `U+FEFF`. A shorthand class's intuitive membership is not its actual membership. Naming the keep-set explicitly removes the guess.

Two spellings of the same idea also proved unequal. `\p{Cc}` does not match `U+2028` or `U+2029`, which are `Zl` and `Zp` (verified, Node v24.14.1). The module therefore carries a separate line-break pattern for the title path at `ticket-draft.ts:110`.

**Scope and limits.** This fix does not make the module a general confusable filter, and it is one layer rather than the whole control.

- The pattern matches an **`http` or `https` scheme only** (`ticket-draft.ts:90`). The property held is therefore "no live link for a URL this pattern matches" — not "no live link", and not "no host ever appears". Two gaps follow from that, and the module's own comment at `ticket-draft.ts:86` states the property too broadly for the same reason.
- A **whitespace**-split scheme (`https:<TAB>//host`) still reaches the ticket as text. `ticket-draft.ts:83-87` states this deliberately. The text is visibly broken and is not a link, and untrusted evidence can always name a host in prose.
- A **scheme-less** host (`www.internal-admin.example/a?token=…`) is never matched at all, so it arrives verbatim. Whether it becomes a live link depends on Linear's renderer: GFM extended autolinking turns a bare `www.` prefix into an anchor, and issue trackers commonly enable it. **This is unverified** — nothing in this session tested Linear's renderer. Check it by pasting a bare `www.host.example/path` into a real Linear issue body and title and looking at what renders. If it autolinks, widening the pattern is a code change, not a documentation change.
- The placeholder is **forgeable in appearance on both paths**. In the body, escaping runs after substitution, so a genuine replacement renders as `\[URL omitted\]` and so does an attacker-written literal. In the title, the structural-character class (`ticket-draft.ts:119`) holds no parentheses, so an attacker-written `(URL omitted)` is byte-identical to a genuine one. Either misleads a reader about whether redaction happened; neither produces a link.
- Prompt-injection containment for the same untrusted text lives in the analysis prompt's evidence delimiters, not here. This module protects the _ticket_, not the model turn.

**Checked and found not to be residuals**, so a later reader does not repeat the work. A markdown link construct (`[text](javascript:…)`) is defused because both bracket pairs are escaped; angle-bracket autolinks are defused because `<` and `>` are escaped (`ticket-draft.ts:102-104`). A right-to-left override is `Cf`, so both the old and the new class already deleted it. A homoglyph host does not defeat the match, because the pattern does not care what follows the scheme — a confusable host is a misleading-destination problem, not a redaction bypass. Truncation cannot resurrect a URL, because every cut happens after substitution has already run on the full input. The two markdown items assume Linear renders CommonMark; that assumption is untested, and it is the same one the scheme-less gap above turns on.

## Prevention

- **State the keep-set; do not subtract from a shorthand.** When a transform deletes a character class but must preserve a few members, enumerate the survivors in an explicit `Set` or array. Do not express the exception as a regex shorthand (`\s`, `\w`, `\b`), and do not rely on `v`-flag set difference to carry the intent. The enumeration is readable, is lintable, and cannot silently gain a member on a Unicode or engine update.
- **Test one case per invisible-character FAMILY, not one representative.** A single `U+200B` case is not coverage. Give any redaction pattern a table-driven case for each of: format (`Cf`), control (`Cc`), variation selector, combining joiner, filler, tag character, and BOM. Families differ in which property class contains them, so a fix can close one and leave the next open. Then sort the rows by what each one discriminates: here the BOM row pins the keep-set choice, and the `VS16` / `CGJ` / `HANGUL FILLER` rows pin the widened class, while `ZWSP` and `SHY` are `Cf` and so were already caught before the fix. This suite runs eight rows across six of the seven families — tag characters are left out because they are `Cf` too and cannot discriminate this change.
- **Verify Unicode membership by execution, never from memory.** Run `node -e` against the exact class and the exact code point before you assert the claim, and record the engine version. Three of this fix's premises were wrong on first statement.
- **Falsify the fix by mutation.** Revert the changed class to its previous value and confirm the suite goes red. A redaction test that passes both before and after the fix is proving something else.
- **State the guarantee as what the pattern matches, not as what you wanted.** "No live link" and "no live link for the schemes this regex covers" read the same to the author and differently to every later reader — the first invites the next person to trust the sanitizer for a case it never handled. Write the narrow sentence in the code comment as well as the doc, because the comment is what a maintainer reads before extending the pattern.
- **Recognize the shape.** The general defect is _a redaction pattern defeated by characters its own pre-pass failed to remove_. It appears wherever untrusted text is normalized and then matched: URL redaction, secret scrubbing, marker or comment stripping, and allowlist matching on identifiers. Whenever a match runs after a normalization step, ask what the normalization misses — that gap is the bypass, and it is invisible in review by construction.

## Related Issues

- **PR #1968** (`worktree-feat-datadog-mobile-triage`) — open, not merged as of 2026-08-20. The fix ships in that branch.

### The fourth input-bounding axis

This repo already names three axes for bounding untrusted input. This learning is the fourth: **character-set correctness at a redaction boundary**. The other three cannot catch it — an invisible character costs one code point, arrives instantly, and adds no nesting depth.

- [`../best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`](../best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md) — the TIME axis.
- [`../best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md`](../best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md) — the SIZE axis. Its sizing corollary is the repo's other case of a wrong character-encoding assumption silently defeating a guard (UTF-16 code unit against UTF-8 byte).
- [`../best-practices/react-markdown-untrusted-nesting-crash-freeze-guard.md`](../best-practices/react-markdown-untrusted-nesting-crash-freeze-guard.md) — the SHAPE/DEPTH axis, and the doc that states the taxonomy.

### Nearest prior art

- [`log-injection-sanitizer-user-input-structured-logs-20260429.md`](log-injection-sanitizer-user-input-structured-logs-20260429.md) — the same "neutralize untrusted text before a downstream artifact" family, but its cause is a **missing** sanitizer while this one's cause is a **present** sanitizer whose class is the wrong set. Its prescribed pattern is itself a narrow shorthand; see the refresh note below.
- [`../integration-issues/mobile-hero-stream-url-trailing-whitespace-validation-gap.md`](../integration-issues/mobile-hero-stream-url-trailing-whitespace-validation-gap.md) — the mirror image. There an invisible character let a bad URL **pass** validation; here it lets a bad URL **evade** redaction. Same seam, opposite direction.
- [`codeql-tainted-output-striphtml-console-error-20260414.md`](codeql-tainted-output-striphtml-console-error-20260414.md) — the repo's other regex stripper at a trust boundary. It inherits the ordering hazard: delete invisibles **before** dropping HTML comments, or a zero-width-split `<!-- -->` re-forms into a live comment once the invisibles are removed.
- [`mastra-body-merged-requestcontext-forgeable-markers.md`](mastra-body-merged-requestcontext-forgeable-markers.md) — same app, same threat vocabulary. A forged marker is exactly what the HTML-comment strip defends against here.
- [`../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — the META home for falsification discipline. A sanitizer test whose fixture uses a character the **old** class already caught cannot detect the widening being reverted; that is the same vacuous-coverage trap, applied to character classes.
- [`../architecture-patterns/support-research-evidence-ledger-pattern-20260801.md`](../architecture-patterns/support-research-evidence-ledger-pattern-20260801.md) — the pipeline this workflow was cloned from, which establishes the code-enforced sanitizer placement for the same `apps/mastra` to Linear outbox shape.

### Refresh candidate

`log-injection-sanitizer-user-input-structured-logs-20260429.md` prescribes a sanitizer class narrower than its own stated goal of stripping control characters. It misses `U+0085`, `U+2028`, `U+2029`, and every zero-width character. For its own sink — a newline-splitting log parser — the narrow class is arguably adequate, so this is a scoping note rather than a contradiction.
