---
title: "Unlisted capability playlists need separate presentation authority"
date: "2026-08-21"
category: "architecture-patterns"
module: "Auth, Admin, and Web user-playlist boundaries"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
related_components:
  - "authentication"
  - "data_model"
  - "frontend"
  - "background_job"
applies_when:
  - "Regular users can arrange existing catalog media without becoming editorial users"
  - "An unlisted resource is readable by anyone who possesses an opaque link"
  - "Account suspension or deletion must revoke access across independently deployed services"
  - "Anonymous sharing cannot launch until edge, telemetry, and scheduler controls are proven"
tags:
  - "user-playlists"
  - "capability-links"
  - "least-privilege"
  - "unlisted-content"
  - "lifecycle-projection"
  - "feature-flags"
  - "privacy"
---

# Unlisted capability playlists need separate presentation authority

## Context

Forge needed to let regular Watch users arrange existing media into personal
blocks and carousels. The arrangement had to remain independent of the
editorial Experience, Collection, and Carousel models: a consumer playlist may
present eligible media, but it must never reorganize the canonical portfolio or
inherit editorial write authority.

Sharing adds a second trust boundary. An unlisted link is not indexed or listed,
but possession of the link grants anonymous read access. That makes the link a
bearer capability, not merely a friendly identifier. The feature therefore
needed owner authorization, capability storage and rotation, lifecycle
revocation, anonymous response privacy, moderation, and operational rollout
controls to agree on the same resource state.

## Guidance

Model consumer presentation as its own aggregate. Store stable references to
eligible canonical media and a bounded presentation snapshot; do not reuse the
editorial aggregate or its permissions. Every owner operation must predicate the
database lookup on both the playlist ID and the immutable consumer subject.
Eligibility checks remain a read-time boundary, so removed or newly ineligible
media can become unavailable without mutating the portfolio.

Treat the share token as a capability with two storage needs:

- Keep a keyed digest for lookup so the database does not contain the bearer.
- Keep separately encrypted material only for the explicit owner reveal flow.
- Version and rotate the capability atomically. Unshare removes all lookup and
  reveal material immediately.
- Return ordinary owner playlist DTOs from create, reshare, and rotate. Expose
  plaintext only through the narrowly named reveal query, so routine mutation
  logs and clients cannot receive it accidentally.

Bind playlist existence to an Auth-owned lifecycle projection. The Admin schema
uses the consumer subject as the relation key, and owner services assert an
active lifecycle before acting. Account deletion first enters a durable deleting
state, revokes playlist-bearing grants, erases the playlist aggregate, and only
then finalizes the identity. Serialize erasure against creation at the lifecycle
row so neither ordering can leave an orphaned playlist.

Keep authoring and anonymous reads behind independent, default-off controls:

```ts
userPlaylistAuthoring: {
  defaultValue: false
}
userPlaylistPublicRead: {
  defaultValue: false
}
```

This lets operators stop new owner activity without changing the anonymous
surface, or retract every public capability read while owners retain their
private data. Missing flag configuration must resolve to off at the authoritative
request boundary, not only hide a menu item.

The anonymous surface should disclose only its closed public DTO and should
return the same neutral not-found response for malformed, unknown, revoked,
blocked, deleted, and inactive-owner capabilities. Apply `noindex`, `nofollow`,
`noarchive`, `no-store`, a strict referrer policy, and an analytics-free layout.
Do not send the raw capability to telemetry, logs, report records, browser route
state, or downstream media hydration. Rate-limit before expensive resolution and
fail closed when the limiter or required signing context is unavailable.

## Why This Matters

Reusing editorial Experiences would turn a presentation feature into a content
authority escalation. Using a database ID as the share URL would make discovery
and enumeration practical. Returning a capability from routine mutations would
spread the bearer into logs and application state. Checking account state only
at sign-in would leave already-issued links live after suspension or deletion.

The separate aggregate makes those risks explicit. Portfolio integrity stays
with Admin's canonical media models; consumer ownership stays with the Auth
subject; anonymous access stays with a rotatable capability; and public rollout
stays reversible through its own request-path control.

## When to Apply

- Apply this pattern to user-curated playlists, boards, galleries, or pages that
  reference an authoritative catalog without editing it.
- Use it when an opaque link intentionally grants anonymous access and immediate
  revocation matters.
- Keep the public-read control off until edge admission, direct-origin blocking,
  scheduler cadence, telemetry redaction, retention, backup, and key-rotation
  evidence are verified in the deployed environment.
- Do not use a bearer capability when per-viewer authorization, audience
  membership, expiry, or access auditing is a product requirement; use an
  authenticated sharing model instead.

## Examples

An owner creates a Spanish-language playlist with a text block and two video
carousels. The snapshot stores presentation metadata and canonical video IDs.
It does not create or update a canonical Experience, Collection, or Carousel.
If one video later becomes ineligible for Watch, the owner sees a privacy-safe
unavailable item and must remove or replace it before saving; the media record is
not changed.

When the owner shares the playlist, the service stores a digest for anonymous
lookup and encrypted material for the explicit reveal query. Rotating the link
increments its token version, so the former URL resolves to the same neutral
not-found page. Deleting the account moves its lifecycle projection to deleting,
revokes playlist OAuth grants, erases playlists and report linkage, and then
removes the identity only after the erasure acknowledgement matches.

## Related

- `docs/plans/2026-08-21-1213-feat-self-service-user-playlists-plan.md`
- `docs/runbooks/user-playlist-sharing.md`
- `docs/roadmap/topic-experiences/feat-411-self-service-user-playlists.md`
- `docs/roadmap/topic-experiences/feat-414-production-playlist-sharing-control-plane.md`
- `docs/solutions/architecture-patterns/kill-switch-completeness-follows-data-lifetime.md`
- `docs/solutions/architecture-patterns/fail-closed-enforcement-point-follows-rollback-capability.md`
