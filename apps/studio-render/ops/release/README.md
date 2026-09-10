# Hosted Shorts release and VM selection

Releases run manually from main. The repository variable `STUDIO_RELEASE_ENABLED` and checked-in `config.json` must both enable releases. Set the dispatch `publish` input to publish the resulting candidate. The `studio-release` environment retains its main branch restriction but has no required reviewer or separate approval step, as requested by the owner on 2026-09-10. Tataihono can dispatch and publish directly.

The candidate job has read-only package access. The publisher checks the actual GitHub workflow run, attempt, main commit, candidate digest, every OCI blob and the host payload before copying artifacts with package-write permission. It never executes downloaded candidate code. GitHub approval history, reviewer identities and approval comments are no longer consulted.

The configured codec is retained at its exact OCI digest. Registry credentials remain outside images. Release CI receives no VM SSH key, worker key or provider credential. VM selection and activation use the existing host commands below; publication alone does not activate the renderer. Retain selected and rollback artifacts in GHCR.

## Build and publish

After the source configuration and repository switch are enabled, run:

```sh
gh workflow run studio-release.yml --repo JesusFilm/forge --ref main -f publish=true
```

Inspect the run summary for the immutable release artifact and candidate SHA256. Use those exact identities for VM acquisition and selection. Source-review and CI checks still apply through the normal PR-to-main flow.

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

## Validation

Run `PYTHONDONTWRITEBYTECODE=1 python3 apps/studio-render/test/run-release-tests.py`. The focused tests cover manual main binding, modified candidate rejection, inert publication, and inactive host selection. They do not establish a hosted build or production rollout.
