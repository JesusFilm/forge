Compile a short, presentable bullet-point recap of the work I shipped to production, for a weekly stand-up. Optional window override: `$ARGUMENTS`.

Follow project rules in `CLAUDE.md` and `AGENTS.md`. Keep the readability contract: plain language, no jargon, no PR-speak.

## Why this exists

I present my week at a 5-person stand-up that runs ~1 hour — everyone takes a turn, so my slot is **5–10 minutes**. I need a tight, spoken-aloud bullet list of what I actually shipped, not an exhaustive changelog. **Your job is to decide what is worth saying out loud and cut the rest.**

## Argument format

`/recap-me [window]`

- No argument → default window is the **last 7 days**.
- `window` may be a day count (`10d`, `14`) or an explicit start date (`2026-07-01`). Interpret loosely; when in doubt use 7 days.

## What counts as "shipped to production"

This repo has **no staging environment** and production deploys happen via **PR merge to `main` + Railway autodeploy** (see `CLAUDE.md` → Deployment). So: **a PR I authored that is merged into `main` inside the window = shipped to production.** Do not try to reconcile Railway deploy logs — merge-to-`main` is the source of truth. (For the `tv`/`mobile` client apps a merge means the code landed and rolls out on the next EAS/app-store build; still count it, but you may note "pending release build" if a bullet hinges on it.)

## Steps

1. **Compute the cutoff date.**
   - macOS: `CUTOFF=$(date -v-7d +%Y-%m-%d)` (swap `7` for the requested day count).
   - Linux fallback: `CUTOFF=$(date -d '7 days ago' +%Y-%m-%d)`.
   - If given an explicit start date, use it directly.

2. **Confirm whose recap this is**, then **pull my merged-to-`main` PRs in the window** (authored by me, base `main`, merged):

   ```bash
   WHOAMI=$(gh api user --jq '.login')   # the active gh account — this is who "me" means
   gh pr list --author "@me" --base main --state merged --search "merged:>=$CUTOFF" \
     --json number,title,mergedAt,url,additions,deletions,labels \
     --jq 'sort_by(.mergedAt) | reverse | .[] | "\(.number)\t\(.mergedAt[0:10])\t+\(.additions)/-\(.deletions)\t\(.title)"'
   ```

   `@me` is resolved by `gh` to the **active authenticated GitHub account** on this machine (not git `user.name`, not a hardcoded name) — so on my laptop it means `Ur-imazing`, and a teammate running this on their own machine gets their own PRs automatically. Capture `WHOAMI` so the output can name the account (below); if it isn't the account I expected, that's the signal something's off. If a high-value PR's title is too terse to summarize, and only then, run `gh pr view <number>` for its body — don't fetch all of them.

3. **Group and prioritize (this is the real work).** Turn the raw list into a stand-up. Apply this judgment:
   - **Collapse clusters into one outcome bullet.** Several PRs that advance the same feature (e.g. a multi-PR rollout of one screen) become a single bullet, not one bullet each.
   - **Lead with user-facing shipped features**, then meaningful fixes, then notable infra. A big diff is a hint, not a rule — a 3k-line refactor can be one quiet bullet; a 40-line fix to a broken prod flow can lead.
   - **Down-rank or drop the noise:** pure `docs`/roadmap edits, `.env`/tooling `chore`s, and internal refactors with no observable outcome. Omit them, or sweep them into a single "also landed" footnote line — never a bullet each.
   - **Translate, don't transcribe.** Rewrite conventional-commit titles into plain outcomes a non-engineer teammate understands. `feat(tv): render Home from the admin watch-home Experience` → "TV home screen now pulls its content live from the admin CMS." No `feat(...)`, no ticket IDs, no file names.
   - **Group by app/platform** (TV / mobile / web / admin) only when it aids scanning; otherwise a flat priority order is fine.

4. **Size it for the slot.** Target **5–8 bullets max**, each **one line, spoken-aloud short**. If the week was huge, that means cutting good work, not shrinking the font — pick the headline items I'd actually want credit for.

## Output format

Return only this, as markdown I can read straight off the screen:

- First, a single italic verification line naming the account, so I can confirm at a glance it pulled _my_ work: `_Recap for @<WHOAMI> · <date range>_`.
- A one-line header: date range + count, e.g. `**Stand-up recap — Jul 7–14 (18 PRs shipped)**`.
- The prioritized bullets (5–8), outcome-first, plain language.
- Optional final line: `_Also landed:_ <comma-separated one-liner of the minor/chore/docs items>` — only if there were any.

Do not include the raw PR table, PR numbers, commit prefixes, or diff stats in the final recap unless a number genuinely strengthens a talking point. If **zero** PRs merged in the window, say so plainly and stop — don't pad.

## Example transformation

Raw (what the query returns):

```
1534  feat(tv,mobile): render Home hero as playable films/shorts (web parity)
1526  feat(tv): render Home from the admin watch-home Experience (U3–U9)
1499  fix(tv): render experience container blocks side-by-side
1482  fix(tv): home loading skeleton fills the full screen
1536  docs(roadmap): feat-240 — origin bypass confirmed open
```

Recap (what you present):

- **Brought the TV home screen to parity with web** — it now renders live from the admin CMS, with a playable hero and correct multi-column layout.

_Also landed:_ roadmap/status doc updates.
