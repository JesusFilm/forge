---
title: "A frozen language corpus must not veto a route the live manifest admits"
date: "2026-09-04"
category: "logic-errors"
module: "apps/web Watch routing"
problem_type: "logic_error"
component: "middleware"
symptoms:
  - "/watch/jesus.html/german-pennsylvania.html returned 404 while the same variant was published and playable in admin and Core."
  - "58 languages published to admin after 2026-05-28 were unreachable on Watch and absent from the language picker."
  - "The failure surfaced as a bare 404 with nothing diagnosable in logs, because an unknown language slug was reinterpreted as an episode slug."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "apps/web src/proxy.ts"
  - "apps/web catch-all page classify()"
  - "apps/web src/lib/watch-route-manifest.ts"
  - "packages/watch-url-policy public-watch-language-slugs.ts"
tags:
  - "watch-route"
  - "route-manifest"
  - "language-slug"
  - "codegen-drift"
  - "fallback-as-authority"
linear: "FGE-81"
---

## Symptom

Jessie Eaton reported that the newly published Pennsylvania Dutch JESUS route
`/watch/jesus.html/german-pennsylvania.html?t=115&autoplay=1` returned 404.
Core and admin both held the language (`pdc`, Core id 2993) and a published,
playable full-film dub. Production probes showed the same for `salar`, `fore`,
`ralte`, and 54 other slugs — every language admin published after
2026-05-28.

## Root cause

Watch URLs have no delimiter between `/{content}.html/{language}.html` and
`/{series}.html/{episode}.html`, so the proxy and the catch-all page decide
the shape by asking "is the second segment a language?". That question was
answered by `isPublicWatchLanguageSlug`, which reads
`PUBLIC_WATCH_LANGUAGE_SLUGS` — a compile-time corpus generated from a
2026-05-28 snapshot of admin's `Language.bcp47`.

Three defects compounded:

1. **The fallback was wired as the authority.** The live route manifest
   (`/api/watch-route-manifest`, fetched on every proxy request with a 60s
   cache) listed `german-pennsylvania` under `audioLanguageSlugs` and admitted
   it for `jesus`. But the corpus check ran first, in `classifyRewrite`, and
   an unknown slug fell through to the implicit-English **episode** branch
   with `requiresExactEpisodeAdmission: true`. No such episode exists, so the
   manifest correctly rejected an episode nobody asked for.
2. **The regeneration path did not exist.** The generated file's header named
   a `generate:language-bcp47-map` script and a drift test; neither was in the
   repo. The only "drift" test compared the corpus to the map it was derived
   from — tautological, so it could never go red when admin added a language.
3. **The failure was indistinguishable from a real 404.** An unknown language
   produced a failed episode lookup, not an "unknown language" signal.

The earlier FGE-81 preflight (2026-08-22) could not catch this: every URL it
probed used a language inside the snapshot.

## Fix

- `isWatchAudioLanguageSlug(slug, manifest)` in
  `apps/web/src/lib/watch-route-manifest.ts`: compiled corpus **OR** the
  manifest's `audioLanguageSlugs`. `null` manifest degrades to the corpus
  alone, so an unavailable manifest never widens the namespace.
- `src/proxy.ts` fetches the manifest once per request, threads it into
  `classifyRewrite` (two-segment, three-segment, and `/{lang}.html/videos`
  branches) and `classifyManifestAdmission`, and logs
  `watch_route.implicit_english_episode.rejected` with `manifestAvailable`
  whenever the implicit-episode fallthrough is rejected.
- The catch-all page's `classify()` became async but awaits the manifest
  **only** when the corpus misses, so the existing "content resolution starts
  alongside the manifest request" contract holds for known languages.
- `scripts/generate-language-bcp47-map.ts` (+ pure
  `src/lib/language-bcp47-map-codegen.ts`) regenerates both artifacts from
  admin's public `languages` query (500-row pages, no bearer) and has a
  `--check` mode. `.github/workflows/watch-language-corpus-drift.yml` runs the
  check daily and opens a refresh PR on drift.
- Regenerated data: +58 languages, −4 soft-deleted in admin (`dari-4`,
  `miao-eastern-xiangxi`, `spanish`, `twi` — all already 404 in production).

## Prevention

- **A synchronous fallback namespace is fine; a fallback wired as the primary
  veto is not.** When a live source is already on the request path, consult
  it before letting a compiled snapshot decide shape.
- **Any regression probe for a "frozen snapshot" defect must include an
  item published after the snapshot date.** The locale suite now pins
  `german-pennsylvania`, `salar`, `fore`, `ralte`; the proxy/page suites use a
  synthetic slug pinned as absent from the corpus so a future regeneration
  cannot make them vacuous.
- **A generated file's header is a contract.** If it names a script and a
  drift test, they must exist and the drift test must compare against the
  upstream source, not against a sibling artifact of the same snapshot.
- **Make the fallthrough distinguishable.** An unknown-discriminator branch
  that degrades into a different lookup should log its own event so the
  next occurrence is a Datadog query, not a support form.

## Residual

- `isLanguageLessWatchVideoPathEligible` and the client-side pickers/URL
  parsers still read the compiled corpus (client bundles cannot fetch the
  manifest); they learn new languages only on regeneration. The scheduled
  workflow bounds that lag to about a day.
- A manifest-only language renders with English chrome and
  `<html lang="en">` until the corpus is refreshed, because the BCP-47
  projection lives only in the generated map.
- The scheduled workflow needs the repository setting "Allow GitHub Actions
  to create and approve pull requests" enabled to open the refresh PR.
