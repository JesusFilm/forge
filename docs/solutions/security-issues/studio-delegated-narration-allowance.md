---
module: Studio
problem_type: architecture_pattern
tags: [studio, narration, oauth, idempotency, paid-providers]
date: 2026-09-23
---

# Delegated draft narration is separate from human approval

`StudioDelegatedNarrationService` owns one durable authoring cycle per project.
The client cannot choose or reset a cycle identifier. Admission locks the project,
checks actor-bound retry receipts, checks the expected revision and live attempts,
and creates the canonical narration attempt, production run and immutable plan
ledger in one transaction. The first two admissions needing new audio consume the
initial and correction passes. A run whose complete identities are all reusable
consumes neither a pass nor provider calls. Interactive `narration-authorize`
commands add passes without deleting or rewriting prior accounting; their command
receipts make lost authorization responses safe to retry.

OAuth `shorts:narration` is independently consented and enforced in Admin. The
narrow admission never creates a SCRIPT approval. Only voice assets previously
registered through trusted or interactive authority are admissible; delegated
asset uploads cannot fabricate an approved voice. Experiments and publication
retain their existing interactive boundaries.

The existing Manager production runner consumes the admitted plan snapshot, not a
fresh plan from the current project revision. Otherwise a human edit between
admission and dispatch could make paid-result recovery impossible. The canonical
claim ledger remains consumed before provider dispatch. Claimed input identities
must occur among that plan's missing audio identities, with the canonical digest
as the provider-call key. Both Admin and Manager use `studioHash`; independently
implemented sorting rules can disagree on settings keys and break the admission
fence. Provider-call amounts remain truthful: delegated runs are controlled by
pass counts, not a fabricated dollar allowance. Quote pricing comes from verified
rate cards or explicitly reports unavailable; zero reserved funds is not a claim
of free audio.

A RUNNING or AMBIGUOUS prior paid claim blocks new paid admission even with a new
client, revision or retry key. Inspect/reconcile the accepted run and retained
assets; do not grant a new key as a recovery mechanism. Unknown provider outcomes
remain blocked until reconciled externally; this implementation does not invent a
provider refund, history lookup, or permission to replay. Completely reusable
retained audio can still attach without another provider call.

The existing canonical completion transaction retains stale outputs and linked
asset provenance without overwriting a human edit. Applied narration revisions
retain the original delegated actor/client while completion still records the
trusted worker separately. Publication dependency checks now independently
require matching human SCRIPT approval for effective speech, because preliminary
script approval is no longer an incidental prerequisite of draft generation.
That approval hashes effective voice settings and speech order, and remains
separate from exact-render publication approval.

Validation uses real loopback Postgres authoring persistence and deterministic
provider output. Manager runner tests exercise its actual paid-provider seam with
a fake provider and lost-response replay. These are not real Claude/Codex client
qualification or authorized paid-provider smoke evidence.

## Runner observations cannot terminate another execution

A lost `finish` response can follow a committed successful paid call, and a
lost context response can happen in a duplicate runner while another owns the
live claim. Neither exception proves failure ownership. The delegated runner
uses `reconciliation-note` for these exceptions; only a
`StudioNarrationDispatchFailure` after owned, recorded dispatch failure may
request terminal failure. The separate command also prevents an old Admin
replica from interpreting a new observer as its former mutating preflight path.

Admin records at most eight deduplicated observer notes in the existing execution
ledger, under the run lock, with `diagnosticOnly: true` and no provider dispatch.
They appear in `shorts.narrationStatus` with same-key resume guidance. Notes never
change a run, attempt, or existing paid claim. The legacy delegated
`preflight-error` path now records the same observation instead of terminalizing.
A run stays READY so retained COMPLETED speech calls can be reattached without
another paid generation; RUNNING/AMBIGUOUS calls remain consumed and require
inspection. Already attached runs stay COMPLETED after a lost attachment response.
If Admin cannot be reached to retain the note, Manager logs an unconfirmed-note
message; the accepted run remains recoverable by its original request key.
