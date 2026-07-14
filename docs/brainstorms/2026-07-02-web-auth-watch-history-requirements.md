---
date: 2026-07-02
topic: web-auth-watch-history
---

# Web Auth and Watch Events

## Problem Frame

The public web watch experience currently stays anonymous by default. Jesus Film
Auth is already available at `auth.jesusfilm.org`, and `apps/web` can verify
Auth sessions for the completed download gate, but Web does not yet have a
general signed-in state that feels like part of the product. Users should be
able to sign in optionally and get an immediate personal benefit without making
the public watch experience feel locked down.

The first signed-in product value should be identity continuity: Web can know
when a viewer is signed in and can attach meaningful viewing activity to real
video records. This creates the foundation for future personalization,
analytics, and content-pathway modeling without making visible watch history,
saved lists, recommendations, profiles, or full account preferences part of the
first slice.

## Requirements

**Authentication Experience**

- R1. Public Web must offer an optional "Sign in" path backed by Jesus Film
  Auth at `auth.jesusfilm.org`.
- R2. Signing in must use Auth as the identity authority and establish
  Web-local authenticated state for `apps/web`; Web must not depend on shared
  `.jesusfilm.org` cookies.
- R3. The sign-in flow must be conceptually similar to Admin's Auth relying
  client flow: redirect to Auth, return to Web, verify the identity result, and
  store only Web-local session state.
- R4. Anonymous use must remain first-class. Users can browse, search, watch,
  and share without signing in unless an existing feature explicitly requires an
  account, such as the download gate when enabled.
- R5. Signed-out users should see a clear but non-blocking sign-in affordance
  from the watch experience, not only after attempting a gated download.
- R6. Signed-in users should see a small account affordance that confirms their
  signed-in state and provides a sign-out action.

**Watch Events**

- R7. Watch-event collection is the first v1 capability unlocked by sign-in.
- R8. Web should record meaningful authenticated viewing activity against
  canonical Admin video records. Anonymous event buffering/linking may be
  planned separately, but must not be required to ship the first signed-in path.
- R9. Events should be based on meaningful viewing activity, not merely page
  load. A brief accidental visit should not create a durable watch event.
- R10. Events should preserve enough context for future product and analytics
  work: Auth subject, video identity, language/variant context, event type,
  occurred-at time, playback position when available, and enough ordering data
  to reconstruct sequences.
- R11. The v1 Web UI should not expose a visible watch-history surface.
- R12. The implementation should keep future uses open, including
  personalization, aggregate viewing analytics, and sequence/pathway modeling.
  Markov-chain analysis is one possible downstream use, not the feature's
  primary requirement.
- R13. Any future user-facing history, recommendations, or analytics products
  should be separate roadmap items.

**Privacy and Trust**

- R14. Watch events must be treated as user data. Do not expose them publicly,
  include it in SEO output, or log raw per-user viewing history in normal
  request logs.
- R15. The sign-in experience and privacy copy should not imply that visible
  watch history exists in v1.
- R16. Signing out should stop authenticated watch-event writes on that browser.
  Existing server-side events may remain according to the product's analytics
  retention policy.
- R17. The implementation must avoid storing raw bearer tokens, Auth cookies, or
  unnecessary identity claims in Web watch-event records.

**Download Gate Migration**

- R18. The completed account-gated download flow must migrate to the new
  Web-local Auth session as its primary signed-in check.
- R19. A signed-in Web session should satisfy the download gate: after
  authenticating through the new Web sign-in path, users should not be asked to
  sign in again immediately to download unless the Web session is invalid or
  the feature flag state requires it.
- R20. The existing same-origin download proxy, opaque download target lookup,
  SSRF defenses, Terms of Use flow, and LaunchDarkly rollout behavior must not
  be weakened by the new account surface.

## Success Criteria

- A signed-out visitor can continue using the public watch experience normally.
- A visitor can choose to sign in, authenticate with Jesus Film Auth, return to
  the same Web context, and see signed-in state.
- A signed-in user who watches a video long enough to count as meaningful
  viewing creates a durable watch event tied to the canonical Admin video
  record.
- No visible watch-history surface appears in v1.
- The download gate uses the new Web-local Auth session as the primary
  authenticated state and still preserves its current security expectations.
- No user-specific watch-event data appears in public metadata, anonymous page
  output, normal logs, or browser-visible server secrets.

## Scope Boundaries

- Do not make sign-in required for normal browsing, searching, watching, or
  sharing.
- Do not build saved videos, playlists, recommendations, account profiles,
  parental controls, or notification preferences in this slice.
- Do not build a visible watch-history page, menu entry, or recently watched
  surface in this slice.
- Do not add Admin, Manager, editorial, partner, or staff authorization to
  public Web.
- Do not use shared parent-domain cookies as the Web session mechanism.
- Do not import Auth internals into `apps/web` or Web internals into
  `apps/auth`.
- Do not redesign the full homepage or watch-page information architecture for
  this slice.

## Key Decisions

- **Identity plus event foundation first:** Auth should unlock useful product
  infrastructure, but v1 should stay smaller than user-facing history, saved
  lists, or recommendations.
- **Anonymous remains the default posture:** The public watch experience should
  feel open; authentication adds continuity rather than becoming a wall.
- **Web-local relying-client session:** Admin's no-shared-cookie Auth posture is
  the right model for Web too. Existing download-gate cookie verification is a
  narrow compatibility path, not the long-term general account model.
- **No watch-history UI in v1:** The visible product surface is sign-in,
  signed-in state, and sign-out. Durable watch events are collected server-side
  for future product and analytics work.

## Dependencies / Assumptions

- `apps/auth` can register a Web OAuth/OIDC client for local, preview, staging,
  and production callback URLs.
- The completed Web download gate in
  `docs/roadmap/platform/feat-146-web-user-accounts-download-gate.md` is the
  security baseline for download behavior, but its narrow Auth-cookie session
  check should be replaced by the new Web-local Auth session path.
- Planning must verify the best persistence owner for watch events. The
  requirement is durable viewing activity tied to canonical videos; the storage
  location is an implementation decision.

## Outstanding Questions

### Deferred to Planning

- [Affects R7-R13][Technical] Which service owns durable watch-event
  persistence for v1: Web-local storage, Admin GraphQL, Auth-adjacent user data,
  or another existing service boundary?
- [Affects R9][Product/technical] What exact playback threshold counts as
  meaningful viewing for a watch-event write?
- [Affects R10][Technical] How much playback-position precision should be stored,
  and how frequently should updates be written without creating noisy write
  volume?
- [Affects R5-R6][Design] Where should the sign-in/account affordance live in
  the current watch UI?

## Next Steps

-> `/ce:plan` for structured implementation planning.
