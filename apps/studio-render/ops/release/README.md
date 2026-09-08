# Hosted candidate publication and explicit VM selection

This is prepared release tooling, not evidence of a hosted run, published package or production rollout. The checked-in configuration is disabled. The VM runtime evidence remains in `docs/validation/studio-460/vm-execution/`; do not infer new image qualification from these packaging scripts.

## Trust and artifact flow

The manually invoked `studio-release.yml` runs only for `JesusFilm/forge` on `refs/heads/main`, when both the repository enable variable and reviewed configuration permit it. Candidate builds receive contents/actions/package **read** permissions. The distinct publisher receives package write permission after the named environment gate. It checks the actual GitHub run, original actor and rerun actor, environment ID, configured reviewer user IDs, decision and exact comment `studio-candidate-sha256:<candidate SHA256>`. Neither actor may self-approve. Missing fields, conflicting rejection, redirects in approval reads, pagination headers, oversized bodies and incomplete JSON refuse publication. The documented review-history endpoint supplies an array without pagination parameters; the adapter refuses a pagination indication instead of inventing a cursor or assuming a partial list is complete.

A review comment is only the digest binding. Its text does not establish reviewer identity; identity comes from GitHub-authenticated API responses. The candidate includes the run attempt in its hashed bytes, so a review of different attempt output does not authorize changed bytes. The run API's actual attempt/source must match. No review-history attempt field or commit-instant revocation guarantee is claimed.

The publisher downloads the exact Actions artifact ID into an owned staging area. It validates the four ZIP names, types, declared sizes and candidate digest before extraction. Bounded ZIP directory and TAR extended-header checks precede library metadata allocation. OCI members are read and hashed in place, never extracted or executed. All copied manifests/blobs and the host bundle payload must match the candidate. ORAS copies inert OCI archives; the publisher never runs Docker or candidate-supplied scripts. A partial copy does not publish a successful release record. Retrying publication copies the same immutable identities; tags are discovery aids only.

The final record is an OCI artifact in `ghcr.io/jesusfilm/forge-studio-releases`; its `candidate.json` payload SHA256 is the separate human selection identity. The record binds the exact render/verifier manifest digests, host artifact and bundle SHA/size, codec artifact/archive/binary hashes, source/run, target, platform and execution profile. The VM never treats an `approved:true` field or a claimed workflow name inside JSON as authority. Its authority is the operator's explicit digest passed to a trusted root-owned command, combined with root-owned target policy. Hosted provenance and VM selection are separate from activation.

## Concrete setup still requiring owner authorization

No item below has been provisioned by this phase.

1. Approve the package namespace and visibility/retention owner for `ghcr.io/jesusfilm/forge-studio-{codec,render,verify,host,releases}`. Preserve selected and rollback dependencies; digest addressing does not prevent an administrator deleting packages. No self-hosted arbitrary PR runner belongs on the VM.
2. Approve durable retention/distribution of the exact reviewed versioned codec archive. Its SHA256 is `e414c137c7d6ed089c75d0887165f9a5fc1feb38bb6883f31d27fef0c00a03e4`; executable hashes remain in `IMAGE.md` and `release.py`. The original archive is absent and the upstream versioned release is pruned after14 days. Neither an expiring URL nor a temporary Actions artifact is durable supply. Publish the reviewed archive as a **single** OCI layer named `codec.tar.xz`, record its immutable manifest digest, and retain it under owner policy. For an approved operator, the proposed ORAS command shape is `oras push --artifact-type application/vnd.jesusfilm.studio.codec.v1 ghcr.io/jesusfilm/forge-studio-codec:<discovery-tag> codec.tar.xz:application/x-xz`; authentication stays in an external registry config, never command arguments or image layers. This command has not been run.
3. Create/configure the exact `studio-release` environment with explicit reviewer **user** IDs, prevent self-review, restrict it to main, and disable bypass. Record its actual numeric ID. Root's2026-09-09 read-only exact-name GET returned404. A same-name replacement with another ID is refused; an environment name alone is not protection.
4. Verify and approve main's source-review policy. Root's effective rules read found deletion/non-fast-forward protection and a pull-request rule, squash-only merges and required review-thread resolution, but **zero required approving reviews**. Classic branch-protection404 did not mean main was wholly unprotected. Decide the required source-review count and enforce it before enabling this path. `preflight` verifies the actual environment/reviewers; **it does not prove main's PR approval protections**. This remains an owner setup prerequisite, not a passed local check.
5. Merge reviewed nonsecret `config.json` values: `enabled:true`, exact codec OCI digest, target, environment ID and reviewer IDs. Enable repository variable `STUDIO_RELEASE_ENABLED=true` only after the above setup is approved. Missing values fail closed. Do not create an unprotected environment as a fallback. Repository visibility is public per root's read-only check; no account mutations or package inventory assumptions were made here.
6. Provision narrowly scoped package read access on the trusted VM, outside authored containers. Preserve the separate scoped production job API credentials and default-off Admin/Manager production controls. Release CI receives no SSH key, pool key or provider credential.

## Hosted build and approval

After reviewed PR-to-main integration and named setup approval, manually dispatch the workflow. `publish:false` builds only a temporary candidate. `publish:true` requests the protected publisher after the candidate is available; its build still has no package-write permission. Review the candidate artifact, source and complete digest, then use the exact displayed digest comment when approving the environment. The workflow alone cannot authorize production connection.

The render and verifier use the existing `render-job` and `verify-job` targets and original named codec context. The added `host-bundle` target exports `supervisor.tar` using the same pinned Node base and native watchdog source. It does not enter the authored runtime or change its budgets. Existing runtime targets are unchanged. System package repositories and hosted runners can change build bytes; this is immutable **output selection**, not a claim that future rebuilds are bit-identical. Every changed output requires a new exact selection.

ORAS1.3.0 archive and executable hashes are checked before use. Actions and BuildKit are pinned. The codec read credential is removed before Docker builds; the Dockerfile receives no credential mount. Temporary Actions artifacts expire after7 days and are only candidate transport. A successful final publication records the immutable release artifact and candidate payload SHA in the run summary. The first hosted build must still qualify the newly built image and exported host bundle before selecting them on the VM; local source validation is not that proof.

## Install release tools and acquire a selected bundle

Use the trusted host operator over existing pinned SSH. Install this **reviewed** ops directory under `/usr/local/lib/forge-studio-release/ops`, preserving `release/`, `install-supervisor.py` and `switch-supervisor.py`. Make files and every parent root-owned and non-writable to other users. Install the exact checksum-verified ORAS binary at `/usr/local/lib/forge-studio-release/oras`. Do not execute root release tools from a user-writable checkout. Tool installation is a named release operation, not something CI performs on the VM.

Create `/etc/forge-studio/release-policy.json`, root-owned mode0600, with exactly `{"version":1,"enabled":false,"target":"forge-render-proxmox-1"}`. An approved operator changes enabled to true only for the established target. It contains no approval boolean for a candidate and no registry credentials. Registry read configuration remains `/var/lib/forge-studio/docker-client/config.json`, root-private; jobs never receive it.

Obtain the exact candidate JSON from the approved hosted record, transfer it into a root-private file, and independently compare its SHA256 with the selected digest. This metadata transfer does not grant authority: the following command checks the explicit digest and target again before acquisition. A trusted operator can also fetch the raw candidate blob from the fixed releases package by that SHA using ORAS with a65,536-byte file limit and a bounded command timeout; never use an unbounded pull/extract of arbitrary artifact paths.

```sh
sudo python3 /usr/local/lib/forge-studio-release/ops/release/acquire.py \
  --candidate /root/studio-release/candidate.json \
  --approved-candidate-sha256 <explicit-selected-candidate-sha256> \
  --output-directory /root/studio-release/selected-bundle
```

The output directory must be new. This command downloads only the selected immutable host artifact's single bounded `supervisor.tar` blob, verifies manifest/payload bindings, and performs no installation, switch or activation. OCI record approval remains distinct from the bundle's own SHA. A failed download remains available for inspection; do not label it successful acquisition.

## Inactive update and rollback

Initial bootstrap remains the existing `../README.md` install/configuration contract. `host.py` deliberately requires an existing selected release; it does not infer that an unknown host is safe or configure production credentials.

```sh
sudo python3 /usr/local/lib/forge-studio-release/ops/release/host.py \
  --candidate /root/studio-release/candidate.json \
  --approved-candidate-sha256 <explicit-selected-candidate-sha256> \
  --bundle /root/studio-release/selected-bundle/supervisor.tar
```

The command refuses non-root callers, disabled/mismatched policy, altered candidate or bundle bytes before registry acquisition. It serializes release operations, persists an operation record, preloads the exact image digests, installs the bundle inactive, then uses the existing switcher to drain and verify the current release's assignment journals before changing image configuration. It preserves the old private config/release identity and selects the new release **inactive**. The original worker enabled value is retained; it does not enable production or boot startup. Activation remains the explicit existing switcher operation after separate approval.

Clean rollback uses this same command with an earlier explicitly approved candidate, bundle and image digests. Each completed selection has its own operation directory, so a previously selected candidate can be selected again for rollback. Preserve old artifacts and credentials needed to read them. Running work keeps its original image digest/lease/absolute deadline; this orchestration does not reset the900s job budget. The existing switcher waits at most1200s for drain; the command wrapper allows1250s to observe its result.

An incomplete operation leaves `/var/lib/forge-studio/release-pending` and its `selected-releases/<operation-id>` directory. New automatic rollout attempts refuse it. A failed switch can leave new image configuration with the old or new selected symlink; **no automatic rollback or successful selection is inferred**. Preserve drain and inspect the recorded candidate, private previous configuration, current symlink, service state and all journals through the existing trusted switcher/reconciliation contract. Only an operator who establishes physical retirement and the exact intended current selection may archive the pending marker and authorize another attempt. Preserve the operation record; never delete malformed job journals or reset a lease to regain capacity. This exceptional reconciliation is intentionally manual and is not a tested automatic recovery claim.

## Local validation boundary

`PYTHONDONTWRITEBYTECODE=1 python3 apps/studio-render/test/run-release-tests.py` loads the focused release suite; workflow parsing uses PyYAML6.0.3 in the recorded local environment. The supplied runner rejects an empty suite. Source-only validation also uses pinned actionlint1.7.7. See `docs/validation/studio-460/hosted-release/README.md` for failures, exact results and tool pins.

No hosted workflow, registry upload, new image build, VM installation, production dispatch, provider operation or broad runtime suite ran during this phase. Follow `docs/runbooks/studio-release-canary-and-rollback.md` for the overall current VM acceptance gates; this directory owns only artifact/selection tooling. Normal production release remains PR-to-main with root/operator approval for named external operations.

## Primary sources

- [GitHub environment protection and automatic creation](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
- [Workflow run and review-history fields](https://docs.github.com/en/rest/actions/workflow-runs).
- [ORAS copy from an OCI archive](https://oras.land/docs/commands/oras_cp/).
- [Curl sensitive headers on redirects](https://curl.se/docs/manpage.html#-H): artifact transport follows only bounded HTTPS redirects; it never uses `--location-trusted`. Approval API reads do not follow redirects.

## Owner setup update — 2026-09-09

The earlier “not provisioned by this phase” and environment404 statements describe the original release-preparation checkpoint. With subsequent explicit user authorization, root provisioned environment21503495622 (`studio-release`), reviewer802117 (`tataihono`), prevent-self-review, no admin bypass and a sole main branch policy. Root also published the approved codec as private package14941980 at `ghcr.io/jesusfilm/forge-studio-codec@sha256:a60de84e61cded686c703768809e34dc20bc0e501273fe1a5d4b9af5400f9cad`. The exact reviewed archive layer is unchanged. These actual identifiers are now recorded in `config.json`, with **enabled:false** preserved.

Another actor must dispatch because the authenticated account is the reviewer. Main's source-review count is still0. The codec package currently has no repository association; Actions read access still needs root's setup/readback. No workflow activation, main-rule change, additional publication or VM action follows from this local alignment. Dated evidence and focused results are in `docs/validation/studio-460/hosted-release/owner-setup/README.md`.
