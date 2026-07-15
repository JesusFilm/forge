# Mobile Datadog data-governance & PII posture (R43)

**Date:** 2026-07-14 (revised 2026-07-15) · **Feature:** feat mobile Datadog observability (plan `docs/plans/2026-07-14-001-feat-mobile-datadog-observability-plan.md`, U11) · **Service:** `forge-mobile`

This is the R43 deliverable the plan's Definition of Done requires: a named
retention/deletion window plus a written re-identification assessment. **Production
Datadog credential provisioning must not proceed until this is signed off.**

> **Revision 2026-07-15 (PR #1573).** The original posture logged the **raw typed
> search term** for diagnostic value (the "rich posture", R2/R42). On review
> against the web app's precedent, the raw term was **dropped** so mobile is
> **strictly no-more-PII-than web on every axis** (see the comparison below). The
> raw-query re-identification vector that dominated the original assessment is
> therefore **eliminated**, not merely accepted.

## What the mobile app logs

- **Search analytics** (`watch_search` / `watch_search_failed`): outcome, result
  count, latency, `request_type`, and a bounded `search_request_id` — **not the
  raw query the user typed**. A clicked result's public title/slug is content, not
  user input.
- **Content** titles + ids/slugs (`content_id`, resolution + QoE events) — public
  catalog metadata, identical to what web logs.
- Standard RUM: a pseudonymous `viewer_id` (random per-install UUID — **not** an
  account or email; mobile is anonymous), session id, device model, OS version,
  and the IP Datadog derives coarse geo from.

Session Replay uses `textAndInputPrivacyLevel: MASK_ALL_INPUTS`, so any text input
(the search field) is blanked in the visual replay. The native video texture is
not capturable by replay, so playback frames never leak.

## Web comparison (the precedent this posture matches)

Verified against `apps/web/src/components/DatadogRum.tsx`,
`apps/web/src/lib/watch-search-rum.ts`, `apps/web/src/components/watch/AccountControl.tsx`.

| Axis                 | Web (`forge-web`)                                         | Mobile (`forge-mobile`)                             |
| -------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| Raw search term      | Not logged (result title/slug + `search_request_id` only) | **Not logged** (same fields)                        |
| User identity        | `setUser({ id, email, name })` for signed-in users        | Random per-install UUID only — **no email/account** |
| Replay input masking | `mask-user-input`                                         | `MASK_ALL_INPUTS`                                   |
| Content titles/slugs | `result_title` (≤160 chars) + slug                        | content titles + `content_id`                       |

Mobile is **≤ web on every axis, and strictly stricter on identity** (web attaches
the account email for authenticated users; mobile has no accounts, so it never can).

## Retention / deletion window (committed policy)

| Data                | Store                             | Retention                                        | Deletion                                                   |
| ------------------- | --------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| `forge-mobile` Logs | Datadog Logs index `forge-mobile` | **15 days**, then auto-purged by index retention | Retention expiry; ad-hoc via Datadog data-deletion request |
| RUM events          | Datadog RUM                       | **30 days** (RUM default), then auto-purged      | Retention expiry                                           |
| Session Replay      | Datadog RUM Replay                | **30 days**; inputs masked at capture            | Retention expiry                                           |

These are the values the operator must set on the `forge-mobile` Datadog org
before flipping production. No long-term cold store.

## Re-identification assessment

**Vector (post-revision).** With the raw query dropped, mobile logs **no
user-authored free text**. The remaining fields are pseudonymous (`viewer_id`),
coarse (city-level geo, low-cardinality device model), or public (content
titles/slugs). There is **no join key from Datadog back to a person**: `viewer_id`
is a random per-install UUID, no email/account/user-id is attached to any session,
and inputs are masked in replay.

**Residual risk: minimal, and bounded below web's.** The only free-text vector
(the raw query) is gone; what remains is the same pseudonymous + public data web
already collects, minus web's authenticated-user email. Bounded 15/30-day
retention caps any exposure.

**If mobile gains authenticated accounts** and starts attaching a user identity
(as web does), revisit this assessment before doing so — that would reintroduce
the identity axis this posture currently avoids entirely.

## Sign-off gate

Per the plan DoD, production `forge-mobile` credential provisioning is blocked
until an owner accepts this assessment and sets the retention values above. Given
mobile is now ≤ web on every PII axis and stricter on identity, this is an
alignment-to-existing-precedent decision, not a net-new privacy expansion.

<!-- Signed off: <name>, <date> -->
