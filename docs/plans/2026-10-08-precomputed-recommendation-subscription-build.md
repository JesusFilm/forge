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
import service/native proof and manual catalog command are still in progress.
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
