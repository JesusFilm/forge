---
title: Merge pending catalog fallbacks without reverting localized provenance
date: 2026-08-25
category: workflow-issues
module: apps/web Watch i18n catalogs
problem_type: workflow_issue
component: tooling
severity: medium
applies_when:
  - A branch adds a pending source-language fallback to every UI locale catalog
  - Main independently improves translated siblings in the same catalog object
  - The merge also changes translation context or generated provenance metadata
tags: [watch, i18n, locale-catalogs, translation-provenance, merge-conflicts]
---

# Merge pending catalog fallbacks without reverting localized provenance

## Context

PR [#2023](https://github.com/JesusFilm/forge/pull/2023) added
`WatchNotFound.languageDescription` to every Watch UI locale catalog as an
intentional English fallback. While that branch was open, PR
[#2025](https://github.com/JesusFilm/forge/pull/2025) improved the existing
Chinese `WatchNotFound` translations, added translation context for catalog prompts, and
regenerated catalog provenance.

The merge required reconciling changes in `zh.json`, `zh-Hans.json`, and
`zh-Hant.json`, but the two changes were not alternatives. One added a pending
leaf; the other improved localized sibling values and the metadata describing
how catalogs were produced. Choosing either catalog object wholesale would
have silently lost a valid part of the other change.

## Guidance

Resolve catalog conflicts by preserving their independent invariants:

1. Keep additive pending keys in the resolved locale object. In this case,
   every catalog keeps `WatchNotFound.languageDescription` with its temporary
   English source copy.
2. Keep newer reviewed or context-aware translations for existing sibling
   keys. The Chinese `description`, `actionsLabel`, and `backToWatch` values
   from main remain localized.
3. Keep the pending key narrowly declared in
   `apps/web/scripts/ui-translation-policy.json`. This makes the temporary
   source-language fallback explicit without marking a whole catalog
   provisional.
4. Keep translation context in
   `apps/web/scripts/openai-catalog-translator.mjs` and generated provenance
   that validate against the resolved catalogs. If provenance cannot be shown
   to describe the resolved catalogs, regenerate it instead of manually
   combining stale model groups or digests.
5. Validate the runtime consumer, structural catalog parity, pending-path
   policy, and provenance together. Valid JSON proves syntax only, not a
   correct semantic merge.

The runtime consumer makes the pending key part of the 404 contract:
`apps/web/src/components/WatchNotFound.tsx` passes
`t("languageDescription")` into the shared globe section. The provisional
catalog test removes configured pending paths before calculating the translated
source digest, then independently verifies per-locale provenance and fallback
model groups.

## Why This Matters

A UI Catalog, its Pending Translation Paths, and its Translation Provenance are
related but distinct contracts. The catalog makes copy available at runtime;
the pending-path policy records that a specific source-language fallback is not
yet a completed translation; provenance describes the translated portion of
the catalog.

Treating a conflict as “ours versus theirs” can therefore produce a catalog
that parses while reverting native copy, dropping a required runtime key, or
claiming provenance that no longer matches the resolved content. Merging by
invariant preserves structural parity without mislabeling fallback text as a
finished translation.

## When to Apply

- A feature branch adds keys to many locale catalogs while main changes values
  in the same message namespace.
- A conflict spans locale JSON, translation policy, translator context, or a
  generated manifest.
- An intentional source-language fallback must coexist with completed
  translations in the same catalog.
- A generated manifest contains model groups or digests that could become
  stale after manual conflict resolution.

## Examples

For a conflict where one side adds a new leaf and the other improves existing
translations, merge the leaf into the newer object:

```json
{
  "WatchNotFound": {
    "description": "<keep the newer localized value>",
    "actionsLabel": "<keep the newer localized value>",
    "backToWatch": "<keep the newer localized value>",
    "languageDescription": "<keep the intentional pending fallback>"
  }
}
```

Then run the focused catalog and component suites, followed by typecheck, lint,
and formatting after the merge.

## Related

- [Give UI catalog translation prompts verified screen context](../best-practices/watch-ui-catalog-translation-context-prompts.md)
- [Machine-translated UI catalogs can pass syntax gates in the wrong language](../ui-bugs/machine-translated-ui-catalog-wrong-language-validation-gap.md)
- [Watch authored UI catalog translation completion](../../roadmap/platform/feat-277-watch-authored-ui-catalog-translation-completion.md)
- [Preserve Watch locale on true not-found pages](../../roadmap/platform/feat-397-watch-localized-not-found.md)
- [PR #2023](https://github.com/JesusFilm/forge/pull/2023)
- [PR #2025](https://github.com/JesusFilm/forge/pull/2025)
