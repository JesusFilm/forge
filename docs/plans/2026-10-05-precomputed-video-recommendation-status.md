# Precomputed recommendation orchestration

Updated: 2026-10-05 (Pacific/Auckland).

## Integration ownership

- Parent: https://github.com/JesusFilm/forge/issues/2565; roadmap: feat-590.
- Orchestrator chat: `01a109d7-dc1c-7600-a2c4-07dee79b4aff`.
- Repository: `JesusFilm/forge`.
- Initial base: `d661b99939e24ba41834adce53c6bad9262bcee9` (fresh `origin/main`).
- Integration branch: `codex/precomputed-video-recommendations`.
- Integration checkout: `/home/nisal/.codex/worktrees/precomputed-video-recommendations/forge`.
- Draft integration PR: pending first task-owned commit and push.
- Saved project: `d0b6bf54-7c60-41f9-bb54-41a55e704a79`, Forge on
  `remote-control:env_e_6ab0824a79ac832e92a3a2f0a40374bb`.
- Task-owned planning documents and only the seven recommendation glossary
  additions were ported from the original dirty checkout. Unrelated edits remain
  there untouched. Current main includes the compact recommendation formats.

The orchestrator exclusively owns integration, this ledger, roadmap status,
and the single integration PR. Workers own their assigned ticket branch and
isolated worktree. No duplicate ticket ownership and at most two active workers.
Implementations are GPT-6 Sol chats (`gpt-6-sol`); the application model remains
`gpt-6-astra`. Use Matt Pocock's exact implement/TDD/code-review skills and the
approved testing boundaries. Compound Engineering skills are prohibited.

## Execution ledger

All issues, comments, readiness labels, native parents, blockers, and reverse
blocking relationships were fetched and verified on 2026-10-05. All ten issues
are open, labelled `ready-for-agent`, and have no comments at kickoff.

| Issue | Blockers     | State                     | Worker / branch                 | Integrated commits / evidence |
| ----- | ------------ | ------------------------- | ------------------------------- | ----------------------------- |
| #2566 | None         | Ready; dispatch pending   | Reserved: `codex/feat-590-2566` | None                          |
| #2567 | #2566        | Waiting for prerequisites | Unassigned                      | None                          |
| #2568 | #2567        | Waiting for prerequisites | Unassigned                      | None                          |
| #2569 | #2568        | Waiting for prerequisites | Unassigned                      | None                          |
| #2570 | #2566        | Waiting for prerequisites | Unassigned                      | None                          |
| #2571 | #2570        | Waiting for prerequisites | Unassigned                      | None                          |
| #2572 | #2571        | Waiting for prerequisites | Unassigned                      | None                          |
| #2573 | #2572        | Waiting for prerequisites | Unassigned                      | None                          |
| #2574 | #2569, #2573 | Waiting for prerequisites | Unassigned                      | None                          |
| #2575 | #2574        | Waiting for prerequisites | Unassigned                      | None                          |

Advance dependencies only on **integrated-and-verified** acceptance evidence.
Implemented, integrated, merged, and live are separate states. GitHub issues
remain open until the integration PR merges; no merge is authorized here.

## External inputs and operation boundaries

- At #2568, notify the user and walk them through historical GA warehouse
  identification and authorized access. Provider is provisionally BigQuery;
  project/dataset, schema, historical coverage, and Video mapping are unverified.
  Continue independent fixture work without claiming live ingestion.
- Verify application access to `gpt-6-astra` before any live model smoke.
- Trusted bot signals, measured human baseline, numeric stopping-rule agreement,
  Railway headroom/capacity evidence, and an actual first catalog cost report
  remain explicit live prerequisites.
- Keep public serving default-off and the incumbent available. No production
  deployment, merge to main, public A/B activation, winner promotion, recurring
  schedule, warehouse writes/exports, or destructive production reclamation.
- No tool permission setting has been changed. Workers use host permissions;
  full access must not be claimed without verification.

## Validation

Initial preparation contains documentation only. Format and scope checks are
required before the first commit/push. No implementation acceptance is verified.
