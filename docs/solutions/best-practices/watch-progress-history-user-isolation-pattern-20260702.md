---
title: Watch progress history must isolate local user state before server sync
date: 2026-07-02
category: best-practices
module: apps/web
problem_type: best_practice
component: authentication
severity: high
applies_when:
  - "A signed-in browser feature promotes anonymous or local state into a durable user profile"
  - "The browser can contain local progress for more than one signed-in account"
  - "An internal service accepts caller-supplied consumer user ids"
tags:
  - watch-progress
  - localstorage
  - bearer-auth
  - history
  - account-isolation
related_components:
  - apps/admin
  - database
  - testing_framework
---

# Watch progress history must isolate local user state before server sync

## Context

Watch resume progress has two sources of truth: browser-local progress for fast
anonymous and offline behavior, and durable server progress for signed-in watch
history. The risky moment is sign-in. A single browser can contain progress for
anonymous viewing plus more than one previously signed-in account, and the
history endpoint receives enough data to persist it under the current Auth
subject.

The initial implementation correctly avoided writing anonymous progress for
signed-out users, but review found two promotion risks: enumerating every local
`forge.watch_progress.v1.user.*` bucket could copy another local account's
progress into the current account, and stale local progress could overwrite
newer server progress.

## Guidance

Treat local progress promotion as an account-isolation boundary, not just a
cache warmup.

Keep a small "current local user" marker and only submit:

- anonymous progress, when it is being promoted during the current sign-in
- the local bucket for the current authenticated user
- never every user-scoped bucket in `localStorage`

Send the expected local user id with the sync payload, and have the server
ignore submitted entries when that id does not match the authenticated session.
That server guard matters because browser storage is user-controlled input.

Before writing submitted progress to the durable store, fetch the current server
rows and only sync entries whose `updatedAt` is at least as new as the server
row for the same video. The admin service should also dedupe submitted entries
per `videoId` and prefer the newest `lastWatchedAt`, so a batch containing
duplicate video progress cannot regress itself.

Completed videos need a separate UX rule. They should render a full progress
bar at the completion threshold, but they should not auto-open or seek to the
end when revisited. Gate resume behavior on `0 < progressRatio < 1`, not merely
"has saved progress".

Internal watch-progress routes should not reuse a broad web SSR bearer when the
receiver accepts caller-supplied consumer user ids. Add a dedicated receiver
allowlist such as `WATCH_PROGRESS_ADMIN_API_KEYS`, include it in the shared
bearer disjointness invariant, and have the web caller prefer that key while
falling back only for local transition periods.

## Why This Matters

Watch history is personal data. The browser-local store is convenient, but it is
not authoritative and it is not naturally account-scoped unless the code makes
it so. Enumerating all local buckets leaks activity between people who share a
browser profile. Trusting stale local timestamps lets an older tab or old local
cache erase newer server progress.

The bearer boundary is the server-side mirror of the same principle. A route
that writes arbitrary `userId` progress is narrower than general web metadata
reads, so it deserves a narrower key and tests that lock that separation in.

## When to Apply

- Promoting anonymous state into a signed-in profile.
- Building history, favorites, saved items, preferences, or any local-first
  feature that later syncs to a server user id.
- Adding internal admin receiver routes that accept a user id supplied by a
  server-to-server caller.

## Examples

The safe shape is:

```ts
const entries =
  localUserId == null || localUserId === session.userId ? submittedEntries : []

const currentEntries = await fetchProgressForUser(session.userId)
const entriesToSync = submittedEntries.filter((entry) => {
  const current = currentByVideoId.get(entry.videoId)
  return (
    !current || Date.parse(entry.updatedAt) >= Date.parse(current.updatedAt)
  )
})
```

The unsafe shape is:

```ts
for (const key of Object.keys(localStorage)) {
  if (key.startsWith("forge.watch_progress.v1.user.")) {
    submit(JSON.parse(localStorage.getItem(key) ?? "{}"))
  }
}
```

## Related

- [Admin mapper catalog projection with narrow bearer access](../architecture-patterns/admin-mapper-catalog-projection-narrow-bearer-pattern-20260609.md)
- [Parity bearer narrow carve-out pattern](../architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md)
- [Client pre-dedupes mirroring server dedupe](./client-mirror-server-dedupe-per-id-contract-20260506.md)
