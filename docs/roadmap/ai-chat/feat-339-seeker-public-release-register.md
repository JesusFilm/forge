---
id: "feat-339"
title: "Seeker public-release readiness register (living decision capture)"
owner: "jian wei"
priority: "P1"
status: "not-started"
start_date: "2026-09-01"
duration: 1
depends_on:
  - "feat-336"
  - "feat-337"
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

> **Stub — a living register, not an implementation brief** (the feat-303 /
> feat-321 decision-capture precedent). This ticket exists so the
> considerations that must be settled BEFORE the Seeker is exposed to the
> public are recorded in ONE committed place, added to over time, instead of
> living in chat transcripts and gitignored reports. Whoever plans the public
> release starts here. Items carry enough context to be actionable later;
> none is being decided in this file. **Add new release-gating concerns to
> this register as they surface — that is its job.**

## Problem

Multiple pieces of work have surfaced release-gating concerns in passing —
the crisis-guardrail gate (feat-198 deferred list), the dogfood-gate removal
recipe (feat-236), the feat-321 data decisions — but no single artifact
tracks what must be true before public exposure. Data protection made this
acute (2026-08-05): the Seeker stores and exports conversations about
religious belief, which the GDPR treats as special-category personal data,
and the storage/retention/deletion posture was being decided ticket-by-ticket
with no release-level view.

## The register

### 1. Data & privacy

- **Retention enforcement live:** feat-336 (Langfuse trace retention sweep,
  flat 25 days matching ai-chat Postgres — owner decision 2026-08-10,
  superseding the earlier 30/180 split) must be deployed and observed
  working before public traffic. Decided 2026-08-05: DIY sweep, not the paid
  Langfuse retention tier — revisit if the silent-failure risk bites.
- **Erasure capability live:** feat-337 (per-user deletion across Langfuse +
  `ai_chat` Postgres). Public release also needs a DECISION on self-serve
  deletion (product surface) vs operator-only, for logged-in AND anonymous
  users — anonymous erasure requires the user to still hold their
  `anon:<uuid>` (cookie), which may be a documented limitation rather than a
  solved problem.
- **Durable erasure record — decide before release (added 2026-08-12,
  feat-337):** feat-337 ships terminal output only and writes NO durable log
  of who was erased, when, or with what result (owner decision KD5:
  completion is recorded wherever the erasure REQUEST is tracked, and the
  compensating actor record is the operator's session log at the execution
  locus — see the `apps/mastra/CLAUDE.md` runbook). That is proportionate at
  allowlisted-dogfood scale with one operator. Investigate before public
  release whether a durable, count-only erasure record is needed — GDPR
  accountability (Art. 5(2)) wants demonstrable evidence a request was
  honored, and a session log at an operator's workstation is neither durable
  nor attributable at volume.
- **apps/mobile deletion copy overstates Seeker erasure — must be resolved
  before release (added 2026-08-12, feat-337):**
  `apps/mobile/src/components/profile/DeleteAccountFlow.tsx` tells the user
  "This permanently deletes your Jesus Film account everywhere — including
  your watch history and saved progress." It does not: account deletion does
  not currently cascade to the Seeker stores at all (that cascade is
  feat-356), so Seeker threads and Langfuse traces survive and age out over
  ≤25 days. The copy sits outside this lane and is deliberately NOT softened
  now (owner decision 2026-08-11, KD11) — but this gate must not pass with
  the claim still overstated. Resolve by softening the copy, by landing
  feat-356, or by an explicit owner acceptance recorded here.
- **feat-356 cascade — decide whether it is release-gating (added
  2026-08-12, feat-337):** feat-356 (apps/auth account-deletion → Seeker
  cascade) is deferred out of feat-337 and blocked by it. Its absence leaves
  two bounded gaps: a deleted account's Seeker data ages out over ≤25 days
  rather than immediately, and once the auth account is gone the `sub` is
  unrecoverable so a LATER erasure request for that person cannot be
  serviced at all. Decide before release whether that is acceptable for a
  public audience or whether feat-356 becomes a hard gate. Coupled to the
  copy item above and to the self-serve-deletion decision already recorded
  under "Erasure capability live".
- **Access-log retention windows — confirm and document (added 2026-08-18,
  feat-209):** feat-209 puts thread ids in `/c/<id>` request paths, so they
  land in Cloudflare and Railway HTTP access logs (IP + timestamp + id;
  never content) with platform-controlled retention that outlives the
  25-day window and feat-337 erasure — standard posture is log rotation,
  not per-user log deletion, but that is only defensible once someone has
  looked up the two actual retention periods, recorded them here, and the
  privacy owner has blessed the "residual log entries age out within N
  days" line for erasure responses. (STATUS: open)
- **Legal review of the data flows (open, undecided):** EU GDPR analysis for
  special-category data — lawful basis (explicit consent wording at the chat
  surface?), the Langfuse Cloud US processor relationship (DPA is available
  on all tiers; the subprocessor list was NOT enumerated during feat-321 —
  pull it before this review), retention-law constraints beyond GDPR for
  target jurisdictions, and whether a DPIA is warranted (likely yes for
  special-category data at scale).
- **Data inventory to keep current:** conversations live in `ai_chat`
  Postgres (flat 25-day purge, feat-208/feat-336); traces incl. full content in
  Langfuse Cloud US when `LANGFUSE_TRACING_ENABLED=true` (feat-321,
  Langfuse-only — no raw local copies); prompt text in Langfuse; NO
  conversation content in logs (enum-only convention) or DuckDB (redacted).
- **Key custody re-affirmed 2026-08-05** (feat-321): full-access Langfuse
  keys guard raw conversations once tracing is on; two pairs, Railway pair
  never leaves Railway; no read-only key scope exists upstream — re-check
  Langfuse's key-scope roadmap at release time.

### 2. Safety guardrails (already a named release gate)

- The feat-198 deferred list marks the full persona + safety guardrail set —
  fabrication/honesty, AI-disclosure, doctrinal-uncertainty, and **crisis
  handling** (self-harm/acute distress → route to human/helpline, never
  improvise) — as a release gate. `seeker-agent.ts` carries the guardrail
  attach-point breadcrumb. Note the interaction with data: crisis
  disclosures raise the sensitivity of stored/exported conversations further,
  and a "raw text never leaves our infrastructure" hardening
  decision would reverse the feat-321 tracing topology (the flip trigger
  recorded in
  `docs/solutions/tooling-decisions/langfuse-vs-mastra-native-management-layer-20260805.md`).

### 3. Abuse & cost containment

- Per-caller rate/concurrency cap — named by feat-236 as its precondition
  step 0 and by feat-208 as "the real flood control"; still open.
- Model spend ceilings for public traffic (the gateway/Gemma chain budget
  posture was sized for dogfood).

### 4. Gate removal mechanics

- feat-236 is the mechanical removal recipe for the dogfood allowlist gate
  (keep-list, grep patterns, teardown). It is the LAST step, executed only
  once the register above is cleared.

## Constraints

- This ticket never flips to `in-progress` by itself — it is worked by
  reference (items point at their own tickets). Flip to `complete` only when
  the public release ships and the register is fully dispositioned.
- Keep entries dated and decision-attributed. Format:
  `- <Item> (STATUS: done | accepted-risk | open) — decided YYYY-MM-DD by
<who>, see feat-NNN`. Superseding an entry follows the repo-wide additive
  supersession convention (root `CLAUDE.md`, "Retired-mechanism prose
  sweep"): stamp a dated note naming the successor, never rewrite history.

## Verification

At release-planning time: every register item is either DONE (linked ticket
complete), explicitly ACCEPTED as a risk (dated, attributed), or has an
owner and a ticket. No item silently dropped.
