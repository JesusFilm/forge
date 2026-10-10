> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Authorized owner setup recorded 2026-09-09

Fixed base `1e5c892e08977a50308fccdb275d0c00d224404c`. This bounded follow-up records root's user-authorized external setup; this task performed only local configuration, evidence reads and validation. Earlier absence/unprovisioned statements in the parent release preparation are historical, not the current owner-setup state.

The configured `studio-release` environment is ID21503495622, with reviewer `tataihono` user802117, prevent-self-review enabled, administrator bypass disabled, and sole main branch policy. The authorized private codec package ID14941980 contains immutable artifact `ghcr.io/jesusfilm/forge-studio-codec@sha256:a60de84e61cded686c703768809e34dc20bc0e501273fe1a5d4b9af5400f9cad`. Its single `codec.tar.xz` layer is126,621,792 bytes with reviewed SHA256 `e414c137c7d6ed089c75d0887165f9a5fc1feb38bb6883f31d27fef0c00a03e4`.

`facts.json` retains a sanitized projection and hashes of root's original evidence under `/home/tataihono/.cache/forge-studio-release-setup/`. Existing environment and artifact validators matched the supplied local evidence, including the exact manifest bytes/digest. There was no new account query or publication by this task.

The config remains **enabled:false**. The affected workflow/config tests failed on the old null values (`config-red.log`) and pass3 cases with the populated identifiers (`config-green.log`). The single disabled-preflight CLI regression also passes and still refuses before token/network access (`disabled-preflight.log`). No runtime checks or builds were repeated.

Remaining limits are explicit: the authenticated account is the reviewer, so another actor must dispatch; main's source-review count remains0; the codec package's repository association is null and Actions read access still requires setup. Root additionally reports exact codec version1224700787. The attempted persistent Actions read grant was rejected by automatic approval review and has not been granted; root owns the specific permission request and external readback/access work. This update does not enable the workflow, change main rules, publish another artifact, touch the VM, or establish hosted-build/production acceptance. Full460 remains in progress.

Independent narrow Standards and Spec reviews against `1e5c892e08977a50308fccdb275d0c00d224404c` are clear. Both confirmed the exact identifiers, disabled state, historical qualifications and pending access/dispatch/main-policy limits. Reviewers performed no tests or external operations. Normal hooks are required for the final single-commit handoff.
