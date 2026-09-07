---
module: Studio authoring
problem_type: integration_issue
tags: [studio, narration, approval, concurrency, provenance, generation]
---

# Approved production and retained results

Studio generation proposes canonical edits; interactive human review of complete
speech authorizes narration. Provider dispatch and atomic attachment are distinct
steps. The implementation builds on the existing native admission store and
Admin asset/experiment registries, without adding a prompt-body database or source
registry. Validation and outstanding real-provider acceptance are recorded in
`docs/validation/studio-458/README.md`.

## Authority, exact identity and timing

`@forge/studio-contracts/production` defines bounded narration plans, quality
reports, execution requests and history cursors. Admin's
`src/services/studio-authoring/production-rpc.ts` owns production commands;
Manager's `/api/studio/production` orchestrates them. Human attribution is not
interactive approval authority. Delegated OAuth agents can propose; they cannot
review the script, confirm an experiment or dispatch paid production. Planner-only
capabilities do not gain these commands.

`orderedStudioSpeech` is the common timeline order: start frame, track order,
then lexical item ID. Script approval, narration planning, provider dispatch and
completion use it consistently. Identity covers exact effective speech, role,
language, provider/model/voice/settings and pronunciation version or explicit
null. The adapter does not trim, normalize or truncate reviewed text. Unsupported
lengths fail preflight; visible segmentation must precede review. Display styling
can change without regenerating equivalent speech. Historic audio with unknown
provenance remains non-equivalent.

Admin atomically verifies the admitted revision, approval, exact identities and
asset references before attaching narration and applying linked timing changes.
Only explicit timing links ripple. Independent overlapping tracks do not acquire
sequential global deltas. Locked linked elements, ambiguous relationships and
source-duration problems produce visible conflicts. Duration follows resulting
item extents and preserved trailing space. Stale, cancelled or published outcomes
retain generated assets without overwriting newer edits or reopening publication.
Do not replace this transaction with a client attachment followed by timing patches.

## Durable claims and bounded data

The production ledger serializes reservations and claims before provider work.
A consumed RUNNING claim is an observation, not ownership: a losing caller must
not finish, fail or otherwise mutate the winning run. A crash after dispatch is
ambiguous and cannot be automatically replayed. Only the caller that dispatched
and recorded its failed call can terminalize that failure. Restart can dispatch
previously unclaimed candidates after explicit operator action; it cannot repeat
an uncertain paid request. Late results, overruns and unused candidates are kept.
Authorization reserves and estimated costs are distinct from actual returned
charges; missing monetary charges remain unknown.

Narration manifests are bounded chunks referenced by the existing attempt/asset
contracts, rather than enlarged request limits or truncated item lists. Read
history with `studioProductionListSchema`: optional project, narration/experiment
kind, and `(createdAt,id)` cursor; pages contain at most 20 runs. Filtering happens
before limiting. Both Manager panels expose older pages so retained candidates
remain discoverable. Equal timestamps require both cursor fields.

## Native generation and source evidence

The hosted runtime freezes native agent/block versions and resolved effective
bytes before canonical admission. It reads only those pinned snapshots and
consumes one durable execution claim. Editable defaults describe source-first
writing, causal bridges, short settle lines and inspectable coherence/depth/
fidelity/voice findings; they do not impose universal devotional layouts.
Typed validation checks canonical operations and truthful timeline role coverage.
Human judgment still determines creative quality.

`source-preview` reads retained canonical VTT for an exact immutable snapshot,
author language and admitted source range. Current eligibility and caller grant
are checked on every page. `nextPage` carries the unchanged tuple and offset;
complete cues fit the bounded page, with no text truncation. Oversized individual
cues fail explicitly. Native `readSource` treats cue text as untrusted evidence;
a partial page cannot support a complete-coverage claim. Synthetic source fixtures
and editorial excerpts do not become canonical historic media.

Music and voice experiments remain explicit operations with rate basis, estimate,
interactive confirmation, retained candidates, browser audition, selection and
separate voice registration. A library miss never dispatches a provider. Exact
IDs and provenance remain inspectable behind human-readable run/candidate labels.

## Reproduction lessons

Do not delete shared disposable storage roots in unit cleanup: each test owns a
UUID asset folder. Missing bytes are an evidence limitation even when rows remain.
Check exact fixture size/digest before and after browser runs. Use the same built
Admin, preview codec and browser settings for baseline/final loading comparisons.
The task's HLS reproduction requires the pinned BtbN artifact and task-local Redis
documented in the validation README. Earlier FFmpeg 7.0.2 proof is not rewritten.

## Repairing a rejected native proposal

A real saved-case run confused semantic QA with timeline roles: it claimed hook,
conclusion and scripture_echo identities for reflection/bridge/settle items.
`StudioCoverageError.feedback` now carries a stable mismatch/duplicate/unchecked
code, the disputed role, actual item count, up to eight exact IDs and observed
roles, with explicit completeness flags. It does not require any particular role.
Admin returns this contract only after existing grant/project checks. Native
`tool-feedback.ts` accepts it only from validate-proposal HTTP 400, with a 4 KiB
body bound; arbitrary, malformed, oversized and unrelated errors remain generic.
The model receives actionable facts without raw database errors. Actual rejected
ch31 inputs cover the neutral validator, nonmutating PostgreSQL service and next
native model turn. Rejection does not apply edits or grant approval.

The separate editable QA calibration defines self-echo as redundant repetition
within the reflection, and scripture-echo as redundant spoken duplication of the
verse card/source dialogue. First-person continuity and quote preservation do not
prove those checks pass. Missing source context is not_checked. The preserved
ch19 claim that ready-faith reasoning was developed is an unsupported depth pass;
its actual script jumps from fear to a brief settle. These editorial examples
remain findings for human review, not hard schema restrictions. Existing native
versions are not rewritten or automatically activated by changing seed defaults;
new drafts require the existing explicit native version/activation workflow.

## Canonical field/type rejection feedback

A closed native-hosted evaluation exposed an actionable validation error hidden
behind the generic asset-tool boundary: ch19 proposed string text `fontSize`
values. Preserve that rejection and its raw streams; do not replay the provider
to diagnose deterministic canonical validation.

Canonical text-property validation now throws `StudioProposalFieldError` with
`PROPOSAL_FIELD_TYPE_MISMATCH`, at most eight operation index/text-key/expected-type
facts. The shared strict schema excludes arbitrary keys, supplied values and raw
validator messages. Admin emits this envelope only for an admitted authenticated
`validate-proposal`; the native boundary accepts it only on HTTP 400 within its
existing byte bound. Invalid envelopes and unrelated errors remain generic.
Component properties remain dynamic, and unsupported text values still fail.

Use the retained actual proposal to test validation ordering. Correcting its
property types must still expose the distinct `ROLE_COVERAGE_UNCHECKED_IDS`
rejection without mutating the project. Field repair is not creative QA success.
The separate unpaid fix evidence and fixed-base reviews are in
`docs/validation/studio-458/field-feedback-fix/README.md`.
