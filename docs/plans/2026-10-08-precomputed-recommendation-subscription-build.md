---
date: 2026-10-08
title: Subscription-backed Astra recommendation build
status: in-progress
roadmap: feat-590
tracker: JesusFilm/forge
issue_url: https://github.com/JesusFilm/forge/issues/2565
---

# Subscription-backed Astra recommendation build

## Owner decision

Use the recommended catalog-first architecture with reusable content profiles
and batched Astra decisions, executed through the existing Codex subscription.
The owner selected this direction on October 8 after reviewing repeated-input
cost in the API implementation. The US$200/400 figures were illustrative API
token budgets, not measured forecasts or authorization to resume that spending.
The earlier US$20 discussion was a feasibility target, not a demonstrated price.

The owner's subsequent clarification makes every new build, rebuild and resumed
run manually initiated. Do not schedule regeneration or trigger it from deploys,
content/analytics updates, page views, startup or allowance reset. Each authorized
operator runs the local command using their own signed-in Codex account and
subscription. A browser Admin login is not authority to use a shared machine's
Codex login. Require a matching current local identity before inference, bind the
run to that identity, and stop if it changes. Record bounded non-secret operator
provenance. No shared service identity or fallback to the owner's account.

Within included subscription allowance there is no separate model API charge.
The paid subscription and consumed allowance still have value; existing credits
or credit-based plans may incur additional charges. Report the billing basis as
subscription allowance, never simply "$0 tokens." Admission must not count paid
credits as included allowance. A pre-call meter check is not a verified provider
spend cap; do not promise zero incremental charges beyond what is established.

Product requirements remain unchanged: exact `gpt-6-astra`; every eligible Video;
complete English transcript per Video Edition or complete non-English fallback;
qualified Watch GA referrer and engagement evidence; directed relationships,
ordering, English reasons and alternatives; every accepted connection retained;
strict evidence validation; atomic private generations; separate manual public
activation. Six is a Watch display limit. Retrieval is allowed and exhaustive
all-pairs reasoning is not required.

## Observed compatibility

Codex CLI 0.153.4 is signed in using ChatGPT on the operator machine. A tiny
synthetic structured-output probe with `gpt-6-astra`, enforced ChatGPT login,
API-key environment variables removed from the child and no tool events
completed successfully in 5.68 seconds. Usage was 16,949 input and 32 output
tokens. This is access/schema evidence, not a real-catalog quality test. The
substantial harness overhead reinforces batching rather than one CLI process
per candidate connection. The account-wide weekly meter was 30% used at the
probe; that snapshot cannot admit future calls or predict full-build usage.

Official [non-interactive Codex documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
supports saved authentication, structured output and usage events.
[Authentication](https://learn.chatgpt.com/docs/auth) distinguishes ChatGPT
subscription access from API-key access. [Pricing](https://learn.chatgpt.com/docs/pricing)
does not equate subscription allowance with API token charges.

## Implementation sequence

1. Add an explicit operator-only `StructuredModel` adapter, leaving the existing
   production OpenRouter factory unchanged. Use argv/stdin, an isolated working
   directory, enforced ChatGPT authentication and exact Astra. Disable available
   tools/config integrations, reject unexpected tool events and validate final
   output independently. Bound process time, input and output. Retain usage on
   invalid or interrupted responses without inventing a USD charge. A fresh,
   injected allowance reader must fail closed and reserve normal coding usage.
   Require fresh initiating-operator identity and explicit included-allowance
   basis; reject mismatched identity, unknown billing or credit-only allowance.
   Test all existing generation-stage schemas and failure paths offline.
2. Record subscription backend/billing provenance additively before importing
   results as a durable accepted generation. Use a bounded real-catalog pilot
   to verify evidence, schema behavior and observed allowance consumption.
   A successful synthetic probe does not establish these acceptance criteria.
3. Produce reusable compact profiles from every complete selected transcript.
   Include content/metadata digests, language-selection policy, prompt version
   and model/backend in cache identity. Account for every chunk of long
   transcripts; summaries do not replace authoritative passages used to
   validate accepted transcript-backed connections. Mark metadata-only sources.
4. Plan candidates across the catalog and judge multiple connections per call.
   For shared multi-source calls, introduce one durable batch reservation and
   usage receipt with frozen member/input digests and fenced source leases.
   The current call row belongs to one source, so do not multiply a shared
   charge or assign it to an arbitrary member. Keep completion/empty/failure
   accounting explicit for each source and resume only known outcomes.
5. Reuse qualified immutable GA data only through a reviewed artifact contract
   whose query, range, cutoff, mapping and content keys match. Current capture
   protocol 3 binds to a generation/candidate pool; do not relabel the existing
   reference capture as reusable for another generation. This change must not
   weaken page coverage, source qualification or honest navigation semantics.
6. Run the representative comparison and full coverage/capacity checks, then
   make the completed generation available for private Admin review. Keep the
   accepted one-month experiment, live measurement prerequisites and separate
   manual launch decision. Regeneration and resumption remain manual-only.

## Boundaries and verification

Implemented through `baebca593`: local subscription adapter and account reader,
manual attempt provenance, complete selected-transcript planning, durable
profile execution, and shared edge batches. The producer chooses exact text;
code verifies its membership and computes offsets/hashes. One physical
invocation has one usage receipt, including a batch shared by two sources.
Closed-attempt or expired-capacity results retain usage without applying work.
The connected PostgreSQL fixture now covers complete non-English profiles,
metadata-only input, a two-source batch, exact replay without another call,
verified passage storage and finalization into existing recommendation payloads.
The generation remains incomplete until the remaining readiness gates exist.

Pages contain contiguous slices of one to eight frozen candidates. Preflight
can shrink pages before reservation to fit the prompt limit; it retains complete
compact profiles and full candidate coverage. The whole-source historical digest
is stable across pages, while page inputs remain distinct. Span offers use a
bounded deterministic subset of verified source and target anchors; the prompt
records available/offered counts. Accepted excerpts are never truncated after
inference. Concurrent exact retries preserve a single immutable receipt, and
cross-page duplicate targets are rejected even after an empty result page.

The reservation-aware adapter now checks fresh local identity/allowance, validates
input/schema and prepares local files before invoking the durable reservation
callback. It dispatches only a newly acknowledged pending call; terminal replay
skips inference. A crash or lost reply between reservation and process dispatch
can still leave pending work without known consumption. Caller assertions or
fabricated zero usage cannot clear that uncertainty.

The GA import client/reader now checks destination intent against Admin's prepared
identity and verifies unchanged origin bytes under the destination copy identity.
It preserves the original qualification and exposes zero destination GA requests;
Admin's schema-normalized qualification digest is an opaque receipt. The Admin
import and manual catalog command are integrated. Native testing also covers
the required imported-history checkpoint and version-specific status/report
parsing. The real GA capture is sealed, independently verified and restored
into an isolated clone. A two-source, contiguous-rank pilot is configured against
that clone; it remains unexecuted while the final connected runner checks finish.
No real catalog inference has run through the subscription adapter.

- No Compound Engineering skills or agents, directly or indirectly. Reuse the
  exact GPT-6 Sol implementation chats and Matt Pocock implement/TDD/code-review
  workflow. Review Standards and Spec sequentially.
- The subscription runner stays on the authenticated operator machine. Do not
  copy personal OAuth credentials to Railway, CI or the application database.
  No direct use of private authentication endpoints or paid API/model fallback.
- Report token counts and observable allowance separately. Subscription USD
  cost remains unavailable where no monetary receipt exists; preserve old API
  charges. Do not purchase credits or redeem reset credits automatically.
- Keep the existing accepted-choice and serving representation, including its
  bounded validated passage excerpts. Full transcripts, model prompts and raw
  execution events must not be copied into durable build storage. Compact
  profile references support offline validation; they do not add live transcript
  reconstruction to Watch serving.
- A quota pause is incomplete work, not a valid empty recommendation set.
  Unknown-consumption calls must be visible and reconciled before retry.
  A later allowance reset or process restart does not restart the run. Each
  manual resume binds the new execution attempt to the initiating operator's
  own identity and preserves earlier attempts' provenance. Bounded,
  accounted retries within an active manually initiated run are separate from
  an automatic rebuild or restart.
- Cover schema validity, missing/foreign IDs, rejected evidence, incomplete
  output, unexpected tools, stale allowance, changed operator identity,
  disallowed automatic starts/resumes, process timeout, lease fencing,
  idempotency, cache invalidation and source coverage with focused tests.
  Use native PostgreSQL for new durable batch/lease/transaction claims.
- Serialize heavy checks with the established validation lock. Keep the running
  GA capture, its pinned operator code, all recovery evidence and unrelated
  working trees untouched. No production merge, deploy or activation follows
  automatically from this implementation.

## October 12: one-time manual recovery authorization

After the orchestrator presented the exact recovery proposal and asked to
implement it and make one fresh connection attempt, the owner replied:
"CAN I get you to get onto that work? Where is the GA being ingested into?"
The orchestrator explicitly acknowledged this as approval of that proposal.

This is a single exception to the reconciliation-before-retry rule for call
`8ab8a620-1608-4115-812e-200bb2fb4b6d` in generation
`subscription-astra-budget2-20261008-v4`. It does not establish that the earlier
call consumed zero tokens or authorize automatic recovery of other calls.

- Preserve the original receipt and unknown usage, with an attributable,
  idempotent acknowledgment bound to that call and the unchanged frozen inputs.
- Require the old attempt to be closed and fenced, no old running process, and
  expired or released source leases. Retain the nine verified profiles.
- Authorize at most one fresh connection call for the original two sources and
  candidate ranks zero through three. Implement, review, and native-test the
  recovery before the orchestrator explicitly launches that call.
- Recheck the initiating operator's identity, included subscription allowance,
  the 25% remaining-allowance reserve, and measured storage capacity.
- Keep the original unknown consumption visible in reports. No automatic
  retries, allowance resets, paid API fallback, source finalization, production
  merge, deployment, or public A/B activation follows from this exception.

The single replacement limit does not authorize another replacement on replay or
restart. Generic continuation remains blocked until this exact replacement has a
validated successful receipt with known usage and both members have been applied.
After the orchestrator reviews that result, later ordinary catalog work may use
a separate explicit manual invocation under the existing authorization and all
normal catalog, allowance, and capacity gates. Only the exact acknowledged old
call is exempted from the pending-call check; any other unknown call still stops
work. The recovery invocation itself stops at the two-source pilot boundary.

The concrete proposal and original evidence remain preserved in
`/home/nisal/.local/share/forge/feat-590-evidence-20261007/subscription-edge-schema-repair-20261008T071236Z/`.
Authorization is recorded here; implementation and execution remain separate
verification milestones.

## October 12: verified recovery outcome

The one authorized replacement ran at integration `42fe2dd47` and succeeded:
`c0f9dd99-2f0f-4bcc-9f23-ff849ba8ea05` used 33,110 input / 1,496 output tokens in
42.874 seconds. Both original two-source member pages reached `applied_edges`;
seven provisional choices were stored. The nine ready profiles were reused,
zero new GA requests were made, and the attempt closed at the pilot boundary.
No source was finalized. The original pending receipt remains unchanged except
for its four attributable recovery-acknowledgment fields; its usage remains NULL.

Local PG grew by 48 KiB during the replacement. The 16.7 MB sealed aggregate GA
artifact remains in the protected object store. This pilot does not establish a
full-catalog storage bound or the percentage of subscription allowance required.
Detailed proof and a protected post-recovery control archive are recorded in the
[current orchestration checkpoint](2026-10-05-precomputed-video-recommendation-status.md#current-checkpoint--october-12).
The operator bridge and model process have exited; there is no scheduled resume.

The approved exception also needs a narrowly qualified readiness proof: retain
the raw unknown count while recognizing only the pinned original receipt after
its exact successful replacement is fully applied and closed. Bind that proof to
frozen prepare/start evidence, and continue blocking unrelated or unreconciled
unknown usage. This implements the existing single-call authorization; it does
not waive any other public-launch gate or authorize public activation.

## October 12: second representative pilot

A separate explicit manual invocation at `90f964f60` completed the second
representative pilot after the prior leases naturally expired. It added ten
ready profiles (five metadata-only) and six provisional connections across The
Covenant and What Is Hope?. Eleven successful profile calls used 270,470 input /
6,719 output tokens; one shared edge call used 26,495 input / 1,135 output tokens.
The attempt stopped at its pilot boundary with no new GA requests or source
finalizations. Local database growth was 240 KiB; bulk GA bytes remained external.

Across the two completed pilot stages, the generation has 19 ready profiles and
13 provisional choices, with 556,937 known input / 14,765 known output tokens
across 25 successful physical calls. The original unknown call is still separate.
A fresh pre-stage-two account check admitted the same operator with 93% weekly
allowance remaining; this account-wide reading does not measure per-stage usage.
The control archive's independent restore passed for all 30 tables / 12,381 rows.

The final representative stage is prepared but has not run. It covers ten new
profiles and 292 selected chunks, plus eight candidate judgments. Resume remains
an explicit action after the existing source leases expire naturally at
2026-10-12T02:00:05.461Z, followed by fresh identity, allowance, and capacity
checks. Full-build call count, duration, and token projections must use the
observed subscription runner; earlier API-price illustrations are not measured
subscription consumption or an established full-catalog token bound.

## October 12: full-run efficiency hold (historical)

After the second pilot, a read-only pass through the actual frozen catalog found
936 planned map parts, 172 metadata-only sources, and 4,128,488 bytes of complete
selected transcript text. The existing source pairing and eight-target pages
produce 7,472 source pages and 3,850 edge calls before any prompt-size splitting.
The earlier 10–20 million input-token illustration is not a verified projection
for this implementation. No token-to-subscription-percent conversion is justified.

Further model calls, including the prepared third pilot, are held while the two
existing Sol workers implement bounded efficiency improvements: lossless edge
prompt encoding and documented per-invocation suppression of irrelevant Codex
context. This does not change the model, reasoning effort, candidate coverage,
complete transcript selection, evidence validation, accepted-connection retention,
manual-only controls, or allowance reserve. Existing profiles and receipts remain
protected. Root will review exact provenance/replay compatibility and benchmark
concrete changes before explicitly deciding the next manual segment.

The no-inference plan and saved benchmark inputs are under the protected
October 12 operator directory: `frozen-catalog-dry-plan.json`,
`saved-pilot-benchmark-inputs.json`, and `saved-pilot-benchmark-history.json`.
All input digests match the frozen generation. The read-only analysis bridge was
stopped after export; no model call, GA API request, or database write occurred.

The compact renderer and lean-context adapter are integrated at `6d06f9794`.
The actual eight-candidate saved input, including GA aggregates, shrank from
46,097 to 33,965 UTF-8 bytes (26.3%). The integrated 113 focused tests and Mastra
typecheck pass. A separate tiny synthetic live probe then stopped on an
unrecognized CLI event with unknown usage; no catalog/GA/DB writes occurred.
Its immutable local receipt is separate from generation v4. Zero-inference CLI
checks accept the flags, but reveal that documented non-tool reasoning/error
events need distinct handling. That compatibility repair is in progress, and
further inference remains held. The 90% weekly allowance read immediately before
the probe is account-wide, not a per-call consumption measurement.

The event compatibility repair is integrated in `70f6c5a70`: explicit reasoning
lifecycle is accepted without retaining reasoning text, explicit errors fail as
provider failures, and every actual tool/unknown item remains fatal. Root's
combined 129 focused tests pass. A distinct instrumented probe returned known
usage of 11,816 input / 19 output tokens and CLI exit zero, but a 221-byte error
item preceded the answer. It was correctly rejected; the error text was not
retained. No catalog or GA writes occurred. The original unknown probe stays
unknown; the second probe's known usage is accounted separately from v4. Further
model work remained held pending zero-inference identification of the error.

## October 12: efficiency verified and all local pilots complete

The final adapter uses `skills.include_instructions=false` instead of the tiny
skill budget, with strict invocation config, memories disabled, no local tools,
and exact `gpt-6-astra`. Explicit CLI errors still fail closed. A real saved-input
edge benchmark on `352fc1390` accepted seven of eight candidate pairs through
the production validator, using 23,964 input / 1,113 output tokens. The earlier
same-sample call used 33,110 input / 1,496 output tokens: a measured 27.62% input
reduction in this one sample. No generation records or GA queries were changed.
Neither this sample nor the account-wide allowance meter establishes a full-build
cost, time, or subscription-percentage forecast. Both earlier probe receipts
remain intact, including the first probe's unknown usage.

The third manual pilot then completed ten full-transcript profiles spanning 292
selected chunks. Thirty-four map and seven reduce calls used 701,980 input /
20,304 output tokens. One shared edge call used 26,323 input / 1,101 output
tokens, producing seven provisional connections for JESUS and 5.3 Are Christians
Out of Touch?. The attempt ran for 19 minutes 43 seconds, then paused at its
pilot boundary. All 42 calls succeeded; zero sources were finalized and zero
new GA requests occurred. Fresh identity, allowance, capacity, and the 25% reserve
were checked before dispatch. All operator/model processes are stopped.

The three pilots now retain **29 ready profiles and 20 provisional connections**
across six sources. Known v4 usage totals 1,285,240 input / 36,170 output tokens
over 67 successful calls, separately from the original unknown call and the
standalone adapter probes. Stage three grew local PG by 328 KiB; all three pilot
deltas total 616 KiB. The 16,674,551-byte GA artifact remains external. This is
not a full-catalog storage bound. The new backup independently restored all 30
control tables / 12,443 rows with exact signatures and no source changes.

The 1,031-video catalog is not complete and public A/B remains off. A read-only
deployment audit confirmed there is no supported whole-generation local-to-prod
import. The manual CLI writes to its configured Admin; production Watch reads
that same Admin's completed generations. Its sealed-GA import is only valid
before model work and requires a verified origin already in the target Admin.
Therefore, the next full catalog run must target deployed Admin after separately
approved normal PR-to-main deployment and target GA-origin verification. A full
local run would require a second build or a newly designed transfer feature;
raw database restoration is not a supported deployment path. See
[the current operator runbook](../operations/precomputed-catalog-build.md).

The latest native CI fixture repair decodes compact prompts before the existing
model assertions; all 34 native integration tests pass. Full CI is still required
on the final integration head. Complete production catalog/capacity proof, live
human baseline and tracking verification, numeric thresholds, and manual launch
remain separate outstanding acceptance gates.
