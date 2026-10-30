# Native Top Shelf public-feed prototype

## Scope

Implement feat-751 in the existing `codex/tv-selected-improvements` worktree,
preserving its uncommitted foreground freshness fixes and previous evidence.
The owner authorized trying extension-side API fetching while Watch stays closed.
All runtime API testing remains local-only; Push is explicitly excluded.

Add an opt-in native feed client, disabled when no endpoint is configured. This
prototype supports public Spotlight, Collection, Short and Journey content.
Continue Watching remains app-owned and does not export history or progress to
the feed. No admin schema, production service, credentials, deployment or release
is included. A later production rollout needs an approved published-content feed
and physical-device validation.

## Design and boundaries

- `ContentProvider.swift` fetches asynchronously when tvOS requests content.
  Native invocation/request/cache/visible Home are separate evidence levels.
  System scheduling is not a fixed refresh interval or an immediate-push promise.
- New Foundation-only `TopShelfFeed.swift` owns validation, bounded networking
  and a separate public cache. Never write the app's `top-shelf.json` or genuine
  viewing history from the extension.
- Native endpoint `TV_TOP_SHELF_FEED_URL` is optional. Ordinary configuration is
  HTTPS without userinfo, query or fragment. Exact loopback HTTP requires
  `TV_TOP_SHELF_FEED_LOCAL_QA=1`, a Debug plist and a compiled simulator+Debug guard.
  Local endpoint/ATS exception must be absent from the generated Release plist.
- GET response contract: schemaVersion 1, monotonic nonnegative integer revision,
  generatedAt, expiresAt, language, public concept and at most ten bounded items.
  Preserve real IDs/slugs/destinations. Reject private/progress fields, invalid
  artwork/identities, wrong context, stale revisions and excessive TTL/body size.
- Use an ephemeral cookie/credential-free session, no redirects, a three-second
  overall deadline and a 64 KiB streaming cap. Failures retain only an unexpired
  last-good public response. A successful empty response is an authoritative
  cached tombstone; do not resurrect old app/bundled items after it expires.
- Bind cache to endpoint/language/concept and coordinate public-cache writers.
  The opt-in public feed owns public items for that context; it does not mirror
  personalized in-app recommendations. Fence responses against app-file removal,
  malformed state, language or concept changes during requests. Same-context
  item/copy/timestamp rewrites do not invalidate public data or resurrect an empty
  response. App-owned fallback and Continue retain full-byte snapshot guards.
  Preserve the existing app snapshot path when the feature is disabled.
- Expo plugin owns persistent source registration and separate Debug/Release
  plist generation. Generated iOS files are build artifacts, not the source fix.

## Verification

Use isolated QA Apple TV 4K `EB58EEAD-0AD3-4EA4-B96E-F3CE887B39F6` and a local
feed on `127.0.0.1:8101`. Build/install without launching Watch or changing its data.
Use public system Home/focus interactions only; a focus action alone is not proof
the system requested the extension again. Require actual native invocation, local
HTTP receipt, public cache revision and visible Top Shelf change with the main
app stopped before/after. Retain any OS-cache/scheduling limitation.

Cover changed copy/artwork, order/removal/empty, invalid/503/timeout retention,
recovery, revision/context fencing and no history writes. Run native Foundation
regressions, plugin idempotence/Release-safety tests, TV static checks, native
build/signature checks and bounded timing/request evidence. Keep original devices,
existing artifacts and private configuration intact; cleanup stops QA/services
and restores native/local environment defaults without production API testing.

## Result

Implemented and locally verified on the existing uncommitted branch. The final
provider is `d3b4904d` with helper `82307dd8`. Six corrected-build UI tests and a
200.754-second passive observation pass: actual artwork changes after a native
request137.461 seconds following the local fixture edit, with no remote input,
Watch launch or cache reset. The app snapshot and genuine history are unchanged.
This is observed simulator timing, not a guaranteed system schedule.

A prior candidate passed nine transport/cache cases but exposed a countdown when
cache TTL was assigned to native content availability. That mapping was removed;
visible title and passive refresh were then retested on the corrected binary.
Earlier artifacts remain clearly labelled. The client enforces cache expiry at
response/fallback delivery; OS-retained cards may remain until another callback.

Native Debug build, TV typecheck/lint/Jest/format,19 Foundation checks and8 local
server checks pass. Source review and harness evidence bind the final source and
QA configuration. The exact results and cleanup are in the native section of
`docs/tv-system-home-validation-2026-10-02.md` and
`.local-tools/top-shelf-native-refresh/results.json`, `runtime-results.md`,
`cleanup.json` and `deliverables/index.html`.

The feature stays default-off. A separately implemented production public endpoint
and physical-device/release verification remain under the broader feat-630 work.
Push and production API testing were excluded. Prior foreground evidence remains
a separate earlier run and is not reused as proof of this native capability.
