---
title: "Refresh public Top Shelf content without opening Watch"
date: "2026-10-20"
category: integration-issues
module: "apps/tv — native Top Shelf public feed"
problem_type: integration_issue
component: content_refresh
tags: [tv, tvos, top-shelf, native, cache, privacy]
---

# Native public Top Shelf feed

Foreground revalidation cannot update the app snapshot while Watch is stopped.
The opt-in native prototype instead fetches a small public feed when tvOS calls
the Top Shelf extension. The containing app need not run, but tvOS determines
when it requests content. A changed API response alone does not wake the
extension or establish an immediate refresh. See Apple's
[provider callback](<https://developer.apple.com/documentation/tvservices/tvtopshelfcontentprovider/loadtopshelfcontent(completionhandler:)>)
and [change notification](<https://developer.apple.com/documentation/tvservices/tvtopshelfcontentprovider/topshelfcontentdidchange()>).

## Build-time configuration

The feature defaults off. Export `TV_TOP_SHELF_FEED_URL` to the native prebuild
process, then rebuild and reinstall. Normal endpoints require HTTPS, at most
2048 UTF16 units, and no credentials, query or fragment. The client adds only
`language` and `concept` query parameters. This is a separate GET contract,
not the app's GraphQL endpoint or an `EXPO_PUBLIC_*` Metro setting.

For a local QA server, exact-loopback HTTP additionally requires
`TV_TOP_SHELF_FEED_LOCAL_QA=1`. The plugin generates the local endpoint and narrow
ATS exception only for Debug; the Swift client also requires a Debug simulator
build. Release strips the local endpoint and exception. Restarting Metro cannot
alter an installed extension's native configuration. The endpoint is optional;
leaving it unset preserves the existing app-snapshot/bundled path.

Canonical sources are
[the provider](../../../apps/tv/top-shelf/ContentProvider.swift),
[feed validation, request and store](../../../apps/tv/top-shelf/TopShelfFeed.swift)
and [the Expo plugin](../../../apps/tv/plugins/withTopShelf.js). Regenerate from
these sources rather than patching the generated iOS extension.

## Public response and transport contract

The JSON object contains exactly `schemaVersion`, `revision`, `generatedAt`,
`expiresAt`, `language`, `concept` and `items`:

- Schema is 1; revision is a nonnegative JavaScript-safe integer. Language and
  concept must match the request. Supported public concepts are `spotlight`,
  `collection`, `short` and `journey`.
- At most ten items and 64 KiB decoded body. IDs/slugs use bounded ASCII
  identifiers; duplicates are invalid. Titles allow 200 UTF16 units, summaries 500.
  Artwork and optional preview URLs require HTTPS. Duration must be finite and
  nonnegative; Journey contains zero-duration sections, other styles contain
  videos, and Short duration must be greater than 0 and at most 900 seconds.
- Dates must be valid ISO timestamps. Expiry must be later than generation and
  the current time; generation allows at most 60 seconds of future clock skew,
  and lifetime is at most 24 hours. The client rechecks freshness before writing.
- Unknown/private fields, including any `progress` field, are rejected. Native
  actions are derived from validated slugs; the feed cannot supply arbitrary
  navigation actions or recommendation capabilities.

The ephemeral session has no cookies, credential storage or shared HTTP cache.
It rejects all redirects, requires HTTP 200 JSON, enforces the 64 KiB cap while
streaming, and cancels at a three-second whole-wall network deadline. Cache lock
acquisition is separately bounded to one second; the network deadline does not
guarantee that the entire provider finishes in three seconds. A constant client
marker identifies the native extension; no API key, viewer/session identifier,
history or progress is exported.

## Authority, empty results and cache ownership

An enabled feed owns public content for its endpoint/language/concept. It does
not mirror personalized in-app recommendations. Same-context item, copy,
progress or timestamp rewrites in the app snapshot do not invalidate an accepted
public feed or resurrect removed items. App-file removal, malformed state,
language/style changes and a switch to Continue are different contexts and are
fenced before publication. App-owned fallback and Continue retain full-byte
snapshot guards.

The extension writes only its separate public cache. A SHA256 namespace for
endpoint/language/concept contains a fixed record and cross-process lock, so
style or language round trips retain each context's revision and empty result.
It never writes app `top-shelf.json`, AsyncStorage, SecureStore or genuine viewing
history.

A newer valid empty `items[]` is an authoritative tombstone. Network, status,
timeout, schema and context errors retain only an unexpired last-good public
response. An expired accepted record or tombstone returns no dynamic content;
it must not revive older app/bundled items. Lower revisions are rejected, and an
equal revision cannot change content. Equal content may renew expiry only with
a newer generation timestamp. A public context with no accepted cache can use
the existing app/bundled fallback; malformed cache state fails closed.

Continue Watching remains app-owned and bypasses public fetching. The prototype
does not create, alter or upload viewing history, and supplies no public progress.

## Verification and scope

The local Debug simulator build succeeded with the final provider/feed helper.
One closed-app Journey observation correlated a native request, local HTTP
receipt, cache revision 3→4 and changed system-shelf artwork while Watch remained
stopped. App snapshot and history were unchanged. This demonstrates the
extension path for that observation; it is not a fixed-cadence promise or proof
that every style/field/system-cache combination refreshed.

Host regressions cover strict parsing, empty/expiry/revision handling,
context round trips, concurrent cache writers, bounded transport and cancellation.
Run the standalone host `@main` test executable from the repository root, using
Swift 5 language mode:

```sh
mkdir -p .local-tools/top-shelf-native-refresh/swift-host
/usr/bin/swiftc -swift-version 5 -DDEBUG -parse-as-library \
  apps/tv/top-shelf/TopShelfFeed.swift \
  apps/tv/top-shelf/tests/TopShelfFeedTests.swift \
  -o .local-tools/top-shelf-native-refresh/swift-host/TopShelfFeedTests
.local-tools/top-shelf-native-refresh/swift-host/TopShelfFeedTests
```

The transport tests use HTTPS URLProtocol stubs without production requests.
Host compilation is separate from tvOS SDK typechecking, app/extension building
and actual system-Home verification. Plugin checks cover configuration and
regeneration. The authoritative case
matrix, build identities, retained failed attempts and cleanup are in the
[October 20 native validation record](../../tv-system-home-validation-2026-10-02.md#october-20-native-public-feed-prototype);
do not infer additional runtime passes from a build or a host test count.

No production public-feed endpoint/server, admin schema change, deployment,
Push implementation/test or store-readiness claim is included. A production
rollout still needs an approved published-content service and physical-device
validation. See the
[implementation plan](../../plans/2026-10-20-top-shelf-native-public-feed.md)
and [feat-751](../../roadmap/topic-experiences/feat-751-tv-native-top-shelf-public-feed.md).

## Do not turn cache TTL into an availability countdown

During system UI inspection, assigning the cache `expiresAt` to native
`TVTopShelfItem.expirationDate` made tvOS show a yellow **3 minutes Left** label
instead of the visible Journey title. Those fields have different meanings:
`expiresAt` bounds reusable data; Apple's item expiration describes when content
stops being available. The corrected provider leaves native item expiration unset
and enforces freshness at request/cache delivery. This preserves the title.
An already displayed OS card can remain until tvOS invokes the provider again;
client cache expiry cannot guarantee immediate removal or reinvocation.

Keep pre-correction passive timing separate: that candidate refreshed after
159.362 seconds, but its callbacks may have depended on the unwanted expiration
metadata. Only a new passive observation on the corrected binary can establish
its observed behavior. Neither run defines a supported polling interval.
