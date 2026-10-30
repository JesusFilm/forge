---
module: Studio editor
problem_type: ui_bug
tags: [studio, manager, drag-and-drop, media, performance]
date: "2026-10-21"
---

# Media workspace placement and fast native drops

`features/video-studio/media-drag.tsx` owns the editor-local selection being
dragged; browser drag data is a marker, never an asset/source authority. Library
descriptors invoke existing capture only on valid drops. `library-insertion.ts`
resolves tracks against the latest session document after asynchronous capture,
then uses one ordinary edit for validation, undo and autosave. Linked footage
audio is a timeline projection of the video, not a second stored item.

Chrome quick drags can enter a track and release before any `dragover` arrives.
Accept and preview compatible targets on **both dragenter and dragover**. A
dragover-only implementation passed simulated drop tests but failed the native
browser drag: events ended with dragenter, dragleave, dragend and no drop. The
workspace integration suite now asserts placement on dragenter. Clear hover on
leaving the timeline's bounds; native dragleave relatedTarget can be null when
crossing children inside the timeline.

Keep the source browser dynamically mounted only after Media intent, then hidden
between switches to retain selection/search. Pause and unmount the player while
browsing so it does not prepare media invisibly. Keep the workspace allocation
and outer timeline split stable across the deferred mount. Native drag image and
placement marks share the actual timeline clip styles, with blue video and green
linked audio, and remain noninteractive presentation elements.

Verification: feat-869 includes native browser checks and fixture mount-window
resource/CLS evidence. Real source admission remains Admin-owned; decorative
catalog thumbnails do not replace capture or exact download/range selection.

## Library artwork (2026-10-21)

Library artwork initially signed every Mux URL, so environments without a signing
key silently omitted even public thumbnails. A read-only real-catalog probe
returned public thumbnail HTTP 200 while signing failed locally. Keep the public
width/time URL as a fallback; signed-only playback continues to enforce its own
access. Keep a media icon beneath failed images instead of an empty cell.

Retained image cards use the authenticated POST library-image route and existing
digest-verifying asset broker, not direct storage URLs. Visibility-triggered
requests, two concurrent transfers, a 16 MiB limit, and blob revocation keep the
browser from downloading the whole retained library at startup.

## Catalog artwork before sampled frames (2026-10-21)

A successful time-zero Mux image can still be black. Footage browsing should use
the catalog's supplied `Video.images.thumbnail`, then `videoStill`, then `url`,
with Mux only as a missing-artwork fallback. `getVideosForEnrichment(ids, true)`
opts into an existing bounded `watchHomeVideos(coreIds)` artwork query after
metadata lookup; ordinary consumers keep their existing projection. Keep timeline
filmstrip frames sampled from the actual source. A live catalog thumbnail returned
HTTP 200 image/jpeg without modifying Admin schema or waiting for a deployment.

## Multi-result artwork and GraphQL rate limiting

Do not alias one `video(id)` root field per search result. The query-field limiter
charges those aliases independently, so one successful single-video test does not
prove the multi-result path. A 19-video hope query failed with rate-limit errors,
and the artwork soft-failure handler turned that into apparently valid cards
without images. Use one `watchHomeVideos(coreIds)` batch after the canonical
metadata lookup, bounded to 100 unique IDs. Catch artwork failures separately so
playback metadata remains available for the Mux fallback. The batch returned
images for all 19 matches and all 19 image URLs returned 200.

## Search presentation

Keep loading placeholders within the existing card grid rather than replacing
search with a text-only row. Skeletons are decorative and respect reduced motion;
empty results render only after loading completes and without an active error.
Clear search resets the query/loading state and focuses the persistent search
input. Count displayable assets, not all retained asset roles, for asset emptiness.

## Shared asset categories

Filter retained media by MIME prefix, not role: background/source/render roles
are not media types. Keep category switching local to the existing asset response
and clear selected assets on switch. `LibraryImage` receives references only;
the thumbnail endpoint authorizes retained media and returns images or generated
video stills. Never insert a retained video as an image timeline item.
Timeline videos require a captured `studioSourceSchema` with catalog identities
and exact preview/export references. Shared video browsing alone does not create
that source authority.

The unified Media sidebar entry maps to either the catalog or retained-asset
request branch. JFP activates catalog search; Videos, Images and Audio share one
asset query. A category switch between retained types must not reset the request
state or trigger a refetch. The active Media navigation state covers both branches.

## Uploading into the library

External file drops use the native `Files` transfer type; internal media drags keep
their timeline placement descriptor. Share one upload handler between the viewport
drop target and the hidden multiple-file chooser. Retaining a file adds it to the
library, not the timeline. Keep newly uploaded references alongside fetched results
and deduplicate by version ID, so a paginated refresh cannot hide a new upload.
Validate type and the route’s 16 MiB limit before sending bytes, serialize batch
uploads, and report failures without losing successful files.

## Retained video thumbnails

Video cards initially rendered only a film icon and filename. The existing
library-image endpoint now also accepts bounded video MIME types, obtains
verified bytes through the broker, and generates a JPEG using local FFmpeg.
Decode local bytes only, downscale before frame sampling, bound input/output,
threads and timeout, and authorize before checking the digest cache. Reuse the
visibility/concurrency/blob lifecycle of LibraryImage. Prefer a recorded title
when supplied; a retained filename alone cannot reveal a JFP catalog title.

Video library captions show duration, not the internal source/background role.
Use catalog or recorded duration first; for uploaded files without recorded
length, carry the decoder’s input duration on the existing still response header.
Keep the callback separate from thumbnail effect dependencies to avoid reloading
images when a duration update rerenders a card. Omit zero minute/second units.

## Viewport file drops

Capture external Files events on window so drops over Preview, timeline, navigation
and portals cannot navigate the browser or trigger a second local upload. Ignore
internal timeline transfer types. Keep the overlay pointer-transparent and fixed;
use a translucent backdrop and solid message panel without shifting the editor.
Only an actual drop opens the lazy Media workspace. Queue files in the editor
until Library mounts and finishes any active batch, then acknowledge consumed
files. Reset drag depth on drop, Escape, drag end and blur; remove all listeners
on unmount. Read-only editors prevent file navigation without accepting uploads.
