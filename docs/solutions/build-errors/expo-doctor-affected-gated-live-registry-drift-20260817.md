---
title: "Affected-gated expo-doctor bills upstream Expo patch drift to the first PR that wakes it"
date: "2026-08-17"
last_updated: "2026-09-30"
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
  - "the failing CI job is named expo-doctor, but the step that fails is `npx expo install --check`"
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
2. **The check validates against LIVE external state.** The job's first check,
   `npx expo install --check` (`.github/workflows/ci.yml:504-506`), compares
   installed versions to what Expo's servers expect for the SDK **today**, not
   to anything in the repo. The Expo CLI fetches `sdks/<sdk>/native-modules`
   from the Expo API (`@expo/cli` 57.0.26,
   `build/src/api/getNativeModuleVersions.js:19`). It uses the installed
   `expo/bundledNativeModules.json` only when `EXPO_OFFLINE` is set or the
   API cannot be reached
   (`build/src/start/doctor/dependencies/bundledNativeModules.js:83-97`). The
   pinned `expo-doctor` step after it runs with
   `EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK=1`, so the version failure always
   comes from the first step, even though the job is named `expo-doctor`.
   (Corrected 2026-09-28: this item first said "per the npm registry".)

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
5. Run the check both ways from `apps/mobile`. If `npx expo install --check`
   fails and `EXPO_OFFLINE=1 npx expo install --check` passes, the installed
   packages still match the installed SDK's own list, and the drift is
   upstream. (Verified 2026-09-28: online, seven packages failed; offline, the
   same tree reported "Dependencies are up to date".)

## Fix

Do not assume that changing only the first reported versions is sufficient. Bumping `expo` can raise
the expected patch floor of its **sibling** packages, so doctor then flags a
second wave (`expo-constants`, `expo-dev-client`, `expo-file-system`,
`expo-image`, `expo-linking`, …) plus a duplicate-native-module complaint from
the half-aligned tree. Use Expo's installer and rerun compatibility validation
after it finishes. For a scoped maintenance PR, start with the reported package
names (`expo install expo expo-build-properties --pnpm`, for example); inspect
any additional requirements before expanding scope. For an explicitly approved
full alignment, use:

```bash
cd apps/mobile
npx expo install --fix        # writes all aligned versions into package.json
cd ../.. && pnpm install      # refresh the workspace lockfile
cd apps/mobile
npx expo-doctor@<CI-pinned-version>   # verify 20/20 — use CI's exact version
```

Result here: nine patch bumps within the SDK 57 line (Expo's patch releases are
bug/security fixes only — no minors, no new packages), doctor 20/20, mobile
suite and typecheck green, full CI matrix green.

## Prevention / next-time playbook

- **Treat "conditionally-run CI check × live external state" as a standing
  hazard shape.** Any such check accumulates silent drift and discharges it at
  whoever wakes it. When one fails on your PR, check the two disqualifiers
  (rerun-identical; no dependency diff) before reading it as your regression.
- **A green main is only as fresh as its last run.** Compare run timestamps to
  upstream release dates before citing main as evidence.
- **Use Expo's installer and validate its final result.** A successful install
  is not proof of compatibility. Named-package installation is appropriate for
  bounded maintenance; `--fix` is appropriate when the full alignment is in scope.
- **Scope honesty:** the fix is a mobile dependency change riding in whatever PR
  woke the check. Say so in the commit message and offer to split it out; note
  that merging publishes nothing (mobile ships via EAS builds, not autodeploy),
  and native-module patch bumps only land in the next built binary/dev client.
- Piping build commands through `tail` swallows exit codes — the same session
  separately hit a "successful" build that had failed with exit 65. Capture
  `EXIT=$?` into the log file, or grep the log for the error summary, before
  trusting any piped build output.

## September 16, 2026 recurrence: Web rollout dependency

PR #2311 changed Web's Redis cache-handler patch and woke the Mobile check through
the workspace lockfile. All other PR checks passed, but existing `expo` 57.0.22
and `expo-build-properties` 57.0.17 failed the current patch recommendations.
The same failure reproduced on an earlier, untouched `main` commit (a
docs-only commit of 2026-09-15).

Merging a scoped fix with a documented baseline failure did **not** make its
Web rollout ready: the production Railway Web trigger has `checkSuites: true`.
The normal deployment waits for repository CI, including this unrelated check.
Inspect that trigger before treating an existing CI failure as release-neutral.
Repair the baseline through a separate normal PR; do not bypass the deployment
gate or redeploy local code.

feat-510 uses Expo's named-package installer to select 57.0.23 and 57.0.19. It
also updates three required Expo toolchain patches in the generated lockfile;
React, React Native and application source remain unchanged. The standalone
version check passes, and the exact CI isolation procedure passes all 19 Doctor
checks: `pnpm --filter @forge/mobile deploy --prod <temp>` followed by the pinned
Doctor with `EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK=1`. That setting belongs
only to the isolated second check; the preceding version check remains enabled.

## Recurrence record: plan for the next one

Expo publishes SDK 57 patch releases often, so this check goes red about
every one or two weeks. Each row is one alignment (or one open failure):

| Date (UTC) | Pull request       | What happened                                                                                                                                                            |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-17 | #1945              | The first recorded case (above). A TV PR woke the check through `packages/admin-graphql`.                                                                                |
| 2026-08-21 | #1986              | A scoped alignment of nine Expo packages, split out of the Better Auth upgrade.                                                                                          |
| 2026-08-28 | #2097              | The check went red on `main`. Railway's wait-for-CI gate then blocked every service's deploy, and a web page stayed a 404 until the bump merged.                         |
| 2026-09-15 | #2312 (`feat-510`) | The September 16 recurrence above.                                                                                                                                       |
| 2026-09-21 | #2355 (`feat-524`) | An alignment to the 57.0.24 patch set.                                                                                                                                   |
| 2026-09-26 | #2427 (open)       | `expo` 57.0.25 and six siblings were published 2026-09-24T10:13Z. As of 2026-09-28, no alignment PR exists, so every PR that wakes the check fails it.                   |
| 2026-09-28 | #2432 (`feat-556`) | An alignment of seven packages to the 57.0.25 patch set.                                                                                                                 |
| 2026-09-30 | #2509 (`feat-582`) | `expo` 57.0.26 and three siblings were published 2026-09-29T10:57Z. PR #2466 woke the check, then merged with it red, so `main` went red. An alignment of four packages. |

Two things follow for the next agent:

- **Expect it, and split it out.** When the check fails on a PR with no
  dependency change, do not fix it in that PR. Open the separate alignment PR
  from `main` that the Fix section describes, and say in the feature PR that
  the failure is upstream drift.
- **The structural cause is still open.** #2097 proposed two fixes: make the
  version check non-blocking for `ci-gate`, or scope the Railway deploy gate
  to each service. As of 2026-09-28, no roadmap ticket tracks either one.

## Cross-references

- `docs/solutions/build-errors/expo-doctor-sdk54-health-checks-mobile-v2-20260409.md`
  — different expo-doctor failure mode (accumulated project-config health issues
  when the check was first introduced). Together they cover both ways this job
  goes red: config debt vs. upstream registry drift.
- Fixed in PR #1945 (`feat/tv-combined`, squash-merged 2026-08-17).
