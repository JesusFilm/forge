---
title: "fix: Normalize roadmap frontmatter for deploy builds"
type: "fix"
date: "2026-07-07"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

## Goal Capsule

- **Objective:** Restore `apps/roadmap` Railway deployments by preventing malformed roadmap markdown frontmatter from crashing `next build`.
- **Authority:** The failing Railway deployment log and local reproduction with `pnpm --filter roadmap build` are the source of truth for the bug.
- **Scope:** Harden the roadmap viewer's file-backed parser, clean the known malformed roadmap tickets, add a traceable roadmap ticket for the hotfix, and preserve the deployment learning in `docs/solutions/`.
- **Stop condition:** The same roadmap build command that failed on `/person/[person]` completes locally, lint passes for the touched app, the durable learning is documented, and a PR is ready to merge.

---

## Product Contract

### Summary

The roadmap app treats `docs/roadmap/**` as production input. Its parser must tolerate YAML frontmatter values produced by `gray-matter`, including date scalars parsed as `Date`, without crashing static generation for owner pages.

### Problem Frame

Railway failed during `apps/roadmap` image build with `Error: Failed to collect page data for /person/[person]`. Local reproduction showed `TypeError: a.start_date.localeCompare is not a function` in `getAllFeatures()`. The immediate trigger is unquoted `start_date: 2026-07-06` values that `gray-matter` parses into `Date` objects, while the app's `Feature` type and sort assume strings.

### Requirements

- R1. Roadmap builds must not crash when YAML frontmatter dates arrive as `Date` objects.
- R2. Roadmap feature data exposed to pages must keep the existing typed viewer shape: `start_date` as `YYYY-MM-DD`, numeric `duration`, valid `priority`, valid `status`, and string arrays for relationship fields.
- R3. Known malformed roadmap tickets must be brought back into the documented frontmatter schema.
- R4. The hotfix must leave the `ai-chat` exclusion and filesystem-backed roadmap architecture unchanged.
- R5. The deployment lesson must be compounded so future roadmap metadata changes are checked as production input.

### Scope Boundaries

- This plan does not redesign roadmap ticket authoring or add a schema validation CLI.
- This plan does not change Railway builder settings, start commands, or roadmap runtime file location.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Normalize at the parser boundary in `apps/roadmap/lib/features.ts` so every page and component receives a stable `Feature` shape, rather than fixing only the current markdown files.
- KTD2. Treat unknown priorities and statuses as safe viewer defaults, with an explicit mapping from legacy `planned` to `not-started`, so bad metadata degrades instead of breaking build output.
- KTD3. Clean the three identified malformed tickets because the roadmap docs are the source data, and the documented schema already requires quoted dates, `P0/P1/P2`, and numeric duration.
- KTD4. Use `pnpm --filter roadmap build` as the regression proof because it is the Railway build command and it exercises `/person/[person]` static data collection.

### Assumptions

- A small parser hardening change is preferable to a deployment-only data patch because `docs/roadmap/**` changes automatically redeploy `apps/roadmap`.
- No database, API, or cross-app contract changes are needed; this app is intentionally filesystem-backed.

---

## Implementation Units

### U1. Normalize roadmap feature frontmatter

- **Goal:** Convert `gray-matter` output into the `Feature` contract before sorting or rendering.
- **Requirements:** R1, R2, R4.
- **Dependencies:** None.
- **Files:** `apps/roadmap/lib/features.ts`.
- **Approach:** Add small parser-boundary helpers for strings, string arrays, start dates, durations, priorities, and statuses. Guard `formatTimeline()` against empty or invalid dates and non-positive durations. Keep existing lane registration and blocked-status logic unchanged.
- **Patterns to follow:** Existing `parseFeatureFile()` boundary in `apps/roadmap/lib/features.ts`; roadmap-specific app rules in `apps/roadmap/CLAUDE.md`.
- **Test scenarios:** A roadmap entry with `start_date` parsed as `Date` builds and sorts without throwing. A roadmap entry with string duration like `"3d"` produces a numeric duration. Unknown or legacy status values do not crash pages.
- **Verification:** `pnpm --filter roadmap build` completes after the parser change.

### U2. Clean malformed roadmap source records

- **Goal:** Bring the known bad ticket frontmatter back into the documented schema.
- **Requirements:** R2, R3.
- **Dependencies:** U1.
- **Files:** `docs/roadmap/platform/feat-160-watch-home-carousel-data-parity.md`, `docs/roadmap/platform/feat-234-watch-home-short-film-player.md`, `docs/roadmap/platform/feat-235-watch-home-builder-production-rollout.md`.
- **Approach:** Quote date values, convert duration to a number, convert `priority: medium` to a valid `P*` value, and map `status: planned` to `not-started`.
- **Patterns to follow:** Root `CLAUDE.md` roadmap frontmatter format.
- **Test scenarios:** A scan of these files shows no `Date`-parsed `start_date`, invalid priority, invalid status, or string duration values.
- **Verification:** The roadmap build reads the cleaned files without warning or crashing.

### U3. Add a traceable roadmap ticket for the hotfix

- **Goal:** Record this deploy repair in the platform roadmap and close it in the same PR.
- **Requirements:** R3, R5.
- **Dependencies:** U1, U2.
- **Files:** `docs/roadmap/platform/feat-236-roadmap-frontmatter-normalization.md`.
- **Approach:** Create the next platform ticket with valid frontmatter and agent-oriented body sections. Mark it complete after the implementation and verification land.
- **Patterns to follow:** Root `CLAUDE.md` roadmap ticket format.
- **Test scenarios:** The new ticket itself conforms to the normalized frontmatter rules.
- **Verification:** The roadmap build includes the new ticket without changing the `ai-chat` lane behavior.

### U4. Compound the deploy-failure learning

- **Goal:** Preserve the root cause and prevention checklist for future roadmap deploy failures.
- **Requirements:** R5.
- **Dependencies:** U1, U2, U3.
- **Files:** `docs/solutions/build-errors/roadmap-frontmatter-normalization-next-build-crash.md`.
- **Approach:** Document that YAML date scalars can become `Date` objects, that filesystem-backed docs are production input for `apps/roadmap`, and that parser-boundary normalization plus `pnpm --filter roadmap build` are the prevention pattern.
- **Patterns to follow:** Existing `docs/solutions/build-errors/*` solution notes.
- **Test scenarios:** Test expectation: none -- this is durable documentation for a solved deploy failure.
- **Verification:** The note links the symptom, root cause, fix, and validation path.

---

## Verification Contract

| Gate                          | Applies to | Done signal                                                                                                           |
| ----------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter roadmap build` | U1, U2, U3 | Next.js build completes and no longer fails collecting `/person/[person]` page data.                                  |
| `pnpm --filter roadmap lint`  | U1         | ESLint passes for the roadmap app.                                                                                    |
| Frontmatter spot scan         | U2, U3     | Known malformed tickets and the new ticket use quoted dates, valid priorities, valid statuses, and numeric durations. |
| PR review                     | All units  | Formal `ce:review` reports no blocking findings.                                                                      |

---

## Definition of Done

- The roadmap deploy failure is reproduced and fixed with a parser-boundary change.
- Known malformed roadmap records are corrected.
- The hotfix has a completed roadmap ticket.
- `pnpm --filter roadmap build` and `pnpm --filter roadmap lint` pass locally.
- The build-failure learning is compounded in `docs/solutions/`.
- The focused hotfix PR is merged, and the next Railway deployment is monitored.
