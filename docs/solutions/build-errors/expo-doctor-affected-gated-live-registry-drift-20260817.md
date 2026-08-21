---
title: "Affected-gated expo-doctor bills upstream Expo patch drift to the first PR that wakes it"
date: "2026-08-17"
category: build-errors
module: mobile
problem_type: build_error
component: ci
severity: medium
symptoms:
  - "expo-doctor fails 'packages match versions required by installed Expo SDK' on a PR that changes no dependency files"
  - "main is green for the same tree state"
  - "gh run rerun --failed fails identically (not flake)"
  - "after bumping only the named packages, doctor names MORE packages plus a duplicate-native-module failure"
root_cause: environment_config
resolution_type: dependency_update
related_components:
  - development_workflow
  - continuous_integration
tags:
  - expo
  - expo-doctor
  - ci
  - affected-gating
  - dependency-drift
  - pnpm-monorepo
---

# Affected-gated expo-doctor bills upstream Expo patch drift to the first PR that wakes it

## Problem

The combined TV PR (#1945, `feat/tv-combined`) failed CI's `expo-doctor` job —
"Check that packages match versions required by installed Expo SDK" — while every
other check passed. The branch changed **zero** dependency files, and `main` was
green on the same manifest state.

## Root cause — two properties compose into wrong-PR billing

1. **The check is affected-gated.** CI runs `expo-doctor` only when
   `@forge/mobile` is in the affected set
   (`contains(fromJson(needs.affected.outputs.services), '@forge/mobile')` in
   `.github/workflows/ci.yml`). Most PRs never run it.
2. **The check validates against LIVE external state.** `expo-doctor` compares
   installed versions to what the Expo SDK currently expects **per the npm
   registry today**, not to anything in the repo.

So when Expo published patch releases (`expo 57.0.13`, `@expo/metro-runtime
57.0.10`, …), no CI noticed — until the first PR whose blast radius reached
mobile's dependency graph. Here that reach was indirect: the PR regenerated
`packages/admin-graphql`'s introspection artifact (for a TV/admin feature), and
mobile depends on that package, so turborepo marked mobile affected and the
dormant check woke against a registry that had moved. "Main is green" was
survivorship, not health: main's last run simply predated the publications.

The failure therefore lands on whoever wakes the check, not on whatever caused
the drift.

## Investigation shape that identified it (reusable)

1. `gh run rerun <run-id> --failed` → identical failure ⇒ **not flake**.
2. `git diff origin/main...HEAD --name-only | grep -E 'package.json|pnpm-lock'`
   → empty ⇒ **not this PR's diff**.
3. Latest main CI runs green _but check the timestamps_ — green-before-publication
   proves nothing about the registry state your run saw.
4. Read the job log's mismatch table (`expected` vs `found` columns) — it names
   the moved packages outright.

## Fix

Do NOT hand-bump only the packages the first log names. Bumping `expo` raises
the expected patch floor of its **sibling** packages, so doctor then flags a
second wave (`expo-constants`, `expo-dev-client`, `expo-file-system`,
`expo-image`, `expo-linking`, …) plus a duplicate-native-module complaint from
the half-aligned tree. Align the whole set with Expo's own tool:

```bash
cd apps/mobile
npx expo install --fix        # writes all aligned versions into package.json
cd ../.. && pnpm install      # refresh the workspace lockfile
cd apps/mobile
npx expo-doctor@<CI-pinned-version>   # verify 20/20 — use CI's exact version
```

Result here: nine patch bumps within the SDK 54 line (Expo's patch releases are
bug/security fixes only — no minors, no new packages), doctor 20/20, mobile
suite and typecheck green, full CI matrix green.

## Prevention / next-time playbook

- **Treat "conditionally-run CI check × live external state" as a standing
  hazard shape.** Any such check accumulates silent drift and discharges it at
  whoever wakes it. When one fails on your PR, check the two disqualifiers
  (rerun-identical; no dependency diff) before reading it as your regression.
- **A green main is only as fresh as its last run.** Compare run timestamps to
  upstream release dates before citing main as evidence.
- **Use `expo install --fix`, never selective hand-bumps** — the SDK's expected
  versions move as a set.
- **Scope honesty:** the fix is a mobile dependency change riding in whatever PR
  woke the check. Say so in the commit message and offer to split it out; note
  that merging publishes nothing (mobile ships via EAS builds, not autodeploy),
  and native-module patch bumps only land in the next built binary/dev client.
- Piping build commands through `tail` swallows exit codes — the same session
  separately hit a "successful" build that had failed with exit 65. Capture
  `EXIT=$?` into the log file, or grep the log for the error summary, before
  trusting any piped build output.

## Cross-references

- `docs/solutions/build-errors/expo-doctor-sdk54-health-checks-mobile-v2-20260409.md`
  — different expo-doctor failure mode (accumulated project-config health issues
  when the check was first introduced). Together they cover both ways this job
  goes red: config debt vs. upstream registry drift.
- Fixed in commit `551a12f9` on `feat/tv-combined` (PR #1945).
