# Source-free recommendations production activation — 14 September 2026

“Recommended for You” is live below Browse by category on the English Watch
homepage. The Spanish homepage shows “Recomendados para ti.” Both use the
top-level `HomepageRecommendationsBlock`. Production playback, feedback and
homepage-return checks passed. This activation changes Web content and curated
data; it introduces no mobile/TV frontend release.

## Deployed code and activated data

- Web restoration: [#2279](https://github.com/JesusFilm/forge/pull/2279).
- Default-on serving: [#2280](https://github.com/JesusFilm/forge/pull/2280).
- Admin CI-mode default fix: [#2281](https://github.com/JesusFilm/forge/pull/2281),
  merged as `c869e80bf0b4c51f50200b370cb560874aed54dc`; primary Admin deployed
  at 23:41:09 UTC on 13 September. PR and main CI completed successfully.
- Production generation: `2026-09-14.astra-homepage-ui-languages.v1`, pointer
  revision **2**, previous version `2026-09-14.astra-homepage-initial.v1`.
- **51 exact locale/audio combinations**, covering 51 audio languages and 21 UI
  locales. Each start pool has **14–191 eligible distinct videos**. Source:
  208 reviewed editorial choices, 233 resolved Core references, five interest
  themes plus `start`; flagged exclusions remain excluded.

The existing `CuratedPoolsService` imported, sealed and promoted the generation
against current production Admin data. Promotion revalidated current eligibility
and stored starter IDs. The initial requirement was six with zero reserved
exclusions. This does not guarantee six after every possible viewing history or
for every requested count. Eligibility, language, history and deduplication rules
remain unchanged. Profile results still take precedence; curated pools only fill
missing places. There is no monthly job or paid model API call.

The owner explicitly removed complete language coverage as a launch gate. The
broader production audit stopped with `P1001` after more than 600 queries when
the public PostgreSQL connection dropped; it did not produce a completed report
or activate the other locally passing contexts. `feat-497` owns that expansion.
The [machine-readable evidence](user-recommendations-activation-2026-09-14.json)
lists the exact activated contexts, counts and source digest.

## Homepage publication

Both previously published homepage locales gained one block immediately after
`watchHomeCategoryRail`: English 16→17 blocks, Spanish 10→11. The unpublished
Russian homepage remained a draft. English had an existing unpublished revision;
its unrelated edits were retained as a draft, with the new block also included,
rather than being accidentally published with the feature.

Publication used `ExperienceService.updateLocaleDraft` and `publishLocale` with
revision checks and a locked transaction. Canonical content and the existing
English draft were compared after schema normalization. English normalization
also materialized empty `excludedVideoIds` defaults on existing media collections.

Spanish contained 16 obsolete `mediaCollection.items[].imageUrl` keys rejected by
the current schema. The normal draft service parses old canonical data before
applying a patch, so cleaning only the submitted patch could not repair it.
A bounded repair archived the exact original snapshot in `ContentRevision`,
removed only those non-projected keys, then returned to normal publication.
Current GraphQL does not read those retired keys. Original snapshots are retained
in protected operator artifacts. Public Watch revalidation returned HTTP 200
after each committed publication; no Railway redeploy was triggered.

## Live validation

- **00:17:55–00:18:16 UTC:** English homepage HTTP 200, one block, correct heading
  and placement, six distinct cards, delivery `served`, no browser page errors.
- **00:30:00–00:30:12 UTC:** phone-sized English Web viewport, six distinct cards,
  stable browsing and no horizontal page overflow.
- **00:33:54–00:34:06 UTC:** phone-sized Spanish Web viewport, localized heading,
  six distinct cards and accepted evidence. Screenshot visually checked.
- **00:34:55–00:36:02 UTC:** English homepage → recommended video → normal Watch
  playback → homepage return. Selection acknowledged; playback advanced beyond
  36 seconds; profile, evidence and playback requests accepted; seeded delivery
  also returned six. Returning fetched a fresh six-card source-free list.
  One navigation-time playback request was aborted; subsequent feedback succeeded.
- Six repeated direct Admin API probes (Arabic Algerian, English, French, Hindi,
  Japanese and Spanish Castilian) each returned six distinct items from revision 2.

Earlier samples remain part of the evidence: the first 21-locale API sweep served
six and returned one admission failure plus fourteen delivery timeouts. A first
browser harness identified itself as headless and correctly received
`machine_evidence_rejected`; the normal-user-agent journey passed without
changing the production admission policy. An intermediate journey played video
and accepted feedback but lacked selection acknowledgment; the final journey
acknowledged selection too. These checks do not prove every language/dub or
completion of the asynchronous profile-projection pipeline.

## Production monitoring and remaining work

The fixed **00:18–00:25 UTC** Web-version window counted **5,408 requests, zero
5xx**, including eight source-free requests. It uses shared production version
tags and can include more than one Railway environment. It is a finite healthy
window, not proof that all runtime failures are resolved. HTTP 200 can also carry
`unavailable`; monitor delivery results as well as status codes.

Later [trace `6aa7403d00000000262e20db7880e1dd`](https://app.datadoghq.com/apm/trace/6aa7403d00000000262e20db7880e1dd)
shows successful retrieval followed by issuance expiration: 298 ms elapsed in a
transaction with 238 ms remaining. Earlier Redis TIME/EVAL and Web upstream
timeouts also remain documented in
[the runtime investigation](watch-runtime-diagnosis-2026-09-14.md). Admin logged
`pg-pool` double release at 00:31:26 UTC; causality is not established. Admin,
Web and Web Redis are in the same Railway region, so a cross-region setting is
not supported as the explanation. `feat-496` remains in progress.

The removed Redis evidence collector did not remove Redis cache and admission
responsibilities. Do not disable GA/RUM or raise deadlines speculatively to hide
these failures. Prior Web restoration performance evidence remains in
[the restoration record](user-recommendations-restoration-2026-09-14.md).

## Rollback and client handoff

The current generation records the initial nine-context generation as its
previous version. Use the existing pool CLI `rollback --execute` with
`--expected-active=2026-09-14.astra-homepage-ui-languages.v1`; it revalidates that
previous generation before moving the pointer. This reduces language coverage.
For homepage rollback, use the revision-aware service to remove the singleton
from canonical and active draft content while preserving unrelated edits.
Explicit `WATCH_FOR_YOU_ENABLED=false` and
`RECOMMENDATION_USER_SERVING_ENABLED=false` remain serving kill switches.

The [API consumption guide](user-recommendations.md) was emailed to the requested
recipient before activation; no duplicate email was sent. The shared API supports
independent anonymous installations on Web, mobile and TV. Native surfaces and
cross-device history are outside this release. Application deployments continue
through normal PR→main; this task performed data publication through the existing
services, not `railway up` or a manual redeploy.
