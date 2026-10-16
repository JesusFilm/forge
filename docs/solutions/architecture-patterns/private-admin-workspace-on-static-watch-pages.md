---
title: "Private Admin workspaces on static Watch pages need split authorization and origin-owned decisions"
date: 2026-10-16
category: architecture-patterns
module: "apps/web Watch + apps/admin SEO"
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "A private operator tool must appear inside a public force-static or ISR page"
  - "The browser needs retained Admin evidence but public HTML and caches must remain anonymous"
  - "An action begins on a public or shared origin but changes an Admin-owned ledger"
  - "Provider evidence includes sensitive query text or short-retention detail"
related_components:
  - frontend_stimulus
  - authentication
  - database
tags:
  - watch
  - seo
  - admin-only
  - force-static
  - authorization
  - privacy
  - immutable-proposals
  - no-store
---

# Private Admin workspaces on static Watch pages need split authorization and origin-owned decisions

## Context

The Watch SEO workspace had to feel like part of a real video page, not a
standalone analytics application, while remaining invisible to viewers and
crawlers. The host page is deliberately force-static, so request identity
cannot decide its HTML. The evidence belongs to Admin, contains retained search
and experiment detail, and can lead to a durable Apply or Decline decision.

Three tempting shortcuts each cross a different boundary:

- Rendering the tab from a server-side role check makes shared static output
  depend on one request's identity.
- Treating a successful capability check as authority for later evidence reads
  lets stale client state outlive a role change.
- Posting Apply or Decline from Watch makes a shared public origin the mutation
  authority and weakens Admin's session, CSRF, and audit boundary.

An earlier isolated mockup also hid the most important product constraint: the
workspace must mount at the semantic-recommendations seam of the existing Watch
page and must not delay player startup or change the anonymous page shape.
(session history) Earlier Manager and SEO-run work supplied the ledger and
evidence foundations, but did not itself create this private Watch surface.

## Guidance

### Keep the static tree anonymous, then discover capability after hydration

Render no Admin label, placeholder, or serialized evidence in public HTML. A
small client boundary waits for the existing authenticated-session signal and
then asks a same-origin dynamic endpoint for the single boolean capability. The
current implementation starts that fetch only after an authenticated signal
and renders nothing until authorization succeeds
(`apps/web/src/components/watch/WatchSeoAdminBoundary.tsx:49` and
`apps/web/src/components/watch/WatchSeoAdminBoundary.tsx:119`). The SEO
panel is a client-only dynamic import and is not mounted until the operator
selects the tab (`WatchSeoAdminBoundary.tsx:13-19,75-117,134-155`).

Mount the boundary at a stable seam in the actual Watch composition. Forge
places it after the semantic recommendations block rather than creating a
parallel app shell (`apps/web/src/components/watch/WatchSectionRenderer.tsx:201-208`).
The surrounding route remains explicitly force-static
(`apps/web/src/app/[locale]/[htmlLang]/page.tsx:29-31`).

### Authorize capability and evidence independently

Capability is presentation state, not a reusable credential. Every private
evidence request must present both the narrow Watch-to-Admin service identity
and the current user's delegated token. Admin then resolves the token subject
to a live Admin user and role before reading data. The read endpoint performs
rate limiting, dual authorization, and only then input validation and the read
(`apps/admin/src/app/api/watch-seo/read-model/route.ts:32-64`). This order also
avoids revealing catalog or contract details to an unauthorized caller.

Do not guess that an OAuth subject equals an Admin database id, and do not fall
back to request-time email matching. Record a durable one-to-one subject/user
binding during verified Admin sign-in; reject attempts to move either side
silently. The resolver uses that binding, permits only an unbound legacy
subject-equals-id case, and returns the live role
(`apps/admin/src/auth/admin-subject-binding.ts:1` and
`apps/admin/src/auth/admin-subject-binding.ts:87`).

Both Web adapter responses must be private and non-cacheable. The evidence
adapter re-verifies the Web session, maps upstream denial to a non-enumerating
response, validates the retained Admin contract, and returns only a validated
public Admin origin for navigation
(`apps/web/src/app/api/watch-seo/page/route.ts:9` and
`apps/web/src/app/api/watch-seo/page/route.ts:16`). Never return a
private Railway hostname to the browser.

### Project retained evidence; do not turn absence into data

The workspace reads only durable Admin records. It does not call GSC, GA4, or a
crawler during page viewing. Each section preserves source, retrieval time,
coverage state, and caveats. Missing or expired evidence is `unavailable`,
`not_connected`, or `compacted`, never zero and never a fabricated daily point
(`apps/admin/src/services/watch-seo/read-model.service.ts:1-15`). A rolling GSC
selection record can support a current ranking summary, but it is not a daily
rank-history series.

The Web projection must be stricter than the retained Admin model. In
particular, Watch should receive query-free opportunity summaries rather than
raw search phrases. Retention is enforced at read time as well as by background
cleanup: proposal identity and outcomes may remain while old prose, diffs, and
query-bearing details become explicit expired placeholders
(`read-model.service.ts:818-877`).

Bound database work, not only the returned array. The read model uses indexed
keys, time windows and SQL limits, filters JSON inside PostgreSQL, and gives raw
reads a transaction-local statement timeout
(`read-model.service.ts:1-12,48-65`). Its GSC lookup uses native enum predicates,
the retention boundary, an ordered limit, and the matching composite index
(`read-model.service.ts:432-475`).

### Move decisions to Admin and bind them to the reviewed immutable version

Watch never performs an Apply or Decline mutation. It opens the public Admin
confirmation route with proposal id, immutable version, payload digest, and the
intended action. Those fields identify what the person chose but carry no
authority (`apps/admin/src/app/dashboard/seo/proposals/confirm/confirmation-params.ts:1-16`).

The Admin server action derives the actor from a fresh Admin session, requires
a meaningful decline reason, ignores browser-supplied actor/nonce/expiry, and
calls the shared ledger decision service
(`apps/admin/src/app/dashboard/seo/proposals/confirm/actions.ts:3` and
`apps/admin/src/app/dashboard/seo/proposals/confirm/actions.ts:52`).
Inside the serializable transaction, the service re-reads the live Admin role,
mints and hashes a short-lived nonce, checks the exact version and digest, and
then uses the same canonical decision core as Manager
(`apps/admin/src/services/seo-experiment.service.ts:1834` and
`apps/admin/src/services/seo-experiment.service.ts:1997`). That
core may create a draft or ticket, but it never publishes canonical content or
deploys (`seo-experiment.service.ts:1997-2002`).

## Why This Matters

Static rendering, UI visibility, data access, and mutation authority are four
separate concerns. Collapsing them into one `isAdmin` check either leaks private
state into a shared cache or lets a stale browser decision stand in for live
authorization. Splitting them preserves anonymous Watch performance while
making every sensitive read and write independently revocable and auditable.

The evidence rules protect decision quality as well as privacy. A chart that
manufactures daily history from rolling snapshots, or a card that displays a
missing provider value as zero, looks authoritative while saying something the
source never measured. Explicit coverage states let people and agents reason
from the same honest record.

## When to Apply

- A private diagnostic or editorial tool must live inside a cached public page.
- A public application displays another application's private retained data.
- A public-origin interaction can initiate an Admin-owned state transition.
- An operator UI combines data sources with different authority, retention, or
  coverage semantics.
- A page-load-sensitive surface needs rich tooling that should download only
  after authorization and explicit selection.

## Examples

Safe read sequence:

```text
public static HTML
  -> authenticated-session signal
  -> no-store capability check
  -> render Admin-only tab
  -> operator selects tab
  -> no-store evidence request
  -> Admin repeats user + service authorization
  -> bounded, query-free projection
```

Safe decision sequence:

```text
Watch opportunity
  -> navigate to public Admin confirmation URL
  -> fresh Admin session and live role check
  -> confirm immutable proposal version + digest + action
  -> server-minted nonce
  -> shared serializable ledger decision core
  -> draft or ticket only; no publication or deployment
```

## Related

- [Keep runtime feature flags out of static Watch route rendering](../integration-issues/watch-runtime-feature-flag-static-route-cache.md)
- [Mastra SEO experiment ledger boundary](mastra-seo-experiment-ledger-boundary.md)
- [Bounded versioned Admin-owned audit reports](bounded-versioned-admin-owned-agent-job-audit-report.md)
- [Anonymous Watch testers use scoped signed capabilities](anonymous-watch-testers-use-scoped-signed-capabilities-20260921.md)
- [Cache-safe origin-issued Watch exposure manifests](cache-safe-origin-issued-watch-exposure-manifests-20260929.md)
- [An AI agent and a person need one versioned write path](agent-and-person-share-one-versioned-write-path.md)
- [Canonical Admin origin for CSRF-sensitive promotion](../security-issues/admin-promotion-csrf-canonical-origin.md)

