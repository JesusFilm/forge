---
title: "Watch language routing is URL-only"
date: "2026-10-15"
category: "architecture-patterns"
module: "apps/web watch routing"
problem_type: "architecture_pattern"
component: "proxy"
severity: "high"
applies_when:
  - "Changing how a Watch entry, utility, video, episode, or language-home route selects its language"
  - "Using forge_watch_lang, Accept-Language, or another request-state signal near Watch routing"
  - "Interpreting historical Watch language audits, plans, or closed tickets"
related_components:
  - "apps/web/src/proxy.ts"
  - "apps/web/src/lib/locale.ts"
  - "apps/web/src/lib/language-preference-client.ts"
  - "docs/roadmap/platform/feat-315-watch-language-less-english-default.md"
  - "docs/roadmap/platform/feat-645-watch-language-preference-redirect.md"
  - "docs/roadmap/platform/feat-708-watch-url-only-language-routing.md"
tags:
  - "watch"
  - "routing"
  - "localization"
  - "cookies"
  - "accept-language"
  - "decision-history"
---

# Watch language routing is URL-only

## Decision

The public Watch URL is the only authority for Watch language. The proxy must
not select or replace a route language from `forge_watch_lang`,
`Accept-Language`, another cookie, or other request-local state. A language
picker changes language by navigating to a public URL that names the selected
audio-language slug. Bare `/watch`, `/languages`, `/history`, and `/whats-new`
remain on their default URL-defined behavior rather than negotiating a visitor
language.

The continued existence of a legacy cookie writer, dormant server helper,
`parseAcceptLanguage`, `_lr`, an old plan, or a closed audit ticket is not
authorization to make Watch routing stateful. Search and subtitle preferences
are separate contracts and do not weaken this rule.

## Why the cookie was rejected

PR #1057 (`16a4bf54a`, 2026-05-28) fixed a probe-confirmed production bug. A
visitor with a stale `forge_watch_lang=bangla-2` cookie who opened the explicit
canonical URL `/watch/jesus.html/english.html` received a 307 to
`/watch/jesus.html/bangla-2.html`. The cookie overrode canonical, shared, and
SEO URLs and could send visitors to a degraded fallback. The fix removed
cookie reads from the proxy and recorded: "the URL is the sole locale carrier."

Feat-315 reinforced the boundary on 2026-07-24 for language-less video URLs:
default them to English and do not infer a target from `Accept-Language`,
cookies, or message locale. The language-preserving navigation plan on
2026-07-23 also required Watch-local links to carry language in the URL rather
than rely on cookies.

## Why the behavior was revived

FGE-176 was created from the 2026-09-13 Watch listing audit and later supported
by September QA reports. It classified two observations as a high-priority
site-wide bug:

1. `/watch` ignored the browser's `Accept-Language` header.
2. The picker wrote a one-year `forge_watch_lang` cookie that no production
   route read, so opening a new bare Watch tab returned to English.

The ticket did not frame those observations as a product-policy conflict. It
prescribed the implementation directly: cookie, then `Accept-Language`, then
English, with 307 redirects for the four bare routes. It had no relation to PR
#1057 or feat-315. Agents followed that concrete bug ticket and interpreted the
existing no-cookie proxy test as proof of a missing feature. They limited the
new behavior to bare routes, so explicit localized URLs still passed their
tests; that narrower scope appeared to reconcile the earlier explicit-URL bug
without revisiting the broader URL-only product decision.

PR #2658 merged that implementation on 2026-10-14. It had no human or agent
review recorded on GitHub. Its PR description demonstrated routing, caching,
and performance correctness but did not mention PR #1057, feat-315, or the
contradictory product policy. Technical validation therefore proved that the
requested mechanism worked, not that the mechanism was wanted.

## Push and merge timeline

There is no evidence that agents refused or were reluctant to push the change.
The first implementation commit and draft PR #2658 were pushed on 2026-10-08,
the same day work began. The initial implementation failed to run at the exact
`/watch` base-path root because its generic proxy matcher did not match that
request. A second commit fixed the matcher on 2026-10-10, after which the PR was
marked ready for review.

It then remained open without reviews until 2026-10-14. A Claude Code session
refreshed the branch onto current `main`; the only conflict was the generated
roadmap README. The PR was merged about 30 minutes later. The recorded delay is
therefore: draft while fixing a real integration defect, followed by an
unreviewed wait and branch refresh. It should not be described as agents not
wanting to push.

## Final resolution

Feat-708, authorized by the product owner on 2026-10-15, reverted the
cookie/header entry negotiation and retired feat-645. The regression test sends
both `forge_watch_lang=japanese` and `Accept-Language: ja-JP` to every formerly
negotiated bare route and proves that none redirects or varies on those inputs.
Explicit language URLs remain authoritative.

When future research again reports that a bare Watch tab opens in English,
treat that as the expected URL-only contract unless the owner explicitly
changes this decision. Do not convert it into a routing bug from historical QA
evidence alone.
