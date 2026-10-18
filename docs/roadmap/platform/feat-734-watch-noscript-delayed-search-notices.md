---
id: "feat-734"
title: "Watch JavaScript-disabled and delayed-search notices"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-17"
duration: 1
depends_on: []
blocks: []
tags: [web, i18n, search]
---

## Problem

B24 N52/N57b (QA627/QA635) needs a JavaScript-disabled notice and localized
feedback when a search stays pending past the accepted 3–5 second threshold.
Carry the recovered implementation onto main `90908a4326901232ec0ff7569744a0e6b7e89e25`.
The original recovery used `848ce82f8d675431c83d66aef3651953d4183b8d`.

## Entry Points — Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx`: static locale root layout.
2. `apps/web/src/components/SearchOverlay.tsx`: submitted query and loading state.
3. `apps/web/src/components/FloatingSearchProvider.tsx`: search lifecycle.
4. `docs/i18n/watch-ui-provisional-catalogs.json`: preserve translation evidence.
5. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`.

## Grep These

`SearchSlowNotice`, `WatchNoScriptNotice`, `slowSearch`, `sourceExtensions`.

## What To Build

- Server-render a localized `<noscript>` notice first in the body, outside
  streamed page content. Keep responsive fixed-header clearance inside noscript
  and translated height intrinsic in normal flow, without covering page links.
- Show localized `SearchOverlay.slowSearch` after 4 seconds pending; reset on
  query change, completion, failure, cancellation and unmount.
- Recover the supplied two message leaves across all 225 catalogs, translator
  context and provenance. Preserve unrelated main leaves and historical evidence.

## Constraints

No translation API/model calls, unrelated player/font changes, generated GraphQL
edits, unpublished PR stacking, analytics changes or roadmap index regeneration.
The offered old worktree remains read-only. Parent owns publication and review.

## Verification

Focused notice/layout/search integration tests; catalog parity, provenance and
generator drift checks; touched formatting/lint and web types. Compare resolved
runtime dependencies with manifest/lock before full-app tests. Measure page load
and search mount/render/request costs; record any outstanding runtime acceptance
gap explicitly before marking complete.

## Recovery Receipt — 2026-10-17

The offered source is the read-only worktree
`/home/lado/Projects/JesusFilm/Forge/.claude/worktrees/agent-ac3c0c0d0a1bdd876`,
HEAD `9ce6836f59a9e74daf2e696b591af82bdb976718`. Exact snapshots of its
231 tracked modifications and four untracked files, status, binary patch and
SHA-256 hashes are in `/tmp/forge-b24-recovery-20261017/`. Patch SHA-256:
`31da5064f790b7f5b255f232d167ea886c39f74e047e3ebf6c5e1a965b4c5a9c`.
The source worktree was verified unchanged after recovery.

Five tracked code/test files reconciled cleanly against the historical HEAD
with `git merge-file`; all four new files were recovered. Every catalog adds
exactly `SearchOverlay.slowSearch` and `WatchNoScript.message` from the offered
work. All current-main siblings, including Spanish Feedback, remain unchanged.
No player, font, B16/B25 or other unpublished PR implementation was absorbed.

Historical `sourceExtensions` and scoped revision evidence is preserved. Current
per-locale digests were recomputed locally with the existing digest helpers,
without translation/model calls. The recovered English source digest is
`d4cb585c210f0917b61c91838df91c8a12fa897ab0883a6b180198dfbdfbad6e`;
the historical extension retains `70222074...`, the digest of the offered
catalog ordering. Both have the same English leaves; additive reconciliation
keeps main's existing key order. Later integration must recompute current
provenance against its final catalogs without relabeling historical evidence.

## Initial Verification Receipt

- Frozen offline web dependency installation resolved Next and
  `eslint-config-next` to 16.3.8, matching manifest/lock; React/React DOM 19.2.4.
- Focused Vitest: 725 passing across seven files, including nine timer/component
  tests, four localized server-HTML tests, eight root-layout tests, 180 search
  integration tests, 460 catalog-parity tests, seven provisional/provenance tests,
  and 57 translation-script tests. The two strengthened integration tests failed
  before production recovery because the slow notice was absent.
- Superseding query resets the 4-second wait; stale results do not clear the
  winning query's notice. Result, failure, actual clear button and unmount are
  covered. Fast-search characterization records exactly two prop-driven renders
  and no later timer renders; this is unit evidence, not page-load clearance.
- Catalog drift checks and touched Prettier/ESLint pass. All 225 catalogs were
  independently compared to main and the offered snapshots: exactly 450 supplied
  leaves added, no current-main leaf lost or changed.
- The initial setup produced 16 typecheck diagnostics and a webpack-only
  `node:crypto` build failure. These are superseded by
  `/tmp/forge-b24-recovery-20261017/runtime-followup/receipt.json`: matching
  local admin dependency links and the canonical default Turbopack build passed
  every build stage and standalone web typecheck. No unrelated source fix,
  temporary config override or manual generated-type removal was needed.

Status remains in progress: full-app JavaScript-disabled HTML/RTL rendering,
real delayed/fast search behavior and network costs, and before/after page-load
performance remain unverified. Parent owns independent review, authoritative
validation, minimal roadmap index reconciliation and publication. Detailed logs
and the exact changed-file list are in `/tmp/forge-b24-recovery-20261017/`.

## Review Fixes and Current Verification

The independent review at
`/tmp/compound-engineering-1000/ce-code-review/20261017-182436-b24/review.json`
identified two P2 defects. Their implementation and local evidence are in
`/tmp/forge-b24-recovery-20261017/review-fixes-20261017/`.

- Same-text language replacements now expose the existing request generation
  alongside query text in the existing submitted-search state. The slow notice
  is keyed by that generation, so a replacement gets fresh timer/visibility
  state immediately, including after an earlier notice appeared. No duplicate
  counter, query normalization change, language-selection change or retry was
  introduced. Four real-controller integration scenarios cover English-to-Spanish
  replacement before/after four seconds, slow/fast completion, and stale results.
  Three failed before the fix; all four now pass.
- The server-only noscript notice follows the complete page in normal flow.
  Its intrinsic translated height becomes scrollable instead of obscuring the
  footer, while browsers running JavaScript still ignore its content. A root
  layout ordering test failed before the fix and passes afterward. Genuine
  pre-fix JavaScript-disabled geometry evidence is being collected separately;
  full post-fix browser/RTL acceptance remains with the parent.
- The branch was rebased with autostash onto exact main
  `4a36916b7fa211c389426b9974bcca19ffac89ce`. The sole conflict was provenance:
  preserve all main extensions/locale revisions and append the unchanged B24
  evidence, then recompute current digests locally. All main catalog leaves,
  including merged #2742 translations and Spanish Feedback, remain unchanged;
  exactly 450 supplied B24 leaves remain added. Current source digest:
  `db27989ea10af89e4d80fc0ad48ced7c1a2e04339a0d3e6074971e1bc2c53166`.
- Current affected Vitest: 744 passing across eight files. Touched ESLint,
  locale/provisional drift checks, and web typecheck pass. The pre-fix snapshot
  preserves all 236 file hashes, staged/unstaged binary patches, exact index,
  original base/author and the five original staged blobs. No new implementation
  commit was made; the retained autostash is an additional recovery copy.
- No build or server restart was performed for these fixes. Existing compiled
  app/server and private API/environment setup remain untouched. Parent owns the
  next canonical build with corrected QA API routing, independent review,
  browser/performance acceptance and publication. Status remains in progress.

## R3 Placement Repair and Browser Evidence — 2026-10-17

The earlier after-page placement above was an implementation choice, superseded
by R3 at
`/tmp/compound-engineering-1000/ce-code-review/20261017-round3-203551-b24/`.
Genuine anonymous Chrome 149 JS-off evidence in
`/tmp/forge-b24-fullapp-browser-20261017/` established localized normal-flow copy
without horizontal overflow, but its initial top was y800/844 on home/RTL and
y1392/1676 on video. Candidate build `hXNPPiDLVYI_-gG1rjZOy` therefore did not
provide a useful first-viewport explanation.

The same server component now precedes the provider/page subtree. Its no-JS-only
container clears the current fixed-header hover envelope: safe-area inset plus
5.5rem mobile, 9rem desktop, 4.25rem compact landscape. Relative z10 places it
above z0 media backdrops and below header layers z40–50. There is no fixed
paragraph height, overlay, JS-on spacer, new copy, client code or streaming fix.
The existing layout regression now checks first-body/outside-streamed-page
placement. Parser coverage checks that the clearance container and paragraph
exist only when scripting is disabled; it is not browser geometry evidence.
Both strengthened assertions failed before the source repair. Current focused
verification and runtime receipts are in
`/tmp/forge-b24-placement-fix-20261017/`.

The six-file affected run passed 678 of 679 tests, including layout, notice,
four-second/search integration and catalog parity. An unchanged provenance
subprocess stderr assertion failed in the sandbox twice; the guarded host
recheck passed all 12 notice/provenance tests without a generator or provenance
test change. Web types, touched ESLint/Prettier, both catalog drift checks and
staged/unstaged diff checks pass. These are current local checks, distinct from
the earlier 764-test receipt. Parser assertions do not prove real geometry.

The prior browser run passed real fast successful search and a diagnostic that
delayed delivery of the same actual successful response by 5200ms. It covered
the four-second same-query language-generation reset, ignored stale results,
dismiss/reopen and clear. No natural slow-network claim follows. The prior
764 tests/10 files and R2 review remain historical evidence; current affected
checks must be recorded separately.

The matching exact-909 baseline `_PDsfntpYGR7vBOxQV73q` and candidate both hid
home/video Terms under streamed `S:3`/`S:0` containers. This is not B24 banner
occlusion; separately tracked in `feat-735`. RTL language-index footer comparison
is not applicable because that route has no footer even with JS on. No full
no-JS page/footer recovery is included here.

Prior bounded warm performance comparison measured equal initial JS
(838365 encoded bytes/30 scripts), +172 deferred search bytes, and no additional
initial or non-input mount CLS/longtasks. Three fixed-order samples per build and
viewport cannot prove a speedup or exclude small regressions. Fresh placement
first-fold/header/RTL/stacking and JS-on absence acceptance remains with the
parent; keep status in-progress until that separate verification and review.

## Final Verification — 2026-10-17

R4 code review completed without actionable findings at
`/tmp/compound-engineering-1000/ce-code-review/20261017-round4-205113-b24/`.
The parent accepted the narrow N52/N57b implementation in
`/tmp/forge-b24-publication-20261017/parent-acceptance.md` at 21:06UTC.
The production/test/catalog/provenance pins remain identical to R4 through this
documentation closeout. Source/base is
`90908a4326901232ec0ff7569744a0e6b7e89e25`, build `9ddibi_U7Zni5GaFWawOC`.

Fresh genuine browser evidence completed 21:02:46UTC in
`/tmp/forge-b24-firstfold-browser-20261017/{report.md,receipt.json,performance.json}`.
Eight JS-off first-viewport cases and eight JS-on controls passed, including
actual Arabic RTL and compact landscape. Notice bounds are y144–189 desktop,
y88–161 mobile and y68–113 compact; all sampled text is visible/hit-tested with
no horizontal overflow. Compact Arabic's existing header skeleton overlaps 12px
of paragraph padding; text starts at y82, below the skeleton end at y80. This is readable
text, not zero box overlap or physical safe-area/device proof.

JS-on has no parsed notice/container, zero-size noscript, no spacer and main y0.
Fresh mobile Seed Demo Video search returned actual API200 in 19.3ms with visible
results and no four-second flash. Earlier 5200ms actual-response-delivery and
request-generation cleanup diagnostics remain earlier-stage evidence, not
natural server latency.

Current video initial-load measurements used before-navigation observers for
four warm samples: desktop CLS about 0.0408, mobile 0, longtasks 0, FCP 60–68ms.
There is no prior same-route video baseline or regression attribution; do not
claim page-wide zero CLS, statistical or field-CWV clearance. Homepage timing
was excluded during an identity failure. Static 116 JavaScript files/4722613 raw
bytes remain identical after build-ID directory normalization; CSS+359 raw/+27
observed encoded bytes. Prior 12 paired warm home/search-mount captures remain
historical with their source/build/sample/cache limits. The parent accepted this
risk-matched evidence without another full benchmark.

A homepage HTTP200 briefly carried foreign build `7CleSsSLpddT-3kK3bjv9` and
`x-nextjs-cache:HIT` while B24 PID3334724/startticks7101578/socket24568260 and disk
build stayed unchanged. It recovered without intervention; all final tested
pages passed build gates. No foreign page was accepted as test evidence. Cause
is unproven and local QA only; feat736 tracks the separate investigation.

The early browser metadata read may have initialized a blank context before disk
admission; no app route or timed capture ran then. This procedural exception is
retained; future bootstrap must await guarded admission/completion. It was not
hidden by rerunning expensive checks.

Current test accounting remains 678/679 in the affected run, with the unchanged
provenance subprocess failure repeated in the sandbox, then 12/12 notice/provenance
cases passing on the guarded normal host. All 679 distinct cases have passing
runs, not one green 679 invocation. Earlier 764 tests are historical. Types,
touched lint/format, catalog drift and the canonical default build passed as
recorded; publication validation and normal-hook receipts are retained separately.

Feat735 remains not-started/P2/vlad for the baseline home/video Terms hidden under
streamed S:3/S:0 containers; Arabic index footer remains not applicable. No full
no-JS SSR fix or production-cache cause is claimed. CE compound assessment found
no additional B24 learning beyond code/tests/ticket; unsolved cache/footer causes
remain follow-ups, not solved solution documents.
