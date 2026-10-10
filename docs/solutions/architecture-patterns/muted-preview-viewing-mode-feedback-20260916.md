---
title: "Treat visible muted previews as viewing-mode feedback"
date: "2026-09-16"
module: "Watch recommendation profiles"
problem_type: "integration_issue"
component: "service_object"
symptoms:
  - "Selected videos can be watched in a muted preview without manual-play facts"
  - "Sticky video remains in the viewport after body content covers it"
root_cause: "missing_workflow_step"
resolution_type: "code_fix"
severity: "high"
tags: [recommendations, playback, profiles, muted-preview, privacy, ranking]
---

# Visible preview viewing is a separate behavioral signal

## Decision

Keep preview first. Sustained visible playback with sound off is a proper viewing
signal, with the same qualification requirements as sound-on viewing. A manual
activation is a different observation. An immediate departure remains unknown
preference; missing playback telemetry cannot establish that nothing was watched.

## Implementation boundaries

- `apps/web/src/lib/viewing-mode-recorder.ts` measures monotonic elapsed time
  backed by media progress. It excludes paused, covered, hidden, buffering and
  seeking periods, splits mode/activation/rate changes, and rejects sample gaps
  over five seconds. Preserve the interval's actual end timestamp when flushing
  later; timestamping an old interval at flush time corrupts overlap accounting.
- `HeroPlayer.tsx` reuses body-overlap geometry, with at least half of the actual
  hero visible. IntersectionObserver alone cannot detect a body panel painting
  over a sticky player. No new continuous polling or scroll listener is required.
- The player exposes seeking events rather than a typed `seeking` property.
  Track seeking and buffering through events and verify against the installed
  player types. A preview media error must be recorded even without manual play.
- Automatic profile initialization precedes standalone episode issuance through
  a bounded wait outside the existing identity lock. This prevents a first-visit
  race without adding a prompt or delaying playback. Failure still allows
  anonymous evidence. Selected-video claims retain the existing episode.
- `viewing-mode.ts` unions wall-clock and media-progress ranges. Repeated loops
  may represent real elapsed time but cannot create extra unique progress,
  independent viewers, or repeated profile votes. Database projections pass only
  event contract fields to the strict parser, excluding database-only columns.

## Versioned initial policy

`sound-off-viewing-v1` qualifies a mode after elapsed visible-playing time
reaches `min(30, max(5, duration * 0.25))` seconds and unique progress reaches
the smaller of that threshold and the full video duration. Even clips shorter
than five seconds need at least five seconds of visible playback; a brief pass
over a tiny autoplay clip must not become a profile preference.
Unknown duration requires 30 seconds. Each distinct video contributes at most
one profile vote; confidence reaches one after three qualified distinct videos.
Muted preview and activated playback use the same threshold.

`viewing-mode-affinity-v1` augments the existing relevant candidate pool before
composition. A sound-off preference above one half can supply at most a 5%
score contribution. Per-video evidence requires 20 other current profiles with
at least three seconds of observable sound-off playback, one recent vote per
profile, and uses a smoothed qualification rate. Immediate sub-three-second
exits do not enter that denominator. Technical failures, late facts, conflicts,
quarantined replay and promotion fences exclude affected episodes.

This is an initial behavioral proxy, not a calibrated causal claim about audio
suitability. It does not infer suitability from popularity, fabricate content
labels, relax locale/audio eligibility, or add unrelated videos. Sparse data
preserves ordinary ranking. Data currently pools mode engagement by video; it
does not distinguish caption settings. The policy and sample thresholds must be
evaluated with mature real traffic before claiming recommendation uplift.

## Storage, privacy and operations

`recommendation_viewing_mode_evidence` is an Admin-owned private profile facet,
one row per episode. It is derived from at most 128 immutable facts (32 mode
facts), carries the policy version and fact watermark, and expires with the
source episode under the existing 29-day raw-evidence policy. Episode/profile
deletion cascades; reset, withdrawal, deletion and expiry erase the generation's
mode influence through `profiles/privacy.ts`.

Publication takes a profile row share lock in the episode's serializable
transaction. Only a current session bridge established before the episode can
bind the facet. A new profile after reset cannot adopt an old episode. Serving
rechecks the current generation and takes the same row lock before committing a
mode-ranked delivery. Immutable request evidence contains bounded decision
provenance for authorized trace diagnostics, never profile tokens or profile IDs.

Serving reads at most 128 profile episodes and 512 recent episodes per candidate,
for at most 64 candidate IDs, then applies integrity filters. The extra lookup
has a 150ms subdeadline within the existing delivery deadline. Failure preserves
ordinary relevance. `RECOMMENDATION_VIEWING_MODE_ENABLED=false` disables mode
projection and ranking while preserving playback, immutable facts, profile
erasure and other recommendations. Deploy changes through normal PR/main flow.

## Regression evidence

Pure tests cover mode parity, unknown data, loop/overlap deduplication, short
media and per-video profile votes. Production-adapter PostgreSQL tests carry
accepted preview facts through the profile facet into candidate engagement,
exercise sparse data, conflicting replay, withdrawal, reset and concurrent
deletion. Delivery tests verify actual changed selection and request provenance.
React tests verify no invented manual play, scroll exclusion, sound changes and
preview errors. Browser fixtures use real media events and the production
recorder, with a synthetic episode service; they are not full Watch-page or
production evidence. Release validation records their measured loading cost.

Related: `docs/plans/2026-09-16-002-feat-recommendation-quality-followthrough-plan.md`;
`docs/roadmap/content-discovery/feat-512-sound-off-viewing-profile-retrieval.md`.

## Open tabs and strict response enums

An additive server enum can break an already-open client that strictly validates
it. During rollout, inspect the previous client parser as well as the current
schema. The Web BFF uses `x-forge-recommendation-client: viewing-mode-v1` to retain
the new mode explanation only for clients that understand it; older clients get
unchanged cards and capabilities with optional personalization metadata omitted.
The authoritative Admin execution decision remains intact. Do not disguise mode
fit as a legacy topic-interest mode to make parsing succeed.

New curated inventory has a new required source discriminator and needs a fresh
client. Older tabs retain their prior empty-row behavior until reload. Test both
missing and unknown client versions, and prove that modern metadata and existing
attribution survive the compatibility branch.

## Production follow-through

The September 16 real Watch journey retained 41.237 seconds of qualified muted
preview and then 15.094 seconds of sound-on playback in one episode. A recommended
destination retained attributed qualified muted preview without a manual start.
Covering the sticky hero stopped observation credit. Deleting the owned synthetic
profile removed its mode facets while immutable playback facts remained.

Keep behavioral proof separate from usefulness and rollout health: the first
15-minute window recovered five empty rows with 30 curated cards, but also had
nine upstream-timeout 503s and higher retrieval latency than baseline. No video
had sufficient independent sound-off evidence for the new boost. Use the
[release report](../../operations/recommendation-quality-release-2026-09-16.md)
for final revisions, subsequent windows, loading measurements and remaining gates.
