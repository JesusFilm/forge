# Native A default and TV beta distribution

## Scope

Make AVKit Native A the Apple TV default before the next TestFlight build. Keep Native B and the existing React player selectable. Migrate legacy stored `existing` values that predate this default change; preserve deliberate player selections made after the new build. Leave Android's native default unchanged.

Build the committed TV branch for tvOS and Android TV. Upload tvOS with Apple's `altool` as `appletvos`, never `eas submit`; upload Android only to Google Play internal testing. Verify each upload and tester availability separately. Do not promote either platform to production.

## Verification

Run preference and player-selection tests, TypeScript, lint, and TV-focused build checks. Inspect the built tvOS bundle and Android manifest, validate the tvOS IPA before upload, then check App Store Connect/TestFlight and the Play internal track for the exact new versions. Confirm feedback-server version allowlists before claiming QR feedback works in those builds.
