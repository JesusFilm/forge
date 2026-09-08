# Independent fixed-base review

Base `5f460b6daf3b7f43b389925e25604babcb43099a`. The implementation was uncommitted: reviewers used `git diff 5f460b6 --` plus the full `git ls-files --others --exclude-standard` source/test/ops/migration/plan inventory. An empty HEAD three-dot diff was not substituted for WIP review. Canonical feat-460 ticket and approved VM plan were the spec; root/Admin/Manager guides supplied standards.

## Standards

Independent reviewer `image_supply_standards` identified three findings:

1. P2 typed errors: raw Error and message-text recovery classification conflicted with root error conventions. Fixed with VmInvariantError/VmUnconfirmedError, explicit instanceof retry classification and typed gateway binding errors. Matching plain error text cannot select retry.
2. P3 GatewayPort interface without declaration merging: changed to type alias.
3. P3 duplicated finish/receipt authorization: extracted private validatedSettlement so both share signature, binding and canonical checks.

Focused follow-up: all three resolved; no new actionable findings. Reviewer noted the preserved typed-recovery red log is missing-module failure, not behavioral reproduction. Green16 includes the behavioral refusal test. No reviewer tests or VM mutation.

## Spec

Independent reviewer `image_supply_spec` identified:

1. P1 new journal cycle parent not fsynced before claim. Fixed; raw syscall trace orders parent sync, claim file/directory sync and connection.
2. P1 expired watchdog startup could exit after one kill and lose continuous ownership through restart-limit exhaustion. Fixed; same expired original identity/deadline tested across SIGKILL restart, continued frozen ownership, delayed marker refusal and trusted retirement.
3. P2 missing successful source/custom/caption/audio image proof in the recent inventory. Withdrawn after inspecting the existing first-render frame, full decode, codec/digest and audio evidence, with explicit direct-image/daemon and sampling/audio-measurement qualifications.

Focused follow-up: both actionable fixes resolved. Final evidence/runbook delta reviewed separately with no actionable findings: cancelled canonical attempt plus losing retained assets, settle-before-switch, idle rollback and final inactive selection are correctly distinguished from production/provider/231s acceptance.

Earlier narrow reconciliation/packaging review findings were also resolved before this full review: strict terminal-state validation, confirmed freezing and exact-CID absence, physical cleanup before API calls, one absolute retirement allowance, retained artifact cleanup, immutable archive snapshot verification, durable install writes and drain marker, and preserving previous-release on same-SHA switching.

## Remaining acceptance

This review does not mark full460 complete. The runtime handoff retains provider/storage/production release gates and explicitly leaves hosted CI publishing integration for the next separately reviewed change. The final application builds/hooks and evidence hashes are recorded in HANDOFF; no paid or production operation was delegated to reviewers.
