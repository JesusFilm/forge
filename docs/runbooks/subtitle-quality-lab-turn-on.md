# Subtitle Quality Lab turn-on, canary and rollback

The Lab shipped dormant in #2057. Code on `main` and migration
`0052_subtitle_quality_lab` are applied in production, but no Lab operation can
complete until the configuration below exists. This runbook turns it on.

Nothing here is a deployment step. The code is already deployed; every step is
configuration, corpus or authorization work.

## Why the order matters

Two guards make ordering load-bearing rather than advisory.

Admin refuses to create a run when any admission or budget value is missing:

```ts
if (nodeEnv === "production" && missing) {
  throw new SubtitleEvalConflictError("admission_budget_configuration_missing", ...)
}
```

`apps/admin/src/services/subtitle-eval.service.ts` treats all five of
`SUBTITLE_EVAL_MAX_PER_RUN_MICROS`,
`SUBTITLE_EVAL_MAX_ROLLING_24H_MICROS`,
`SUBTITLE_EVAL_RESERVATION_PER_CELL_ATTEMPT_MICROS`,
`SUBTITLE_EVAL_MAX_ACTIVE_RUNS_PER_OPERATOR` and
`SUBTITLE_EVAL_MAX_ACTIVE_RUNS_GLOBAL` as required in production. Configure the
caps before the paid key exists and the window in which a bug can spend money
without a ceiling never opens.

Manager refuses to mint a reviewer session proof when its signing key is absent:
`configuredProof()` in `apps/manager/src/lib/subtitle-eval-session-proof.ts`
throws `SubtitleEvalSessionProofConfigurationError`. Interactive Lab operations
therefore fail closed rather than degrading to unauthenticated ones.

Both guards are environment-conditional or configuration-conditional. Verify
each by observation after setting it; do not infer either from a green deploy.

## Step 1 — Admin admission and spend caps (before any provider key)

Set on `@forge/admin`. All five are required together in production; a partial
set leaves run creation failing with `admission_budget_configuration_missing`,
which is the intended state until you finish this step.

| Variable                                            | Meaning                                   |
| --------------------------------------------------- | ----------------------------------------- |
| `SUBTITLE_EVAL_MAX_PER_RUN_MICROS`                  | hard ceiling for one run, in micros       |
| `SUBTITLE_EVAL_MAX_ROLLING_24H_MICROS`              | rolling 24-hour ceiling across all runs   |
| `SUBTITLE_EVAL_RESERVATION_PER_CELL_ATTEMPT_MICROS` | amount reserved up front per cell attempt |
| `SUBTITLE_EVAL_MAX_ACTIVE_RUNS_PER_OPERATOR`        | concurrent runs one operator may hold     |
| `SUBTITLE_EVAL_MAX_ACTIVE_RUNS_GLOBAL`              | concurrent runs across the whole system   |

Units are micros — millionths of a currency unit. Confirm the intended currency
against the reservation logic before choosing numbers; a factor-of-1e6 error
here is the difference between a capped canary and an uncapped one.

For the first canary set the per-run and rolling caps to roughly the cost of a
single cell attempt plus a small margin, and both active-run limits to `1`. The
point of the canary is that a runaway loop hits a ceiling within one cell.

**Verify before continuing:** attempt to create a run while the paid key is
still absent. Expect a typed refusal, not a provider call.

## Step 2 — Reviewer session signing keypair

Generate an Ed25519 keypair in an approved secret-management environment. Never
generate it on a laptop, in CI logs, or in a chat transcript.

- Manager `@forge/manager` receives `SUBTITLE_REVIEW_SESSION_PRIVATE_KEY`
  (PKCS8 PEM) and `SUBTITLE_REVIEW_SESSION_KEY_ID`.
- Admin `@forge/admin` receives `SUBTITLE_REVIEW_SESSION_PUBLIC_KEYS`, a JSON
  object mapping key id to SPKI public PEM — a keyring, not a single key.
  `parseKeyring()` in `apps/admin/src/auth/manager-reviewer-session-proof.ts`
  rejects arrays and non-objects.
- Both sides receive the same `SUBTITLE_REVIEW_ASSERTION_ENVIRONMENT`. It
  defaults to `local`, so leaving it unset in production silently binds proofs
  to the wrong environment.

Proofs are verified with issuer `forge-manager`, EdDSA only, and a five second
clock tolerance.

**Rotation:** add the new public key to Admin's keyring first, then switch
Manager's key id and private key, then retain the old verifier entry for longer
than the maximum accepted proof lifetime before removing it. Receiver first, as
with every other cross-service credential in this repo.

## Step 3 — Artifact storage

Set the complete `RAILWAY_S3_*` tuple on `@forge/manager`:
`RAILWAY_S3_ENDPOINT`, `RAILWAY_S3_BUCKET`, `RAILWAY_S3_ACCESS_KEY_ID`,
`RAILWAY_S3_SECRET_ACCESS_KEY`. `RAILWAY_S3_REGION` defaults to `auto`.

The Lab refuses artifact read and write in production when the tuple is absent
or incomplete; it never falls back to the local `.tmp` directory that local
development uses. Preserve the bucket across deploys — a database report whose
matching immutable object is missing is incomplete evidence, not a recoverable
state.

## Step 4 — Manager service configuration

On `@forge/manager`: `MANAGER_BASE_URL` (canonical origin; the Studio-style
same-origin guard falls back to the request Host when this is unset),
`MANAGER_API_KEY` (also the recovery endpoint bearer — see step 6),
`WORKFLOW_API_KEY`, `MASTRA_BASE_URL`, `MASTRA_SERVICE_API_KEY`, and Mux
credentials.

Production cloud launches additionally require Railway's
`RAILWAY_GIT_COMMIT_SHA`, or an explicit `GIT_COMMIT_SHA`. A missing or
`unknown` immutable code revision is rejected, which is what keeps a run's
evidence attributable to an exact build.

## Step 5 — Mastra provider key

On `@forge/mastra`: `MASTRA_SERVICE_API_KEYS` and a spend-limited
`OPENROUTER_API_PAID_KEY`. The generic `OPENROUTER_API_KEY` is the fallback;
prefer a dedicated paid key with its own provider-side limit so the provider
enforces a ceiling independently of anything in this repo.

**Do this last of the configuration steps.** Until it exists, no paid call is
possible regardless of any other mistake.

**Verify:** confirm the protected one-cell route rejects a wrong bearer before
authorizing any spend.

## Step 6 — Recovery scheduling

Process-death recovery is not self-scheduled. Without an external caller, a run
stranded by a crash stays `RUNNING` and its reserved spend is never released.

Use Railway cron, matching the existing precedent in
`apps/admin/docs/core-sync-recurring-job.md`:

```bash
curl -X POST "$MANAGER_URL/api/scheduled/subtitle-eval-recovery" \
  -H "Authorization: Bearer $MANAGER_API_KEY"
```

Each invocation lists runs stale by at least five minutes, reads at most four
pages of 25, claims a 120-second run-recovery lease, refuses cells holding a
live lease, requeues an expired retryable cell while attempts remain,
terminalizes exhausted work, and writes the terminal report once every cell is
terminal. Concurrent schedulers are safe: lease generation and token hashes
fence recovery, and `SKIPPED_OR_RACED` is the expected outcome when another
worker owns the lease.

Configure the schedule only after the bearer is provisioned. Alert on runs that
stay `QUEUED` or `RUNNING` beyond the scheduler cadence plus the maximum cell
timeout. **Do not treat HTTP 200 as proof of recovery** — inspect the returned
per-run outcomes and the Admin terminal report.

Mastra's own `schedule: { cron }` workflow option was considered and rejected
for this job: it shares a failure domain with the executions being recovered
(a Mastra crash is the most likely way a cell strands), and it would introduce
a Mastra to Manager credential direction that does not currently exist.

## Step 7 — Corpus import and certification

Import accepts the committed manifest and lock plus exact Core-to-Admin
language mappings. Manager downloads each allowlisted Core VTT with redirects
disabled and a byte ceiling, verifies raw and clipped hashes and cue count,
writes the clipped bytes, then asks Admin to import a provisional version.

Certification is a human judgement and is not satisfied by a successful import.
For every cell in the locked corpus, the curator confirms:

1. **Authorship** — who produced the reference subtitle, and that it is a human
   translation rather than machine output.
2. **Cut and synchronization** — the reference matches the exact video cut and
   its timings are correct for it.
3. **Language identity** — source and target language, including script and
   regional variant, match what the cell claims.
4. **Reference quality** — the translation is good enough to be a scoring
   target. Every metric the Lab reports is measured against this.
5. **Reuse authority** — the organization may use this text for evaluation.

Record the certification and its provenance against the version. Until this is
done, treat all scores as structural output only: they demonstrate the pipeline
runs, not that a model is good. Do not refresh the lock during activation; if
Core legitimately changes, review and commit a new lock and corpus identity
first. An accepted correction creates a superseding frozen version and never
mutates an existing object.

## Step 8 — Provision reviewers

Admin's users dashboard has a **Subtitle Lab Reviewers** section
(`/dashboard/users`). It lists current grants, revokes one with a recorded
reason, and grants a new one.

A reviewer grant is language-scoped and carries its own justification, so it is
a form rather than a role dropdown. Granting requires:

| Field                                | Rule                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Reviewer                             | any user who is not an active Manager operator                                                |
| Language                             | must exist, not be deleted, and have a slug                                                   |
| Target language proficiency evidence | required, up to 2,000 characters                                                              |
| Source language proficiency evidence | optional                                                                                      |
| Rubric dimensions                    | at least one of meaning accuracy, naturalness, timing and readability, scripture and theology |
| Scripture / theology specialist      | required before scripture and theology can be granted                                         |
| Reason                               | required, up to 500 characters                                                                |

Granting creates the `ManagerRole.REVIEWER` membership if the person does not
have one. An active Manager operator cannot hold a reviewer grant, and the
picker excludes them.

The evidence and reason fields are mandatory on purpose. This surface records
the judgement that somebody is qualified to review a language; it does not make
that judgement.

First reviewers are internal staff. External contributors stay blocked until
the notice, retention, redaction, export, correction and erasure policy is
decided and implemented — Admin has no Lab-specific retention or erasure
implementation today, so no deletion period can honestly be promised.

## Step 9 — Bounded canary

Run exactly one approved corpus cell, then stop and read the evidence.

Confirm before launching that Admin, Manager, Mastra and Auth report the same
immutable code and policy identity. Then verify:

1. Exactly **one** provider-execution attempt for the cell. More than one means
   the idempotency or reconciliation path is wrong, and that is a spend bug.
2. Exactly **one** terminal report, with replay-safe artifact references.
3. The artifact objects exist in the bucket and match the report's hashes.
4. An assigned reviewer reaches only the intended language and cell, and cannot
   reach operator routes or launch a run.
5. A service bearer cannot perform an interactive review action, and an
   interactive session cannot trigger recovery.
6. Spend recorded matches spend reserved.

During the window watch failed cells, reconciliation-limit failures, provider
spend, recovery latency, artifact-write errors and authorization denials.

## Stop and rollback

There is no kill-switch flag. Containment is by configuration, in this order:

1. Remove `OPENROUTER_API_PAID_KEY` from Mastra to stop new paid work.
2. Set the active-run limits to a value that refuses new admissions.
3. Stop the external recovery schedule only after in-flight runs are terminal —
   stopping it earlier strands them.
4. Remove Manager's `SUBTITLE_REVIEW_SESSION_PRIVATE_KEY` to close the reviewer
   surface, which fails closed immediately.

Removing configuration does not delete runs, reports, artifacts or reviews.
Nothing in the Lab publishes subtitles, activates a prompt or model, or deploys
a service, so rollback has no publication to retract.

## Known gaps at the time of writing

- **PR environments cannot exercise this path.** `@forge/admin` and
  `@forge/mastra` have no service instance in any `forge-pr-*` environment, and
  `@forge/auth`'s PR-environment instance has no source repository attached, so
  it never builds. Production is currently the only environment where the full
  path exists. `stage` has Admin, Auth and Manager but no Mastra, so it cannot
  exercise the paid leg either.
- **Contributor-data policy is undecided**, which bounds first use to internal
  staff.
