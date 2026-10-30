# TV development harness

## Scope

Implement feat-631 under `apps/tv/harnesses/development`, with a short discovery pointer in `apps/tv/CLAUDE.md`. Reuse the repository's Node/Corepack/pnpm/Jest tools. Keep build/install/UI execution agent-driven through XcodeBuildMCP, computer use and explicit ADB targets; do not create another automation framework or alter app behavior.

## Acceptance defined before implementation

1. A new chat can identify the selected checkout, user task, allowed paths, target platform, prerequisites and exact commands from HARNESS.md and the supplied task manifest.
2. Initialization preserves existing dirty work. Evaluation detects new changes outside the task scope, including changes to previously dirty files and committed changes.
3. Preflight reports real disk/tool/dependency state. Native work requires 12 GiB headroom as a conservative project budget, not a platform guarantee; the agent rechecks during builds and stops its own build below 2 GiB. No cleanup is performed automatically.
4. Static checks reuse TV's existing commands. Required missing, failed, blocked or stale checks cannot produce a passed overall verdict. Three attempts per check means an initial attempt plus at most two repairs.
5. Reports record source and instruction digests, Git revision, tools, declared agent model, durations, evidence digests, judge and next action. Source changes invalidate prior passing checks; unchanged content can reuse them across a commit.
6. Runtime acceptance is explicitly judged by a human/agent inspecting actual target evidence. A valid report schema or unit-test pass is not TV runtime proof. Apple TV and Android targets retain distinct gates.
7. JSON task/evidence input is data: it cannot inject shell commands or authorize destructive/publishing operations. Generated run state stays under ignored TV `test-results/`; secrets and raw command output are not stored in reports.
8. Exercise isolated success and failure cases and a live preflight. Report unavailable native/physical checks honestly without performing unrelated builds or releases.

## Delivery

Execution guide, evaluation guide, task/evidence examples, executable helper and its fixture evaluator. Source skill files stay unchanged. Native UI test cases cover startup, Search Back, playback/resume, separate audio/subtitles, My List, feedback, and platform-specific system Home where relevant. No new native archive is needed to validate this development tooling.

## Result

Implemented in the dedicated `codex/tv-development-harness` worktree. Twenty isolated cases pass, and the helper ran the existing TV typecheck, lint, Jest and formatting commands successfully. A live read-only Apple preflight selected the 4K simulator and correctly blocked the blank TV API token; no app runtime success was fabricated. See `apps/tv/harnesses/development/VALIDATION.md` for the run record and limitations.

## Integration — 14 October 2026

Applied only the harness commit `5f3dca63a` from the SSD branch to the current
TV checkout. Preserved the app and pre-existing startup fixes, verified all 20
fixture cases and live TV static checks, and documented the optional external
skill and the unchanged runtime token requirement in the harness validation guide.
