Run ce-code-review, fix all actionable findings, then re-review — looping until the review is clean.

## Process

### Round 1: Initial review

1. Run `/ce-code-review` in interactive mode (no arguments needed — it reviews
   the current branch). The skill is hyphenated and named `ce-code-review`;
   `/ce:review` and `/ce-review` do not resolve. If it is unavailable, follow the
   plugin preflight in `.claude/commands/work.md` before continuing.
2. When the review presents findings and asks the policy question, select **"Apply safe_auto fixes and leave the rest as residual work"** (or the closest option that applies all safe fixes).
3. If the review offers to apply fixes, let it proceed.

### Round 2+: Fix and re-review loop

After fixes are applied:

1. Run the test suite for affected packages to verify fixes don't break anything:
   - `pnpm --filter @forge/cms test` (if CMS files changed)
   - `pnpm --filter @forge/web test` (if web files changed)
   - Adjust for whichever packages were touched.
2. If tests fail, fix the test failures before continuing.
3. Run `/ce-code-review` again on the updated code.
4. If new findings appear, apply safe_auto fixes again.
5. Repeat until the review returns **"Ready to merge"** with zero actionable findings (P0-P2).

### Exit conditions

Stop looping when ANY of these are true:

- The review verdict is **"Ready to merge"** with no P0-P2 findings
- The only remaining findings are **P3 advisory** items (user's discretion)
- The same finding appears in consecutive rounds with no viable fix (avoid infinite loops)
- **Maximum 3 rounds** have been completed (to prevent runaway loops)

### What to fix vs. skip

| Category              | Action                                                  |
| --------------------- | ------------------------------------------------------- |
| `safe_auto` findings  | Fix immediately                                         |
| `gated_auto` findings | Ask the user before fixing (changes behavior/contracts) |
| `manual` findings     | Report to user, do not fix automatically                |
| `advisory` findings   | Report only, never fix                                  |
| Pre-existing findings | Skip — not introduced by this branch                    |

### After the loop completes

Report a summary:

```
Review-fix loop complete after N rounds.

Round 1: X findings → Y fixed
Round 2: X findings → Y fixed
...
Final verdict: [Ready to merge / Ready with advisory items]

Remaining advisory items (if any):
- [list P3 items]
```
