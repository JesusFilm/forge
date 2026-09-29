---
title: "RAG portal session recovery and section restoration"
type: feat
status: not-started
date: 2026-09-30
---

## Problem Statement

The Forge RAG consumer portal has a fixed two-hour session. An operator can
leave a tab open or keep working in it without being told that the portal
session has expired. The next protected action reveals a Continue with GitHub
button. If GitHub still has an authenticated browser session, clicking the
button often completes the OAuth round trip without asking for credentials.
The operator has spent a click merely to restore portal access, and the
callback opens Consumers regardless of the section they were using. Usage
report dates and other view context can be lost during that navigation.

## Solution

Keep a currently admitted portal session alive while the operator is
genuinely active, with an eight-hour idle expiry and an absolute 24-hour
limit from OAuth sign-in. If the session actually expires, automatically
start the existing GitHub OAuth browser flow for a previously signed-in tab.
After the callback, restore that tab's last selected portal section and its
selected Usage UTC date range. GitHub can still ask for credentials or
consent when necessary. If recovery fails, show a clear fallback in the
portal. Explicit sign-out, removed admission, and service outages must not
trigger automatic sign-in loops.

## User Stories

1. As a portal operator, I want genuine activity to renew my portal session, so that a fixed two-hour deadline does not interrupt work.
2. As a portal operator, I want an eight-hour idle limit, so that an untouched open tab does not stay authorized forever.
3. As a portal operator, I want a fresh OAuth round trip at the 24-hour absolute limit, so that continuous activity cannot extend one portal session without bound.
4. As a portal operator, I want keyboard, pointer, touch, and scroll interaction in a visible tab to count as activity, so that reading and navigating keep my session alive.
5. As a portal operator, I want passive timers and background requests excluded from activity, so that an unattended tab cannot renew itself.
6. As a portal operator returning to an expired tab, I want the portal to begin recovery automatically, so that I do not click a button only to start a quick OAuth round trip.
7. As a portal operator whose session expires during a protected read, I want recovery to begin automatically, so that the page does not remain apparently ready but unable to load data.
8. As a portal operator, I want GitHub's normal sign-in or consent screen when GitHub needs my input, so that recovery is understandable when it cannot complete quickly.
9. As a portal operator on Usage, I want to return to Usage after recovery, so that I do not land on Consumers.
10. As a portal operator on Sources, I want to return to Sources after recovery, so that I can continue inspecting the catalog.
11. As a portal operator on Consumers, RAG, or Knowledge, I want to return to the same section after recovery, so that every portal section behaves consistently.
12. As a portal operator preparing a Usage report, I want my selected UTC date range restored after recovery, so that I do not enter it again.
13. As a portal operator with multiple portal tabs, I want each tab to remember its own section, so that navigating in one tab does not change another tab's return destination.
14. As a portal operator, I want one automatic recovery attempt for an expiry, so that a failed attempt cannot create a redirect loop.
15. As a portal operator, I want a clear retry or sign-in action if automatic recovery fails, so that I know how to proceed.
16. As a portal operator whose Forge admission was removed, I want an access-denied explanation, so that I do not repeatedly pass through GitHub without regaining access.
17. As a portal operator during a GitHub or portal outage, I want an unavailable explanation, so that a service failure is not presented as my sign-in expiring.
18. As a portal operator who intentionally signs out, I want to stay signed out in my open portal tabs, so that automatic recovery does not reverse my choice.
19. As a portal operator saving a one-time API key, I want automatic navigation deferred, so that I can save the unrecoverable value before leaving its dialog.
20. As a portal operator submitting a management change, I want recovery to leave the result explicit, so that creation, rotation, suspension, or revocation is never repeated automatically.
21. As a portal operator, I want remembered view state to exclude credentials and issued keys, so that convenience does not weaken secret handling.
22. As a portal operator, I want session checks to stay lightweight, so that normal portal navigation and page loading remain responsive.
23. As a portal operator on a first visit, I want a normal sign-in action, so that the portal does not unexpectedly redirect me before I have chosen to enter.

## Implementation Decisions

- Scope is the RAG portal session and browser shell. The retrieval bearer path,
  consumer ownership, and source policy are separate concerns.
- Store both idle and absolute expiry in the durable portal session. A
  successful renewal sets the idle expiry to the earlier of eight hours from
  now and the 24-hour absolute expiry. The absolute expiry is fixed at OAuth
  sign-in. Keep the secure HTTP-only cookie expiry aligned with the effective
  server expiry. Existing sessions can keep their original expiry until their
  next sign-in.
- Count genuine user input while the tab is visible. Coalesce activity into
  bounded renewal requests; do not send a request for every event. A focus or
  visibility change may check for expiration but does not by itself keep the
  session alive. Passive polling and data refreshes never renew it. Use the
  server's returned expiry times to schedule detection instead of repeatedly
  polling the GitHub-dependent identity proof.
- Renewal retains the current live merged allowlist, numeric GitHub identity,
  and Forge repository permission checks. It is a no-store, origin-checked
  portal action. The restricted portal-session database role receives only
  the additional privilege required to update its own session rows.
- Distinguish an expired or missing portal session from changed admission and
  a temporary admission-service failure. Start automatic OAuth only for a
  confirmed expiry in a previously signed-in tab. A first visit and an
  intentional sign-out retain deliberate sign-in. Failed OAuth callbacks
  lead to a readable portal fallback, not a raw error or redirect loop.
- Recovery uses the existing top-level GitHub OAuth flow. It may complete
  quickly with an existing GitHub browser session or show GitHub's normal
  interactive sign-in or consent screen. Do not store GitHub OAuth tokens or
  try to run OAuth through a hidden request.
- Keep the last selected portal section in per-tab `sessionStorage`, validate
  it against the known sections, and restore it when `/portal` loads. The
  callback may continue returning to `/portal`; a return destination need
  not be bound into OAuth state for same-tab recovery. Restore the selected
  Usage UTC date range from similarly validated, nonsecret per-tab view state.
  Missing or invalid view state falls back to Consumers and the Usage default.
- Browser storage is permitted only for nonsecret view state and a bounded
  recovery-attempt marker. Never store issued API keys, consumer bearer
  values, portal cookies, OAuth codes or state, corpus text, or management
  mutation payloads. This is a narrow update to the earlier no-browser-storage
  portal convention; one-time key disposal remains unchanged.
- Show a brief restoring state during automatic recovery. Make at most one
  automatic attempt for an expiry, then offer an explicit fallback. Admission
  denial or service outage stops automatic recovery until the operator acts.
- Defer automatic navigation while a management mutation is in flight or a
  one-time API key is displayed. After recovery, reload read-only data where
  appropriate. Never replay a management mutation; retain the established
  uncertain-issuance recovery guidance.
- Explicit sign-out clears recovery intent and informs other open portal
  tabs. Coordinate OAuth starts so simultaneous tabs do not overwrite the
  existing browser-binding cookie or strand one another in a failed callback.
- Keep the shell and static assets free of identity and secrets. Preserve
  no-store responses, CSRF protections, current admission checks, and the
  separation between portal admission and consumer ownership. Update operator
  guidance with the lifetime, recovery, and narrow storage exception.

## Testing Decisions

- Test externally visible behavior, not timer wiring, storage calls, SQL
  statements, or event-handler implementation. A good test observes whether
  an active operator stays signed in, an expired operator recovers without an
  unnecessary click, and the previous section returns.
- Use the existing local HTTPS portal browser journey as the primary seam.
  Its synthetic sign-in and real PostgreSQL sessions can exercise every
  section, Usage range restoration, automatic recovery, the one-attempt
  boundary, manual sign-out, one-time key display, multi-tab behavior,
  mutation non-replay, and the fallback. Keep evidence synthetic and free of
  issued secrets.
- Use the existing portal HTTP test seam for renewal and callback contracts,
  origin checks, and distinct expiry, denial, and outage responses. Pin time
  rather than waiting eight or 24 hours.
- Extend the existing isolated PostgreSQL session integration seam for idle
  renewal, the absolute cap, expiry, revocation, and least-privilege grants.
  The browser journey cannot prove these durable-session invariants.
- Verify that an untouched or hidden tab does not extend expiry, that
  activity requests are coalesced, and that concurrent tabs cannot invalidate
  one another's OAuth state. Explicit sign-out must remain signed out.
- Verify that a one-time key never enters browser storage or test artifacts,
  and that recovery does not repeat create, rotate, suspend, or revoke.
- Because portal initialization and navigation change, compare page-load
  timing and network/resource counts with the existing baseline. Session
  checks must not create a steady stream of live GitHub API calls.

## Out of Scope

- Changing the GitHub identity provider or storing GitHub OAuth access or
  refresh tokens.
- Changing consumer bearer credentials, retrieval authorization, consumer
  ownership, or the portal allowlist policy.
- Automatically replaying a management mutation after recovery.
- Persisting one-time keys, secrets, arbitrary forms, or sensitive report
  data in browser storage.
- Adding a separate sign-in page for the normal expiry path; the failure
  fallback can live in the existing portal shell.
- Direct production deployment outside the reviewed PR-to-main flow.

## Further Notes

The current portal session has a fixed two-hour database and cookie expiry.
The callback always opens `/portal`, and the browser defaults to Consumers.
Protected actions already recheck merged allowlist membership and live Forge
repository permission; renewal must preserve that boundary. The local
browser harness uses synthetic sign-in and real PostgreSQL sessions. The
portal's earlier no-browser-storage guidance is superseded only for the
nonsecret, per-tab view state described above.

The matching roadmap ticket is feat-572. Production changes use the normal
reviewed PR and Railway autodeploy path.
