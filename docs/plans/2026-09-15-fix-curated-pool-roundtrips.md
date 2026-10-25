---
title: "Read curated fallback metadata in one database snapshot"
date: "2026-09-15"
status: "in-progress"
ticket: "feat-496"
---

## Evidence

Admin deployment dfbea3507 resolves the contextual fallback's repeated vector
queries. Immediately after startup, source-free delivery still failed in
curated retrieval (trace 6aa892480000000032b6ea5e97a96d41) and issuance (trace
6aa89241000000006ef6975c861bba33). Curated retrieval spent 730 ms on one successful
request, leaving insufficient issuance time. The failed curated transaction
consumed 777 ms of a remaining 642 ms budget. It separately reads the active
pointer, generation, language pools, optional interest memberships, and final
editorial ranks before returning hydrated candidates. Steady-state subsequent
production probes serve six cards in 761–892 ms including network transit.

## Change

Read active generation, at most nine exact-locale/audio pools and their bounded
membership/rank metadata in one SQL statement. Keep current live video
hydration, eligibility, canonical deduplication, interest ordering, starter
reserve and requested count unchanged. Do not cache publication state or expand
the 1.5-second delivery deadline. Preserve all import/promotion operations.

## Verification

Use existing real-Postgres lifecycle/eligibility tests and compare full output
against the old service on the local catalog, including cold starts, interest
history and multiple playback languages. Measure complete service and statement
counts with the same Prisma instance. Include empty pointer/context and missing
membership cases. Run Admin checks/build, review, compound, PR/CI/merge and fresh
production probes across startup and steady traffic. Keep the homepage removed.
