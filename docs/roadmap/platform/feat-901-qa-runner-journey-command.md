---
id: "feat-901"
title: "/qa-runner command for QA engineers to create or change mobile release check journeys"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-10-29"
duration: 1
depends_on:
  - "feat-888"
blocks: []
tags:
  - "mobile"
  - "infrastructure"
---

## Problem

`/release-check journey <journey id>` (feat-888) takes only the journey id. A QA engineer with no context who asks an agent "I want to create a journey to test the mobile app. How do I do this?" found the command, but no file said to describe the journey first or what to describe. The command also never asked, so an agent could write a journey from guesses.

## Entry Points — Read These First

1. `.claude/commands/qa-runner.md`: the QA-facing command. It keeps to the mobile release check, asks for the journey's brief, and then follows step 7 of `/release-check`.
2. `.claude/commands/release-check.md`, step 7 ("Journey"): the procedure, and step 7.1, which asks for the brief when the conversation lacks it.
3. `apps/mobile/release-check/README.md`, section "Write or repair a journey", subsection "Ask Claude for a journey".
4. `apps/mobile/release-check/__tests__/releaseCheckCommand.guard.test.js`, `describe("the /qa-runner command")`.

## Grep These

```bash
rg -n "qa-runner" .claude/commands CLAUDE.md apps/mobile/CLAUDE.md apps/mobile/release-check
```

## What To Build

- `/qa-runner` in `.claude/commands/` (the git-tracked home for shared commands; `.claude/skills/` is local only). It covers only `apps/mobile/release-check/`, and stops for a request about the web app, the TV app, or another app.
- It finds the task (new, change, or repair), asks only for what is missing (id, start, steps, checks, what not to tap, platforms, searches; for a repair, the run or the failing step), shows the brief back for a yes, and then does step 7 of `/release-check`.
- `/release-check` step 7.1 asks for the same brief when a person runs it without one.
- The README, `apps/mobile/CLAUDE.md`, and the root `CLAUDE.md` name `/qa-runner`.

## Constraints

- One procedure: `/qa-runner` hands over to step 7 of `/release-check` and does not copy it. The guard test pins the step numbers that the two files use for each other.
- Every yes that step 7 asks for still applies.

## Verification

- `npx jest release-check/__tests__/releaseCheckCommand.guard.test.js` from `apps/mobile` passes, and fails when `/qa-runner` loses its brief step or its web and TV exclusion.
- A fresh agent with no context, asked "I want to create a journey to test the mobile app. How do I do this?", names `/qa-runner` and what to describe.
