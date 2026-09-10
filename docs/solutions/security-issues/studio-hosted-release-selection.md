---
module: Studio rendering
problem_type: security_issue
tags: [studio, release, github-actions, oci, approval, vm]
---

# Bind release selection to trusted identity and exact bytes

A candidate JSON document cannot approve itself. The prepared hosted release path separates read-only candidate builds from a privileged inert publisher. The publisher reads GitHub's actual run/environment/review records and requires a configured reviewer who is neither the original nor rerun actor, with a comment binding the complete candidate SHA256. Missing or ambiguous response fields, pagination indications and conflicting rejection fail closed. A same-name environment is insufficient; its numeric identity and current reviewers must match configuration.

Approval is checked before registry login/copy. Candidate ZIP names, expansion bounds and exact candidate bytes are checked before extraction. OCI headers/blobs are validated without extracting or executing candidate paths; the host bundle payload must match the same approved record. ORAS transfers inert archives. A partially copied set is not a successful release record. Temporary Actions artifacts are transport, not durable codec supply.

The VM uses separate authority: an explicit digest passed by a trusted root operator and root-owned target policy. It acquires only matching immutable artifacts, installs inactive, drains the existing worker before changing image configuration, and keeps activation separate. Clean rollback selects a prior exact candidate; uncertain partial rollout preserves the pending operation/private prior config for explicit reconciliation. No lease deadline is reset and no ambiguous cleanup is relabeled success.

`apps/studio-render/ops/release/README.md` specifies the prepared workflow, target layout, retention/setup owners and commands. Main PR approval enforcement is an owner prerequisite that the current environment preflight does not establish. The root's classic protection404 and effective PR rules with zero approvals must not be conflated. The workflow remains disabled until named setup is authorized; source validation is not hosted-build, registry, VM or production acceptance. Exact focused evidence and failures are in `docs/validation/studio-460/hosted-release/README.md`.
