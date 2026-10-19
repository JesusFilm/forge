# Consolidate TV work into draft PR 2719

## Scope

The owner chose to update the existing draft, not merge it into main. Work in
`codex/tv-selected-improvements` at the managed candidate checkout and retain its
existing local recordings, native artifacts and ignored configuration.

Inputs are the original draft `11103c5e3`, current-main preservation `abf9b5c1a`,
selected improvements `956ee6e39`, verification limits `14f4804a1`, and the
uncommitted foreground/native Top Shelf follow-ups. The four comparison branches
were selectively integrated already; merging their heads again would reintroduce
excluded features. Latest fetched main is
`ef37fa836532f19b1dbefbfcda79082df62e340b`.

## Execution

1. Preserve a local patch, file backups and TV source/environment fingerprints.
2. Commit the reviewed Top Shelf changes with normal hooks. Merge latest main,
   preserving existing TV source and resolving roadmap ID collisions.
3. Remap local TV IDs 734–738 to 747–751. Track this consolidation as feat-752.
4. Run TV typecheck, lint, Jest, development-harness fixtures, Foundation native
   regressions and CI-sensitive formatting, patch and roadmap-ID checks. Compare
   final runtime sources with previously built/tested artifacts; rebuild only if
   integration changes invalidate that native evidence.
5. Publish the validated Git tree through the connected `up-tandem`
   account with an expected-head lease, preserving the existing draft and main ancestry. The
   local Git credential for this account is unavailable, so use GitHub Git Data
   with an expected-head lease and verify exact tree equality. Fetch that published
   commit and fast-forward the original local draft branch; update the PR title/body
   and inspect GitHub checks.

## Boundaries

No production content API or Push tests, app/data resets, new public backend,
dependency/player rewrite, main merge, deployment or store upload. Native public
feed remains default-off. Preserve Native A / Media3, hidden Profile, disabled
startup/menu animations, dots loading and the development harness.

Implementation consolidation does not close existing player-control, physical-TV,
Google Home placement or distribution gaps. Keep selected-integration and broader
Top Shelf roadmap tickets open for their remaining acceptance.

## Result

Local consolidation is complete. The Top Shelf implementation is committed as
`cb827eedc`; latest main merged without source conflicts as `21cb84901`. All 610 TV runtime,
configuration and test files remain byte-identical to the pre-merge candidate,
and private endpoint bytes are unchanged. Upstream GraphQL changes are additive
film-finder types that TV does not use; introspection is erased from runtime.
Previous native builds/UI evidence therefore remain applicable to their original
configurations, with their documented limits. No new native build or app/API run
is claimed for this source-preserving consolidation.

Validation passes: typecheck, lint, 186 Jest suites / 2,328 tests, 20 harness
fixtures, 19 Foundation regressions and dependency-patch consistency. Normal
commit hooks run staged lint/format and whole-repository formatting. Publication
uses the connected account and verifies exact local/remote tree equality; draft
PR 2719 remains the review destination, not a production merge.

The final publication receipt and CI state are retained under
`.local-tools/tv-pr-consolidation/`. TV tickets now use 747–751; historical local
logs/recordings retain their original IDs and are not rewritten. Selected
integration ticket 749 and broader Top Shelf ticket 630 remain in progress for
previously documented native-control, physical-device and distribution gates.

Publication check: the initial connected-account commit message exceeded the
100-character body-line limit. Correct only that newly published integration
commit through an expected-head lease, preserving the original draft/main parents
and all TV source. Validate the exact publication message locally before retrying.
The initial and corrected receipts/CI runs are retained in local evidence; never
rewrite another contributor's intervening head or disable commit lint.

CI also exposed five Apple language-panel unit cases attempting to import the
native Modal presenter on Linux. A focused mock now isolates only that native
host boundary; all loading/error/retry/empty/focus assertions remain intact.
Local and CI use the same RN TV version. The exact Linux-only trigger was not
reproduced on macOS, but the recorded failure stack identifies native presenter
introspection. A cold-cache CI-style full run passes 186 suites / 2,328 tests.
Only `SeriesLanguagePanel.test.tsx` differs among the 610 previously fingerprinted
TV source/config/test files; production runtime/native inputs are unchanged.
