---
date: 2026-07-29
topic: tv-auth-releasable
---

# Making TV Sign-In (feat-322) Releasable

## Problem Frame

PR #1785 shipped the complete on-TV sign-in/profile experience (QR + user code +
profile screen) dark behind a flag, with the grant stubbed: scanning the QR
today lands on a 404 because `auth.jesusfilm.org` has no device-authorization
endpoint. Viewers cannot actually sign in. This document captures the product
decisions that turn the scaffolding into a releasable feature, so planning can
start without inventing behavior. The implementation map (files, routes,
constraints) already lives in `docs/roadmap/platform/feat-322-tv-auth-sign-in-profile.md`
and is deliberately not duplicated here.

## Requirements

- R1. A viewer signs in on Apple TV / Android TV by scanning the on-screen QR
  with their phone (or typing the short code at the shown address). No
  credentials are ever typed on the TV.
- R2. The phone-side page is the existing Jesus Film sign-in (Google, Facebook,
  Apple, email/password), shows the TV's code pre-filled, and supports brand-new
  account creation in the same visit.
- R3. After phone approval, the TV lands on the signed-in Profile (name, email,
  sign out) within one polling interval, without the viewer touching the remote.
- R4. The signed-in session survives app relaunches and TV restarts, and stays
  valid for living-room-scale lifetimes (weeks, not hours), until the viewer
  signs out.
- R5. Sign out on the TV takes effect immediately on that device.
- R6. The "Approve on this device (demo)" stub is removed in the same change
  that enables the real grant; expired codes surface a "code expired — get a new
  one" state rather than silently hanging.
- R7. The release is staged: the surface stays hidden in public builds until
  the flow has passed real-hardware testing via TestFlight / internal preview
  builds; only then is it enabled in production builds.
- R8. No personal data (email, name, user code) appears in telemetry — the TV
  app's zero-PII posture holds after accounts exist.

## Success Criteria

- A tester with no coaching completes scan → approve → signed-in on real
  Apple TV and Android TV hardware with their own phone.
- The session survives force-quit, relaunch, and a TV reboot.
- Admin's introspection accepts the TV token (verified in logs with the TV
  client id) — proving the token is a first-class citizen of the platform, not
  a special case.
- Datadog shows no PII in any RUM action name or log for the new surface.

## Scope Boundaries

- No resume / continue-watching / watch-history surface on TV in this slice
  (the 2026-07-02 brainstorm's exclusion stands; it becomes the natural
  fast-follow once accounts exist).
- No playlists, saved videos, notifications, parental controls, or profile
  editing (feat-229 v1 exclusions carry over).
- No typed email/password entry on the TV — the letters-only keyboard gap is
  deliberately not being closed.
- No end-user read path in admin GraphQL in this slice; profile data comes from
  the identity provider's userinfo endpoint.

## Key Decisions

- **V1 = sign-in + profile only**: ship the account foundation first; the
  payoff feature (resume) is a separate follow-up slice. Keeps the server
  surface minimal and matches the roadmap's existing exclusions.
- **Propose Route A to the auth-platform owner**: enable better-auth's shipped
  RFC 8628 device plugin and add a small token-translation exchange in
  `apps/auth`, rather than building a device grant inside the oauth-provider
  layer (Route B). Rationale: reuses tested plugin semantics; the custom
  surface is one contained endpoint. The owner (tataihono, feat-121) makes the
  final call.
- **TestFlight-first staged rollout**: dark merge now → preview/TestFlight
  builds with the flag on for internal + stakeholder hardware testing →
  production build with the flag on. Accepted trade-off: the flag is build-time
  (`EXPO_PUBLIC_*`), so enabling/disabling is a rebuild, not an instant switch.

## Dependencies / Assumptions

- Blocking: auth-platform owner sign-off on the server route (proposal is ready
  in feat-322's ticket).
- `apps/auth` schema migration + deploy, TV client registration, and admin's
  client-id allowlist update all precede any TV-side end-to-end test.
- Secure token storage on TV is a new dependency (`expo-secure-store`) and
  requires a prebuild — plan it as part of the TV slice, not an afterthought.

## Outstanding Questions

### Resolve Before Planning

- [Affects R1–R4][Owner decision] Route A vs B sign-off from tataihono
  (feat-121). Server-side planning cannot start until this lands.

### Deferred to Planning

- [Affects R4][Needs research] Whether a newer `better-auth` /
  `@better-auth/oauth-provider` release already composes the device grant with
  introspectable tokens — would collapse Route A's translation step into
  configuration.
- [Affects R4][Technical] Token/refresh TTLs appropriate for a living-room
  device under `offline_access`, and the refresh-failure UX (silent re-auth vs
  signed-out state).
- [Affects R7][Technical] Whether Android TV internal-testing distribution can
  run on the same cadence as TestFlight or needs its own track timing.

## Next Steps

→ Blocked on the Route A/B sign-off. Immediate actionable step: send the
Route A proposal (feat-322 ticket) to tataihono. Once signed off →
`/ce:plan` for the server + TV implementation slices.
