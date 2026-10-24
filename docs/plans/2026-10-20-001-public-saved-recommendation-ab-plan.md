---
title: "Public A/B testing for completed saved recommendations"
date: 2026-10-20
status: completed
---

## Scope and owner decision

Make `editorial-catalog-20261019-v1` available to a public 50/50 test without
regeneration, editorial qualification, Astra/GA requirements, a prior baseline,
capacity attestation, Turnstile setup, or external loss-certification prerequisite.
The owner explicitly requested removal of these self-imposed launch barriers.
This supersedes the earlier feat-746 proposal. Reuse the current tables, signed
browser identity, assignment, delivery, click accounting, retention, and rollback.

## Implementation

1. Add an ordinary public-browser authority to the existing control/policy
   contracts. Its eligibility label records ordinary browser filtering honestly;
   no human-proof, model or calibration receipt is invented. Existing stricter
   experiments retain their original semantics.
2. Let an authenticated operator select any complete saved generation and start
   a one-calendar-month 50/50 cohort immediately. Freeze its generation, source
   and routing digests and default reporting settings. The ordinary cohort does
   not depend on private-test flags. Preserve stale-pointer protection and
   refusal to overwrite a running cohort.
3. Admit ordinary browsers using the current server-derived traffic classifier
   and signed browser identity. Exclude known automation, prefetch, unknown
   traffic, sources outside the frozen source set, and unplayable sources.
   Retain zero-card visits and original-arm fallback attribution.
4. Keep durable CTR counts and intervals available for ordinary public cohorts,
   including final reports without independent calibration. Label their evidence
   as observed public traffic; do not claim verified humans or measured transport
   loss. Existing certified promotion remains separate from starting this test.
5. Put the ordinary start control first in Admin. Keep stricter baseline and
   certificate controls under optional advanced measurement. No new viewer UI or
   browser request is required.

## Verification and release

- Native PostgreSQL lifecycle: protocol-1 editorial import, launch without
  baseline/GA/model/capacity receipts, frozen assignment, empty results, accepted
  clicks, final report without calibration, unchanged provenance, rollback,
  stale updates, and unknown authorities.
- Route tests preserve session authorization, CSRF and recent authentication.
- Web public-path tests demonstrate ordinary no-proof admission and unchanged
  player-independent behavior; no flags or producer metadata enter the client.
- Admin UI tests and a browser/load check for the changed control page.
- Run scoped formatting, lint, types, schema/migration checks, then review.
- Commit, push, create PR, wait for CI, merge through the normal flow, verify
  deployed behavior, and activate the exact editorial generation. The user has
  authorized the public test. Do not run a direct production deployment.

## Limits

This public cohort uses existing bot filtering; it does not certify every viewer
as human or measure browser-to-server event loss. Reports expose those limits.
The generation remains immutable and all publication/language/playback rules
remain active. Migration adds allowed authority values only and activates nothing.
