# Mobile Datadog rich-posture data governance (R43)

**Date:** 2026-07-14 · **Feature:** feat mobile Datadog observability (plan `docs/plans/2026-07-14-001-feat-mobile-datadog-observability-plan.md`, U11) · **Service:** `forge-mobile`

This is the R43 deliverable the plan's Definition of Done requires: a named
retention/deletion window plus a written re-identification assessment of the
free text the mobile app logs. **Production Datadog credential provisioning must
not proceed until this is signed off.**

## What the mobile app logs (rich posture, R2 / R42)

Unlike the TV app (PII-free), mobile deliberately logs **raw free text** for
diagnostic value:

- Raw **search terms** (`watch_search` / `watch_search_failed`, `term` field)
- Content **titles and ids/slugs** (`content_id`, resolution + QoE events)

Everything else is standard RUM telemetry: a pseudonymous `viewer_id` (random
per-install UUID — **not** an account or email; mobile is anonymous), session
id, device model, OS version, and the IP Datadog derives coarse geo from.

Session Replay is enabled with `textAndInputPrivacyLevel: MASK_ALL_INPUTS`, so
the search field is **blanked in the visual replay** even though the term is
logged as a Log/RUM attribute. The native video texture is not capturable by
replay, so playback frames never leak.

## Retention / deletion window (committed policy)

| Data                               | Store                             | Retention                                        | Deletion                                                   |
| ---------------------------------- | --------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| `watch_search` term-bearing Logs   | Datadog Logs index `forge-mobile` | **15 days**, then auto-purged by index retention | Retention expiry; ad-hoc via Datadog data-deletion request |
| RUM events (term/title attributes) | Datadog RUM                       | **30 days** (RUM default), then auto-purged      | Retention expiry                                           |
| Session Replay                     | Datadog RUM Replay                | **30 days**; inputs masked at capture            | Retention expiry                                           |

These are the values the operator must set on the `forge-mobile` Datadog org
before flipping production. No raw term is archived beyond the window, no
long-term cold store, and no Sensitive Data Scanner scrub is applied to the term
field (the rich posture is intentional — see below).

## Re-identification assessment

**Vector.** The only user-authored free text is the search term. A term can
incidentally contain PII (a user typing their own name, a personal question).
Combined with IP-derived geo, device model, and a stable `viewer_id`, a single
session is in principle linkable to an individual **if the term itself carries
identifying content**.

**Why the residual risk is acceptable:**

- **No identity linkage.** `viewer_id` is a random per-install UUID. Mobile is
  anonymous — no email, account, or user id is attached to any RUM session (the
  Search bearer is a shared fleet key, not a per-user credential). There is no
  join key from Datadog back to a person.
- **Replay is masked.** Inputs are masked in Session Replay, so the term is
  never reconstructable from the visual recording — only from the Log attribute.
- **Coarse metadata.** IP yields city-level geo at best; device model is
  low-cardinality. Neither singles out a person without the term already doing so.
- **Bounded window.** 15-day (Logs) / 30-day (RUM) retention caps the exposure;
  nothing persists long-term.
- **Diagnostic value outweighs it.** Real queries are the point — they are how
  we find broken search, empty-result content gaps, and ranking bugs. Hashing or
  dropping the term would defeat the feature.

**Accepted residual (R42).** A user who types PII into search will have that text
logged for up to the retention window. This is accepted given the anonymity, the
masked replay, the bounded retention, and the absence of any account linkage. If
that calculus changes (e.g. mobile gains authenticated accounts), revisit this
assessment before keeping the raw-term posture.

## Sign-off gate

Per the plan DoD, production `forge-mobile` credential provisioning is blocked
until an owner accepts this assessment and sets the retention values above.
