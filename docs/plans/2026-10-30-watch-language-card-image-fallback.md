# Language inventory blank artwork fallback

## Plan

Integrate PR2643 / FGE-178 / W-016 with current main, preserving its inventory,
layout, ordering, filters, links, localization, authored-first heroes and pinned
Mux derivative. Reserve a globally unused roadmap identity before moving the
owned ticket; feat-637 also belongs to queued PR2617.

Reproduce the bug on main's unchanged `cardImageUrl` (`??`) through both
`InventoryCard` (subtitle-only) and `CompactVideoRow` (audio). Scope assertions
to unique card hrefs and their actual images. Cover blank and null artwork,
authored artwork and missing playback. Change only the surviving operator to
`||`, then run the focused component suites, Web typecheck, touched lint/format
and roadmap identity/dependency checks.

## Acceptance boundary

Local implementation completion does not establish target acceptance, current
head CI, independent review or page-loading performance. A newly populated blank
card intentionally adds a useful frame request; null and authored cases should
retain their request identities and geometry. Browser loading, transferred bytes
and CLS require a later matched-fixture target comparison. No production catalog
empty-string incidence is inferred from component fixtures.

## Review and compound

The incoming 13 thumbnail tests passed on unchanged nullish main. Replacing its
page-wide blank assertion with 12 card-scoped controls produced two meaningful
failures: blank artwork with playback on each surface. The other ten controls
passed. Applying only `??` → `||` made all 24 thumbnail cases pass, alongside the
current-main component and inventory tests (128 total) and 8 URL tests.

When heroes and cards share an image recipe but select sources independently,
page-wide image assertions can conceal a blank card. Select a unique card href,
verify the intended surface's interaction frame, then assert that card's image
and exact recipe. Keep absent-image assertions card-scoped too. Preserve null,
authored-artwork and no-playback controls to distinguish the actual regression.

Self-review confirms the production component differs from integrated main only
at the fallback operator. The roadmap identity was locally reserved as feat-916
after a fresh all-author, fully paginated audit. Main's README ordering and
unrelated rows/statuses are retained. No new runtime dependency, client boundary,
image recipe or layout is introduced. Whole-page loading and target acceptance
remain pending; source/fixture evidence is not a performance certificate.
