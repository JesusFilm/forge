# PR #2685 search-card reconciliation

Scope: feat-677, `apps/web/src/components/search/VideoCard{,.test}.tsx` and its
existing route dependency. Preserve the authored `Route | null` guard and global
modal search; tighten valid Unicode controls on actual main. No Admin/Core or
URL grammar change, publication, commit, push, build or browser work in this pass.

## Plan

1. Read the canonical FGE-2 report, six comments, prior triage and repository
   guidance. The July/Mostly Tea observer is unknown; Holly Gooden is attributed
   only to the related Know God collection-click report.
2. Retain feat-677, mark it in progress, verify no distinct retained identity
   collision, and preserve feat-918 for PR #2647.
3. Switch the assigned clean checkout to exact offered head
   `ea2a6e373f982f903cc15e2804328dded91115ca`. Integrate only exact actual main
   `a3a8f8796a8c25749c4cd02432397772dbf93cef` with a staged uncommitted merge.
   Currency is justified by `routes.ts` changing from ASCII to reviewed canonical
   Latin Unicode since `07d5aaf74bb60a9c65922f4b4ffbcb07dd3296a0`, while the
   owned runtime and tests are unchanged on main since that base.
4. Require both reported Unicode slugs to retain canonical links and playable
   affordances. Retain English omission/collisions, explicit audio, subtitle,
   unavailable recovery and custom-builder behavior.
5. Capture discriminating red against actual main's pre-guard runtime, then
   restore the byte-identical authored runtime for green. Verify inert DOM,
   callbacks/storage and real-grid row counts. Run scoped tests, full Web types,
   touched root/package lint/format and relevant roadmap/CI checks, one foreground
   heavy command at a time with at most two test workers, after parent release.
6. Self-review the exact main-relative delta and freeze its staged tree, index
   copy and hashes. Independent review, candidate CI, full modal/device/loading
   and broader FGE-2 acceptance remain parent-owned and pending.

## Work and self-review

The exact integration merged without conflicts. Runtime is reused unchanged from
PR #2685; only tests and owned documentation need reconciliation beyond it.
Dependency reuse requires matching package manifests, patches and the installed
lockfile; use local mutable cache directories and no shared `.next`.

The parent subsequently reserved heavy capacity for normal publication hooks and
another project's tests. Tests/typecheck/build/install and other heavy work are
deferred until explicit release. Source review cannot substitute for red/green
execution or frontend page-load verification.

## Compound

A guard test that permits either a canonical URL or null can pass while disabling
valid content after the route dependency is fixed. Once the canonical dependency
is integrated, pin the positive destination and playable DOM independently of
negative fallback cases. Preserve source/data acceptance as a separate boundary:
this guard does not establish Core title/publication or actual playback health.

## Parent validation after resource release

The #2647 browser worker completed and released its heavy-command claim. The
parent reproduced four actual homepage-fallback assertion failures against
main's runtime, restoring the exact authored guard afterward. All 390 scoped
tests in seven files then passed under Node 24.22.1, pool two with file
parallelism disabled. Full Web typecheck, touched root/package lint, owned
formatting and UI locale checks pass. Typecheck initially exposed missing local
Admin dependency links; restoring three links from the previously proven
compatible install resolved those errors without source changes or an install.

The two positive Unicode DOM tests initially expected raw Unicode hrefs, while
the existing playback-source URL helper correctly percent-encodes them. Pin
literal encoded destinations at both rendered anchor and click callback; keep
the direct builder, positive affordance and inert negative assertions intact.
This is a test expectation repair, not a runtime URL change.

Main advanced externally from `a3a8f879` to `c2e4bd3` through #2822. Its three
History page/test/ticket paths are disjoint from this guard and its route
dependency; retain that exact comparison receipt instead of an age-only merge.
No commit, publication, candidate CI, independent review or actual
modal/device/loading acceptance is implied by these local checks. Feat-677 stays
in progress; broader FGE-2 source/title/publication/playback requirements remain
separate.
