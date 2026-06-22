---
title: Running a large plan unattended (tmux + headless Claude loop) and the pre-commit discipline it requires
date: 2026-06-22
category: docs/solutions/workflow-issues
module: compound-engineering / ce-work (autonomous execution)
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - Executing a large multi-unit ce-plan/ce-work plan hands-off (operator away)
  - Driving headless Claude (`claude -p`) in a loop to land many commits unattended
  - Committing autonomously in this repo (any agent or human scripting commits)
  - Auto-firing a code review when an unattended run completes
tags:
  - tmux
  - headless-claude
  - unattended-execution
  - ce-work
  - lint-staged
  - commitlint
  - pre-commit-hooks
  - autonomous-agents
---

# Running a large plan unattended (tmux + headless Claude loop) and the pre-commit discipline it requires

## Context

A 10-unit plan (the admin→standalone Mastra consolidation) needed to run hands-off: the operator asked to "do it in tmux" and walk away, then auto-review the result. Running an interactive agent masks a cluster of gotchas — a human silently re-formats files, fixes a rejected commit message, regenerates a client, and retries a flaky review. Unattended, each of those is a **hard stop that wastes a whole turn or silently produces nothing**, and the loop stalls without obvious error. This documents the harness shape that works and the four pre-commit/environment rules an unattended agent must pre-empt so commits don't stall the loop.

## Guidance

**1. Drive the work from a detached tmux session running headless Claude in a loop, gated by a sentinel file.**

- A runner script in `tmux new-session -d` runs `claude -p "<self-contained kickoff prompt>" --model opus --permission-mode bypassPermissions`. The prompt tells the agent to implement units one at a time, run typecheck/tests/lint per unit, **commit each (never `--no-verify`), NOT push**, and `touch <SENTINEL>` only when ALL units are done.
- After the kickoff, loop `claude --continue -p "<continue prompt>"` (same flags) until the sentinel exists, up to a bounded round count. `--continue` resumes the SAME headless conversation, so the work survives a turn that ends mid-plan. One long kickoff turn often clears many units before the first continue is even needed.
- **Monitor via `git log --oneline` and the sentinel file — NOT the headless log.** `claude -p` (print mode) only flushes output when a turn completes, so the log looks empty mid-turn; the real-time progress signal is new commits + the changing working tree.

**2. Fire the post-run review from a SEPARATE detached watcher, independent of the operator's session.**

- A second tmux session polls for the sentinel, then runs the review headlessly and writes findings to a file. Independence means the review still happens even if the operator's interactive session is closed.

**3. Pre-empt the four things that stall an unattended commit in this repo:**

- **lint-staged runs `eslint --max-warnings=0` BEFORE `prettier --write`**, and eslint has `eslint-plugin-prettier/recommended` active — so any prettier formatting deviation surfaces as a **blocking eslint error** before the `prettier --write` step can auto-fix it. Run `pnpm exec prettier --write <changed files>` yourself, then `pnpm exec eslint --max-warnings=0 <files>`, BEFORE `git commit`.
- **commitlint (`@commitlint/config-conventional`) enforces `subject-case`** — a subject that starts with an uppercase token is rejected. Keep the subject lowercase after the `type(scope):` prefix: `fix(mastra): add SSRF host allowlist…` passes; `fix(mastra): SSRF host allowlist…` is rejected.
- **A fresh git worktree has no generated Prisma client.** Run `pnpm --filter @forge/admin db:generate` (prisma generate) before typecheck, or `@prisma/client` exports resolve to nothing and typecheck floods with hundreds of false `has no exported member` errors that look like your change broke everything.
- **Commit, do not push.** Pushing is outward-facing and is the operator's explicit decision; an unattended run should leave clean local commits for review.

**4. Prefer a multi-agent Workflow review over a single headless `claude -p` review for resilience.**

- A single headless review died on a transient API 429 (`Server is temporarily limiting requests`) and wrote no output at all. A multi-agent Workflow review (parallel dimension reviewers + a synthesis step) is resilient: a dead agent drops out (`.filter(Boolean)`) and the surviving reviewers still produce findings. (Note the one gap: if a reviewer dies, that dimension is uncovered — surface it, don't claim full coverage.)

## Why This Matters

Interactive execution hides these failures because a human absorbs them reflexively. Unattended, they are silent or fatal: a prettier deviation fails the commit hook (eslint-before-prettier), a capitalized subject fails commitlint, an ungenerated Prisma client makes every typecheck "fail," and a transient 429 silently voids a single-shot review. Pre-empting all four is the difference between "run my plan in tmux and walk away" actually finishing end-to-end versus stalling on commit #1 with the operator none the wiser.

## When to Apply

- A plan is large enough to want hands-off execution (many units, long wall-clock).
- You're scripting commits via headless Claude or any non-interactive automation in this repo.
- You want a code review to run automatically when an unattended run finishes.

## Examples

Runner loop (sentinel-gated; commit-not-push lives in the prompt):

```bash
SENT=/tmp/plan-DONE; rm -f "$SENT"
claude -p "$KICKOFF" --model opus --permission-mode bypassPermissions >> "$LOG" 2>&1
for i in $(seq 1 14); do
  [ -f "$SENT" ] && break
  claude --continue -p "$CONTINUE" --model opus --permission-mode bypassPermissions >> "$LOG" 2>&1
done
```

Separate watcher that auto-reviews on completion:

```bash
for _ in $(seq 1 720); do [ -f "$SENT" ] && break; sleep 30; done
[ -f "$SENT" ] && claude -p "$REVIEW_PROMPT" --permission-mode bypassPermissions >> "$RLOG" 2>&1
```

Commit gotchas, fixed:

```bash
# eslint runs BEFORE prettier in lint-staged → format yourself first
pnpm exec prettier --write path/to/changed.ts
pnpm exec eslint --max-warnings=0 path/to/changed.ts
# fresh worktree → generate the prisma client before typecheck
pnpm --filter @forge/admin db:generate
# commitlint subject-case: lowercase after the prefix
git commit -m "fix(mastra): add SSRF host allowlist to the admin agent-tools client"   # passes
# git commit -m "fix(mastra): SSRF host allowlist…"                                       # REJECTED
```

## Related

- `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md` — Tier-2-review-before-push rule. This learning extends it: under unattended/headless execution prefer a multi-agent Workflow review over a single headless `claude -p` review, which is fragile to transient API 429s.
- `docs/solutions/database-issues/admin-prisma-client-and-db-migration-drift-after-pull-20260603.md` — stale Prisma client breaking typecheck/build; the fresh-worktree `prisma generate` rule here is the worktree variant.
- `docs/solutions/mobile/jest-mock-import-first-lint-ordering.md` — canonical example of `eslint --max-warnings=0` turning a lint nit into a commit/CI blocker (same enforcement mechanism this relies on).
- `docs/solutions/developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md` — fresh-worktree environment-setup gotchas (generated artifacts not present), adjacent to the prisma-generate rule.
- `docs/solutions/platform/devcontainer-setup.md` — devcontainer/worktree provisioning backdrop for running a detached tmux loop in-container.
