---
title: "Keep unavailable Watch search evidence separate from playback identity"
date: "2026-08-13"
category: "logic-errors"
module: "Watch search-to-route handoff"
problem_type: "logic_error"
component: "service_object"
severity: "high"
symptoms:
  - "A relevant Watch search result classified as unavailable opened a generic 404 when activated"
  - "The selected search language appeared in a playback-shaped URL even though Admin supplied no playable action language"
  - "Exact route admission rejected the fabricated content-and-audio combination instead of reaching a useful recovery experience"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "apps/admin Watch search contract"
  - "apps/web search result mapping"
  - "apps/web Watch route admission"
  - "Next.js App Router not-found recovery"
tags:
  - "watch-search"
  - "unavailable-language"
  - "playback-identity"
  - "language-routing"
  - "route-manifest"
  - "app-router"
  - "not-found"
  - "recovery"
---

# Keep unavailable Watch search evidence separate from playback identity

## Problem

Watch search can return a relevant Video while truthfully classifying it as
`unavailable`. In that state, Admin deliberately supplies no language,
playback, Dub, subtitle, duration, or href identity. Web previously treated
the missing audio language as an omission to repair, filled it with the
selected or resolved search language, and passed the result through the normal
playback URL builder.

The route manifest then correctly rejected the fabricated content/audio pair,
so clicking a useful search result ended on the generic Watch 404. For example,
a Simplified Chinese metadata match could become a
`/good-friday-live.html/chinese-simplified.html` playback claim even though the
search response contained no Simplified Chinese action language.

## Root Cause

The handoff collapsed three different language roles:

- **Search target**: the language used for the completed search result set.
- **Evidence language**: the language of the title, metadata, or transcript
  that made the result relevant.
- **Playback identity**: the published audio language that may be encoded in a
  public Watch playback URL.

For an unavailable result, search target and evidence may both be known while
playback identity is intentionally null. Null is authoritative negative
information here, not a field Web may fill from the search control.

Two additional boundaries made the failure easy to mishandle:

- the search control remains editable after results arrive, so recovery must
  use the target attached to the completed result set rather than the current
  draft selection; and
- a generic 404 cannot distinguish known content missing one exact language
  from unknown content or an old manifest without exact evidence.

## What Didn't Work

### Filling every null result language

The failure pattern treated language enrichment as harmless normalization:

```ts
if (result.type === "video" && result.languageSlug == null) {
  result.languageSlug = resolvedLanguage.publicSlug
}
```

That fallback is valid only when a playable state has already established an
audio action. It is invalid for `target_subtitle`, where playback and subtitle
languages differ, and for `unavailable`, where no playback action exists.

### Reusing the normal playback destination

Sending every Video through a builder shaped like
`watchVideoPath(slug, result.languageSlug ?? english)` turns display or search
context into a playback claim. Silently redirecting to English has the same
problem: it changes viewer intent and hides that the requested version does
not exist.

### Treating every manifest rejection as a verified gap

Knowing that a language exists somewhere in Watch does not prove that one
Video lacks or supports it. Absence from an older manifest is also not proof of
unavailability. Unknown content and inconclusive evidence must retain the
ordinary 404 rather than receive a specialized recovery page.

### Returning a terminal 404 from Proxy

Proxy classifies the route and rewrites it to the locale-scoped sentinel. The
sentinel calls `notFound()`, allowing the nearest not-found boundary to render
the recovery UI while keeping classification separate from the final document.

## Solution

### 1. Preserve null playback identity

Both Web search mappings exclude `unavailable` and `target_subtitle` rows from
the resolved-language fallback. An unavailable result therefore keeps
`languageSlug: null` even when Admin reports a non-null completed search
target.

Carry that completed target separately on the search response. The result row
continues to describe what can play; the response-level target describes what
the viewer searched for. The result overlay binds its cards to the completed
target, so changing the language control after results arrive cannot rewrite
their recovery destination.

### 2. Build an unavailable request without claiming playback

The unavailable card branch uses the content slug plus completed requested
language to form an intentional unavailable address. The path has the same
wire shape as an explicit Watch language route, but its type and documentation
make clear that syntax is not proof of playability.

If the content slug or completed target language is absent or malformed, the
card fails closed to the Watch search surface. Normal target-audio and
target-subtitle results retain their existing URL behavior.

### 3. Admit recovery only from exact manifest proof

The route-manifest helper distinguishes four states:

- `admitted`: the exact content/audio pair is playable;
- `known-missing`: the content and exact per-content index are known, but the
  requested audio language is absent;
- `unknown-content`: the content slug is not known; and
- `inconclusive`: the manifest cannot prove exact absence.

Only `known-missing` enters specialized unavailable-language recovery.
Unknown-content and inconclusive rejections keep the ordinary Watch 404. This
preserves the route manifest as an admission contract instead of weakening it
to make a search result appear playable.

### 4. Finish through a true not-found boundary

Proxy rewrites an exact known gap to one fixed internal unavailable sentinel
without setting the final status on the intermediate response. The sentinel
calls `notFound()`, and its nearest locale boundary renders the recovery UI.

The final public response remains HTTP 404 with `noindex, nofollow`, no
canonical, and no video structured data. The browser retains the original
content/language URL, while the fixed internal destination bounds route and
cache cardinality.

### 5. Treat browser context as optional presentation data

The tab-scoped recovery snapshot stores only the target slug and title, safe
artwork, requested-language display data, schema version, and creation time. It
has a short TTL and a byte ceiling, and it excludes query text, request IDs,
snippets, evidence, playback IDs, result lists, and destination links.

Reads require an exact content/requested-language match and remove stale,
malformed, oversized, or mismatched data. The server independently re-proves
the exact gap, so browser storage cannot admit a route or mint playback.

Artwork follows the same authority boundary. While server admission is
pending, the page renders a CSS gradient and no image element. After admission
completes, it renders only the approved content image, or the static fallback
when no approved image exists. This avoids downloading a default image and
then replacing it with a second network image.

### 6. Offer only explicit, admitted same-video audio options

The recovery action resolves published, HLS-playable variants for the same
content slug, excludes the requested missing language, and intersects every
remaining option with exact route-manifest admission before building a URL.

The client starts with no selected option. The watch action remains disabled
until the viewer explicitly chooses one, and navigation uses only the admitted
href returned by the server. One transient resolution failure may retry once;
a second failure settles into safe browse-only recovery rather than looping or
inventing a fallback.

## Why This Works

The fix gives one authority to each question:

1. Admin search supplies relevance, availability, and the completed search
   target.
2. Only an action/result audio language establishes playback identity; for
   `unavailable`, the truthful value is null.
3. The exact Watch Route Manifest decides whether a public pair is playable,
   a verified language gap, unknown, or inconclusive.
4. The recovery action exposes only same-video playback destinations that pass
   exact admission.

Search evidence can still lead a viewer to useful content, but evidence,
selected language, UI locale, and session storage cannot manufacture a Dub.
The specialized sentinel keeps honest 404/SEO semantics while giving the
viewer a useful, explicit next choice.

## Verification

Cover every boundary rather than testing only the final component:

- unavailable mapping preserves `languageSlug: null` while retaining the
  completed target separately;
- changing the draft search language after completion does not change the
  unavailable href or stored target;
- malformed or absent requested-language input fails closed;
- manifest tests pin admitted, known-missing, unknown-content, and
  inconclusive outcomes;
- proxy tests send only exact known gaps to the fixed unavailable sentinel;
- production HTTP checks prove final 404/noindex behavior, ordinary-404
  separation, and unchanged indexable playback routes;
- storage tests cover TTL, byte limit, exact target binding, and forbidden
  search/playback fields;
- recovery options are same-video, playable, exact-manifest-admitted, and not
  preselected;
- transient failure retries once and persistent failure terminates safely; and
- pending artwork renders no image, then resolves to exactly one final image.

## Prevention

- Model search target, evidence, availability, subtitle intent, and playback
  action as separate fields. Do not reuse one language slug for several roles.
- Treat null playback identity on `unavailable` as a contract, not missing data
  to enrich.
- Keep URL tests table-driven by availability kind. Missing required identity
  must fail closed.
- Never collapse unknown or inconclusive route evidence into known-missing.
- Test Proxy's intermediate rewrite separately from the final production HTTP
  status and App Router boundary.
- Treat browser storage as untrusted presentation context, never admission.
- Do not silently choose English or the first playable language.
- When the final image URL depends on asynchronous admission, use a non-image
  placeholder until that decision is complete.

## Related

- [Watch subtitle-only search results need separate availability and playback languages](watch-search-subtitle-playback-contract.md)
- [Separate Watch Search lexical language from playback language](watch-search-chinese-lexical-playback-language-conflation.md)
- [Use a statusless proxy rewrite and fixed not-found sentinel for App Router 404s](../integration-issues/nextjs-proxy-not-found-sentinel-preserves-app-router-navigation.md)
- [Admin-owned Watch route manifest](../architecture-patterns/admin-owned-watch-route-manifest-20260530.md)
- [Static locale rewrite and route-manifest admission](../performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md)
