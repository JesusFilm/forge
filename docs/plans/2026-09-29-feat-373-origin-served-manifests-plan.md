---
title: Origin-issued anonymous Watch exposure manifests
status: active
feature: feat-373
---

## Measurement boundary

An anonymous served count means the origin persisted issuance of a measurement
manifest containing that card for an ordinary activation request. Persistence
does not prove client receipt. It does not count the
original cached HTML response, a DOM acknowledgement, or an eligible impression.
Cached HTML and cached feed responses carry reusable immutable content
descriptors. Rendering/building those descriptors writes no recommendation data.
The descriptor contains only public block, placement, ordered target paths and
source version information, authenticated by the origin. It contains no viewer,
cookie, account, IP or session identity. An untrusted client list cannot establish
the served denominator.

Web owns descriptor signing with the existing `REVALIDATION_SECRET`, following
the domain-separated HMAC pattern already used by dynamic collection cache
signatures. The new domain is exclusive to exposure manifests. Descriptors expire
after 47 hours 55 minutes on the signer clock, reserving up to five minutes of
positive signer clock skew within the unchanged 48-hour verifier ceiling.
Signed expiry is always final; expired or invalid descriptors fall back to
unknown v1 coverage.
Key rotation invalidates old cached descriptors until normal revalidation; no
new production secret or feature flag is required. Admin-origin search
descriptors may use its existing matching `WEB_REVALIDATE_TOKEN` only under this
same domain and exact canonical contract; absent configuration returns unknown
coverage and must not block search.

## State and contract

1. Trusted content projection creates an immutable descriptor for one registered
   block and its exact ordered item identities. Only known projections are
   measured; unsupported projections remain explicit coverage gaps.
2. After actual browser activation, an asynchronous no-store Web POST submits
   that descriptor plus a random retry nonce. Web validates origin, request size,
   traffic, descriptor signature and cache lifetime before calling Admin.
3. Authenticated Web calls additive `issueWatchSurfaceDelivery` with the verified
   manifest and retry nonce. Admin validates registry, finite card bounds and
   authenticated traffic classification before its first write. Excluded traffic
   has no persistent issuance and returns a deferred/contextual disposition.
4. Admin derives a delivery window from the retry nonce and serializes issuance
   for that window. An exact retry returns the same receipt and immutable card
   slate; a conflicting reuse cannot overwrite it. Empty slates create no card
   rows. Partial slates preserve their actual cardinality.
5. The existing exposure ledger stores server-only `served` rows under
   `watch-exposure-v2`. Browser rendered/eligible/selected facts are accepted only
   against exact issued window, registry, placement, policy, position and path.
   Browser input schemas never accept served. Legacy v1 facts remain valid, and
   their denominator remains unknown.
6. Buffered render/selection events retain their original time while issuance
   completes. Navigation never awaits telemetry. Early selection remains an
   anomaly and cannot create eligibility. Prerender activation, abort, StrictMode,
   BFCache restoration and descriptor changes have separate window lifecycles.

## Storage and rollout

Reuse `watch_surface_exposure` rather than duplicate its anonymous dimensions in
a second ledger. Migration 0105 extends the kind constraint and adds a partial
unique served identity index. Transactional issuance protects retry binding;
the migration uses an atomic transaction with a two-second lock timeout and a
30-second statement timeout, rolling back on contention or slow scans.
If deployment hits either timeout, stop promotion and inspect the normal Prisma
migration failure receipt. Migration 0105 is deliberately outside the existing
automatic P3009 recovery allowlist; retrying its SQL fixture does not authorize
production migration-state repair or bypassing the deployment gate.
Served rows inherit the existing bounded 29-day expiry/retention continuation.
Report cohorts include served-only deliveries so lost receipts or ingestion
failure do not disappear. Keep event-time CTR and original v1 coverage explicit.
No historical rendered rows become served facts.

Admin mutation, schema artifact and generated client deploy before Web starts
calling the new operation. Rollback removes new Web issuance before retiring the
receiver contract. No live recommendation ranking, experiments or profile state
changes are included.

## Source integration and verification

Home models and authored sections, catch-all merged video blocks, series episode
data, direct search response and dynamic feed response each require trusted
origin projection and an exact client mapping. Hero rotation uses its server
candidate position, not an arbitrary active DOM index. Repeated paths and blocks
retain occurrence and placement identity. Cached source descriptors cannot reuse
a delivery window across navigations.

Known measured adapters include manual collections, category rails, Bible quote
resource links and supported authored CTA/hero/container forms. Chapters and
empty collections mirror renderer early returns. Route-video-derived
collections use the renderer's supplied context; current callers supply none
and therefore render no collection. RelatedQuestions and promotional Text
project actual compiled Markdown anchor order from a server-only module, with
an aggregate 48 KiB authored parse budget. Raw authored CTAs and Markdown anchors requiring a navigation base use exact
trusted public pathnames only for root/language home routes, whose redirects and
proxy mappings preserve that authority. Other callers supply no exact public
pathname, so the entire ambiguous block remains unknown. This includes rootless
HTTP(S) forms such as `https:watch/birth.html`: a scheme prefix does not establish
base independence. Canonical/internal ISR paths cannot safely substitute for the
browser base. Follow-up feat-564 owns cached public-navigation authority for
remaining generic routes; no viewer links change for telemetry.
Unknown block typenames also withhold authority. Hero or
multi-parent alternative slates exceeding 100 cards withhold v2 authority;
ordinary lists measure only their bounded first 100 Watch-link occurrences.
These gaps retain v1 facts with an unknown denominator and cannot satisfy the
registry completion gate.

Verify issuer/ingress authority, exact retries and conflicting nonce reuse,
served-only denominators, policy separation, early selections, repeated blocks,
expiry and excluded traffic with unit and explicit PostgreSQL fixture tests.
Verify browser activation, cached descriptors, navigation and resource/timing
impact independently. Deployed authorized Admin reconciliation remains required
before completing feat-373. The existing Admin sign-in blocker was cleared
through ordinary sign-in; local evidence still does not establish deployed
coverage.

## Bounded report inspection

The existing anonymous query timed out at its three-second budget in production.
A 60,000-fact local reproduction exposed correlated scans of a materialized CTE
for every first selection. Compute the first eligible time with a window over
the exact window/config/policy/position/path partition instead; retain full
history ranking, event/receipt cutoffs, early-selection and repeat semantics.
The identical local fixture completes in 338 ms under the unchanged budget.
The parent's authorized read-only production candidate succeeded but returned
the 129-group truncation sentinel. A bound registry-entry/optional-placement
filter therefore scopes both signed and anonymous readers before aggregation.
The 128-row limit and explicit unknown/truncation warning remain. Other overview
windows and replay totals retain their existing scope.
