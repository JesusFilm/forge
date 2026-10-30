# Studio hosted build and approved VM release

Status: local implementation/review; no workflow run, registry publication, credentials or production activation authorized.
Fixed base: `97e747ce328b73af72e960202c7b813725f288e6`, tree `a58514a14a9c4787807509a6621223a0db23dfbc`; root equivalent `a13dace2`. Preserve the completed runtime evidence and do not repeat runtime suites.

## Intended release chain

A reviewed PR merges to main. A manually enabled hosted workflow builds the existing `render-job` and `verify-job` targets and the existing host supervisor bundle from that exact source commit. A candidate records OCI digests, bundle checksum, source commit, workflow run and exact codec identities. An explicit reviewed release selection pins that candidate; the VM fetches only that approved selection, verifies bytes/provenance, drains, installs and switches through existing ops interfaces. Rollback selects an earlier approved immutable record, never a mutable tag or reset job deadline.

No self-hosted runner on the VM, inbound deployment listener, SSH credential in CI, or provider/production token in image builds. Registry read credentials remain on the trusted host. Candidate publication, release approval and production activation are distinct operations.

## Bounded edit map

- `.github/workflows/studio-release.yml`: new source-only hosted candidate build/publish workflow, default disabled, manual main-only invocation, minimal per-job permissions, no PR-code execution with write credentials. Reuse existing checkout/setup conventions; pin new supply-chain actions/tools by reviewed immutable identity.
- `apps/studio-render/ops/release/`: small release-record validation and preparation CLI, pinned tool/config contract, artifact download/verification integration and explicit selected-release application through existing installer/switcher. Keep credentials/configuration separate; no second job authority.
- `apps/studio-render/test/release-*.test.*`: focused public CLI/record and workflow-policy cases with disposable local files and fake external-command boundaries. No real Docker builds, VM changes or provider calls in this phase's tests.
- `apps/studio-render/Dockerfile` only if a narrow host-bundle export target is needed to reuse its exact Node/toolchain. No change to runtime render/verifier targets or resource profile.
- `apps/studio-render/ops/README.md`, release runbook/validation evidence and feat-460 checkpoint. Preserve historical runtime manifests.

## Durable artifact proposal

Use repository-owned GHCR namespaces derived from `JesusFilm/forge`: separate render, verifier, host-bundle and codec-supply packages. OCI digests bind images and artifact manifests; the host bundle and codec archive are additionally checked by their existing exact SHA256. Tags aid discovery only. GitHub Actions artifacts are temporary candidate handoff, not the durable codec or deployment source.

The codec package must contain the reviewed versioned archive SHA256 `e414c137c7d6ed089c75d0887165f9a5fc1feb38bb6883f31d27fef0c00a03e4`, with the two already reviewed executable hashes. No latest URL or expiring upstream fallback. Its first approved immutable OCI digest is deliberately unset until an owner authorizes/provisions supply; validation fails closed. Package retention/access policy must preserve every selected release and required rollback dependency. Digest verification detects replacement; it does not prevent an authorized registry administrator deleting bytes.

The candidate manifest binds exact source SHA, repository/workflow identity/run, platform linux/amd64, codec artifact/archive/binary identities, render/verifier digests and host-bundle digest/checksum. Provenance attests origin, not human approval. The approval record separately pins the complete candidate digest and intended deployment target/profile. Publication and VM selection must reject changed bindings, tags, missing artifacts or unapproved records before install/switch.

## Approval and unavailable account facts

A GitHub environment name alone is insufficient: referencing a missing environment creates it without protection rules. Required-reviewer availability also depends on repository visibility/plan. Keep publishing disabled until an owner verifies an actual approval mechanism and main protection. Prefer a configured environment with required reviewers/no self-review/no bypass, plus explicit reviewed candidate selection. If those protections are unavailable, a reviewed main-branch approval record plus explicit operator-selected immutable digest is the fallback to evaluate; do not silently treat an unprotected environment as approval.

Exact external owner decisions still needed: confirm GHCR package namespace/visibility and retention owner; authorize first codec archive publication/retention (including distribution policy); verify repository/environment approval support and nominate release approvers; provision narrowly scoped registry read access for the VM. None can be established by local workflow files. No credentials or packages are provisioned during preparation.

## Test seams and validation

TDD seams proposed to root before tests: (1) public release-record/preparation CLI refusing malformed/mutable/mismatched/unapproved identities before external commands; (2) rollout command using a verified selection, preserving drain and rollback semantics without changing current job bindings; (3) static workflow policy enforcing main-only/default-off and separation of build, publication and approval permissions. Use actual disposable archive/JSON bytes for verification and bounded fake command executables to observe no premature pull/install/switch. Runtime suites remain unchanged.

Validate the new scripts, workflow syntax/policy and packaging interface only; use independent fixed-base Standards/Spec review and normal hooks. Actual hosted runs/publication and production pull/activation remain separate named authorized release operations.

## Primary references

- [GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments): protection availability and automatic unprotected creation.
- [GitHub package deletion](https://docs.github.com/en/packages/learn-github-packages/deleting-and-restoring-a-package): digest-addressed packages still require an owner retention policy.

The existing repository has only `ci.yml`, `issue-labels.yml` and `rag-pages.yml`; no renderer publishing workflow exists at this base.

## Current owner facts and review qualification

Root's2026-09-09 read-only facts: `JesusFilm/forge` is public and defaults to main; exact `studio-release` environment GET returns404. Effective main rules include deletion/non-fast-forward protection and a pull-request rule with squash-only merges and review-thread resolution, but required approving review count0. Classic branch-protection404 does not mean no effective rules. No setup change was made. The publisher checks actual digest-bound user review; preflight does not prove source PR approval protection. Owner verification/configuration of the desired main review policy remains a named setup prerequisite.

Local scope adds a bounded candidate ZIP reader before extraction and OCI metadata bounds before library allocation. This implements the approved inert-publisher boundary; no candidate path or script executes with registry-write credentials. The host command supports inactive updates and clean rollback; ambiguous partial rollouts retain pending state for explicit operator reconciliation, never guessed success.
