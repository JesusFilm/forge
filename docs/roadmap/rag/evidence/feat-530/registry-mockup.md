# Registry mockup revision — 2026-09-28

User supplied the blue consumer registry mockup and capybara illustration,
requesting its layout, no Settings navigation, and otherwise blank RAG/Knowledge
sections. This direction supersedes previous color/inline-action preferences.

## Acceptance and observations

- Scan and navigation: white registry panel, blue controls and selected section,
  name/status/member count/action columns. Search, filters, sorting and pages
  operate on actual directory data. Member counts come from one aggregate database
  query; no membership identities are disclosed to other consumers.
- Action discovery: compact row popover with keyboard traversal, Escape and
  outside-dismiss behavior. Existing ownership rules still determine controls.
- RAG and Knowledge: shared supplied image, lazy-loaded only when opened; no
  Settings item or fabricated functionality. Direct creation and secret disposal
  remain unchanged.

## Evidence

Matched before/after captures: `apps/rag/output/portal-registry-pass/{before,after}`,
Chrome for Testing 153.0.8010.12, 1280×900 and 390×844, four fixed visual directory
fixtures, local-owner identity. Added action-menu and construction captures.
No credentials were captured. Mobile has an independently scrollable table and
no page overflow. Visual assessment is the implementing agent's judgment.

The paired initial consumer payload grew from 117,062 to about 127,000 decoded
bytes, within the existing 140 KB budget. The single local load observations
were 12.4 ms before / 17.1 ms after; these are not production timing evidence.
The supplied ~1 MB PNG is excluded from initial consumer navigation and loaded
on demand for the placeholder sections. Fonts and images remain same-origin.

Checks: real PostgreSQL lifecycle browser journey; registry search/filter/sort,
pagination, keyboard menu and both placeholder image-loading checks; portal HTTP
and adapter regression tests; typecheck, lint and dependency rules. Production
admission and operational dogfood keep their existing feature gates.
