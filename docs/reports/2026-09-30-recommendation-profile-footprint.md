# Recommendation profile footprint

Production measurements below use September 29 UTC. The user asked to make the
whole profile footprint substantially smaller while retaining recommendation
behavior and the existing expiry rules. This breakdown distinguishes the core
profile from its interests, history, lineage and indexes.

## Measured allocation at 22:06 UTC

| Relation                                 |   Allocated bytes |   Decimal MB |
| ---------------------------------------- | ----------------: | -----------: |
| Profile interests                        |       675,094,528 |       675.09 |
| Projection generations                   |       321,937,408 |       321.94 |
| Contribution lineage                     |       189,620,224 |       189.62 |
| Current generation pointers              |       110,493,696 |       110.49 |
| Core profiles                            |       106,946,560 |       106.95 |
| Projection workflow runs                 |        27,418,624 |        27.42 |
| Session links                            |        25,387,008 |        25.39 |
| Viewers and new vector snapshot relation |            57,344 |         0.06 |
| **Total**                                | **1,456,955,392** | **1,456.96** |

These are complete PostgreSQL relation allocations, including indexes and TOAST,
not filesystem space that can immediately be reclaimed. Core profiles account
for 7.34% of the family. A capped block sample of 1,500 core profiles averaged
200 bytes per row datum, before page and index overhead.

Interests contain the largest avoidable duplication: 633,307,136 bytes of their
allocation is auxiliary/TOAST storage, primarily existing full-precision vectors.
The shared-vector implementation preserves the exact vector bytes and stores
membership, weights, lineage and expiry separately. Its local fixture reductions
are not a measured production saving or a percentage to apply to this entire
family. It does not rewrite retained inline interests.

Generation, contribution and pointer relations total 622,051,328 bytes. Their
indexes account for 298,221,568 bytes (47.94%); auxiliary/TOAST is only 196,608
bytes. Vector sharing does not reduce these relations.

## Empty versions and repeated metadata

At 22:12:45 UTC, an aggregate count found 253,816 published durable generations.
Of these, 221,383 (87.22%) declare zero contributions, interests, explicit
preferences and negative evidence. No session or expired generations were
present. Declared counters alone do not prove child absence or establish that
an empty version can be removed.

A 1% SYSTEM block sample, capped at 1,500 rows with repeatable seed 574, averaged
624.7 bytes per generation datum. Ten policy/version labels accounted for 304
bytes; each label tuple had one distinct value in the sample. The contribution
sample averaged 377.3 bytes, including 50 bytes in version labels. This sample
is neither uniform nor stratified. Tuple sizes exclude page/index overhead;
do not extrapolate them into a physical recovery promise.

An empty published generation records a state used by fallback, replay fencing,
reconciliation and authority checks. Existing code already reuses unchanged input
digests. Any more compact representation must preserve those behaviors, original
generation identity, source lineage and expiry. Deleting empty generations or
skipping their publication is not justified by their count.

At 22:19:30 UTC, a further exact aggregate found 218,003 first generations, of
which 218,001 were declared empty; 3,406 of 35,843 later generations were empty.
The most recent 1,000 published durable generations included 743 first-empty
versions, 740 created within one minute of the core profile and a median delay
of 0.470 seconds. Of these, 723 were current pointer targets. The sample covered
19:23–22:19 UTC and is not a full lifecycle or random sample.

Code inspection identifies a matching mechanism: the Web consent shell mounted
in the locale layout auto-grants personalization for undecided ordinary visitors.
Admin creates the profile and schedules projection, which publishes a generation
and pointer even without evidence. Valid cookies reuse the profile. Recognized
crawler/speculative guards exist; the database counts do not establish cookie
loss or unrecognized automation as causes.

The narrow future-write opportunity is therefore the **initial** empty version.
It requires an explicit no-evidence job result and must preserve incoming-evidence
races, retry/coalescing, privacy and claim fences, reconciliation and rollback.
Later empty replacements can clear previously learned interests and must remain.
Existing retained versions are outside this future-write change.

## Priorities

1. Shared-vector activation PR #2491 merged normally at 22:17:12 UTC as
   `f8d388d97`. At 22:30, both actual Admin roles ran that revision, returned health
   200 and reported effective sharing `true`, served format `legacy`, and compact
   traces. The first mixed-age sample included eight shared interests referring
   to five vectors, with zero missing/digest/shape mismatches. This proves actual
   new writes, not a production savings percentage. By 22:34, the separate cohort
   beginning 22:31 contained 14 generations and 16 interests, all shared, with
   zero inline writes or integrity/expiry mismatches. Eighteen projection jobs
   completed without recorded failure; one remained pending. Eight served
   requests had retrieval p95 272.45 ms. This small observation excludes
   unpersisted failures and is not representative loaded-capacity proof.
2. Implement and benchmark a gated initial bootstrap skip using conservative raw
   source absence, as specified in U3's follow-up plan. Keep the switch off until
   native concurrency/lifecycle and loaded query-cost proofs pass review. Preserve
   all current/read-history contracts and privacy lifetimes; existing retained
   versions stay unchanged. Repeated-metadata normalization is a later option.
3. Remove only proved redundant indexing. The nonunique
   `recommendation_profile_interest_generation_kind_idx` occupies 6,725,632
   bytes and matches the live unique generation/kind/ordinal key. Catalog checks
   found no constraint or normal dependency users of the nonunique index. A
   production-shaped query-plan/native proof and reviewed bounded migration are
   still required. This candidate is only 0.46% of the family.

Do not lower vector precision, shorten profile retention, delete contribution
lineage, remove current pointers or claim that all unique generation indexes are
duplicates. Their replay and identity keys differ.

## Evidence and source paths

Aggregate receipts and guarded probe SQL are in the task artifact directory
`outputs/heartbeats/20260929T2206-profile-family-breakdown`. No profile identifiers,
vectors or raw payloads were exported. No production mutation was made by these
measurements.

- `apps/admin/prisma/schema.prisma`: `RecommendationProfileProjectionGeneration`,
  `RecommendationProfileProjectionPointer`, `RecommendationProfileInterest`, and
  `RecommendationProfileProjectionContribution`.
- `apps/admin/src/services/recommendations/profiles/profile-projection.service.ts`:
  input-digest replay, generation publication, interest/contribution persistence
  and pointer swap.
- `apps/admin/src/services/recommendations/candidates/profile-candidate.service.ts`,
  `profiles/reconciliation.service.ts`, and `promotion/owner-authority.ts`: readers
  whose current/empty-state behavior must survive any later format change.
- `docs/operations/recommendation-profile-vector-sharing.md`: activation and
  compatible rollback requirements.
