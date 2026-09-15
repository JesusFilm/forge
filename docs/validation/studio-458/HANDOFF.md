> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Reviewed implementation and outstanding acceptance

This handoff covers feat-458 implementation against reviewed base
`2855e26512ebfacd78bee987e1cda3f66d738774` (root reviewed 457 `8ca433eb`
patch-equivalent). All prerequisites are already incorporated; do not cherry-pick
those prerequisites again. Reviewed implementation commit: `341d57f05f381eab2d8f0bb828c9788c6035ed7d`.
A subsequent documentation-only handoff commit records these hook results and
evidence hashes; its exact SHA is in the coordinator handoff message. Apply that
ordered pair only, without prerequisite duplicates. The ticket remains in progress.

## Downstream interfaces

- `@forge/studio-contracts/generation`: explicit confirmed batch of 1–8 unique
  project admissions, maximum 64 KiB; result text/proposals/diagnostics maximum
  256 KiB. Manager dispatches through frozen native admissions. Planner access
  does not authorize this production path. Proposals still require operator apply.
- `@forge/studio-contracts/production`: exact narration identities, bounded quality
  findings and role feedback, execution/history contracts. `orderedStudioSpeech`
  supplies the common review/dispatch/completion order. Narration manifests use
  bounded chunks; the Admin narration service owns atomic attachment and linked
  timing ripple. Consumers must not implement follow-up client timing patches.
- Admin `production-rpc.ts` accepts only the trusted delegated
  `studio-production` client with `studio:production:execute`, and verifies the
  interactive admission owner. Commands are context, claim, finish, upload,
  narration-complete, experiment-candidate, fail and preflight-error. Hosted agent
  attribution alone grants no approval, experiment confirmation or paid dispatch.
- `@forge/studio-contracts/sources` exports `studioSourcePreviewSchema`:
  sourceSnapshotId, exact language, startMs/endMs, offset (default 0), limit
  (default 20, maximum 50). Admin returns exact Video/Dub/Edition/subtitle identity,
  catalogDigest, admitted range, complete cues, totalCues, nextOffset, coverage,
  evidenceKind and nextPage. Cue pages are bounded at 32 KiB; oversized individual
  cues fail instead of truncating. `nextPage` preserves the immutable snapshot,
  language and range. Every page checks caller authority, current eligibility and
  retained asset bytes. Only a complete first-and-final page reports complete;
  partial pages never independently establish full source coverage.
- `StudioCoverageError.feedback` / `studioCoverageRejectionSchema` expose stable
  ROLE_COVERAGE_MISMATCH, ROLE_COVERAGE_DUPLICATE or ROLE_COVERAGE_UNCHECKED_IDS,
  disputed role, expectedItemCount, at most eight expectedItemIds and observedRoles,
  and separate completeness flags. Admin returns validated HTTP 400 only after
  authority checks. Native `tool-feedback.ts` reads at most 4 KiB only for
  validate-proposal; malformed or unrelated errors remain generic. These are
  timeline facts, separate from subjective scripture/self-echo or depth findings.
- Editable native seed defaults now calibrate the recovered rubric with preserved
  failure examples. Existing frozen native versions remain unchanged; use the
  explicit draft/version/activation workflow before evaluating new instructions.

## Verification and release limits

See README, reviews, tests and performance for exact logs. The final correction
passes Manager 1,201 tests, Mastra 3,011 tests and 61 scoped Admin PostgreSQL/storage
tests. The full Admin run and separate network-isolated Redis fallback rerun are
preserved with their environmental limitation. Independent Standards and Spec
reviews cleared the fixed-base implementation and subsequent corrections.

The local production browser proves proposal/apply, two-project batch, exact
approved narration bytes and 3/0/1 initial/style/speech-change calls, retained
music/voice audition, history pagination and source-containing preview. These
provider responses are deterministic fixtures. Actual registered assets were
verified before and after final runs. The 936 unavailable older disposable objects
remain an explicit limitation; their database rows are not retention evidence.

Both paid LLM batches are closed. The native-hosted batch used two exact cases and
eight requests, reported USD 0.0972243 and retained all request/response bytes.
One proposal previewed; the other failed typed coverage. Creative quality remains
partial/failing, including the unsupported ch19 depth/voice passes. Unpaid typed
feedback and rubric corrections have not received another paid quality run.
No additional LLM calls are authorized. Actual ElevenLabs narration, music and
voice design/registration/audition proof remains paused pending verified account
billing/slot facts and explicit bounded authorization. Do not mark the feature
complete or infer actual media cost from ceilings or deterministic fixtures.

## feat-460 toolchain provisioning

The tested FFmpeg is BtbN `n9.0.1-27-g9b0578816c-20260907`, artifact
`https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz`,
SHA-256 `da49baa2fd544ac090fa8adac19d2d6d1f781e75556c4f95dcc0a4f2dd22b1a6`.
Verify the hash and retained asset metadata; the mutable latest URL is insufficient.
`codec/same-bytes-reproduction.json` records independent old/new tests on identical
MP4/TS/HLS inputs: old 7.0.2 decodes MP4 but crashes on TS/HLS, new succeeds on all.
The MPEG-TS bytes are retained as `codec/source-fixture-0.ts.body`; restore the
original filename only in disposable reproduction storage. Probe is Remotion
4.0.475's bundled n7.1. Built source reproduction also requires task-local Redis
(127.0.0.1:56458 in this fixture). No earlier 456 codec evidence was rewritten.
This does not establish feat-460 render or publication acceptance.

## Closed follow-up 2 and separate field/type correction

The later follow-up is also closed: two runs/seven requests, provider-reported
USD 0.0791718. See `native-hosted-followup-2/live/comparison.md` and `summary.json`.
ch19 produced no accepted proposal; ch31 previewed but retained documented
fidelity/depth/voice shortcomings. This is same-case calibration, not blind
acceptance. All three paid batches are closed. No additional provider dispatch is
authorized; ElevenLabs and creative acceptance remain outstanding.

The separately reviewed unpaid correction based on `2554442afcd0be5209789ff46c22a9b11ee434da`
adds bounded canonical property-type facts to the native validation next turn.
See `field-feedback-fix/README.md` for exact exports, authority/response bounds,
actual ch19 regression, independent reviews and verification. Correcting types
still fails the separate role-coverage check. No defaults or paid evidence changed.
