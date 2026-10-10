---
id: "feat-363"
title: "My List account sync (cross-device saved titles)"
owner: "ekkasit"
priority: "P1"
status: "not-started"
start_date: "2026-08-18"
duration: 5
depends_on: []
blocks: []
tags:
  - "tv"
  - "graphql"
  - "platform"
---

## Problem

PR #1940 shipped My List as a **device-scoped** list: saving a title on the TV
does not make it appear on the phone, and a factory reset loses it. R4 of the
requirements doc promised the account half — local-first, promoted into whichever
account signs in, synced across devices — and that half needs an admin
persistence surface that did not exist.

Confirmed by a full sweep during #1940: there is **no** favorites / watchlist /
saved / bookmark concept anywhere in `apps/admin` (Prisma, Pothos, services) or
in web/mobile. Every apparent hit is an icon-name string or an ops-dashboard
review queue. The only per-user persisted collections today are `WatchProgress`
and `WatchEvent`. This is genuinely new — but it is templated end to end by
watch-progress, so the design work is copying, not inventing.

Deliberately split out of #1940: a new table, a migration, and three new
permission keys are a sensitive surface that earns its own review rather than
riding along behind a UI feature.

## Entry Points — Read These First

1. `apps/admin/prisma/schema.prisma` — the `WatchProgress` model (~line 1743) is
   the shape to copy. Note `userId String @map("user_id")` is a **bare column,
   not a relation**: it is the consumer Auth subject, deliberately not FK'd to
   admin's editorial `User` table.
2. `apps/admin/prisma/migrations/0038_watch_progress/migration.sql` — the
   canonical hand-written DDL. Migrations here are raw SQL, not Prisma-generated
   diffs.
3. `apps/admin/src/graphql/types/watch-progress.ts` — the whole feature in 114
   lines. Copy `requireOwnDataSubject(ctx.user)`: the account comes **solely**
   from the verified principal, and no argument ever carries a user id (R13).
4. `apps/admin/src/services/watch-progress.service.ts` — note
   `deleteWatchProgressForUser(userId, client?)`, which takes an optional tx
   client so account erasure runs in one transaction.
5. `apps/admin/src/auth/permissions.ts` — the three `:own` keys, and the two
   per-role allowlists `WEB_USER_PERMISSIONS` (TV/web) and
   `MOBILE_USER_PERMISSIONS`.
6. `apps/tv/src/lib/myList/myList.ts` — already exposes `updateMyList(mutate)`,
   the locked whole-list fold the hydrate needs. No new lock work required.
7. `apps/tv/src/lib/watchEvents/watchProgressSync.ts` — the up/down sync shape to
   mirror, including why a failed push **aborts** the pull.
8. `apps/tv/src/lib/auth/anonymousMerge.ts` — `AccountMergePayload` gains the
   list; read the three shared-TV isolation rules first.

## Grep These

- `myWatchProgress|upsertMyWatchProgress|clearMyWatchProgress` — every layer the
  new operations must appear in, including the TV/mobile document modules.
- `USER_TOKEN_OPERATIONS` — `apps/tv/src/lib/authHeaders.ts`. The signed-in
  bearer is allowlisted **by operation name**; an unlisted or renamed op goes out
  anonymous and 401s at the scope gate. Keep it out of `FLEET_TOKEN_OPERATIONS`
  (`overlappingAllowlistOperations()` must stay empty).
- `ANONYMOUS_STATE_KEYS` — `MY_LIST_STORAGE_KEY` is already registered.
- `WEB_USER_PERMISSIONS|MOBILE_USER_PERMISSIONS` — both are pinned by enumerating
  assertions in `permissions.test.ts` that will fail until updated, on purpose.
- `internal/watch-progress` — the bearer-gated erasure route apps/auth calls on
  account deletion.

## What To Build

Nine steps, in this order:

1. **Prisma model** — `MyListItem`: `userId String @map("user_id")` (no
   relation), `videoId` + `video Video @relation(… onDelete: Cascade)`,
   `createdAt`, `@@unique([userId, videoId])`, `@@index([userId, createdAt])`,
   `@@index([videoId])`, `@@map("my_list_item")`; plus the back-reference on
   `Video`.
2. **Migration** `0051_my_list_item/migration.sql`, hand-written to match 0038.
3. **Service** `my-list.service.ts` — `listMyList({userId, limit})`, `addMyListItem`,
   `removeMyListItem`, and `deleteMyListForUser(userId, client = prisma)`.
4. **Permissions** — three keys in the `PermissionKey` union, three matrix
   entries, added to **both** `WEB_USER_PERMISSIONS` and
   `MOBILE_USER_PERMISSIONS`; update the enumerating tests.
5. **Pothos type** `my-list.ts` — `objectRef` + `inputType` +
   query/mutation fields with `authScopes: { hasPermission: … }` and a
   `requireOwnDataSubject` clone. Cap the batch size like `MAX_ENTRIES = 200`.
6. **Register it** — `import "@/graphql/types/my-list"` in
   `apps/admin/src/graphql/schema.ts`. Silently omitted if forgotten.
7. **Account erasure** — add the new table to the DELETE handler's
   `prisma.$transaction` in `apps/admin/src/app/api/internal/watch-progress/route.ts`
   (or a sibling). Skipping this orphans rows on account deletion.
8. **Regenerate + commit** `pnpm --filter @forge/admin schema:print` then
   `pnpm --filter @forge/admin-graphql generate`.
9. **TV consumer** — a documents module mirroring `watchProgressDocuments.ts`, a
   sync module mirroring `watchProgressSync.ts` (using the existing
   `updateMyList` fold), the new op names added to `USER_TOKEN_OPERATIONS`, and
   the list threaded into `AccountMergePayload`.

## Constraints

- **Never accept a user id as an argument.** The subject comes from the verified
  principal only; the internal REST route stays the one surface that takes one.
- **Do not add per-user local buckets on TV.** `anonymousMerge.ts` rule 2 is
  load-bearing: one anonymous bucket set, so a key scan has nothing to find. A
  per-user bucket means re-deriving that whole module.
- Do not widen `FLEET_TOKEN_OPERATIONS`.
- Do not run migrations against production by hand; Railway's pre-deploy runs
  `db:migrate:deploy`.
- Removing a card is not un-saving on another device until the clear pushes —
  mirror watch-progress's newest-wins guard rather than inventing a tombstone.

## Verification

- `pnpm --filter @forge/admin test` — resolver tests asserting the exact
  `authScopes` per field, and that anonymous / consumer-bearer / workflow callers
  are all denied at the scope gate.
- `pnpm --filter @forge/tv test` — sync tests mirroring
  `watchProgressSyncModule.test.ts`: push rides the promotion, local removal
  never waits on the network, and an UNOWNED shelf never touches the account.
- CI drift jobs `admin-schema-drift` + `admin-graphql-generate` green.
- Real round trip: sign in on the tvOS simulator, save a title, sign in as the
  same account on mobile, confirm the row appears. The simulator is the only
  platform with a screenshot channel — verify there, not on a physical Apple TV.
- Shared-TV check: sign in as A, save; sign out; sign in as B; B's list must be
  empty and A's must be intact server-side.

## Notes

TV's signed-in bearer already reaches admin through the `WEB_USER` principal
(feat-322), so no new credential plumbing is needed — only the operation names in
the allowlist.
