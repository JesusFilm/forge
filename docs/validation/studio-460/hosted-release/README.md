# Hosted release preparation evidence

Fixed source base: `97e747ce328b73af72e960202c7b813725f288e6`, tree `a58514a14a9c4787807509a6621223a0db23dfbc`, root equivalent `a13dace2`. Root later integrated the independent five-file462 runbook update as `bdb13723`; this phase did not duplicate that prerequisite or edit its runbook.

This evidence qualifies local source preparation for `.github/workflows/studio-release.yml` and `apps/studio-render/ops/release/`. **No hosted workflow, registry publication, new image build, VM rollout, production connection or provider operation ran here.** Previous VM/runtime evidence is unchanged. Full460 remains in progress.

## Final focused scope

- `release-suite-final.log`:37 tests pass (the preceding metadata snapshot also passed37). These exercise candidate/hash/target refusal, actual GitHub adapter semantics with fixture responses, CLI default-off/non-root refusal, inactive rollout ordering with fake commands, bounded archive metadata/paths and publisher byte/approval/copy ordering. They do not establish real GitHub permissions or actual host drain.
- `workflow-actionlint-final.log`: pinned actionlint1.7.7 exits0 after one real context correction. Shellcheck and pyflakes adapters are disabled because the YAML run steps are direct Python commands; Python syntax/tests are separate. An empty log represents the recorded successful command, not a runtime test.
- `oras-offline-first.log`: actual checksum-verified ORAS1.3.0 creates and copies a tiny **inert local OCI artifact**. Source/copy manifest `sha256:498305508f116f5db09cb628196207515cfff4028819776968736f85f5ab8cc4` matches; the57-byte payload hash is `26a746cc92985920b1e50f270f727936d9ff80fac7d1d0cbf23015199a940f8d`. No registry or rendered image is involved. `oras-offline-metadata-qualified.log` reads those unchanged archives with the final metadata bounds; it does not rerun image qualification.
- Independent fixed-base Standards and Spec reviews are recorded in `REVIEW.md`. Source review does not establish hosted image/bundle operation or production acceptance.

The explicit test runner is `PYTHONDONTWRITEBYTECODE=1 python3 apps/studio-render/test/run-release-tests.py`. Python3.14.4 and PyYAML6.0.3 were present locally. Hosted source targets Ubuntu24.04/Python3.12+; no Python3.14-only syntax is used. Do not claim that this local run was a hosted Ubuntu job.

## Preserved failures and qualifications

| Evidence                                                                                                           | Exact interpretation                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record-red.log`, `apply-order-red.log`, `approval-red.log`, `oci-red.log`, `download-red.log`, `workflow-red.log` | Initial absent interface/file failures during TDD. They are not behavioral security exploit proofs.                                                                                                           |
| `record-target-red.log`, `record-supply-red.log`                                                                   | Candidate target/supply restrictions were initially absent; later focused records pass.                                                                                                                       |
| `record-ambiguity-red.log`                                                                                         | Real lookalike registry-host regex and duplicate-JSON-key acceptance reproduced; `record-ambiguity-green.log` records5 passes after correction.                                                               |
| `github-path-red.log`                                                                                              | The documented `workflow.yml@main` path was incorrectly refused. Green accepts only bare exact path or exact `@main`, and still refuses another branch suffix.                                                |
| `publish-command-first.log`                                                                                        | Harness qualification failure: helper named `run` shadowed `unittest.TestCase.run`. No publisher assertion ran. `publish-command-qualified.log` records3 passes after renaming the harness helper.            |
| `release-suite-first.log`                                                                                          | Standard discovery loaded zero tests because these filenames contain dots/hyphens. No coverage claim. The explicit runner rejects zero cases; later35 and final37-case logs are distinct.                     |
| `workflow-actionlint-first.log`                                                                                    | Actual YAML error: `runner.temp` is unavailable in job-level env. Moving the same Docker config path to the buildx step env fixes syntax and preserves matching builder selection.                            |
| `oras-offline-metadata.log`, `oras-offline-metadata-qualification.txt`                                             | Initial read-only check entered size55 instead of57. Empty stdout and the returned refusal are qualified explicitly. Final check derives size from the original exact payload; archived bytes did not change. |

Logs named `first`, `red` or `qualified` retain their original contents. Earlier green logs are intermediate focused results, not substitutes for the final37 cases. No historical runtime tests/builds/performance measurements were repeated.

## Boundaries and remaining operations

`ops/release/README.md` is the concrete setup and operator contract. Prepared code requires a real configured environment/reviewer identity and immutable codec supply; neither exists merely because the workflow file is present. Root's read-only report established public repo/main default, exact environment404 and effective main PR rules with required approving-review count0. Classic branch-protection404 did not establish absence of all protections. Preflight verifies the environment, **not** main source-review enforcement. Main policy remains an explicit owner setup prerequisite.

The proposed namespaces are `ghcr.io/jesusfilm/forge-studio-{codec,render,verify,host,releases}`. An owner still must authorize retention/distribution and first exact codec publication, actual environment/main policy setup, hosted builds and artifact publication, then approved VM pull/install/activation. The new host-bundle Docker target is source-validated only; its future built bytes need qualification before selection. The same existing renderer/verifier targets do not waive qualification of new output digests.

Host updates and clean rollback remain inactive by default. Failed partial operations retain a pending marker and private prior configuration; exceptional reconciliation is manual, not claimed as automatic rollback. No caller-authored JSON approval grants authority. Production durable storage, scoped HTTPS/pool setup, actual provider/Mux/public Watch acceptance and other release gates remain open under the common runbook.

## Subsequent authorized owner setup — 2026-09-09

The environment absence and unprovisioned codec statements above are historical to the original preparation. `owner-setup/README.md` records root's subsequently authorized private codec and environment provisioning and the matching disabled configuration. Other-actor dispatch, main-review policy and package Actions read access remain unresolved; this task made no external changes.
