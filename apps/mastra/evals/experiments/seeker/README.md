# Seeker managed-prompt experiments

This directory is the Git ledger for official Seeker prompt and model
experiments. Each experiment lives at `<experiment-id>/experiment.json`; its
immutable attempts and terminal verdict remain beside that manifest. Commit
every terminal outcome, including failed, inconclusive, and deferred work.

Start from [`experiment.template.json`](./experiment.template.json). Replace
every example identity value with values derived from the repository production
identity, the canonical benchmark, and an immutable Langfuse prompt version.
The template is illustrative input, not experiment evidence or a baseline.

## Prerequisites

- Work from a clean feature branch based on current `main`.
- Configure the local Langfuse key pair and HTTPS base URL for `forge-mastra`.
  Never use the Railway key pair locally.
- Configure `CHAT_EVAL_OPENROUTER_API_KEY`. The runner refuses the production
  paid key and pins the dedicated eval key before importing the agent.
- Confirm the candidate's exact prompt revision and SHA-256 content hash.
  Labels may discover candidates but are never durable experiment identity.
- Copy `productionBenchmark.identity` exactly from the referenced canonical
  benchmark. Never relabel the legacy fallback baseline as managed evidence.

## Create and preflight

Copy the template into a lowercase path-safe `<experiment-id>` directory.
Complete the owner, hypothesis, criterion, one comparison axis, benchmark, and
candidates before spending. Prompt experiments may change only prompt revision
and hash; model experiments may change only the ordered model route identity.

Run an official immutable attempt from the repository root:

```bash
pnpm --filter @forge/mastra eval:seeker:experiment:run -- \
  --experiment=apps/mastra/evals/experiments/seeker/<experiment-id> \
  --experiments-root=apps/mastra/evals/experiments/seeker \
  --attempt=<attempt-id>
```

The coordinator validates the manifest, benchmark identity, exact managed
prompt revision, and content hash before constructing an agent or generating a
cell. Fallback, stale, missing, deleted, or mismatched prompt resolution is a
refusal, not evidence. Never rename mock, fallback, or ad hoc output as an
official attempt.

## Retry and review

Attempts are immutable. After failure, fix the external prerequisite or create
a new manifest revision and use a new attempt ID. Reuse is permitted only from
a complete prior attempt whose checksums and full identity match:

```bash
pnpm --filter @forge/mastra eval:seeker:experiment:run -- \
  --experiment=apps/mastra/evals/experiments/seeker/<experiment-id> \
  --experiments-root=apps/mastra/evals/experiments/seeker \
  --attempt=<new-attempt-id> --reuse-attempt=<complete-attempt-id>
```

Review `resolved-identity.json`, all candidate answers, transcripts, judgments,
scores, `comparison.md`, `gate-report.json`, and `completion.json`. Verify the
inventory checksums and scan the package for prompt text, credentials, and
unrestricted traces. Evidence must be understandable from Git alone.

Record the human terminal verdict with repository-relative evidence links:

```bash
pnpm --filter @forge/mastra eval:seeker:experiment:verdict -- \
  --experiment=apps/mastra/evals/experiments/seeker/<experiment-id> \
  --attempt=<attempt-id> --candidate=<candidate-id> \
  --verdict=<successful|failed|inconclusive|deferred> \
  --actor=<reviewer> --reason='<review reasoning>' \
  --evidence=attempts/<attempt-id>/gate-report.json,attempts/<attempt-id>/comparison.md
```

A human can veto automatic eligibility but cannot make red, refused, failed,
unknown, or unavailable machine evidence promotable.

## Separate promotion change

Promotion never belongs in the experiment-evidence PR. After that PR is merged,
create a separate branch from current `main`, update the repository production
prompt pin, and write the matching proposed production identity file. Then
validate the committed evidence package against that proposed identity:

```bash
pnpm --filter @forge/mastra eval:seeker:experiment:promote -- \
  --experiment=apps/mastra/evals/experiments/seeker/<experiment-id> \
  --attempt=<attempt-id> --candidate=<candidate-id> \
  --commit=<evidence-commit> \
  --production-identity=<proposed-production-identity.json> \
  --benchmark-dir=apps/mastra/evals/results/seeker-baseline
```

Run without `--materialize` first. Only after read-only validation passes,
rerun with `--materialize`. Review the already-updated production prompt pin
and all four newly materialized canonical benchmark files together in the same
promotion PR. Any identity change after the accepted attempt requires a fresh
qualifying benchmark.

After merge, move the Langfuse `production` label to the pinned version. A
mismatch is an actionable alert, not a traffic selector or deployment blocker.
A missing pinned version is a distinct critical degraded state: restore it or
promote new qualified evidence; do not silence the alert by following a label.
