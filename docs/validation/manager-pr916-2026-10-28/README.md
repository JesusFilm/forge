# PR #916 recovery verification

Baseline: `1279e6cfc` (current main). Source intent: the final polish commit
`857eaa2bbb28158b9ad50af90354d98bd0c947b7` on historical `pr-827`.
The earlier design-system migration, backend changes and historical roadmap
IDs were not ported. This bounded unit uses reserved roadmap ticket feat-891.

## Characterization

T3 preview, local Manager on independent port 3916, Node 24.22.1, Next 16.3.8,
mock backend with throwaway local session secrets. No real provider credentials
or paid-provider requests.

- Original baseline: after choosing source subtitles, clicking Review launch
  invoked one create POST. That characterization request was intercepted before
  network dispatch and returned a synthetic 503, so it created nothing.
- The original modal had no `.design-system-eleven` ancestor: its portal lost
  the dashboard token scope. At 375px its dialog was 327px wide (24px side
  gutters); Agents began at x=366 in the horizontally scrolling navigation.
- The original profile menu had no vertical viewport bound.

## Browser behavior after recovery

- 375×667, source subtitles, Dry run, hourly, cap 6: Review launch sent **zero**
  create POSTs. Final Create sent **one** and received HTTP **201** with
  `application/json` from the actual local mock API. The dialog closed and
  focus returned to New automation. This is UI/mock-store evidence, not durable
  Admin persistence or provider execution proof.
- 1440×900: Review launch sent zero POSTs; final Create sent one. A deliberately
  injected HTML 502 produced the root helper's readable unexpected-response
  message and retained the review form rather than throwing a JSON parse error.
- 375×667 dialog: x=12, y=12, width=351, height=643; no horizontal overflow.
- 320×480 dialog: x=12, y=12, width=296, height=456; client/scroll width both
  294px. Scrolling reached Cancel at y=413–451 inside the visible dialog.
- 1440×900 dialog: width=980, three recipe columns, no horizontal overflow.
- Mobile navigation exposes all eight current routes with labels. Agents is
  visible in the open menu at 375px (x=21, y=387, width=333, height=44).
- At 320×480 the profile menu is 296×456; client/scroll widths both 294px after
  fixing grid-item minimum sizing, and its 651px content scrolls vertically.
- Actual profile theme switching exercised light and dark palettes. Dark
  recipe card background is rgb(24,24,23), title rgb(240,238,235).
- Opening the modal focuses Close. Shift+Tab wraps to Cancel; Escape closes it
  and restores the trigger. The mobile navigation closes on Escape and link
  activation, returning focus to its disclosure control.

Local screenshots (available to the root integration agent):

- `/tmp/forge-pr916-evidence/mobile-375-light.png`
- `/tmp/forge-pr916-evidence/mobile-320-dark.png`
- `/tmp/forge-pr916-evidence/desktop-1440-light.png`
- `/tmp/forge-pr916-evidence/desktop-1440-dark.png`
- `/tmp/forge-pr916-evidence/profile-320-dark.png`
- `/tmp/forge-pr916-evidence/navigation-375-light.png`

## Page-load evidence

Raw measurements and environment details: [page-load.json](./page-load.json).
An initial nonadjacent comparison was noisier while sibling workers ran checks;
retain it for transparency. The adjacent control temporarily restored the four
modified existing UI files to baseline, then restored the candidate files. Each
process had one excluded warmup navigation, followed by five reload samples at
375×667 collected 250ms after load.

- Median FCP: **52ms → 52ms**.
- Median load: **58.3ms → 64.9ms**; median TTFB **29.2ms → 34.5ms**.
- All ten control samples: **22 static resources**, **two existing jobs-count
  fetches**, **6,922 transferred bytes** under warmed cache revalidation.
- CSS source: 332,850 → 336,223 bytes (+3,373, approximately 1%). No new package,
  media, initial fetch, dynamic import or render-blocking resource.

No material local first-paint or initial-request regression was observed. These
shared-host development samples do not establish production Web Vitals or
uncached bundle transfer size. Root should retain the normal integration build
and CI validation before publishing.

## Checks and ownership

- Manager typecheck: passed.
- Manager lint: passed.
- Focused tests: 14 passed (response helper, creation confirmation, shell menu).
  The form test covers implicit submit from rules, review without creation,
  explicit final creation, duplicate pending submits and completion callback.
- Prettier and `git diff --check`: passed before commit; enabled commit hooks
  run staged formatting and the repository-wide format check.
- Root's `/tmp/forge-automation-ui-root.patch` and response helper/test were
  copied into this candidate because the isolated main baseline lacked them.
  Their response and final-click behavior is preserved.
- No backend, server data loader, Admin schema or generated GraphQL changes.
  Root owns independent review, integration, production-build validation and
  publishing; this worker does not push or merge.

## Independent review round 1: step-transition focus

Integrated `1309e8ccbb3868e281ee19c837b9136dc1f1e969` onto parent
`a810975c7` without conflicts. The parent already contained the response helper,
explicit-create guard and subtitle source execution recovery. Only UI focus and
its regression coverage changed after integration; no Admin files were touched.

The review's P3 reproduced at 320×480: Enter on Review launch removed the
focused keyed button, leaving focus on BODY at dialog scrollTop 504. Next Tab
focused Close and reset scrollTop to 0. Preserve the distinct advance/create
keys; after step transitions focus the new heading with `tabIndex={-1}` instead.
An initial-step guard preserves opening focus and ordinary editing focus.

Real Chromium keyboard checks on the candidate, at 320×480 and 1440×900:

- Review Enter focuses `agents-review-title`; next Tab reaches Cancel.
- Back, Change and Continue focus the corresponding rules/recipe headings.
- Reverse Tab reaches the step navigation; modal Tab wrap and Escape restoration
  still work. Review/navigation issue zero creation POSTs.
- An explicit create attempt returning synthetic HTML 502 retains the form and
  readable error. A subsequent explicit create sends one real local mock POST
  (HTTP 201), closes the dialog and restores New automation focus.

T3 preview was attempted first. Initial dependency symlinks were rejected by
Turbopack; installed local dependencies offline. Login then redirected to the
default port 3002 and failed with `ERR_CONNECTION_REFUSED`; corrected the local
base URL to 3920. Terminal-browser fallback could not run because this terminal
does not support images. Browser evidence uses a separate agent-browser
Chromium session with no production/provider requests.

Raw focus observations, environment and paired warm-load samples:
[focus-review.json](./focus-review.json). Each variant used an excluded warmup
and five reloads at 320×480. Median FCP 68 → 64ms, load 78.8 → 82.0ms, TTFB
34.6 → 37.1ms. Both variants had 21 static resources, the same two existing jobs
requests and 6,922 transferred resource bytes. No material local load regression
observed; these are warmed development samples, not production Web Vitals.

Validation: 15 focused tests passed (including the new focus regression, first
observed failing), Manager typecheck/lint passed. Enabled hooks, scoped Prettier
and diff checks run before the final commit. Root owns the next independent
review and integration; no push, merge or deployment was performed.
