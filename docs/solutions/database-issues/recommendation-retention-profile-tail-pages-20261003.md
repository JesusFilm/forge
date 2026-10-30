---
title: "Page expired recommendation profile tails within the retention deadline"
date: "2026-10-03"
module: "Admin Recommendations"
problem_type: "database_issue"
component: "background_job"
severity: "high"
symptoms:
  - "A normal loaded retention cycle misses its fixed transaction deadline after a large profile tail"
  - "Request roots drain, but expired projection children remain"
root_cause: "unbounded_database_mutation"
resolution_type: "code_fix"
tags: [recommendations, retention, postgres, profiles, batching]
---

# Page expired recommendation profile tails

The request-root batch size did not constrain four later `deleteMany` calls for
expired projection runs, contributions, interests and generations. One loaded
production wrapper committed 8,265 projection runs and then exhausted its
five-second deadline before the following phase committed. That sequence points
to the large tail, though it does not identify every SQL statement's duration.

Select expired child IDs in stable expiry/ID order, up to the existing batch
size, and delete only those IDs within the same retention transaction. A
generation with live run or decision references needs those links detached in
bounded pages before deletion; retain the live rows and their provenance. Check
that all child collections are empty before deleting a generation, so database
cascades cannot silently turn a bounded page into an unbounded operation. Keep
the original deadline and expiry policy.

Continuation must reflect a full page or any remaining expired profile-tail
row even when no request roots remain. A partial child page can still leave an
expired generation waiting for its other children. Native PostgreSQL fixtures
should exercise more than one page, live references and eventual completion.
Those fixtures prove the local behavior, not failure-free production retention;
that requires subsequent normal loaded cycles.
