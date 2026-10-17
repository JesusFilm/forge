# Studio full-render profile (feat-716)

The current 90s combined staging/packaging window is shorter than measured work.
Use a new immutable `studio-render-2/1200s-180prep-2cpu-2g-128p-96child-128m`
profile: 180000ms preparation, 1200000ms cumulative job deadline, 1220000ms
request and 1500000ms lease. The 20 minute job budget also accommodates the
295.2s project: retained 231s synthetic evidence needed 652.492s render/verify;
linear extrapolation plus measured preparation exceeds the old 900s budget.
This is capacity inference, not a measured render of this project.

Keep v1's descriptor exact for receipt/history decoding. New claims/admissions
require current profile; legacy jobs are not upgraded or executed. Failed
settlements and exact sealed receipts remain readable. New successful retention
requires v2. Do not reset persisted VM execution deadlines on restart.

Update Manager and VM transport, supervisor cumulative watchdog, native cap,
release profile validation and operator drain windows together. Preserve all
CPU/memory/PID/byte bounds. Manager reserves 5s inside the outer input deadline
for response delivery. Tests cover legacy/current exact decoding, refusal of
mutated descriptors, historical receipts, current-only claims, resource parity
and immutable candidate selection.

Rollout through PR/main only. Drain an idle worker before application profile
transition, publish immutable artifacts using studio-release.yml at merged main,
verify exact source and artifact digests, install/select then activate the matching
worker. Recheck revision 21 and historical hashes; request a fresh full draft
render, preserve failed attempts, and verify retained output before completion.

Migration 0155 accepts both fixed retention profiles and requires the recorded
profile to equal the immutable issued job snapshot, preserving exact-lease attribution.
