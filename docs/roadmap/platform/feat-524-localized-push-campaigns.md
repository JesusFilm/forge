---
id: "feat-524"
title: "Localized push campaigns reach each viewer at their own morning hour"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-09-21"
duration: 14
depends_on:
  - "feat-519"
blocks: []
tags:
  - "mobile"
  - "platform"
  - "graphql"
---

## Problem

The ministry cannot speak to the install base. When a new series ships, the app
has no channel to the people most likely to watch it, so the moment passes in
silence. Most of the install base watches outside English, so one English
announcement would exclude them or reach them in a language they do not read.
The ministry also cannot tell whether an announcement led to watching.

The lapse reminders of feat-519 already obtain notification permission, so a
share of the install base is reachable on the day a send path exists. Nothing on
the server can send to it.

## Entry Points — Read These First

1. `docs/plans/2026-09-18-1540-feat-localized-push-campaigns-plan.md` — the
   implementation-ready plan. It carries the Product Contract, R1-R31, AE1-AE21,
   KTD1-KTD15 and nine implementation units. It is the authority for every
   decision below.
2. `apps/admin/prisma/schema.prisma`, the push models at the end of the file —
   registration, test device, campaign, copy, zone, delivery, open, attribution.
3. `apps/admin/prisma/migrations/0099_push_campaigns/migration.sql` — the
   partial unique indexes and CHECK constraints that Prisma cannot model. The
   daily-claim index carries its own SQL comment.
4. `apps/admin/src/services/push/` — retention, the identity unlink, the typed
   errors, and the real-database proofs of the claim contracts.
5. `apps/admin/src/workflows/recommendationRetention.ts` — `stepRunPushRetention`
   is the push purge step inside the existing daily scheduler loop.
6. `apps/mobile/src/lib/lapseReminders/notificationsAdapter.ts` — the one file
   that may import `expo-notifications`. The push port joins it in U7.

## Grep These

- `push_delivery_daily_claim_key` — one announcement per phone per local day
- `PushDeliveryStatus` — claim statuses against report-only outcomes
- `unlinkPushViewerIdentities` — every caller that ends a viewer's push link
- `PUSH_RETENTION_WORKFLOW_KEY` — the push purge's own ledger key
- `368_000_004` — the push retention advisory lock id
- `[push] event=` — the plain-string log lines this feature emits

## What To Build

U1 shipped the data model, migration 0099, the retention step, and the identity
unlink. The units that follow:

- U2. Registration and open-report mutations on admin's public GraphQL surface,
  under the push admission predicate.
- U3. Audience resolution, language resolution, and the claim service.
- U4. The Expo transport, the campaign workflow run, the env schema, and the
  monitors.
- U5. Tap attribution in the playback-context issuance resolver.
- U6. The campaign dashboard: list, editor, test devices, and report.
- U7 and U8. The app's push port, registration, tap routing, and the foreground
  banner.
- U9. Credentials, the device pass, and the first internal campaign.

## Constraints

- Admin owns the campaign end to end. No vendor console, and no second
  notification SDK in the app.
- A test send precedes every real send. A campaign freezes when sending starts;
  cancel is allowed and edit is not.
- Nothing sends while the push flag is off, and every batch step re-reads it.
- A delivery's `error` column and every push log line hold the provider's error
  code and an admin classification only. The provider's message embeds the push
  token.
- No log line and no aggregate row carries a push token, a viewer digest, or a
  session digest.
- The push purge keeps its own advisory lock and its own ledger key. A push
  failure must never retry the recommendation privacy purge.
- A consent withdrawal changes no push row. Only a viewer deletion or expiry
  ends the push link, and neither deletes a registration.

## Verification

- `pnpm --filter @forge/admin test` with the admin test database available
- `pnpm --filter @forge/admin typecheck` and `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin build`, which runs the workflow manifest gate over
  `stepRunPushRetention`
- The push database suites:
  `PUSH_DB_TEST=1 DATABASE_URL=<admin test database> pnpm --filter @forge/admin exec vitest run src/services/push`
- `apps/admin/src/scripts/prisma-migration-deploy-safety.test.ts`, plus a review
  that migration 0099 alters no existing table
- `prisma migrate status` clean on the admin web and worker services after the
  deploy
- The first internal campaign passes the go-or-no-go checklist in the plan.
