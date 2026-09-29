---
title: "Core Watch catalog sync failed on a publisher-only field"
date: "2026-09-30"
category: "integration-issues"
module: "Admin Core sync and Watch search"
problem_type: "integration_issue"
component: "background_job"
symptoms:
  - "Published Breaking Point content worked in the app but was absent from Watch."
  - "Videos watermark stayed old while dependent media checkpoints advanced."
  - "Core rejected Video.restrictViewPlatforms for the anonymous Watch client."
root_cause: "missing_permission"
resolution_type: "code_fix"
severity: "high"
tags:
  - "core-sync"
  - "graphql"
  - "authorization"
  - "watermarks"
  - "watch-search"
  - "typesense"
---

# Core Watch catalog sync failed on a publisher-only field

## Problem

Breaking Point (`7_KnowGodBP`) and its four episodes were published in Core on
September 14, 2026, but had no Admin video rows. Watch routes and search could
not discover content that the mobile app could already read from Core.

## Symptoms

- Production's Videos watermark was August 3, while dependent phases had
  advanced to September 29. A catalog row-count audit still passed because
  older rows remained present.
- The September 29 worker log contained `Not authorized to resolve
Video.restrictViewPlatforms`. GraphQL HTTP 200 was not a successful import.
- The anonymous Core query with `x-graphql-client-name: watch` returned the
  series and all four episodes when the publisher-only field was omitted.

## What Didn't Work

- Inferring an editorial restriction from the field name: the error describes
  permission to **read a field**, not the value of that video's restriction.
  Core's Watch catalog itself admitted all five records. There was no evidence
  that Holly added a restriction.
- Adding an optional token was not the repair for this public projection.
  Production had no `CORE_API_TOKEN`; its Bearer branch was dormant. Core's
  publisher authentication expects JWT. That mismatch was separate from the
  active anonymous query failure.
- Re-running only incremental dependent phases would miss media already
  skipped while parent videos were absent, because their checkpoints had moved
  beyond those records.
- Running a full Videos phase inside one durable Workflow step exceeded the
  local HTTP transport's approximately 300-second limit. The queue retried
  while old step bodies continued writing under the same run-level lock.
  Native workflow cancellation stopped future orchestration but did not stop
  those already-running bodies.
- Refreshing Current Typesense aliases alone would not update Watch: live
  search selected an immutable Candidate generation from September 8.

## Solution

[PR #2476](https://github.com/Jesusfilm/forge/pull/2476), merged as
`1403be0a4b46258efcc0c03d13db0881dce3ff3a`, removed publisher-gated restriction
fields from the public Videos query and its input schema/upsert. Existing
stored restriction values are preserved; new records retain the schema
default. Core performs Watch visibility filtering before returning videos and
their relations.

The same repair caps child-phase watermarks at the last successful parent
watermark. Existing skipped data still requires a one-time full replay. Use
the deployed `pnpm --filter @forge/admin core-sync:run --full` command through
the authorized production runtime, retaining normal sync-lock ownership.
Scope remaining phases only after verifying earlier phases actually completed.
Do not clear another active owner's lock or start a competing import.

The repair deployed successfully to Admin and its worker. The exact merged
query validated all 1,134 live Watch-eligible Core records. All 116 Core-sync
tests passed. The first recovery Videos pass completed with zero errors,
updated 1,134 videos, and soft-deleted 46 Core records absent from the public
catalog. Breaking Point and all four correctly linked episodes were present.

The deployed CLI then completed dependent images, editions, subtitles, dubs,
and downloads with zero errors. It refreshed route/SEO manifests, but the
worker lacked Web revalidation configuration. Replaying the existing webhook
from Admin's configured runtime returned HTTP 200 for each invalidation.
The live series page now lists all four episodes; each played successfully
in the browser. Invited reached its full 232.64-second duration without a
media error.

The new immutable search generation `breaking-point-recovery-20260930` contains
all five records and privately returns Breaking Point first. Public search
still selects the September 8 generation. **End-to-end search recovery was still pending at that checkpoint.** The user
subsequently authorized ordinary automatic catalog publication and durable
import execution (feat-576/577). Track deployment and actual public verification
in feat-578; the old broad evaluation does not become passing evidence.

## Why This Works

The public importer needs the already-filtered Watch projection; selecting a
publisher field makes the entire GraphQL page fail. Removing that selection
restores the intended access contract without adding publisher credentials or
overriding editorial visibility. Parent watermark caps prevent future child
phases from permanently skipping data during a parent outage.

Admin data freshness and search freshness are separate. Before this repair,
successful sync refreshed manifests but never the serving catalog. The new
content publisher builds immutable catalog/lexical/availability snapshots against
the unchanged qualified engine baseline. It records content identity separately
and never creates a passing qualification for that content refresh. Ranking,
index-contract, and embedding changes retain their existing qualification gates.

Long Core phase bodies now run outside Workflow HTTP requests. A persistent
run/phase record replays completed results; a Postgres session lock excludes
concurrent native workers. Real database testing caught a Prisma compound-key
upsert race, now handled by reading the winning unique execution record. A
worker restart reruns the idempotent phase, with a bounded restart count; it does
not resume at an exact page offset. Keep old workflow entry points during rollout.

Successful imports/backfills queue durable delivery. Separate search and Web
acknowledgments make failures retryable, including absent Web credentials.
First-import parent/child relations are reconciled after later pages commit.
Never claim a merged PR or a private candidate query proves public recovery.

## Prevention

- Test the public query against Core's actual anonymous authorization contract.
  Never select a publisher-only field in this projection.
- Alert on stale phase watermarks and failed phases, not just catalog counts.
- Retain dependent checkpoint caps and full-replay instructions for incidents
  that predate those caps.
- Bound durable work below the transport budget. Run-level locks alone do not
  serialize retries of the same run. Confirm all active bodies have drained
  before owner-checked lock release after cancellation.
- Verify Watch search using the canonical Web `Origin` and no explicit mode.
  Compatibility requests without that origin may use PostgreSQL and conceal a
  stale or invalid Typesense serving generation.
- Verify the series, episode relations, thumbnails, playable dubs, live route,
  and live search independently. A merged PR is not recovery evidence.

The Videos watermark predates the August 10 commit that added the gated field.
The September failure is proven; the original August 3 onset remains unproven.

## Related Issues

- [Recovery record](../../roadmap/platform/feat-578-breaking-point-watch-recovery.md)
- [Automatic search publication](../../roadmap/content-discovery/feat-576-watch-search-catalog-publication.md)
- [Bounded workflow steps](../../roadmap/platform/feat-577-core-sync-bounded-workflow-steps.md)
- [Core projection coverage](../platform/admin-core-sync-entity-coverage.md)
- [Previous 300-second Workflow failure](../workflow-issues/transcript-embedding-backfill-cancel-and-resume-operations.md)
- [Search operations](../../operations/typesense-watch-search-production-readiness.md)
