---
id: "feat-727"
title: "Validate Watch download consent and share copy on current main"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-17"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "i18n"
  - "accessibility"
---

## Problem

[FGE-289](https://linear.app/jesus-film-project/issue/FGE-289) QA N65 needs a whole
localized download consent sentence with its Terms link. N50a needs localized
new-tab hints in social share accessible names. Preserve the implementation and
catalogs offered in [PR #2753](https://github.com/JesusFilm/forge/pull/2753) while
rebasing onto current main and validating provenance.

## Entry Points — Read These First

1. `apps/web/src/components/watch/DownloadModal.tsx` and
   `apps/web/src/components/watch/__tests__/DownloadModal.test.tsx`: rich-text
   consent sentence, checkbox name, text toggling, and Terms button behavior.
2. `apps/web/src/components/watch/ShareModal.tsx` and
   `apps/web/src/components/watch/__tests__/ShareModal.test.tsx`: localized
   `opensInNewTab` names and existing social link attributes.
3. `apps/web/messages/*.json`, `apps/web/scripts/ui-translation-policy.json`,
   `apps/web/scripts/translate-ui-catalogs.test.mjs`, `apps/web/vitest.setup.ts`,
   and `docs/i18n/watch-ui-provisional-catalogs.json`: preserve offered copy,
   current-main translations, and source-digest evidence.
4. `docs/solutions/workflow-issues/merge-pending-catalog-fallbacks-with-localized-provenance.md`
   and `docs/analytics-and-recommendation-policy.md`.

## Grep These

`termsAgreement|termsAgreementPrefix|termsAgreementSuffix|opensInNewTab|sourceDigest|catalogDigest|sourceExtensions`

## What To Build

Repair PR #2753 onto main with minimal conflict and provenance changes. Retain
all 225 offered catalog deltas, one complete consent sentence per locale with
its rich-text link, and translated accessible new-tab hints. Inspect compatibility
with preceding PR #2742 without absorbing its changes. Record any integration
dependency for the parent to resolve.

## Constraints

No translation or inference APIs/scripts, invented translations, broad English
fallback, UI redesign, generated GraphQL edits, or changes to analytics or consent
policy. Preserve unrelated main translations and provenance. Use existing digest
helpers for provenance updates. Parent owns independent review, canonical
publication, and CI; this isolated worker does not push or publish.

## Verification

- Run focused DownloadModal/ShareModal and translation-script tests, catalog
  parity, provisional provenance, and generated locale/provisional checks.
- Run touched-file Prettier/ESLint and applicable TypeScript checks.
- Confirm unrelated catalog leaves and source extensions survive the rebase.
- Record why a copy/provenance-only repair needs no new page-load measurement;
  measure if the repair changes rendering, hydration, media, routing, or init.
- Reconcile this ticket’s row and status counts in `docs/roadmap/README.md`,
  preserving the current main index’s date-free layout.
- Record local verification separately from remaining parent review and CI.

## Local Verification Result

Verified on 2026-10-17 against main `848ce82f8d675431c83d66aef3651953d4183b8d`.
Rebased PR head `3a34b53e3ff219e676f26b475792481643b97193` as
`c48aaf987886a9b9badb464d7f9af6071079a2e9`. The only conflict was
`apps/web/vitest.setup.ts`; retain both main's Spanish and the PR's Hindi/Urdu
catalog entries. No catalog copy, modal implementation, or provenance manifest
needed a conflict edit.

- Node 24.19.0: six focused Vitest suites passed, 653 tests total:
  DownloadModal, ShareModal, messages-parity, watch-ui-provisional-catalogs,
  translate-ui-catalogs, and FeedbackLauncher (including main's Spanish flow).
- `node scripts/generate-provisional-ui-catalogs.mjs --check` and
  `node scripts/generate-ui-locales.mjs --check` passed from `apps/web`.
- `tsc --noEmit --incremental false`, touched-file ESLint with
  `--max-warnings=0` from `apps/web`, and all 233 rebased PR files' Prettier
  checks passed. Existing tests were preserved unchanged.
- The roadmap generator initially restored legacy dates and an overdue count
  absent from current main, and reported 18 pre-existing frontmatter skips.
  The parent retained main’s date-free index and reconciled only feat-727’s
  row and counts: 858 total, 639 complete, overdue/open unchanged at 0.
  Every existing main row is preserved; no other ticket bodies were edited.
- The initial sandbox-only generator fixture failure reproduced Node
  `spawnSync EPERM`; it passed through ordinary approved execution. An older
  incomplete shared dependency cache was replaced with read-only reuse of the
  offered PR checkout's matching installed dependencies, with local workspace
  package links. No dependency installation or configuration change was needed.
- The repair changes no rendering, hydration, media, routing, or initialization
  path beyond the offered implementation; no new page-load measurement is
  necessary. Browser runtime smoke was not run: the isolated checkout has no
  configured Watch server/backend. Real next-intl modal rendering is covered
  by the passing jsdom tests.

## Integration Note

PR #2742 was inspected at `c8978cede8a7f38f04d6c21f985f7f53aea09cf0`.
It has zero same-locale leaf overlap with this PR and no runtime dependency.
Its translation policy removes 20 pending paths, so sequential integration
requires reconciliation of current provenance digests while retaining both
PRs' original `sourceExtensions` evidence. This PR alone validates against
main; no changes from #2742 were absorbed here.

The respective source digests are
`b5f588b922143ea56872c70e4448067a687cfc270ec1f66eda9b0a1bb676a07b`
(#2753) and
`dc3efd5887e25eadab89be2b5c57b4279189116144a588acf61ea10d39ba93c7`
(#2742); their combined source/policy digest is
`623976f7bdbefaeb39db53405d76db92595102975c1ba08a114fe8b0ed4980fd`.
Parent decides integration order and any stack or later rebase. Independent
review, canonical publication, and CI remain parent-owned; local completion is
not merge approval.
