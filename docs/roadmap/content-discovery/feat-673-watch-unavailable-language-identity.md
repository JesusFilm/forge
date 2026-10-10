---
id: "feat-673"
title: "Preserve selected catalog language on unavailable Watch pages"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-10"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "graphql"
  - "i18n"
---

## Problem

FGE-284: French-African unavailable audio page identifies the selection as plain
French. Production inventory identifies the published language as `French, African`.
The recovery payload lacks requested-language metadata and ICU aliases `fra` to `fr`.

## Entry Points — Read These First

1. `apps/admin/src/services/video.service.ts` — existing preferred-variant snapshot SQL.
2. `apps/admin/src/graphql/types/video.ts` — snapshot public DTO fields.
3. `apps/web/src/lib/content.ts` — unavailable recovery target projection.
4. `apps/web/src/lib/watch-unavailable-recovery-actions.ts` — verified missing-dub branch.
5. `apps/web/src/components/watch/WatchUnavailableLanguageClient.tsx` — heading and browse action.

## Grep These

- `findPreferredPlayableVariantRow|WatchRouteSnapshotLanguage`
- `WatchUnavailableRecoveryResolution|localizedSearchLanguageName`

## What To Build

Carry active requested-language metadata through the existing snapshot query and
recovery payload. Preserve provider-owned identifying wording when ICU cannot
represent the catalog selection. Keep plain French localized.

## Constraints

No additional catalog or inventory-count request. No invented regional translation,
dub creation, catalog publication, route or content identity change. Missing dubs
are not assumed defects. Regenerate SDL and typed-client outputs after schema changes.

## Verification

Focused Admin snapshot/service contracts and Web recovery/display tests. Verify
French-African heading/CTA against provider metadata and a plain French control.
Confirm no added SQL/network call or waterfall and record loading-impact evidence.

## Outcome

Admin exposes nullable `WatchRouteSnapshot.requestedLanguage` through the existing
preferred-variant SQL statement. Web requires an exact requested slug and keeps
approved catalog qualifiers when ICU loses them. Plain French remains localized.
An exact unknown-field validation retry uses the legacy query with a 60-second
process cooldown during independently ordered Admin/Web deploys.

## Validation Receipt

- Admin service: 92 tests; targeted public resolver/schema/security/classification
  suite: 2,496 passed, 1 todo. Admin and typed-client typechecks passed; schema and
  gql.tada outputs regenerated and checked for drift.
- Full Web suite: 4,753 passed, 10 skipped, 1 todo. Web typecheck and touched-file
  ESLint passed.
- Browser: actual component and French catalogs show `French, African` in heading
  and browse action; plain French control shows `français`, preserving exact links.
  Alternating warm fixture median heading time: before 40.7 ms, after 41.9 ms; same
  two resource requests. Fixture bundle increases 404 bytes raw / 127 bytes gzip.
  This measures the component fixture, not the full production Next page.
- PostgreSQL 18.6 private Unix-socket fixture executes the exact source SQL with
  10,004 synthetic language rows: exact slug, plain French, alias, soft-delete,
  null/unknown request, missing dub and deleted-video controls passed.
  `language_slug_key` is used. Thirty local samples: baseline median 0.017 ms,
  candidate 0.048 ms. No added query/round trip; no production p95 claim.

FGE-284 remains In Progress until merge. Missing requested dubs are not catalog
errors without an owner-approved content expectation; the audited Burmese/LUMO
and Bartimaeus blanket claims did not reproduce.
