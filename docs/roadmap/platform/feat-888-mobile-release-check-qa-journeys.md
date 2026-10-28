---
id: "feat-888"
title: "QA engineers write and repair mobile release check journeys"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-10-28"
duration: 1
depends_on:
  - "feat-798"
blocks:
  - "feat-901"
tags:
  - "mobile"
  - "infrastructure"
---

## Problem

The mobile release check (feat-798) gave the QA engineers a way to run the check, but not a way to repair or write a journey. QA engineers have Claude Code, write access to the repo, and their own local admin, so they can do this work. Without fixed steps, each QA engineer's Claude decides for itself how much to test, which config lists it may change, and when it must ask. A fresh Mac without CocoaPods also passed `setup --check` and then failed at `ios-pod-install` in the middle of a run.

## Entry Points — Read These First

1. `.claude/commands/release-check.md`, step 7: the `journey <journey id>` form that a QA engineer's Claude follows.
2. `apps/mobile/release-check/README.md`, section "Write or repair a journey": the journey rules and the short form of step 7.
3. `apps/mobile/release-check/lib/session.js`, `checkedBuild`: the build of HEAD that a session needs, and the files that do not block a new build.
4. `apps/mobile/release-check/lib/devices/setup.js`, `checkCocoaPods`: the CocoaPods check.
5. `docs/solutions/developer-experience/maestro-journey-authoring-traps-mobile-release-check.md`: the Maestro traps.

## Grep These

```bash
rg -n "Journey\*\* \(\`journey" .claude/commands/release-check.md
rg -n "buildInputChanges|AUTHORING_LISTS" apps/mobile/release-check/lib/session.js
rg -n "COCOAPODS_MISSING" apps/mobile/release-check/lib apps/mobile/release-check/__tests__
```

## What To Build

- A `journey <journey id>` form of `/release-check` with fixed steps: a branch, session tries on one device of each platform that the journey runs on, a class-based reaction to each failed try, `check-lists` and `check-screens`, `record-search` after `session down` for a new search, one commit, a partial check on all five devices, and a pull request that the mobile owner merges.
- A journey change may change only `not-tested.json`, `screens.json`, and `search-answers.json`. The mobile owner keeps the other four lists.
- `session up` and `record-search` build HEAD while a journey file or one of those three lists has uncommitted changes, because the build checks out the commit. `run` still refuses them.
- `setup --check` runs `pod --version` with the build's PATH and Ruby settings, and names the fix for a missing `pod` or for an rbenv shim with no gem.

## Constraints

- A QA engineer's Claude never removes or weakens a check only to make a journey pass. An app crash, a blocked request, or wrong app behavior goes to the mobile owner.
- Every device action keeps its own yes. Only the mobile owner merges.
- Never call `maestro` directly, and never use a `Forge RC` simulator or a `forge_rc_` emulator outside the runner.

## Verification

- `npx jest release-check` from `apps/mobile` passes, including `session.test.js` (uncommitted journey files do not block a build; an app change or a test settings change still does), `setup.test.js` (the CocoaPods cases), and `releaseCheckCommand.guard.test.js`.
- `node apps/mobile/release-check/cli.mjs setup --check` names CocoaPods on a Mac without `pod` on PATH.
- The first QA engineer repairs or writes one journey with `/release-check journey <journey id>`, from a fresh clone, and the pull request carries a passing partial check.
