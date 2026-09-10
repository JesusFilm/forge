> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Dedicated VM execution qualification

Fixed source review base: `5f460b6daf3b7f43b389925e25604babcb43099a` (root equivalent `f9e7165c358dbd622429ba94f663a9f0b9dc02b2`). Feat-460 remains in progress. This evidence covers the authorized dedicated VM and owned local API/database; production, paid providers and image publication remain off.

## Runtime and provenance

Ubuntu24.04 dedicated VM `10.2.1.100`, Docker29.8.0 from its verified official repository, pinned SSH. Only SSH and loopback DNS/fixture forwarding listen. Docker has no TCP listener. Credentials stay on the trusted host/Manager; both job containers have no network, no socket, no credentials, dropped capabilities and unchanged OCI proc masks/read-only controls. No inner fresh-proc mount is used.

Exact preloaded renderer image `sha256:1f5545cad34fdfb4945bae4fce19322037366ee43fadf7555dcf3e9cdc61bcbb`; separate verifier `sha256:75f306ada316ce00494423b37edd371dc663ffd4f72a20248edd81b6b8342182`. Jobs use `--pull=never`. The versioned codec archive is `e414c137c7d6ed089c75d0887165f9a5fc1feb38bb6883f31d27fef0c00a03e4`; exact binary hashes and supply limits remain in `apps/studio-render/IMAGE.md`. No claim that the absent original archive is retained.

Initial combined daemon bundle: `d0c00b9a005f5e3bddf1873466f2127d145b350cd450937ec4a71d7d531d8cd8`. Final host bundle after review fixes: `cedd3e68111bdc2361de8a5ecd53ffa3d8fc588f76ffd31034f5977a8e18fe48`. Renderer/verifier images were unchanged for the host fixes. Final bundle was installed, started idle, rolled back to the prior installed bundle idle, and selected again drained/inactive. It has not executed another composition; watchdog candidate has its separate actual restart proof. No unnecessary repeated image build/render was performed.

## Accepted local milestones and exact limits

- `first-render-*`: direct exact-image source/custom/caption/audio render and separate verification. Inspected pixels show blue source, green custom element and “Retained caption”; H.264/AAC, full decode and matching digest. This predates daemon integration and does not prove source-media transfer through the daemon. The late sampler observed zero processes, so this first record establishes no live membership. Non-silent audio alone does not substantiate precise trim/gain/frequency. Historical full231s evidence remains separate; no new full231s VM run is claimed.
- Original outbound attempt `1b6b9461…`: retention initially failed with no returned assets because the fixture lacked transfer/configuration seams. The original output was reused within the original lease, retained and canonically completed once. This is recovered flow, not an uninterrupted60s retention-window proof.
- First daemon activation selected older owned pending **empty** assignment-test compositions. Preserve `daemon-first-*` as qualification; it is not visible-text acceptance. Its sampler overwrote final counters after cgroup removal and supports no measured peak claim.
- `daemon-text-*`: actual combined daemon, text render, separate verifier, canonical retention and lost-finish-response recovery. One generation/execution, three assets, SUCCEEDED/COMPLETED. Frame visibly reads “VM daemon fixture”; independent full decode.1539 samples/31 actual process memberships under the exact bounded ancestor, memory peak177684480 bytes, CPU3491912µs, no OOM. All31 captured PID/starttime identities subsequently absent. Bounds2CPU/2GiB/no-swap/128aggregate tasks; child NPROC96. No production bucket or provider is involved.
- `daemon-cancel-*`: canonical cancellation while input preparation awaited response, signal abort observed, no render create/start, no assets. Cancellation remained authoritative and late terminal recording was not admitted.
- `daemon-restart-*`: SIGKILL of the verified daemon PID while an actual renderer ran. Systemd restarted once, original deadline8010730 and exact assignment persisted, no second create/start. Runtime retired; canonical FAILED outcome, not a completed video.19 sampled members, no OOM.
- **`daemon-oom-*` is a failed intermediate**, not OOM proof: missing retained-source transfer route prevented rendering; peak17215488 and zero OOM counters. **`daemon-oom-transfer-*` is the corrected proof**: actual retained custom component allocates memory in Chromium;19 observed members, memory peak2147483648, max23/oom1/oom_kill1, swap0. Runtime retired and canonical failure retained. `daemon-after-oom-*` separately proves a fresh successful generation with three assets afterward.
- `native-boundary-*` uses the exact renderer image with a **diagnostic-only readonly child entrypoint bind**, not the product launcher or canonical composition path. It tests UID1000, hard NPROC96, fork/pthread pressure, blocked hard-limit raising/UID reset/namespaces/proc remount/network/root writes, and detached descendants. No masks were removed. The fixed observed82 forks/threads is ambient UID occupancy, not a product guarantee. Initial filtered capability output was empty; full later deadline status captures zero capability sets, NoNewPrivs1 and Seccomp2.
- `native-deadline-*`: diagnostic blocked Node event loop plus detached child, same native original20s short-proof deadline. Attach-to-stop19556ms; exact runtime retired, original deadline includes setup. Three later-sampled memberships and CPU19534867µs. It does not claim every initial process was sampled or replace the production900s profile.
- `watchdog-expired-restart-red.json`: old native startup exited after one kill, hit five restarts and failed. Green uses the exact same expired deadline/group inode with fixed watchdog: SIGKILL recovery, continuously frozen group, delayed marker absent, trusted retirement stopped owner and removed group. No new execution allowance.
- `claim-fsync-order.strace`: cycle parent fsync precedes dispatch-file/directory fsync and first claim connection (lines33/41). This is syscall ordering, not a power-loss simulation.
- `daemon-upload-cancel-*` / `daemon-active-update.json`: actual render/verifier followed by cancellation after committed upload while response waited4s. Attempt/job remain CANCELLED, three late assets attached to exact lease, execution result SUCCEEDED but **admitted:false**. Dropped finish response recovered. Update began while response was pending and switched after settlement/drain (~5.2s), retaining original running-job image. `daemon-rollback-final.log` proves idle new/old startup and final inactive selection. The initial retirement log attempted nonexistent `receipt.json`; receipt is inside validated `complete.json`, not that missing path. That first check also used an incorrect cgroup path. The subsequent JSON checks the profile-derived exact cgroup, but its label filter was incorrect. `daemon-upload-cancel-exact-retirement.log` uses the correct `io.forge.studio.job` filter, lists all remaining containers, confirms the exact cgroup absent and service inactive. No job container was present; the all-container output includes retained stopped BuildKit builder ba915300feb8. Its exact identity/state is recorded in vm-final-retained-inventory.log.

## Review and validation

Independent fixed-base Standards and Spec reviews included tracked and untracked implementation. Standards found raw/message-selected retry errors, an interface preference and duplicated settlement validation; all fixed and cleared. Spec found parent-directory durability and expired-watchdog restart ownership; both fixed and cleared using the evidence above. The initially missing media-proof finding was withdrawn with the explicit first-render qualifications above.

`vm-typed-recovery-red.log` is a missing-module failure, not a behavioral reproduction of text-based retry. Green16 tests includes an explicit regression that matching plain Error text cannot select retry. Current VM focused suite34 pass, Manager gateway14 pass, Manager types pass. Manager full suite964 pass/2 skipped. Admin full run6175 pass/190 skipped/1 todo, two environment-fixture failures and three blocked Datadog telemetry errors. Focused rerun76 pass after supplying required auth placeholders, a task-owned database name containing the asserted forge_admin label, and disabling tracing/telemetry. No application code changed for these qualifications. Render full run: startup2 pass, node45 pass/10 skipped, two legacy namespace tests failed because the host network-guard preload path was absent inside bwrap. A task-only adapter readonly-mounts the same guard into those network-isolated namespaces; focused rerun2 pass. Containers/masks/guard restrictions are preserved. Contracts20 pass; bundle2 pass. Exact final type/build checks are in HANDOFF.

All validation subprocesses use owned endpoints. `final-endpoint-guard.log` demonstrates refusal of default PostgreSQL5432, Redis6379, external connection and wildcard listener, plus successful owned loopback. The prior guard allowed test listeners to bind without a host; final guard forces unspecified listeners to127.0.0.1 and rejects explicit external binds. No unrelated shared state was inspected/cleaned. Tests requiring external or separately owned databases retain their explicit skips.

Raw failed logs remain unchanged even when filenames include “green”: notably `assignment-lease-green.log` is14pass/1fail and `vm-artifacts-green.log` is3pass/1fail. Distinct later evidence documents fixes. Build/package warnings and original failed probes remain evidence, not hidden retries. No provider acceptance, production storage, production transport or full public-release claim follows from these local records.

Harness copies under `harnesses/` retain original bytes with `.txt` suffixes; paths and fixture identities refer to owned local state. No keys/configuration are included. These are diagnostic/reproduction files, not installed service code.

## Build guard qualification

The original Manager build was stopped with TERM (session19581 exit143) after a generated PostCSS child reproduced `STUDIO460_TEST_ENDPOINT_DENIED`; the original compiler log remains preserved. Turbopack's Rust parent owns an ephemeral loopback IPC listener not registered through Node Server.listen. The task-only guard now admits this IPC solely for exact own Manager/Admin `.next/build/postcss.js` or `webpack-loaders.js` entrypoint/port, exact own Next build parent, and a loopback listening socket inode present in that parent's fd table. `build-ipc-accepted.jsonl` captures those facts; generic processes, shared DB/Redis and external endpoints remain denied. This is validation tooling, not product networking or a VM exposure change. A missing PID/observation timeout alone did not trigger the retry.

The first corrected compiler admitted PostCSS but Workflow's distinct generated
`webpack-loaders.js` still failed under that narrower rule; its real generated
entrypoint reproduction is preserved separately. The final guard covers those
two exact entrypoints with identical parent/socket checks and denial audit.
The stalled compiler was intentionally stopped after identifying this second
fixture boundary. A bounded read-only ptrace attempt was denied by host policy;
no policy change was made. Compiler acceptance is reported only from the final
completed build, not from an IPC connection alone.

Final inventory retains the stopped BuildKit builder (`/buildx_buildkit_studio4600`,
PID0), not a running job. The final watchdog archive binary and the tested candidate
have different whole-file hashes; ELF comparison records differences only in the
build-id note and non-allocated symbol/string tables. Executable and other runtime
sections match byte-for-byte. They are not claimed to be identical whole files.
The final installed watchdog remains tied to its manifest; the earlier candidate
restart proof is labeled separately. No additional unchanged render was repeated.
