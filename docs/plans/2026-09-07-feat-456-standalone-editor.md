# feat-456 standalone editor implementation

Scope: replace Manager Shorts product routes with standalone projects and an NLE;
Admin remains canonical. Use reviewed 454/455, no calendar/generation/publication UI.

Agreed TDD seams: authenticated shared commands (human attribution distinct from
interactive review authority), two-client stale-save, and editor timing/crop/undo/save
state. Browser verifies the actual local production build and real source media.

Transport: Manager validates its HttpOnly session and same-origin mutation requests,
then signs a short-lived request-body-bound Ed25519 assertion to a narrow Admin
Studio endpoint. Admin checks signature, audience, environment, digest and current
operator membership. No caller identity or interactive flag in JSON. Delegated
principals retain attribution but cannot satisfy explicit review/experiment authority.

Editor: composition-local undo/redo with immutable server history; retain a failed
save's exact revision and retry key. Conflict requires explicit reload or reviewed
local-document reapplication; never silently overwrite. Selection and playhead live
outside persisted revision updates. Canvas transforms, multi-track drag/trim, property
inspector, shared assets and Content Packs all commit at meaningful state boundaries.

Preview: lazy client-only fixed host on a distinct registrable site, opaque-origin
iframe, bounded broker sessions and watchdog, version-pinned compiler. Only canonical
asset references can stage media. Digest-check source playlists/segments, decode/probe
selected full-resolution source, register immutable media and manifests through 455.
No generated code executes in Manager/Admin; production renderer launcher stays 460.

Validation: preserve /tmp/forge-studio-456-prep/browser-baseline.mjs and report in
committed evidence. Repeat same browser/viewport/cache/pairs/control definition.
List/create comparisons separate from new editor cost. Measure real HLS startup and
decoded seek; do not invent an unavailable legacy prepared-media seek baseline.
Run scoped then full tests/typechecks/builds/format, fixed-base independent Standards
and Spec review, resolve findings, compound, and commit locally with hooks.
