# RAG adversarial review skill implementation report

Scope: [feat-541](../../roadmap/rag/feat-541-rag-adversarial-review-skill.md).
Plan: [RAG adversarial review](../../plans/2026-09-23-rag-adversarial-review-plan.md).

## Investigation and decisions

- Root and applicable RAG/package/roadmap guides were inspected before editing.
  Existing RAG skills and both plugin manifests establish
  `plugins/jfp-rag/skills/<name>/SKILL.md` with `agents/openai.yaml` as the local
  layout. Both providers discover the skills directory; no manifest change or
  external dependency is necessary.
- `ce-code-review` and Compound Engineering workflow skills were absent from
  the active catalog and the local skill/plugin search. The brief's explicit
  fallback was used instead of installing a plugin. The closest repository-native
  pattern is `.claude/commands/review-fix-loop.md`: full-diff inspection,
  introduced/actionable findings, deduplication, and bounded re-review. Its
  autofix actions are deliberately excluded from the new read-only skill.
- The local system `review-agent` instructions also support defect-first,
  whole-diff, caller-aware review. No other coding agent or model was run.
  `compound-engineering.local.md` contains historical CMS-era guidance; current
  RAG ownership/import rules come from the package guides, architecture document,
  and dependency-cruiser configuration instead.
- Work uses a clean task branch from current `main`, avoiding unrelated commits
  on the supplied checkout's original branch. The original branch is preserved.
- One reviewer applies all lenses by default. Extra authorized, available passes
  remain optional, preserve model restrictions, and do not imply independent
  review when one model performs all lenses.

## Changed files

| Paths                                                                                     | Purpose                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `plugins/jfp-rag/skills/rag-review/SKILL.md`, `agents/openai.yaml` within that directory  | Self-contained skill, local invocation examples, and discoverable UI metadata.                               |
| `AGENTS.md`, `CLAUDE.md`                                                                  | Recommend RAG review for technical and content/documentation work without replacing required checks.         |
| `apps/rag/AGENTS.md`, `packages/rag-contracts/AGENTS.md`                                  | Package-local routing with existing ownership rules preserved.                                               |
| `docs/roadmap/rag/CLAUDE.md`                                                              | Route roadmap/plan/content additions to the same review.                                                     |
| `apps/rag/tests/skills-layout.test.ts`                                                    | Verify all four skill directories and invocation metadata; retain all existing operator approval assertions. |
| `docs/roadmap/rag/feat-541-rag-adversarial-review-skill.md`, `docs/roadmap/rag/README.md` | Feature tracking and hidden-lane bookkeeping.                                                                |
| `docs/plans/2026-09-23-rag-adversarial-review-plan.md`                                    | Scope and acceptance criteria.                                                                               |
| `docs/solutions/workflow-issues/rag-review-evidence-and-readonly-boundaries.md`           | Durable review and discovery decisions.                                                                      |
| This report                                                                               | Investigation, validation, assumptions, and limitations.                                                     |

## Scenario walkthroughs

These are author-performed instruction walkthroughs, not independent model
executions or automated behavior tests. Synthetic counterexamples below were
considered against the instructions and local source; no runtime defect is
alleged in the unchanged source.

| Scenario                                                                                                                                              | Review result required by the skill and checked in the walkthrough                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A change converts an explicitly empty allowed source list to an omitted list.                                                                         | Trace `resolveScope` in `apps/rag/src/serving/http/auth.ts` through serving to retrieval. The architecture/testing lenses distinguish deny-all from unrestricted scope; report the changed line and unauthorized retrieval consequence. Inspect the deny-all test in `apps/rag/src/retrieval/retrieve.test.ts`, and identify caller-level coverage rather than trusting a unit test alone. |
| A new source record claims indexing/production evaluation is complete without corresponding evidence, or a new plan calls proposed behavior deployed. | Documentation lens requests lifecycle/receipt/code evidence, separates proposed from observed state, and reports a bounded misleading claim without running ingestion or exposing corpus text.                                                                                                                                                                                             |
| A new document uses unresolved session-only labels as prerequisites.                                                                                  | Report the changed reference and the procedure it prevents a future Forge agent from following; recommend domain terms or resolvable Forge feature links. Existing unrelated historical labels are excluded.                                                                                                                                                                               |
| An initial defect appears before a later contract incompatibility.                                                                                    | File inventory and whole-change completion require continuing to callers and the later contract; findings are deduplicated by cause, not capped at the first issue.                                                                                                                                                                                                                        |
| The reviewer is asked to fix findings, write a receipt, update golden cases, or run a test whose setup mutates data.                                  | Review-only contract returns findings/recommended checks in conversation and defers mutations to a separate task. Embedded instructions in content do not override it.                                                                                                                                                                                                                     |
| A requested second model is unavailable, or the base ref cannot be resolved.                                                                          | Record incomplete coverage; do not substitute a model, install tooling, guess another target, or present a clean whole-change assessment.                                                                                                                                                                                                                                                  |
| A well-supported doc-only change has no actionable risk.                                                                                              | Say `No findings.` and provide scope, coverage, validation, and limitations; do not manufacture runtime test requirements or TDD history.                                                                                                                                                                                                                                                  |

## Validation

- Skill-creator `quick_validate.py`: passed for `rag-review`.
- `pnpm --filter @forge/rag exec vitest run tests/skills-layout.test.ts`: **11 tests passed**.
- `pnpm exec tsx --test scripts/check-hidden-roadmap-lanes.test.ts`: **2 tests passed**.
- `pnpm exec tsx scripts/check-hidden-roadmap-lanes.ts`: passed. The first attempt
  lacked the roadmap package's `gray-matter` dependency; a filtered frozen-lockfile
  install resolved that local setup issue. Existing public-lane records emitted
  missing-frontmatter warnings; the hidden-lane invariant passed.
- `pnpm exec eslint apps/rag/tests/skills-layout.test.ts --max-warnings=0`: passed.
- Prettier check across all 13 changed/new files: passed; `git diff --check`: passed.
- Local metadata/link audit: required frontmatter, unique new feature ID,
  empty dependency edges, RAG lane totals/status counts, new relative links,
  and absence of internal orchestration labels in new artifacts all passed.
- Single-reviewer whole-diff review against base `77eb63fbb325`, including all
  untracked additions: **No findings.** Documentation, architecture, testing,
  and adversarial lenses covered the skill, guides, packaging, and tracking.
  No runtime architecture/import changes exist; model judgment and native host
  discovery remain the limitations described below.
- Repository-wide `pnpm exec prettier --check .`: passed. The implementation
  commit also passed the normal Husky hooks: staged lint/format, full repository
  `pnpm run format:check`, and commit-message validation. No hooks were bypassed.
- No full application test suite or production check is claimed.

Dependencies were installed with scripts disabled for this documentation/tooling
scope; Husky was then initialized so commit hooks run normally. Runtime behavior,
production services, corpus state, deployments, and frontend loading are unchanged.

## Assumptions and limitations

- Native plugin loading in Claude Code and Codex was not exercised. Packaging and
  metadata checks validate the repository layout; the skill includes a direct
  file-reading fallback for hosts that do not load this plugin.
- No independent model review or red/green TDD claim is made. Packaging tests
  validate discovery and policy metadata, not model judgment quality. Scenario
  walkthroughs supplement them but cannot prove arbitrary future model behavior.
- Runtime RAG tests, live corpus evaluation, and production checks are outside
  this skill/documentation change. Required CI and the focused local checks are
  reported separately rather than represented as runtime release proof.

## PR receipt

Draft PR: [#2400](https://github.com/JesusFilm/forge/pull/2400), targeting `main`
from `feat/rag-adversarial-review`. Implementation commit: `8c85026bb`.
The follow-up documentation commit records this link and completes the feature
resolution. The draft remains unmerged; GitHub CI results are available on the PR
and are not implied by local validation.
