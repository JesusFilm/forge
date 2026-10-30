# Google TV Home integration

This Android-only Expo module uses `com.google.android.engage:engage-tv:1.1.0`.
Native and React playback remain unchanged. This is not a custom launcher layout.

## Enabled behavior

- Settings → Google TV Home offers adult-only, explicit same-device Continue Watching.
- Nothing is published on first app launch. Home caches already-loaded catalogue metadata;
  it does not fetch another catalogue or wait for publishing before rendering.
- After enabling, foreground Home refreshes reconcile the local Continue Watching store.
  Only known feature/short films with valid artwork, duration and unfinished progress
  are eligible. Episodes without typed episode metadata are skipped rather than mislabeled.
- Recent entries are deduplicated and capped at five; completed, stale and malformed
  entries are excluded. Sync is false and no account identity is fabricated.
- Turning off stops publishing immediately. Failed removal remains pending and retries
  on a later foreground Home refresh. No automatic retry timer changes launcher focus.
- Discovery persists a shuffled bag of eligible themes (Spotlight, Collection,
  Hope, Journey), visiting each before refilling and avoiding a boundary repeat
  where another theme exists. The selected theme stays stable for 24 hours.
  Continue Watching is independent and never shuffled.
- Discovery preview fetches `fetchForYou` using the saved audio language when
  recommendation support is enabled. The service's returned ranking is preserved
  within themes; only public title, description, artwork, slug and duration reach
  the SDK. Capabilities and identity/session tokens never enter the publisher.
  Current catalogue records supply media-kind validation, not replacement picks:
  unknown kinds are skipped because Engage movie entities must not mislabel episodes.
  Transport failure or empty recommendations does not substitute editorial Home picks.

## Production gate

Production discovery is deliberately blocked in JavaScript and Kotlin. Profile is
disabled in this release, so there is no approved adult account identity to submit.
Do not replace that gap with an installation UUID. Google partner onboarding and
recommendation/continuation availability are separate checks.

Discovery preview is available only in a verification build. It uses a fixed test-only
identity and real recommendation metadata, never viewing progress. `GOOGLE_TV_ENGAGE_TESTING=1`
selects the verification release manifest; normal release declares production.
The native module also rate-limits accepted discovery publications to once per 24 hours.

## Integration and validation

Call `syncGoogleTvHome(model, entries)` when foreground Home has refreshed catalogue and
local progress. It reloads progress through the storage lock to avoid stale entry races.
Expose `/google-tv-home` from Android TV Settings only. Expo local-module autolinking
requires a new Android binary; an OTA JavaScript update cannot add the SDK.

Source tests cover eligibility, dimensions, stable selection, no-repeat, consent,
pending removal, production blocking and verifier separation. SDK method signatures
were checked against the published 1.1.0 AAR. Native Kotlin compilation and an
arm64 Debug APK build passed on October 2. On October 5, an ARM32/ARM64 Debug build
was installed as `org.jesusfilm.tv.homesdkqa` (Watch Home QA) on a USB-connected
Chromecast running Android 14. The installed Play beta remains unchanged because
its signing certificate differs from the local Debug certificate.

The native service reported availability, and Google's verifier accepted a JESUS
recommendation and a separate Continue Watching entity with zero entity/cluster
errors. Selecting the recommendation opened JESUS playback. Initial verifier errors
required a genre and availability despite the TV recommendations guide describing
genres as optional. Entities now carry Watch's existing broad `Faith & Scripture`
catalogue category and `AVAILABILITY_AVAILABLE` for its freely playable films; no
film-specific genres or release dates are fabricated.

Bundled ARM32/ARM64 Release QA also passed cold JESUS autoplay at saved 4:18. A hot
external Play link to the same paused video initially left playback consumed and
could show a black frame. The watch route now rearms validated same-video external
Play requests; the rebuilt release-mode QA resumed 5:19 with visible progressing
video and Play/Pause focus. Player layouts and publisher URI contracts are unchanged.

Real launcher placement and approved-package/certificate feedback submission remain
independent release gates. Verification-app acceptance does not prove production
Home display. The local release-mode QA uses local signing and the verification
manifest, not production signing or a Play-uploadable release.

Test no-service, offline, revoke, empty history, completion and background behavior.
Do not publish production credentials, infer adult status from sign-in, or re-enable
Profile as part of this feature. No app store submission is included.

References:

- https://developer.android.com/guide/playcore/engage/tv/getting-started
- https://developer.android.com/guide/playcore/engage/tv/recommendations
- https://developer.android.com/guide/playcore/engage/tv/continue-watching/client
- https://developer.android.com/guide/playcore/engage/faq
