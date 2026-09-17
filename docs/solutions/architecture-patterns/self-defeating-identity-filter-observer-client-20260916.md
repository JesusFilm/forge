---
title: "A visibility filter keyed on the caller's own identity is self-defeating for the client whose job is to observe that filter"
date: "2026-09-16"
category: "architecture-patterns"
module: "apps/admin (src/services/core-sync/phases/sync-videos.ts, sync-video-images.ts, core-client.ts) — Core Sync's read of Core's video catalogue"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
related_components:
  - "apps/admin/src/services/core-sync/core-client.ts"
  - "apps/admin/src/services/core-sync/phases/sync-videos.ts"
  - "apps/admin/src/services/core-sync/phases/sync-video-images.ts"
  - "apps/admin/src/services/core-sync/test-doubles/core-gateway.ts"
applies_when:
  - "A client reads an upstream API that personalises, filters, or redacts its response based on WHO the caller says it is"
  - "That same client's purpose is to mirror, enforce, or audit the very rule the upstream is applying to it"
  - "The upstream exposes both a consumer-facing field and an admin/publisher field over the same underlying data"
  - "Absence in a sync response is interpreted as deletion (soft-delete-by-absence)"
  - "Tests for the client mock at a layer above the one where the caller's identity is attached"
tags:
  - "graphql"
  - "core-sync"
  - "data-visibility"
  - "restrict-view-platforms"
  - "soft-delete"
  - "test-doubles"
  - "client-name"
---

# A visibility filter keyed on the caller's own identity is self-defeating for the client whose job is to observe that filter

## Context

Core (the JesusFilm media gateway) lets an editor restrict a video from
specific platforms via `Video.restrictViewPlatforms`. Core enforces this on its
public `videos` root field by applying, per request:

```
filter.NOT = { restrictViewPlatforms: { has: clientName } }
```

where `clientName` is the caller's `x-graphql-client-name` header.

Forge's Core Sync mirrors Core's catalogue into admin's Postgres, including the
`restrict_view_platforms` column, so that jesusfilm.org/watch can enforce the
restriction. Its GraphQL client sent `x-graphql-client-name: watch` — correctly,
because Core's downloads resolver keys off the same header — and read the public
`videos` field.

So the sync that existed to learn "which videos are restricted from Watch?"
asked the question **as Watch**, and Core answered by removing exactly those
videos from the response.

The result in production (JesusFilm/forge#2324): `2_ElCamImpulsesVert` was
blocked on Nexus and still publicly playable on jesusfilm.org/watch. Forge had
never been told.

## The law

**If a client's job is to observe a rule, it must not read through a surface
that applies that rule to the client.**

The failure is silent by construction and it is silent in the worst possible
direction: the rows you most need are the rows you cannot see. There is no error,
no empty result, no partial page — just a correct-looking response with a hole in
it shaped exactly like your requirement.

Two properties make it hard to catch:

1. **The hole is invisible from inside the response.** 1134 videos came back and
   every one of them parsed, upserted and reconciled cleanly. Nothing in the
   response says "and 46 more were withheld".
2. **Absence already means something else.** Core Sync soft-deletes by absence:
   a `source: "CORE"` row not seen during a full sync is tombstoned. So the
   filter did not merely hide the restricted videos, it actively caused Forge to
   mark them deleted — and "restricted" and "deleted in Core" became
   indistinguishable states.

## The fix, and the thing it is easy to get wrong

Change the **field**, not the **identity**.

```diff
-  query Videos($offset: Int!, $limit: Int!, $where: VideosFilter) {
-    videos(offset: $offset, limit: $limit, where: $where) {
+  query AdminVideos($offset: Int!, $limit: Int!, $where: VideosFilter) {
+    adminVideos(offset: $offset, limit: $limit, where: $where) {
```

`adminVideos` takes the same `VideosFilter` input and returns the same `Video`
type; it is gated on the caller being a publisher rather than filtered by client
name.

The tempting fix — drop the `x-graphql-client-name` header, or send a different
client name — is wrong twice over. It changes an identity other resolvers depend
on (Core's downloads resolver reads the same header, so the sync would silently
start observing different download variants), and it fixes the symptom by
lying about who you are rather than by asking the right question.

Keep the header. Pin the decision at the assertion so the next reader does not
"clean it up":

```ts
for (const request of gateway.requests) {
  expect(request.clientName).toBe("watch") // downloads resolver keys off this
  expect(request.rootField).toBe("adminVideos")
}
```

### Implicit conditions travel with the consumer field

A consumer field is usually filtered in more than one way, and only one of those
ways is the one you noticed. Core's public `videos` also implies **published
only** and **available-languages non-empty**. Moving to the publisher field drops
all of them at once:

- The published condition had an exact filter-input equivalent, so it moved into
  the query explicitly. The catalogue phase already sent `published: true`; the
  images phase did not, and had been relying on the public field's implicit
  behaviour without anyone writing that down.
- The available-languages condition had **no** filter-input equivalent and could
  not be reproduced. That widening was accepted deliberately — but only after it
  was measured.

**Before switching fields, enumerate every implicit condition of the field you
are leaving and decide, in writing, what happens to each one.** The ones with a
filter equivalent become explicit clauses. The ones without become a measured,
accepted widening or a blocker.

### The gated field fails loudly — make sure your loop agrees

A publisher-gated field rejects an unauthorized caller with a GraphQL error, not
an empty list, so the switch cannot silently empty the catalogue. That is the
right failure mode, and it introduces a permanent per-page failure where
previously only transient ones were plausible.

Core Sync's images phase isolated page failures by recording the error,
advancing `offset` and continuing — whose only loop exit is a short page it would
now never receive. Under a permanent rejection it spins forever.

The damage is not memory. The loop retains nothing per iteration, so it does not
grow the heap; it simply never returns. The orchestrator holds a `SyncLock` for
the whole run and refreshes it on a 60s heartbeat
(`core-sync/orchestrator.ts`), so a phase that never returns keeps that lock
alive indefinitely and every subsequent scheduled run exits early with
`reason: "lock_held"`. The observable symptom is a sync job that quietly stops
running — no crash, no alert, no restart. That is strictly worse than an OOM,
which at least restarts the process and drops the lock.

Bounding consecutive page failures ends the phase with `errors > 0`, which
already suppresses the soft-delete and stops the watermark advancing.

**When you move a read onto a gated surface, re-read every retry/continue loop
around it and ask what it does when the failure never stops.**

## Testing: mock below the identity, not above it

The pre-existing tests mocked `coreQuery` and handed the phase a fixture
containing the restricted video. They could not have caught this bug at any
effort level: a fixture that hands you the row has already assumed away a bug
whose entire content is that the row does not arrive.

The identity lived one layer below the mock. `coreQuery`'s signature is
`(query, variables)` — the header is attached inside `core-client.ts`, so a
double installed at `coreQuery` is blind to the mechanism.

**Install the double at the layer where the caller's identity is attached** —
here, `fetch` — and make it a _semantics_ double rather than a canned response:
give it Core's rule, let it read the root field the query asked for and the
client name the request carried, and let it decide what comes back.

```ts
function isVisible(video, rootField, clientName) {
  if (rootField === "adminVideos") return true // publisher-gated, no filter
  if (clientName == null) return true
  return !video.restrictViewPlatforms.includes(clientName)
}
```

That one function is what makes the suite able to go red. With it, the
production scenario — sync, restrict in Core, sync again — is three lines and
fails on the unfixed code with `expected [] to deeply equal ['watch']`.

This is the general form of the repo's
[mocked-shape-vs-real-contract discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md):
mocked tests prove branch shape, and a bug that lives in _what the upstream
chose not to send you_ has no branch to shape.

### The rules in the double are empirical, and they expire

Most rules in the double came from a dated read-only probe of the live gateway,
recorded in the double's own header with its date, the exact query and the exact
response. That header is the only thing standing between a modelled rule and a
guess — so it must also record which rules were **not** probed, and a doc that
says "every rule was probed" while the header says otherwise has made the
header worthless.

Two beliefs here are load-bearing and were **not** probed, because the
publisher field needs a credential the measuring environment did not have: that
Core Sync's credential satisfies the publisher gate at all, and that the
publisher field returns what the public field hides. Both are inferences from
Core's schema, not observations. An unprobed belief is not automatically
unacceptable — but it has to be named as unprobed, modelled as an explicit
failure case with a test pinning the consequence when it is wrong (here: the
phase fails loudly and soft-deletes nothing), and handed to someone who _can_
run the probe, as a named post-deploy check rather than a hope.

## Measure the widening before you merge

Counting is cheap and it converts "this should be fine" into a number. From the
same live gateway, unauthenticated:

| Query                                     | Client name | Count |
| ----------------------------------------- | ----------- | ----- |
| `videosCount(where: { published: true })` | `watch`     | 1134  |
| `videosCount(where: { published: true })` | _(none)_    | 1180  |

46 published videos — about 4% of the catalogue — were restricted from Watch and
therefore structurally invisible to the sync, _and_ were being tombstoned on
every full sync. The same query with `where: {}` returns the identical 1134 /
1180, which is also how the public field's implicit published filter was
confirmed rather than assumed.

Note what that table is: the _restriction_ delta, measured by toggling the
header rather than the field, because the publisher field needs a credential the
measuring environment did not have. Say which delta you measured and which you
did not. A measured 46 plus a named, unmeasured remainder is an honest number; a
single number that quietly conflates them is not.

## The fix is inert until a full sync runs

Worth stating because it is easy to merge and assume done. Core Sync defaults to
incremental (`incremental = options?.incremental ?? true` in
`core-sync/orchestrator.ts`), and incremental runs pass
`where: { updatedAt: { gte: <watermark> } }`. The watermark already advanced
past the restricted videos — the filtered-out reads reported `errors === 0`, so
every one of them looked like a clean run. A restricted video Core has not
touched since is outside every incremental window, so the deploy alone changes
nothing for it.

Deploying a read-widening fix therefore has a required second step:

1. Deploy.
2. Confirm the publisher gate actually admits the sync's credential — the one
   belief no CI test can hold. Run one full sync and check it did not fail with
   `Not authorized to resolve Query.adminVideos`. If it did, the fix is inert in
   the other direction and `CORE_API_TOKEN` is the first thing to check: it is
   `.optional()` in the env schema, so an unset token is not a boot error, it is
   a runtime rejection on the first page.
3. Run a **full** sync (`incremental: false`), or reset the videos and
   video-images watermarks, so the already-synced restricted videos are re-read.
4. Verify against the known case (`2_ElCamImpulsesVert`): its Forge row should
   carry `restrict_view_platforms` containing `watch`, and it should stop
   resolving on the public Watch surfaces.

**A fix to what a sync READS only reaches rows the sync re-reads.** Incremental
defaults hide that completely, and they hide it in the direction of "shipped and
green".

## Checklist

- [ ] Does this client read a surface that filters on the client's own identity?
- [ ] Is the client's purpose to observe, mirror, or enforce that same rule?
- [ ] Does the upstream expose an admin/publisher field over the same data?
- [ ] Have you enumerated every _implicit_ condition of the consumer field, and
      handled each one explicitly or measured it as an accepted widening?
- [ ] Does the client interpret absence as deletion? If so, the filter has been
      corrupting state, not just hiding it — and the restore path is worth
      stating (here: the ordinary upsert's `deletedAt: null`).
- [ ] Do the tests mock **below** the layer that attaches the identity?
- [ ] Does the double model the upstream's rule, with each rule traceable to a
      dated probe?
- [ ] Does every retry/continue loop around the new read terminate when the
      failure is permanent?
- [ ] Is the identity header's retention pinned by an assertion that carries the
      reason?

## See also

- `apps/admin/src/services/core-sync/test-doubles/core-gateway.ts` — the double,
  with the 2026-09-16 probe transcript in its header
- `apps/admin/src/services/core-sync/phases/sync-videos.restrict-view-platforms.test.ts`
- [`mocked-shape-vs-real-contract-discipline-20260506.md`](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
