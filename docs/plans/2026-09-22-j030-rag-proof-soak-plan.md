# J030: RAG proof, archive, and dashboard documentation

## Scope

Audit `feat-435` against the current RAG lane conventions, historical issues
#130/#168, merged migration records, and read-only GitHub metadata. Distinguish
local Icelandic slice evidence, operator recollection, and production proof.
Record the investigation in the ticket's planned
[`proof-soak-archive.md`](../roadmap/rag/evidence/feat-435/proof-soak-archive.md)
receipt, including the consumer inventory and any unresolved closure gates.

Refresh the dashboard using the repository `status-dashboard` process. The J030
request authorizes the necessary `read dashboard snapshot` operation against
`Doppler forge-rag/prd production-read`; no production writes, schema changes,
publication, credential changes, or repository-setting changes are authorized.
If the read or validation fails, preserve the committed dashboard and record
the exact blocker. Do not reconstruct a production snapshot from local counts.

## Work and review

1. Keep `feat-435` in progress during the audit; close only proven or explicitly
   accepted requirements. Missing retirement decisions require owner input.
2. Update the ticket and lane index, preserving the docs-only lane. Repair
   reciprocal dependencies only where directly connected to `feat-435`.
3. Run status/snapshot/dashboard checks as far as the evidence allows, plus
   focused dashboard/Pages tests, local browser verification for new artifacts,
   formatting, local links, and roadmap consistency checks.
4. Review the diff for unsupported claims and sensitive material. Record durable
   evidence/limitations guidance in the receipt, then commit and open one draft
   PR to `main`. Merge and publication remain outside this job.

Compound Engineering commands are unavailable in this session; this plan,
implementation, review, and consolidated receipt follow that loop without
delegation. The original `ops/j030` branch is preserved: it contained two unrelated
J007 commits. The task uses `docs/j030-rag-proof-status` from current `origin/main`
(`0f7bbe195`) so the PR contains only J030 work.

## Authorized continuation — Option A

Jaco revised the closure gates on September 22: Forge RAG is already the active
owner, all consumers have migrated, and external traffic is outside this scope.
Rollback rehearsal/expiry and final snapshot retention are not applicable to
feat-435 closure. Legacy service and credential retirement move to a separate
follow-up ticket; the unverified Icelandic import provenance and missing direct
migration/AGENTS README links are accepted limitations.

Update feat-435, its consolidated receipt, and the lane index; create the next
globally available roadmap ticket for deferred retirement with reciprocal
dependencies. Keep the existing verified dashboard snapshot and artifacts;
this continuation needs no production or credential operation. Recheck local
documentation, status/dashboard verification and Pages assembly, then commit,
push, and update draft PR #2379 without merging or deploying.
