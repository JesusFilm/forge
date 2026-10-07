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
   manual launch decision. No refresh schedule is enabled by this plan.

## Boundaries and verification

- No Compound Engineering skills or agents, directly or indirectly. Reuse the
  exact GPT-6 Sol implementation chats and Matt Pocock implement/TDD/code-review
  workflow. Review Standards and Spec sequentially.
- The subscription runner stays on the authenticated operator machine. Do not
  copy personal OAuth credentials to Railway, CI or the application database.
  No direct use of private authentication endpoints or paid API/model fallback.
- Report token counts and observable allowance separately. Subscription USD
  cost remains unavailable where no monetary receipt exists; preserve old API
  charges. Do not purchase credits or redeem reset credits automatically.
- A quota pause is incomplete work, not a valid empty recommendation set.
  Unknown-consumption calls must be visible and reconciled before retry.
- Cover schema validity, missing/foreign IDs, rejected evidence, incomplete
  output, unexpected tools, stale allowance, process timeout, lease fencing,
  idempotency, cache invalidation and source coverage with focused tests.
  Use native PostgreSQL for new durable batch/lease/transaction claims.
- Serialize heavy checks with the established validation lock. Keep the running
  GA capture, its pinned operator code, all recovery evidence and unrelated
  working trees untouched. No production merge, deploy or activation follows
  automatically from this implementation.
