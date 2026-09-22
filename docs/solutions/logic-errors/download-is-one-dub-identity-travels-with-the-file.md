---
title: "A download is one dub: a stored file's identity must travel with the file, not beside it"
date: 2026-09-23
category: logic-errors
module: apps/mobile
problem_type: logic_error
component: frontend_stimulus
severity: high
framework_version: "expo 57.0.24 / react-native 0.86.3"
symptoms:
  - "On a downloaded video the viewer picks another audio dub, the language pill changes, and the downloaded audio keeps playing with no error and no log"
  - "A language re-download leaves the stored record naming a dub its own file does not contain, and records already on devices get no repair"
  - "Expanding the floating mini player swaps the streamed dub back to the file mid-sentence, then the fresh provider re-ranks the download over the viewer's pick"
  - "A cold-opened download keeps the file's quality-of-experience session, because the first pick compares against a language that has not settled yet"
  - "Restoring the bug at the resolver's single production call site left every suite green (271 at the time of the check, before this fix added its own guard file)"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - apps/mobile/src/lib/playerSource.ts
  - apps/mobile/src/contexts/DownloadsProvider.tsx
  - apps/mobile/src/contexts/WatchSessionProvider.tsx
  - apps/mobile/src/components/watch/PlaybackHost.tsx
  - apps/mobile/src/lib/miniPlayer/store.ts
  - apps/mobile/src/lib/offlineManifest.ts
  - apps/mobile/src/lib/downloadLifecycle.ts
  - "apps/mobile/app/watch/[slug].tsx"
tags:
  - mobile
  - react-native
  - offline-downloads
  - video-player
  - language-identity
  - mini-player
  - identity-predicate
  - playback-session
---

# A download is one dub: a stored file's identity must travel with the file, not beside it

## Problem

`apps/mobile` stores one downloaded file per video, and the watch screen's source
resolver returned that file ahead of every other source. After the download sheet
gained a language swap, a download became one file for one DUB and the resolver
did not follow. A viewer who picked another audio language on a downloaded video
saw the language pill change while the downloaded audio kept playing.

Fixed in PR #2376, merged 2026-09-22. The work uncovered five faults with one
shape: an identity travelled apart from the thing it identified.

## Symptoms

- A viewer opened a downloaded video and picked a different audio dub. The pill
  changed to the new language and the downloaded audio kept playing. Nothing
  logged and nothing failed.
- After a language re-download from the download sheet, the stored record named
  the OLD dub while the new file held the NEW one, because `swap` never wrote the
  dub it was handed.
- An expand from the floating mini-player window swapped the streamed dub back to
  the downloaded file mid-sentence, and the fresh provider then re-ranked the
  download over the viewer's persisted pick. The choice was undone twice on one
  screen.
- On a cold-opened download, the first pick claimed `"same-content"` and the host
  silently kept the file's quality-of-experience session.
- The full suite ran green throughout, including a run where the reported bug was
  deliberately restored at the resolver's single call site.

## What Didn't Work

- **Bumping `OFFLINE_MANIFEST_VERSION`.** The parser drops any record whose
  version does not match (`apps/mobile/src/lib/offlineManifest.ts:146`), and the
  record is what holds the path to the file. A bump would have deleted every
  download on every device and orphaned the bytes. A nullable field replaced it.
- **Reading `getRecord().dubDocumentId` beside `committedPath`.** Mid-swap the
  record already names the incoming dub while the old file still plays, so that
  pairing names a language the bytes do not contain.
- **Trusting the full suite.** Writing `offlineDubDocumentId: null` at the one
  production call site type-checked, landed on an already-tested branch of the
  predicate, and restored the reported bug with every suite green.
- **Adding another behavioural fixture in the same shape.** Every pre-existing
  fixture pinned the other axes at their safe values, so a new one in that shape
  could not discriminate a guard either.
- **Fixing host adoption alone.** It stopped the mid-sentence swap back to the
  file. The fresh reconciler still re-ranked the download on the next commit. The
  expand path needed all three legs below.
- **Treating a slug as a playback identity.** An earlier session established that
  downloaded records are keyed by slug, and concluded that one slug-keyed
  last-watched record covers online and offline playback alike. That conclusion is
  correct for pointing at a video and is the exact limit case this defect
  occupies: a slug identifies which VIDEO, never which AUDIO. (session history)

## Solution

### 1. Return the file and its identity from one accessor

During a swap the record already names the INCOMING dub while the OLD file still
plays. The writer proves it: `swap` sets the new `dubDocumentId` in the same patch
that nulls `committedPath` and keeps the old file under `swapFrom`. So one
accessor returns the path and its identities together, chosen on one branch:

```ts
// apps/mobile/src/contexts/DownloadsProvider.tsx:94
export type CommittedCopy = {
  path: string
  /** Null when the copy predates the dub being kept on a swap snapshot. */
  dubDocumentId: string | null
  /** The subtitle bundled with THIS file; null for "No subtitles". */
  subtitleLanguageSlug: string | null
}
```

`committedCopyFor` (`DownloadsProvider.tsx:765`) returns the committed record's
path with the record's own identities, or, mid-swap, the `swapFrom` path with the
OLD file's identities. A caller cannot mix a path from one branch with a dub from
the other.

All three production readers use it, keyed on the same slug: the watch route at
`apps/mobile/app/watch/[slug].tsx:272`, the language sheet at
`apps/mobile/app/watch/language.tsx:29`, which marks the dub on disk with a
"Downloaded" line, and the session provider at
`apps/mobile/src/contexts/WatchSessionProvider.tsx:265`, whose read feeds the
fallback chain in fault 4. The source that plays, the mark the viewer sees, and
the language the pill defaults to therefore cannot name different dubs.

### 2. Add a nullable field to a persisted snapshot; do not bump its version

```ts
// apps/mobile/src/lib/offlineManifest.ts:40
export type SwapFrom = {
  committedPath: string
  renditionDocumentId: string
  /** The dub the old file holds; null on a snapshot written before it was kept. */
  dubDocumentId: string | null
  // ...
}
```

A snapshot from an older build has no such key, and `parseSwapFrom` reads it
through `asString`, which yields null. Null then means the OLD behaviour at every
reader: `swapRevertFields` leaves the record's own dub in place
(`apps/mobile/src/lib/downloadRequestBuilders.ts:141`), and the resolver keeps the
file (`playerSource.ts:56`).

### 3. A writer that receives an identity must write it

`swap` spread the existing record and rewrote the rendition, the quality label,
the title, the subtitle, the state, both paths and the byte counts. It never
rewrote `dubDocumentId`, although the sheet always sent the ACTIVE dub:

```ts
// apps/mobile/src/lib/downloadLifecycle.ts:658 (after #2376)
await deps.writeRecord({
  ...existing,
  // The sheet sends the ACTIVE dub, so a swap can change language. Offline
  // playback keys on the record's dub, so it must name the file it fetches.
  dubDocumentId: request.dubDocumentId,
  renditionDocumentId: rendition.documentId,
  // ...
})
```

This fault was pre-existing, and no repair runs for records already on devices.
That is one reason the resolver's second guard exists: an unknown or stale dub on
disk keeps the file rather than playing nothing.

### 4. A fresh provider must not outrank state the viewer just produced

A watch screen that remounts onto the floating session gets a FRESH group-scoped
`WatchSessionProvider` whose dub has not settled, so its first render publishes
the download with a null language. Three legs, each guarding a different seam:

**Host adoption holds while a request names no dub.** A container flip with no
language is a half-resolved remount, never a viewer's choice
(`apps/mobile/src/components/watch/PlaybackHost.tsx:389`).

**The store keeps a known language across a slug-only re-start.** A remounted
screen re-reads the dub from the session, so the merge must not downgrade it to
null (`apps/mobile/src/lib/miniPlayer/store.ts:197`).

**The provider seeds its default from the floating session ahead of the
download** (`apps/mobile/src/contexts/WatchSessionProvider.tsx:297`):

```ts
preferredSlug: floatingAudioSlug ?? downloadedAudioSlug ?? preferredAudioSlug,
```

The order of that chain is the whole decision. The floating session holds the most
recent thing the viewer did, so it wins. The download is a standing preference, so
it comes next. The stored preference is oldest, so it comes last.

### 5. Refresh a snapshot on every axis it carries, not only the axis it is keyed to

The host's applied-constraint snapshot carries a url, a tier, a video key and a
language, but the arming block refreshed it only when the url or the tier changed.
On a cold-opened download the file is published one commit BEFORE the dub settles,
under the SAME url, so the language stayed null across that commit and the first
pick compared against null. An else leg now carries a known language forward under
an unchanged url, and never downgrades a known one to null
(`PlaybackHost.tsx:642`).

## Why This Works

Each fix removes a place where a caller could assemble two values that must
agree. The accessor removes the choice at the reader. The nullable field removes
the choice at the parser, because an absent key has exactly one reading. The swap
write removes the choice at the writer. The fallback chain removes it at the
default. The snapshot refresh removes it at the comparison.

The guards fail in the safe direction. When the identity is unknown on either
side, the file plays rather than nothing; only a KNOWN and DIFFERENT dub sends the
viewer to the network (`playerSource.ts:55` to `:59`). That matters because a
download is the offline feature's whole product, and its viewers chose it for poor
connections.

The persisted-schema decision carried the largest blast radius. A version bump
would have voided every stored record on every device, with no warning and no
recovery, to add one field.

## Prevention

- **When two values must agree, do not let a caller assemble them.** Return them
  from one accessor, chosen on one branch.
- **Widen a persisted snapshot with a nullable field, and make null mean the
  previous behaviour.** Enumerate every reader and check the null path at each.
  Reserve a version bump for a change that cannot be read tolerantly, and never
  for a record that points at user data the app cannot re-create.
- **A spread carries the OLD value of every field it does not overwrite.** List
  the request's fields against the spread and confirm each is either rewritten on
  purpose or kept on purpose.
- **Order every default source by how recently the viewer produced it** when a
  screen can remount onto live state. Give the consumer a hold for the window
  where the fresh provider knows nothing, and give the store a merge so a
  half-resolved re-start never downgrades a known value.
- **A snapshot with N fields needs a refresh rule for each field.** A field that
  only the key's own change refreshes is stale on every path where the key does
  not move.
- **A predicate whose axes all arrive from ONE call site needs two pins.** Branch
  coverage of the predicate is not coverage of the behaviour.
  - A shape assertion at the call site, because no behavioural suite reaches the
    wiring. Spell each negative as the revert you fear, not as a generic absence:
    `expect(call).not.toMatch(/offlineDubDocumentId:\s*null/)` in
    `apps/mobile/src/components/watch/__tests__/watchOfflineDubWiring.test.ts`.
  - One fixture per guard that holds every OTHER axis permissive, opened by a
    control proving the permissive shape streams
    (`apps/mobile/src/lib/__tests__/playerSource.test.ts:170` holds the control
    and guards 1 to 3; guards 4 and 5 already had discriminating fixtures
    earlier in the same file). A fixture that leaves a second axis safe passes
    for the wrong reason.
  - Label a fixture SYNTHETIC in place when the call site cannot produce its
    state, and name the producing expression in the label.
- **Measured after the fix** (iPhone 17 Pro Max simulator, 2026-09-23, temporary
  timing logs since reverted): a switch onto the downloaded file resumes at the
  kept position in about 0.2 s; a switch onto a cold stream takes 1.3 to 2.0 s,
  split roughly 0.6 s to accept the source, 0.7 s to load, 0.7 s to rebuffer at
  the seek target. The seek cannot apply before the source loads, so the viewer
  briefly sees the new dub's first frame.

## Related Issues

- [Two predicates for one identity](session-identity-needs-one-slug-tolerant-predicate.md)
  is the direct ancestor, written from the FIRST commit of this same PR. Its fix
  is what makes fault 4 reachable: because the session now survives the remount,
  the fresh provider's null-dub first render became a live path.
- [Occluding layers must share one gate predicate](occluding-layers-must-share-one-gate-predicate.md)
  is the same law one layer up: two readers agree on the happy path and diverge
  exactly where it matters.
- [A nullable language slug read as nothing-selected](mobile-subtitle-nullable-language-slug-silent-failure.md)
  is the sibling shape on the subtitle axis. Note the contrast: there a null meant
  NONE, here a null means UNKNOWN and deliberately keeps the old behaviour.
- [Mocked shape versus real contract](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
  is the META home for the testing rule above. The new dimension is a pure
  predicate with full branch coverage whose single production call site carries no
  pin at all.
- [The strict sequential batch queue](../architecture-patterns/strict-sequential-batch-queue-over-persisted-state-pattern.md)
  documents the swap machinery but not fault 3, so a reader following it alone
  would reimplement the missing write.
- [Card hydration and the hero leak guard](../architecture-patterns/mobile-watch-home-card-hydration-hero-leak-guard.md)
  prescribes bumping the schema version for a persisted snapshot. That rule holds
  for a CACHE, where a failed version gate costs one re-fetch. It is destructive
  here, and the scope limit belongs in that doc.
- `apps/tv` carries no copy of `resolvePlayerSource`, `offlinePlays` or
  `isOfflineContainerSwap` (checked 2026-09-23), so the repo's mobile-and-TV
  predicate-copy rule does not apply to this change.
- Not issue #1979, "English 529 dub for Light0111 contains Arabic audio". That is
  a defect in the media itself, proved with an audio check. This one is an
  app-side source-precedence defect. The two share the phrase "the wrong language
  plays", so a search on that phrasing finds both.
