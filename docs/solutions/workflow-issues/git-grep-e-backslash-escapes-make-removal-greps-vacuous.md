---
title: git grep -E reads \b as a literal b on Apple Git, so a removal grep can pass vacuously
date: 2026-09-23
category: workflow-issues
module: roadmap + compound-engineering
problem_type: workflow_issue
component: development_workflow
severity: medium
root_cause: wrong_api
resolution_type: workflow_improvement
applies_when:
  - You write the grep patterns of a removal-recipe ticket
  - You write or run a prose sweep for a retired mechanism
  - A verification step treats an empty grep result as proof that code or prose is gone
  - You start a removal from a recipe that another person or another machine wrote
  - A git grep -E pattern contains a backslash escape such as \b, \<, \d, \s, or \w
related_components:
  - roadmap
  - compound-engineering
tags:
  - git-grep
  - regex
  - word-boundary
  - removal-recipe
  - prose-sweep
  - verification
  - positive-control
  - macos
---

# git grep -E reads \b as a literal b on Apple Git, so a removal grep can pass vacuously

## Context

The feat-543 branch (`feat/mobile-sign-in-gate`) adds a mobile sign-in gate. The same branch adds the removal ticket, `docs/roadmap/platform/feat-544-mobile-remove-sign-in-gate.md`. The ticket follows the removal-recipe learning: greps find the removal sites, and an empty grep is the proof of removal.

The first draft of one ticket grep was:

```bash
git grep -nE 'isSignInAvailable|resolveSignInAvailable|signInGateState|signInGate\b' -- apps/mobile
```

In the session, the agent ran the last branch alone against a file that contains `signInGate`. Line 16 of `apps/mobile/src/components/watch/SignInPrompt.tsx` imports `isSignInAvailable` from `apps/mobile/src/lib/signInGate.ts`. The branch found nothing. The table shows the results on `git version 2.50.1 (Apple Git-155)`. The machine has no `grep.*` git configuration, so `git grep` uses its default engine.

| Command on `SignInPrompt.tsx`                               | Result            |
| ----------------------------------------------------------- | ----------------- |
| `git grep -cE 'signInGate\b'`                               | no output, exit 1 |
| `git grep -cE 'signInGate'`                                 | 1                 |
| `git grep -cP 'signInGate\b'`                               | 1                 |
| `git grep -cw 'signInGate'`                                 | 1                 |
| `git grep -cE 'signInGate[[:>:]]'`                          | 1                 |
| `/usr/bin/grep -cE 'signInGate\b'` (BSD grep 2.6.0-FreeBSD) | 1                 |

The observed cause: `git grep -E` on this machine reads `\b` as the letter `b`. The proof is `git grep -cE 'isSignInAvaila\ble'`, which matches `isSignInAvailable` (count 2 in the same file). So `signInGate\b` searches for the string `signInGateb`, and that string does not occur.

Other backslash escapes fail in the same way. On the same file, the `-E` patterns `\<LD\>`, `feat-\d+`, `import\s+\{`, and `isSignIn\w+` all return nothing. The POSIX forms `feat-[0-9]+` and `import[[:space:]]+\{` match. The `-P` forms `feat-\d+` and `import\s+\{` also match.

A broken escape can also match the wrong text. Across the `*.md` files, `git grep -lE 'feat-\d+'` finds 14 files, because it searches for `feat-d`. It matches names such as `feat-demo-` and `feat-daily-`, not ticket IDs. So a non-empty result does not prove that the pattern works as written.

The shell `grep` on the same machine accepts `\b` (the last table row). That is why the pattern looks correct. An author who tests it in the shell sees hits, and then `git grep` returns nothing.

The session fixed the ticket. `docs/roadmap/platform/feat-544-mobile-remove-sign-in-gate.md:39` now reads `git grep -nE 'isSignInAvailable|resolveSignInAvailable|signInGate' -- apps/mobile`. The `signInGate` literal also matches `signInGateState`, so the ticket needs no boundary. Line 44 of the ticket adds the warning: "Do not add `\b` to a pattern: `git grep -E` on macOS does not support it, and the pattern then matches nothing."

### A second instance, now fixed

`docs/solutions/workflow-issues/mechanism-retirement-docs-prose-sweep.md:91-92` gives this prose sweep:

```bash
git grep -niE 'strapi|launchdarkly|\bLD\b|SEARCH_API_KEYS' -- '*.md'
git grep -niE 'strapi|launchdarkly|\bLD\b|SEARCH_API_KEYS' -- '*.ts' '*.tsx'
```

The `\bLD\b` branch is dead on this machine. These counts come from the current tree:

| Command                                                                   | Lines |
| ------------------------------------------------------------------------- | ----- |
| `git grep -niE '\bLD\b' -- '*.md'`                                        | 0     |
| `git grep -niw 'LD' -- '*.md'`                                            | 245   |
| `git grep -niP '\bLD\b' -- '*.md'`                                        | 245   |
| `git grep -niE '\bLD\b' -- '*.ts' '*.tsx'`                                | 0     |
| `git grep -niw 'LD' -- '*.ts' '*.tsx'`                                    | 48    |
| `git grep -niE 'strapi\|launchdarkly\|\bLD\b\|SEARCH_API_KEYS' -- '*.md'` | 3292  |
| The same alternation without the `LD` branch, with `-niE`                 | 3292  |
| The same alternation with `-niP`                                          | 3515  |

The full sweep prints 3,292 lines, so nothing looks wrong. But the `LD` branch adds zero lines, and `-P` shows 223 more lines. The sweep doc names "LD" as its example of an abbreviation that repo prose uses (lines 73 and 81). So the branch that the doc marks as a recall risk is the branch that fails. On 2026-09-23, the same branch moved these commands to the `-P` form and added a note that points to this learning.

### A third instance

`docs/plans/2026-07-28-002-feat-mobile-search-observability-parity-plan.md:331` gives a prose sweep with the branch `\bsearch\.result_clicked`. The plan uses `\b` on purpose, to exclude the new name `watch_search.result_clicked`. On this machine, that branch returns 0 lines under `-E` and 2 lines under `-P`. The 2 hits are lines 309 and 331 of the plan itself. So the current tree shows no stale document that the dead branch missed. This doc does not know on which machine that sweep ran.

## Guidance

### 1. Give every grep a positive control when you write it

Run each pattern against the live tree before you put it in a recipe. Each pattern must return at least one hit. A pattern with zero hits at write time is dead, or it points at nothing. Both are errors in a removal recipe. This is the anti-vacuous rule that the repo already applies to tests. For example, `apps/mobile/src/lib/__tests__/signInGateWiring.guard.test.js:99` is the positive control for the feat-543 source guard.

```bash
# Run each branch alone. Each count must be above 0.
for p in 'EXPO_PUBLIC_SIGN_IN_ENABLED' 'isSignInAvailable' 'resolveSignInAvailable' 'signInGate'; do
  printf '%s: ' "$p"
  git grep -lE "$p" -- apps/mobile | wc -l
done
```

On the feat-543 branch, the counts are 7, 9, 4, and 11 files.

### 2. Run the same control when the removal starts

The control at write time proves the pattern on one machine, on one day. The person who does the removal can use a different machine and a different git build. So start the removal with the same step. Run each grep before you delete anything, and see hits. Then delete, and run the greps again for an empty result.

An empty result is proof only after a non-empty result from the same command on the same machine. This rule makes the recipe independent of the regex engine. This doc does not claim how other git builds treat `\b`. It claims only the Apple Git 2.50.1 results above.

### 3. Write word boundaries in a form that `git grep` accepts

Do not use `\b`, `\<`, `\>`, `\d`, `\s`, or `\w` with `git grep -E`. Use one of these forms:

- **Drop the boundary.** For a removal grep, a pattern that matches too much is safe: you read the extra hits and skip them. A pattern that matches too little hides removal sites. `signInGate` alone matches `signInGate` and `signInGateState`, which is correct for feat-544. Do not drop the boundary for a short abbreviation: `git grep -niE 'LD' -- '*.md'` returns 26,484 lines.
- **Use `git grep -P`** when a boundary is necessary. The git on this machine supports `-P`. It also accepts `\d`, `\s`, and `\w`.
- **Use `git grep -w`** for one word in its own command. The `-w` flag applies to the whole pattern, not to one branch. `git grep -lwE 'signInGate' -- apps/mobile` finds 8 files, but the pattern without `-w` finds 11. The line-91 alternation with `-niwE` returns 3,310 lines, but `-niP` returns 3,515.
- **Use POSIX bracket classes** for character classes: `[0-9]` for `\d`, and `[[:space:]]` for `\s`.

`[[:>:]]` matched on this machine, but it is a BSD-specific class. Do not put it in a shared recipe.

### 4. In an alternation, check each branch alone

A dead branch does not make the command fail. The other branches still print hits, and the output looks normal. The line-91 sweep prints 3,292 lines and silently drops the `LD` lines. Only a run of each branch alone shows the dead branch. Use the loop in step 1.

## Why This Matters

For a removal check, an empty result is the success signal. A dead pattern also gives an empty result. So the failure looks the same as success, and nobody sees it.

The removal-recipe learning makes "grep returns empty + typecheck green" the proof of removal (`docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md:100-107`). Its rename covenant (lines 84-90) covers a pattern that goes stale when someone renames a symbol. It does not cover a pattern that the regex engine makes dead from the first day.

The typecheck half does not help here. Typecheck catches a deleted symbol that code still imports. If a dead grep is the only pattern that finds a site, the remover does not delete that site. That code stays unchanged, so typecheck stays green. Both checks pass, and the scaffolding stays in the code.

For a prose sweep, the failure is partial. The sweep returns many hits, so the operator believes that it ran in full. The lines that only the dead branch matches never reach the classify step. In the line-91 sweep, those lines are the "LD" lines.

## When to Apply

- You write the "Grep These" section of a removal-recipe ticket.
- You write or run a prose sweep for a retired mechanism.
- A verification step uses "the grep returns nothing" as proof.
- You start a removal from a recipe that another person wrote.
- A `git grep -E` pattern contains a backslash escape such as `\b`, `\<`, `\d`, `\s`, or `\w`.

## Examples

### Removal grep (feat-544)

Before. The last branch is dead on Apple Git 2.50.1:

```bash
git grep -nE 'isSignInAvailable|resolveSignInAvailable|signInGateState|signInGate\b' -- apps/mobile
```

After (`docs/roadmap/platform/feat-544-mobile-remove-sign-in-gate.md:39`). The `signInGate` literal also covers `signInGateState`:

```bash
git grep -nE 'isSignInAvailable|resolveSignInAvailable|signInGate' -- apps/mobile
```

### Prose sweep (mechanism-retirement-docs-prose-sweep.md:91)

Before. The command returns 3,292 lines, and the `LD` branch adds 0:

```bash
git grep -niE 'strapi|launchdarkly|\bLD\b|SEARCH_API_KEYS' -- '*.md'
```

After, option A. The command returns 3,515 lines, and the `LD` branch adds 245:

```bash
git grep -niP 'strapi|launchdarkly|\bLD\b|SEARCH_API_KEYS' -- '*.md'
```

After, option B. Keep `-E` for the literal branches, and give the abbreviation its own `-w` command:

```bash
git grep -niE 'strapi|launchdarkly|SEARCH_API_KEYS' -- '*.md'
git grep -niw 'LD' -- '*.md'
```

For either option, run each branch alone once and confirm a count above 0.

## Related

- `docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md`: part 4 makes "grep returns empty + typecheck green" the proof of removal, and its rename covenant covers a pattern that goes stale after a rename. This learning adds a second cause of the same empty result: the regex engine.
- `docs/solutions/workflow-issues/mechanism-retirement-docs-prose-sweep.md`: the sweep now uses the `-P` form, and a note there points to this learning (see the second instance above).
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`: the repo's anti-vacuous discipline for tests. This learning applies the same positive-control rule to shell greps.
- `docs/solutions/best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md`: a sibling sweep failure, where one pattern misses a second syntax family.
- `docs/roadmap/platform/feat-544-mobile-remove-sign-in-gate.md`: the corrected removal ticket.
