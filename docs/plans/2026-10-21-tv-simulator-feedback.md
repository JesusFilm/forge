# TV simulator feedback and local receiving server

## Scope

Implement opt-in feedback QR testing on the Apple TV simulator and Android TV
emulator. Reuse the existing feedback form in `apps/tv-feedback`; receive test
reports and selected attachments on the Mac. Add an explicit optional delivery
step to the existing TV Beta Feedback Linear project. Live Linear test delivery
awaits the user's answer; local implementation and tests can proceed.

Branch: `codex/tv-feedback-simulator`, based on main `4fe360bf6`.
Roadmap: `docs/roadmap/platform/feat-756-tv-simulator-feedback.md`.

## Hosted signed-link extension

The owner subsequently requested signed simulator links on the existing feedback
staging service, `https://web-staging-920a.up.railway.app`, so phones can use any
network. The owner also removed simulator test-report/QR daily quotas. Normal
verified-device quotas remain unchanged; per-upload size/content validation,
per-report bounds, token expiry and idempotency still apply.

- New `/tv/simulator#token=...` entry, with a dedicated Ed25519 signing key held
  in the developer's macOS Keychain and only its public key on staging.
- Compact JWT: pinned `EdDSA`, `typ: JWT`, `kid` = first 16 lowercase hex digits
  of SHA-256(SPKI DER); issuer `forge-tv-simulator`; exact origin audience; scope
  `tv-feedback:simulator`; `iat`, `exp`, UUID `jti`. Default lifetime one hour,
  maximum two hours, at most 60 seconds of future clock skew, no expiry grace.
- The token is exchanged from the fragment by a same-origin POST. Each claim
  creates an independent single-report session; the link can be rescanned until
  expiry. Only server-verified grants receive the simulator source marker.
- The server labels simulator reports regardless of client-supplied context.
- Verify the exact Railway project, service and staging environment before
  deployment. Use reviewed source and preserve existing deployed credentials.
- The approved real local-to-Linear test created `TV-7` with its annotated photo.
  Do not create additional live test issues without separate authorization.

## Boundaries

- Keep the normal native attestation, server grants and release URL policy.
- Simulator QR requires explicit opt-in, a development bundle and a native-confirmed
  simulator/emulator. Release and physical-device paths cannot use it.
- Use separate local endpoints, storage and honest local receipts. Do not write
  simulated values into the normal verified-grant cache.
- Local routes require explicit development configuration, enforce request
  origin/ownership, bound uploads and retain retry/idempotency guarantees.
- Keep Linear credentials on the server. Report local save and confirmed Linear
  delivery separately. Never automatically retry an ambiguous issue creation.
- Only the explicitly selected feedback staging service is in deployment scope.
  Do not rebuild store artifacts, change EAS profiles or production
  configuration, or test production content APIs.
- Preserve existing simulator data, main checkout and all prior evidence.

## Verification

1. Focused checks for the TV mode gates, local URL handling, native development
   guards, release exclusion and unchanged normal QR behavior.
2. Feedback server tests for local report/attachment persistence, invalid input,
   cross-session access, duplicate retries, size limits and disabled routes in
   production; test Linear delivery via isolated mocks until authorized.
3. TV and feedback typecheck, lint, tests and required production build checks.
4. Build and run on explicit Apple TV 4K and Android TV emulator targets. Open
   Feedback, inspect and decode the actual rendered QR, follow its local URL,
   test photo/annotation/submission and Back/focus. Record artifacts and timing.
5. Review source and generated Release configuration to prove local mode stays
   disabled even with the public switch set. Store builds remain unchanged.

## Progress

Implementation in progress. Runtime targets, commands and evidence will be
recorded in the development harness and final local verification record.
