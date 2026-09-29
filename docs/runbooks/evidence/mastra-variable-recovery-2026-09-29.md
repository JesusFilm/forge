# Mastra variable restoration and restaging audit

## Incident and authorization

On 2026-09-29 Jaco reported accidentally applying a staged Railway change and
aborting deployment `d1dd4573-f20a-44a3-b827-24622e1d77f2`. He then explicitly
asked to restore the previous variables and make the change pending again.
This record describes the recovery already applied on `forge` / `production` /
`@forge/mastra`. Merging this documentation PR performs no production operation.

Original patch: `ceb2e619-f136-4707-a057-dc8fca307b27`, created at
`2026-09-15T02:43:20.998Z`, applied at `2026-09-29T03:30:27.934Z`.
Railway records `jaco-brink` as its applying user. It affected only these
variables on Mastra:

- `DATADOG_TRIAGE_API_KEY`
- `DATADOG_TRIAGE_APP_KEY`
- `LINEAR_DATADOG_TRIAGE_API_KEY`

The patch was staged when independently read immediately before and after the
separate RAG usage-variable update at approximately 03:28 UTC. Its creation date
does not establish that each value was last edited on 15 September. The original
staging author and per-variable edit dates were not established by the available
records. The aborted deployment was created on **29 September**, not 15 September.

## Baseline and exact applied writes

The previous successful Mastra deployment was
`f08d00c3-414f-40f6-8135-e99658565ffb`. Its Railway deployment snapshot,
`109cfe6e-ebff-4160-9689-e9af734d2942`, created at
`2026-09-28T01:06:45.321Z`, contained none of the three variable names.
Restoring that baseline therefore required removing three additions, rather
than replacing existing credentials with guessed values.

Before writing, the operator confirmed that the current committed values still
matched the accidentally applied patch, that it contained only the three
expected variables, that the accidental deployment was stopped, that the old
deployment remained successful, and that no other change was pending.

Two configuration mutations followed:

1. `environmentPatchCommit` with an explicit patch containing only those three
   variable deletions for Mastra and **`skipDeploys: true`**. The operation was
   acknowledged at `2026-09-29T03:43:10.112150Z`. No environment-wide staged
   commit or deployment rollback was requested.
2. `environmentStageChanges` with **`merge: true`**, containing the original
   three-variable proposal read directly from Railway. Acknowledged at
   `2026-09-29T03:43:14.434827Z`, it created pending patch
   `1b405e65-5df5-4462-b357-78d6dfa67a34` with status **`STAGED`**.

The removed deployment ID remains removed. This recreates the configuration
proposal for later review; it does not requeue the aborted deployment.

## Verification and scope limits

Read-back confirmed:

- Exactly the three named committed variables changed and all three were absent.
- Every other returned Mastra variable remained unchanged.
- RAG service variables remained unchanged.
- The running/latest successful Mastra deployment remained unchanged throughout
  restoration and staging; the operation triggered no new deployment.
- The complete new staged patch matched the original three-variable proposal,
  including its values, and staging did not reapply them to committed config.

Safe receipt: [mastra-variable-recovery-2026-09-29.json](mastra-variable-recovery-2026-09-29.json).
Its timestamps describe operator acknowledgment/read-back, rather than invented
database commit times. The restore API returned an operation identifier, recorded
as `restoreOperationId`; the pending patch ID is recorded separately.

No secret values, connection strings, value hashes or payloads are included.
Values were read and transferred in subprocess memory/stdin, never command
arguments, files or output. No credentials were minted or rotated. The operator
issued no application database writes, schema changes, Datadog calls or Linear
calls. No RAGBot personal consumer key was accessed.

Retained operator source on the VM:
`/home/jacobuntu/Ops/config/ragbot/operator/restore-mastra-pending-variables.py`;
SHA-256 `2fecfa0ac8f90e429e6e4985a505a433e03599e9c7e4d9a8541b81bb1ea94e48`.
It is narrowly guarded against this incident and refuses changed baselines;
do not rerun it to inspect status.

## Current disposition

The previous committed baseline is restored and the proposed triage credentials
are pending review. This does not grant approval to apply that patch or activate
the triage pipeline. Follow [the triage runbook](../datadog-mobile-triage.md) and
its scoped-credential, migration and dry-run requirements before rollout.
