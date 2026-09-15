> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Hosted release tooling handoff

Integrate only this phase's final implementation commit, based on `97e747ce328b73af72e960202c7b813725f288e6` (root `a13dace2` equivalent). Do not duplicate runtime prerequisites or the separately integrated462 docs commit. Root's current docs tree can receive this non-overlapping source/tooling delta; the common runbook was not edited.

Prepared surfaces:

- `.github/workflows/studio-release.yml`: manual main-only default-disabled candidate build and independent protected inert publisher.
- `apps/studio-render/ops/release/`: strict candidate/approval/OCI verification, bounded GitHub artifact transport, exact codec acquisition, publication orchestration and explicit root-selected inactive acquisition/update/clean rollback.
- `apps/studio-render/Dockerfile`: new isolated `host-package`/`host-bundle` export targets; existing renderer/verifier targets and job budgets unchanged.
- `apps/studio-render/ops/release/README.md`: concrete namespace/environment/main-policy/codec owners, trusted host layout, commands and unresolved rollout policy.

Final focused results:37 tests pass in `release-suite-final.log`; pinned actionlint exits0 in `workflow-actionlint-final.log`. Actual offline ORAS copy preserved the exact tiny fixture manifest/payload; it is not hosted image or VM qualification. Fixed-base Standards/Spec source reviews and final docs review are clear after the documented credential-wording correction. The main-review-policy owner prerequisite remains explicit.

Normal hooks are required for the implementation commit. The authoritative commit SHA, hook exit and clean-state result are sent to root after completion; the owned hook log is `/home/tataihono/.cache/forge-studio-460-release/hooks.log`. No hook bypass, push, merge, upload, workflow dispatch, account setup or VM operation is part of this handoff.

Remaining named external sequence, not authorized by source preparation: establish durable codec/package retention and initial supply; configure actual environment reviewers and source PR policy; merge reviewed nonsecret enable configuration; run/qualify hosted image and host-bundle candidates; approve publication and exact VM selection; acquire/install inactive and then approve named activation/rollback checks. Production HTTPS/pool/storage/provider/public-release gates remain as documented by the common runbook. Full460 is incomplete until its remaining acceptance is actually established.
