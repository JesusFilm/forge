# feat-461 implementation handoff

## Scope and base

Final reviewed dependency base: `2a03da7cd701c97e238645d1646592c38eeb88d9`, equivalent
to root7d0cf7bf retirement atop reviewed final460 and its docs correction. Calendar
implementation commits follow that base only. No sibling WIP or duplicate prerequisites.
Ticket stays **in progress** pending root acceptance of performance/external
qualifications; local functional implementation is complete rather than planner-only.

## Delivered behavior

- Standalone projects remain optional. The calendar presents current14 and following14
  days, one slot per day, explicit IANA zone/time and bounded once/twice daily planning.
- Strict isolated native planning admits only following-fortnight dates automatically.
  Explicit manual planning can fill gaps in both windows. Complete-week and slot output
  contains only titles/themes, exact admitted identities and frozen native provenance.
  Empty/guidance-only packs can suggest themes but never fabricate source readiness.
  Human overrides, assigned packs, edited/approved projects and subsequent edits win.
- Explicit single/batch generation composes reviewed458 and preserves retained proposals
  for the same human review workflow. Confirmed rejection permits refreshed selection;
  ambiguous completion preserves the original request and consumed native claim.
- Scheduling requires prior interactive authorization for exact slot/version/project/
  revision/approval/render/release/due/window. It never locks a draft. Current membership,
  source eligibility and fresh same-release readiness are revalidated when due.
- Separate durable publication timer calls final460 preparation and canonical publication.
  Dispatch leases fence old preparers; full envelopes persist before submission. Exact
  accepted retries resolve the original receipt even after unpublish. Cancellation,
  rescheduling, expiry, stale revisions and unavailable/unapproved work cannot substitute
  another release. Project-before-slot locks and rollback preserve atomic consumption.
- Built UI exposes approval/readiness/delivery/override state, explicit fresh selection,
  authorization/cancel/retry/refresh actions, DST gap/fold choices and permanent unpublish
  lock. First publication permanently locks content; no edit/republish escape exists.

## Ownership map

- Portable schema/time resolver: `packages/studio-contracts/src/calendar.ts`.
- Admin calendar, production admission, human authorization, dispatch and timer startup:
  `apps/admin/src/services/studio-authoring/calendar*.ts`.
- Migrations0088–0092 own calendar/history/planner dispatch/weekly provenance/publication
  dispatch. Final460 owns0083–0087; no competing asset/source/agent/catalog registry.
- Durable timer: `apps/admin/src/workflows/studioCalendar.ts`; authenticated discovery
  route plus `scripts/verify-studio-calendar-workflow-build.mjs` require four IDs.
- Native tool-free profile/runtime: `apps/mastra/src/services/studio-authoring/calendar*.ts`.
- Manager UI/actions: `apps/manager/src/features/video-studio/calendar*.tsx` and calendar
  routes. Final publication uses `prepareScheduledStudioPublication` and
  `publishPreparedStudioProject`; readiness is absent from prior human identity.

## Evidence and review

`README.md`, `review/README.md` and `integration/README.md` retain all stages.
Original fixed-base reviews and failed runs remain frozen. Both independent axes
cleared source findings, including final dialog/state recovery corrections.
The final source is byte-equivalent across the retirement import; comparison-build
artifacts accidentally present only in one temporary review tree were excluded by
both reviewers and are outside the final commit.

Actual local timer due23:32:00Z consumed23:32:12.340Z, attempts1, exact revision2;
one same-asset observation; canonical Watch published/revoked delivery acknowledgements.
Built Watch advances through HLS. Actual UI unpublish revokes six old resources;
exact stored-envelope retry makes zero preparation/consumption and leaves UNPUBLISHED.
The media is owned synthetic local footage verified by exact reviewed codecs; this
is signed-provider protocol evidence, not actual Mux or contained-image acceptance.

Final checks:18 calendar DB/scheduler tests,6 native calendar DB/planner tests,
20 contracts, full Manager1230 and full Mastra3031 pass. Admin full run6174 pass
with2 harness failures; corrected guarded targeted72 pass without unhandled errors.
Types/builds and normal hooks are recorded in integration logs. Post-retirement
focused calendar checks are isolated from host network services.

## Qualifications root must retain

- Earlier create cold+59.1ms/script+13.1ms remains unresolved. Calendar-only twelve-sample
  comparison improves controls-ready medians but adds12.680ms cold script CPU.
  No blanket performance pass; no further local repetitions planned.
- Existing full-suite auth test explicitly reached default Redis6379 and may have
  touched its expiring shared counter. No shared inspection/cleanup. Preflight now proves
  default ports denied before connection; isolated reruns are retained. This is a
  qualification incident, not a clean isolated full Admin-run claim.
- Watch optimizer500 is a blocked unrelated Unsplash image; recommendation/profile503s
  remain recorded. The editor preview requires a distinct registrable site in this fixture;
  the successful run proves rendered-video review/Watch, not new canvas isolation proof.
- Actual provider/creative/ElevenLabs, Mux, OCI/production containment, deployed revocation,
  operator acceptance and deployment remain separate release gates. No paid/provider,
  infrastructure, push, merge or deployment operation was performed or reopened.
