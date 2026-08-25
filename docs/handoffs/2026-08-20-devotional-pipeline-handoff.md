# Daily devotional pipeline — implementation and handoff

**Date:** 2026-08-20
**Author:** Lyuba (with Claude Code)
**Audience:** an engineer taking over or reviewing the devotional pipeline

## What this document is, and is not

This is the **entry point and current-state record**. It explains how the
solution is put together, what is actually true today, and where the sharp edges
are.

It deliberately does **not** restate the contracts that are already written
down. Two copies of one fact drift apart, and that has already cost this project
time. Where something is documented elsewhere, this document points at it:

| For                                                                       | Read                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| The design, the architecture exception, the full lifecycle route contract | `docs/plans/2026-07-10-001-feat-video-first-devotional-pipeline-plan.md` |
| Runtime rules, environment variables, ownership boundaries                | `apps/mastra/CLAUDE.md`, section "Daily devotional generator"            |
| Media execution boundaries                                                | `apps/shorts-worker/CLAUDE.md`                                           |
| The Workspace folder contract                                             | `apps/mastra/devotional-workspace/README.md`                             |
| The production cutover procedure                                          | `docs/runbooks/devotional-workspace-cutover.md`                          |
| Original product requirements                                             | `docs/brainstorms/2026-06-17-daily-devotional-generator-requirements.md` |

## Current state in one paragraph

**The machine is built and merged; the content it needs and the text-quality
gate are still in review; and the pipeline has never run end to end through the
shared store.** Every structural piece — the workflow, the worker client, the
renderer, the gateway access layer — is in `main`. Two pull requests are open:
one supplies the scripture and commentary the pipeline reads, the other adds a
quality review of the generated text. No devotional has yet been produced
through the shared store, and the paid steps have not been exercised on the
current branch.

## Architecture

### Ownership across apps

| App                   | Owns                                                                                                                                                             | Never does                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/mastra`         | The durable control loop, all AI calls, the Workspace (canonical inputs and outputs), credential issuance, verification of worker output, authenticated playback | Touch video bytes, run ffmpeg or a browser |
| `apps/shorts-worker`  | Source downloads, ffmpeg, Chromium, Remotion, the rendered video bytes, cancellation, its own private storage                                                    | Hold permanent Workspace credentials       |
| `apps/mastra-gateway` | Human authentication, the current `admin`/`editor` access record, the approval and playback credential lanes, actor attribution                                  | Execute workflow logic                     |

Mastra hands the worker short-lived, digest-bound capabilities per job and
exchanges only opaque artifact references. The worker never receives permanent
bucket credentials. This split is deliberate: execution responsibility does not
imply storage authority.

### Why the control loop lives in Mastra

By default in this monorepo, a heavy AI-plus-media control loop belongs in
`apps/manager`. This pipeline is an **owner-approved exception, dated
2026-07-21**, justified by the Mastra-native sub-workflow composition and by
approval happening through authenticated Mastra Gateway access.

The exception is conditional. It holds only while, among other conditions:

- workflow state is persisted in Postgres, never in memory
- **Mastra runs exactly one Railway replica** — reservation and lifecycle
  serialization are process-local
- lifecycle operations stay authenticated and serialized, starts stay
  idempotent per UTC date
- native workflow mutation routes stay denied for devotional workflow IDs
- the worker's render deadline stays strictly below Mastra's polling ceiling

Losing any condition means setting `DEVOTIONAL_NEW_RUNS_ENABLED=false`, stopping
the external scheduler, draining suspended runs, and either restoring the
condition or moving the control loop to Manager. The full list is in
`apps/mastra/CLAUDE.md`. **An engineer changing replica count, storage backend,
or route authentication is touching the terms of this exception, not just
configuration.**

### The six stages

`video-first-devotional` composes six sub-workflows in sequence. Each hands its
saved result to the next; a failure at any stage releases the reserved chapter.

| #   | Sub-workflow / step                             | What it does                                                                                                              | Runs on         |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | `devotional-source` / `pick-clip-and-scripture` | Picks an unused Jesus Film chapter, reserves it against the used-clips ledger, resolves the passage and the exact verse   | Mastra          |
| 2   | `devotional-content` / `compose-content`        | Builds the devotional text from commentary plus verse, then runs the safety gate (and, once merged, the quality gate)     | Mastra          |
| 3   | `devotional-produce` / `prepare-media`          | **A gate, not a producer.** Validates the authored media policy and stops if safety blocked. Produces nothing             | Mastra          |
| 4   | `devotional-render` / `render-video`            | Generates narration, selects a music track, submits the render job, polls the worker, verifies the returned file's digest | Mastra → worker |
| 5   | `devotional-approve` / `await-approval`         | Suspends the run until a human approves or rejects the rendered video                                                     | Human           |
| 6   | `devotional-publish` / `publish`                | Publishes if configured, then records the chapter as used                                                                 | Mastra          |

Two properties worth internalising:

- **Stage 4 is the only paid stage.** Narration, music and render are where
  money is spent. Everything before it is cheap.
- **Stage 6 records the clip, not stage 1.** Stage 1 only _reserves_. A run that
  fails anywhere before publish leaves the chapter never-used. See the defect
  section below for why that matters.

### The AI agents

Six agents under `apps/mastra/src/mastra/agents/devotional/`. Each writes one
part; none of them decides control flow.

| Agent           | Stage | Produces                                                                                                                                                                   |
| --------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scripture       | 1     | Chooses which verse to quote. The exact wording comes from the committed WEB text, not the model; an unresolvable reference falls back to model wording flagged unverified |
| Modernizer      | 2     | Rewrites Victorian commentary into contemporary language. Carries the house writing rules                                                                                  |
| Highlighter     | 2     | Selects the phrase to emphasise on screen                                                                                                                                  |
| Copywriter      | 2     | Title, closing line, question, prayer. The prayer is always an invitation to the viewer, never the narrator praying for them                                               |
| Safety judge    | 2     | Pass or block with a confidence score. **Fails closed**: a judge that cannot run blocks the run                                                                            |
| Thematic ranker | 2     | Would rank theme-matched devotional entries. **Currently idle** — no thematic source is loaded                                                                             |

### The data plane

Everything the pipeline reads is authored content in one S3-backed Workspace:
writing prompts, safety rubric, calendar, voices, music profiles, render styles,
brand, the film catalogue and passage map, the Bible text, and the commentary.

The flow is: **repository seed → migration → Workspace → read at run time.**

- `apps/mastra/devotional-workspace/inputs/**` is the committed seed, described
  by its own README as "migration inputs and contract fixtures, not a runtime
  fallback".
- `docs/runbooks/devotional-workspace-cutover.md` is the operator procedure that
  copies it in. The manifest — every file with its size and SHA-256 — is
  authored by the operator; there is no generator in the repo.
- At run time, `authored-data.ts` has **no filesystem, repository-root, or
  environment fallback**. A missing required document is a failure before any
  side effect. This is deliberate and load-bearing: it is what makes the
  Workspace genuinely authoritative rather than a cache over local files.

**The single most important trap in this whole system:** an invalid input file
is _excluded and reported_, not raised. Only a `safety` category failure throws.
So a malformed commentary file produces, at generation time, the same symptom as
a file that was never uploaded. `committed-seed-corpus.test.ts` exists because
of this — it runs the real reconcile-time validator over the committed bytes, so
the failure surfaces in CI rather than in production.

### State and durability

- Workflow state, clip reservations, publication intents and history: Postgres.
- The used-clips ledger holds per-chapter reservation and use counts. Its lock is
  **process-local**, which is why one replica is a hard requirement.
- Apply schema with `pnpm --filter @forge/mastra migrate:database`; verify with
  `pnpm --filter @forge/mastra check:devotional-database-readiness`, which must
  return `{"ready":true,"version":1}`.

## How to run and verify it

### Locally

| Command                                                                           | What it does                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node apps/mastra/src/scripts/ingest-ryle-luke.mjs` (and the `ingest-*` siblings) | Refetches the commentary and Bible text from public sources into the seed folder. No credentials, no local state                                                                                                                                                         |
| `pnpm --filter @forge/mastra test`                                                | Full suite, including the committed-seed contract test                                                                                                                                                                                                                   |
| `pnpm --filter @forge/mastra devo:run`                                            | Local runner for the **older** `daily-devotional` workflow (hook → scripture → video → write → safety → voiceover → persist), not `video-first-devotional`. Predates the Workspace; useful for reading a real generated result, misleading as a test of the current path |

**What cannot be verified locally:** narration, music, render, approval and
publishing all need credentials that are not on a developer machine, and the
Workspace in local mode uses a contained directory rather than S3 — so the
storage layer genuinely differs from production.

**What was verified locally** (2026-08-20, read-only, temp directory, no
credentials): the Workspace is discovered, validated and read correctly; all
eleven required documents load; and every catalogued chapter resolves real
scripture and a real commentary section. Stages 4 through 6 were not exercised.

### In production, in order

1. Merge the two open pull requests.
2. Apply migrations, confirm readiness returns `{"ready":true,"version":1}`.
3. Follow the cutover runbook to upload the seed into the Workspace.
4. Confirm `numReplicas = 1` and record it in the release attestation.
5. Leave the quality gate in report-only mode and watch its verdicts.
6. Set `DEVOTIONAL_NEW_RUNS_ENABLED=true` only after the attestation passes.
7. Point an external scheduler at `POST /forge-daily-devotional` once a day.
   **The pipeline never schedules itself.**

## Defects found and fixed — worth knowing

These are recorded because each one is a class of bug this architecture invites,
not a one-off.

**The first automatic run would have wedged the schedule permanently.** Chapter
selection returns the lowest never-used chapter, so a fresh ledger picks chapter
1 — the Genesis prologue, which the Gospel commentary cannot serve, so content
composition throws. Because a failed run never records its clip, the next run
picks chapter 1 again. Not a lost day: a stuck schedule. Fixed by narrowing the
pool to chapters the loaded commentary can actually serve, keyed on the corpus
rather than a chapter number.

**Content that validates locally but is silently rejected upstream.** The ingest
scripts emitted a metadata envelope around their output; both consumer schemas
are strict and reject it. The migration copies content byte-faithfully and never
validates it, so nothing would have caught this before production. Fixed at the
producers, and guarded by a test that reads the committed bytes.

**A latent range-matching bug, activated by a refactor.** A chapter-level
reference with no verse numbers expanded to an unbounded range, so commentary on
Luke 8 would have answered a Luke 24 passage. Invisible while matching used
exact equality; exposed the moment matching went through ranges. Bounded at the
chapter now.

**Theme-keyed sources leaking into passage-matched selection.** Routing keyed on
the reference prefix before the filename, so 123 of Spurgeon's 732 entries would
have landed in the commentary pool and could have been presented as commentary
on a passage they never discuss.

## Known problems and open decisions

| Item                                                  | Status           | Needs                                                                                                                                                                                      |
| ----------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nobody runs the daily trigger                         | Open             | Scheduling and infrastructure access. This is the one item blocking daily operation                                                                                                        |
| No human-facing review surface exists                 | Open             | Approval today is an API call. The gateway has routes but no page. This affects the video approval that already ships                                                                      |
| Human review of the _text_, before the paid stage     | Proposed         | Product decision: does it replace video approval or add to it, and may the human edit rather than only approve? An edited text must re-enter the safety gate, or the gate becomes optional |
| Chapter 1 (Genesis prologue) never publishes          | Deliberate       | A Genesis commentary volume, its verses in the WEB file, nothing else — the book allowlist was removed                                                                                     |
| 61 chapters is about two months of daily videos       | Open             | Product decision: repeat, extend the catalogue, or change format                                                                                                                           |
| Stage 3 is named `prepare-media` but prepares nothing | Cosmetic         | A rename, so nobody looks for audio there                                                                                                                                                  |
| The thematic ranker agent has nothing to rank         | Open             | Either add a thematic source or retire the agent so it stops reading as working machinery                                                                                                  |
| Generated content is committed to the repository      | Decision pending | 2.76 MB added to a 119.9 MB repository. Alternative is committing checksums only and verifying at upload, at the cost of CI no longer checking content                                     |
| Cost per run is unmeasured                            | Open             | Measure on the first real run                                                                                                                                                              |
| The fix-and-verify loop is slow                       | Open             | There is no preview environment: a change can only be verified after review, merge and deploy. Worth a conversation about a faster path                                                    |

## If you change X, read Y first

- **Replica count, storage backend, or route authentication** → the architecture
  exception conditions in `apps/mastra/CLAUDE.md`. These are exception terms.
- **Anything under `devotional-workspace/inputs/`** → that folder's READMEs. The
  schemas are strict; an extra key makes a file ineligible, silently.
- **Reflection selection or routing** → `reflection-corpus.ts`. Selection ranks
  by how tightly an entry covers the passage, deliberately not by author, so a
  new commentary volume is data alone.
- **The clip pool or chapter selection** → remember that a failed run does not
  record its clip. Any chapter the pipeline cannot serve must be kept out of the
  pool, or it will be selected forever.
- **An ingest script's output shape** → `committed-seed-corpus.test.ts` reads the
  real bytes. If it goes red, production would have silently dropped that file.
- **A new environment variable for opt-in scaffolding** → make it optional with a
  runtime fallback. A required variable with no default breaks deploys for
  environments that have not been provisioned.
