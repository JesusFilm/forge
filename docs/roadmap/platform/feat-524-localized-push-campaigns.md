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
   that may import `expo-notifications`. It carries the push port (token read,
   rotation, announcements channel), the foreground branch, and the
   dismiss-by-identifier call.
7. `apps/admin/src/workflows/pushCampaign.ts` and
   `apps/admin/src/services/push/dispatch.ts` — one durable run per campaign:
   ledger row, start, zone groups, batch pages, receipts, finish or fail.
8. `apps/admin/src/app/dashboard/push-campaigns/` — the list, the editor and
   report page, and the test-device page, behind `write:push-campaigns`.
9. `apps/mobile/src/lib/push/` — registration controller, client, store, and
   the announcement payload parser the tap handler dispatches to.
10. `apps/admin/CLAUDE.md` "Localized push campaigns (feat-524)" and
    `apps/mobile/CLAUDE.md` "Push registration" — seam, flags, deploy order,
    and rollback.

## Grep These

- `push_delivery_daily_claim_key` — one announcement per phone per local day
- `PushDeliveryStatus` — claim statuses against report-only outcomes
- `unlinkPushViewerIdentities` — every caller that ends a viewer's push link
- `PUSH_RETENTION_WORKFLOW_KEY` — the push purge's own ledger key
- `368_000_004` — the push retention advisory lock id
- `[push] event=` — the plain-string log lines this feature emits
- `PUSH_CAMPAIGNS_ENABLED` — admin's send flag; `PUSH_REGISTRATION_ENABLED` — the
  app's zero-import registration switch
- `runPushCampaign` — the durable run; `stepFailPushCampaignRun` — the failure
  path that marks the ledger and the campaign
- `registerPushDevice` and `reportPushOpen` — the two public mutations;
  `RegisterPushDevice` and `ReportPushOpen` — the operation names the fleet
  bearer rides
- `afterOpenStored` — the seam where the reverse attribution join runs
- `push.registration` — the app's telemetry events, through the sink named
  `telemetry`

## What To Build

Units U1 to U8 are built on this branch, one commit each: the data model and
migration 0099, the retention step and identity unlink, the campaign, audience,
language, claim, and test-device services, the two public mutations, the send
workflow with transport, receipts, and recovery, attribution in both
directions with the report, the dashboard, and the app's registration, tap
routing, foreground banner, and open report.

U9 remains and is owner-run: credentials, the native builds, the device pass on
a physical iPhone and Android phone, the first internal campaign, and the first
real campaign as a one-country wave. The plan's Operational Notes carry the
credentials table and the go-or-no-go checklist.

## Operator steps before the first campaign

1. Deploy admin with `PUSH_CAMPAIGNS_ENABLED` unset. Confirm both admin services
   ran migration 0099 and `prisma migrate status` is clean.
2. Restart the recommendation-retention scheduler run once. The push retention
   step was added inside that durable loop, so the run alive at deploy time
   replays an event log without it. Cancel it in the workflows dashboard and
   confirm a fresh run starts.
3. Set the worker's queue concurrency to at least 4 and record the value.
4. Mint the Expo access token under a low-privilege robot user and set it as a
   Railway variable on the worker service only. Admin web refuses to boot with
   it injected.
5. One batched Doppler write of the push vars with the flag on. Schedule must
   then be refused only by the missing-test-send reason.
6. Apply the four monitors in `infra/datadog-monitors/push/` once admin logs
   reach Datadog.
7. Add `apps/mobile/google-services.json` from the Firebase console before any
   Android build; `expo prebuild --platform android` refuses while it is absent.
   Provision the Apple push key and the FCM v1 service account in EAS.
8. Ship a native build before the next `eas update`: the app config changed, so
   the fingerprint runtime version moved.
9. Run the device pass and the first internal campaign per the plan's
   go-or-no-go checklist. Only after the first real one-country wave shows a
   dead-token rate under 5 percent does an everywhere campaign go out.

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
- `pnpm --filter @forge/admin build`, which runs the workflow manifest gates over
  `stepRunPushRetention` and the campaign workflow
  (`scripts/verify-push-workflow-build.mjs`)
- `pnpm --filter @forge/mobile test`, `typecheck`, and `lint`
- The synthetic dry run:
  `CI=1 pnpm --filter @forge/admin exec tsx src/scripts/push-campaign-dry-run.ts --registrations=100000 --groups=40`
- The push database suites:
  `PUSH_DB_TEST=1 DATABASE_URL=<admin test database> pnpm --filter @forge/admin exec vitest run src/services/push`
- `apps/admin/src/scripts/prisma-migration-deploy-safety.test.ts`, plus a review
  that migration 0099 alters no existing table
- `prisma migrate status` clean on the admin web and worker services after the
  deploy
- A launch-path measurement for the mobile change, taken during the device pass:
  the root layout now mounts `PushNoticeHost` and the registration controller
  runs on every launch. Compare a release build's Datadog `js_tti` before and
  after, or the console-patch JS-path timing on a warm deep-link open. A
  dev-client cold launch is not a measurement (its noise floor is about 6 s).
- The first internal campaign passes the go-or-no-go checklist in the plan.
