---
title: Sitemap inclusion is not hreflang eligibility, and relaxing a per-entry invariant needs an aggregate to replace it
date: 2026-09-22
problem_type: architecture_pattern
category: architecture-patterns
component: apps_web
root_cause: conflated_concerns
resolution_type: code_fix
severity: high
tags:
  - watch
  - seo
  - sitemap
  - hreflang
  - i18n
  - wire-contract
  - deploy-order
  - code-review
related:
  - docs/roadmap/platform/feat-533-watch-sitemap-full-language-coverage.md
  - docs/roadmap/platform/feat-538-watch-sitemap-materialization-and-manifest-byte-cap.md
  - docs/solutions/performance-issues/watch-hreflang-sitemap-manifest-20260612.md
  - docs/solutions/architecture-patterns/widening-a-closed-selection-block-into-an-authored-list-20260827.md
---

# Sitemap inclusion is not hreflang eligibility, and relaxing a per-entry invariant needs an aggregate to replace it

## Problem

Watch's sitemap generator derived every `<loc>` **from the hreflang alternate
list**. The alternate list only accepts BCP-47 tags that normalize to a
Google-valid hreflang (`[a-z]{2}` language subtag, optional `[A-Z]{2}` region),
so a language with no ISO-639-1 code was dropped from the manifest — and because
the URL was derived from the alternate, dropping the alternate **deleted the
URL**. A content item whose languages all failed the test was dropped entirely
by `.filter((group) => group.alternates.length > 0)`.

`/watch/jesus.html/cebuano.html` returned 200 in production and appeared zero
times in the sitemap. Watch advertises 2,000+ languages; the sitemap exposed
roughly 140. Cebuano alone has ~20M speakers.

Nothing failed. There was no error, no log line, no failing test — the sitemap
was internally consistent and the auditor passed. The defect was only visible by
comparing what the site serves against what the sitemap advertises.

## The rule

**Two different questions were answered by one predicate.**

- _Should this URL be discoverable?_ -> it is playable. Nothing else.
- _Should this URL carry an `<xhtml:link>` annotation?_ -> it has a
  Google-valid hreflang AND the other cluster members point back at it.

Any time one predicate answers both a **visibility** question and an
**annotation/enrichment** question, the stricter one silently deletes from the
looser one's output. Split them, and let the looser one drive inclusion.

## Do not annotate a non-member

The tempting shortcut is to emit the long-tail `<loc>` and give it the same
`<xhtml:link>` block the cluster uses. That is worse than the bug. Google
requires hreflang reciprocity: every page in a set lists every page in the set,
**including itself**. A URL publishing a set it is not in is non-reciprocal, and
Google's documented response is to ignore the annotations — for the whole
cluster. You would trade a discovery gap for ~140 working languages losing their
hreflang.

A `<url>` with a `<loc>` and no `<xhtml:link>` is valid sitemap XML (the child
is optional) and indexes normally. Ship the long tail bare.

## Relaxing a per-entry invariant is a silent-pass change

The offline auditor enforced "every canonical entry includes itself in its
alternate set." Unannotated entries have no alternate set, so that rule had to
become conditional on the entry annotating at all.

That conditional is a **silent-pass guard change**, and it costs real detection:
a bug that strips a cluster's annotations now produces XML byte-identical to a
legitimate long-tail URL. For a single-member cluster nothing else fires either —
the reciprocity rules only trigger when some _other_ entry references the URL.

When you narrow a per-entry invariant, add an **aggregate** that the narrowed
rule can no longer reach. Here: fail a sitemap that publishes canonical entries
with zero hreflang across the whole run. That holds because the two Watch home
entries build their alternates in code and never from the manifest, so a healthy
sitemap can never reach zero — the aggregate has a structural reason to be true,
not just an empirical one. State that reason at the guard; an aggregate whose
floor is only "we have never seen it that low" is a flake waiting to happen.

## Widening a cross-service wire contract

The ticket asked for `toAlternates` to return `{ languageSlug, hreflang: string | null }`.
Do not do that. The consumer (`apps/web`) validates with
`isString(record.hreflang)` and returns `null` for the **entire manifest** on a
single predicate failure, and its sitemap routes then serve 503. A nullable
`hreflang` would have dark-served the whole sitemap for every web replica that
had not deployed yet.

Add the field beside the old one instead (the feat-439 widening law), and make
it **optional on both sides**:

- Optional in the producer's schema, because admin's `WatchSeoManifestStore.getLatest()`
  re-parses the persisted snapshot with the current build's schema on every read.
  A required field 500s the route against the snapshot the previous build wrote,
  until the next Core sync regenerates it — a window nothing in the deploy
  controls.
- Optional in the consumer's type with a fallback to the old field, so an old
  producer degrades to the previous output rather than to nothing.

That is what makes the deploy order irrelevant instead of merely documented.
Prove it at the HTTP layer, not only in unit tests: serve a manifest without the
new field from a stub and diff the rendered sitemap against the pre-change one.

## Verification

```bash
pnpm --filter @forge/admin test -- src/services/watch-seo-manifest.service.test.ts src/services/watch-seo-manifest-store.test.ts src/services/watch-seo-manifest-refresh.service.test.ts
pnpm --filter @forge/web test -- src/lib/watch-sitemap.test.ts src/lib/watch-sitemap-audit.test.ts src/lib/watch-seo-manifest.test.ts src/app/sitemap.test.ts
pnpm --filter @forge/web audit:watch-sitemap -- --origin <origin>/watch
```

The auditor is the one check that reads the served bytes rather than the code,
so run it against a real `next build` + `next start`, with the manifest served
by a stub in both shapes (with and without the new field).

## Prevention

- Never derive a URL's existence from its enrichment metadata. Derive existence
  from the thing that makes the URL real.
- Before narrowing any guard, ask what regression the wide version was catching
  and what will catch it now.
- A coverage change with no error signal needs its own counter. This change
  added `canonicalVideoUrls` to the manifest generation log precisely because
  the previous bug's whole character was that nothing reported it.
