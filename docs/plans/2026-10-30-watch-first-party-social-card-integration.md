# Watch first-party social card integration

## Scope and source

Integrate PR #2655 at `73bbcbcd988f0c31b0385558abd5799ec7399b36` with
main `067a1c27b53590db9d384b608e0a352b7847e090`, preserving both parents
in an uncommitted merge. FGE-214 / W-073 comes from the September 13
collective automated Watch audit; the named human reporter is unknown.
Current main still selects the hotlinked Unsplash default. Historical
production observations establish neither fresh reproduction nor acceptance.

Keep the original 147,447-byte JPEG and replace only the default metadata
URL, dimensions (1200×630), and alt text. Preserve main's managed-image,
Mux/poster, locale, canonical, description, OG/Twitter, robots, and structured
data behavior. Keep the Unsplash allowlist for existing section consumers.
Do not absorb the social/embed or language-hub work in #2633 / #2672.
The supplied #2629 reference resolves live to decorative-backdrop work; its
current files do not edit the metadata module.

## Plan and work

1. Mark the incoming social-card ticket in progress. Audit all live open PR
   heads, local refs, worktree files/indexes, and parent reservations before
   any necessary owned-ticket renumbering. Leave unrelated identities intact.
2. Merge main without committing. Resolve the README from main and reconcile
   only the owned ticket and summary through the canonical roadmap reader,
   preserving manual ordering, undated presentation, and unrelated statuses.
3. Retain current tests and add focused regressions for both sharing channels,
   localized/error/series defaults, and invalid or partial managed-image
   dimensions, blank URLs, and known/unknown MIME types.
4. Use Node 24.22.1 with frozen dependencies. Run scoped metadata contracts,
   Web typecheck, touched lint/format, roadmap identity/dependency checks, and
   whitespace checks. Keep runner pools at two and heavy commands sequential.
5. Decode/hash the asset and, where feasible, collect labeled local static
   serving and SSR metadata evidence without credentials or env bypasses.

## Review and compound

Self-review the candidate against current main: the runtime source delta must
remain within static image metadata, with no added fetch/await/client boundary,
hydration, media, routing, or preload work. Metadata image tags describe an
asset; they do not themselves fetch it during rendering. Verify response
bytes separately from this source argument; do not claim measured browser
performance or production acceptance.

Leave the ticket in progress until parent review, current candidate CI,
production-mode static serving, representative social-card visual acceptance,
and target-environment checks close the remaining gaps. The implementation
writer's review is not independent review. Preserve immutable tree/diff/log
receipts outside the repository for parent publication through normal hooks.

Durable integration lesson: main already owns safe finite-positive managed
dimensions and optional MIME handling. Retain those helpers rather than
restoring an older implementation while changing its shared fallback size.

## Independent review repair (2026-10-30)

R1-P2-001 found that an authored Experience image could inherit the lake-scene
description. The real Experience mapper supplies an empty alt value.
The shared default previously supplied the neutral label “Jesus Film Project”.

Keep the lake-scene description on the default JPEG. Use a separate neutral
fallback for Experience, video, template, and series images without their own
description or title. Preserve explicit descriptions and the existing empty-value
rules. Add tests for both sharing channels and retain the default-image controls.

This static repair adds no request, await, client boundary, or preload.
Repeat scoped validation and obtain a new independent review of the exact tree.
Keep the existing route, visual, CI, and target acceptance limits.

Durable lesson: unchanged consumers can produce different results when a shared
fallback changes. Check each consumer when generic text becomes image-specific.
