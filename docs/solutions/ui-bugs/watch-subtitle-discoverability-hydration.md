---
title: "Watch subtitle affordances and localized hero counts must hydrate from server-owned labels"
date: "2026-08-22"
last_updated: "2026-08-23"
category: "ui-bugs"
module: "apps/web/watch"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Watch subtitles were represented by ambiguous or glyph-only controls before and during playback."
  - "A Video with one audio Dub and offered subtitles could render non-interactive subtitle metadata."
  - "The Xhosa JESUS route emitted React hydration error 418 when the server and browser formatted the localized audio-language count differently."
  - "The subtitle tooltip wrapped its heading and language onto separate lines with a dangling separator, while adjacent icon-only player controls had no equivalent visible help."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx"
  - "apps/web/src/components/watch/HeroPlayer.tsx"
  - "apps/web/src/components/watch/HeroPlayerControls.tsx"
  - "apps/web/src/components/watch/ChromeButton.tsx"
  - "apps/web/src/components/watch/SeriesPageClient.tsx"
  - "apps/web/src/components/watch/SeriesHero.tsx"
  - "apps/web/src/lib/content.ts"
tags:
  - "watch-page"
  - "subtitles"
  - "hydration"
  - "next-intl"
  - "accessibility"
  - "responsive-layout"
  - "performance"
  - "text-track"
---

# Watch subtitle affordances and localized hero counts must hydrate from server-owned labels

## Problem

The Watch hero exposed subtitle availability through a captions glyph beside a
generic language count, and the in-player control could become glyph-only when
subtitles were disabled or matched the audio language. The hero also used the
multi-audio switcher gate, so offered subtitles were not always interactive
when a Video had only one playable Dub.

The Xhosa JESUS route had a separate hydration defect. Its server HTML rendered
the localized audio-language count as `2 285 iilwimi`, but browser-side ICU
reformatted the same count as `2,285 iilwimi` during hydration. The adjacent
runtime stayed `128 min`; runtime generation was not the cause.

## Symptoms

- Viewers had to infer subtitles from a captions icon or an unlabeled count.
- A one-audio Video with offered subtitles could not open the existing Language
  & Subtitles modal from the hero metadata.
- The Xhosa route emitted React hydration error 418 while equivalent English
  and Afrikaans routes hydrated cleanly.
- Xhosa had no same-language subtitle in the supplied catalog data. That was a
  truthful availability state, not evidence that offered subtitle delivery had
  failed.
- The subtitle tooltip could split `Subtitles` from `· EN`, and play, mute,
  audio-language, and fullscreen controls lacked the same hover/focus help.

## What Didn't Work

- Reopening the VTT proxy or authentication path was unsupported by the
  evidence. An offered Afrikaans Forge Subtitle Track reached native
  `readyState === 2` with cues through the existing same-origin URL.
- Changing runtime formatting would not address the captured mismatch: the
  runtime text was identical before and after hydration.
- Formatting the count again in `HeroPlayer` left the server/client ICU seam in
  place. The localized presentation value needed one owner before React's first
  client render.
- Treating the missing Xhosa track as a delivery failure would conflate catalog
  availability with delivery of tracks that are actually offered.

## Solution

### Serialize localized labels at the route projection boundary

`WatchHeroPlayerBlock` now carries nullable
`audioLanguageCountLabel` and `subtitleLanguageCountLabel` values. The catch-all
Watch route obtains the availability-specific `HeroPlayer` count translator for
the resolved route locale, formats positive counts on the server, and adds those
strings while pruning standalone and episode block data for the client. Series
routes pass the same values through `SeriesPageClient` and `SeriesHero` into
trailer-mode `HeroPlayer` blocks.

`HeroPlayer` renders the serialized values verbatim. Its existing client-side
formatter remains only as a compatibility fallback for synthetic/test blocks
whose new fields are `undefined`; explicit `null` means that the server decided
the label should be absent.

### Make subtitle entry points explicit and subtitle-owned

The pre-reveal hero renders the server-produced availability labels verbatim.
In English these read `{count} audio translations` and `{count} subtitles`, so
the two numbers no longer share the ambiguous `languages` noun. Existing
localized count wording remains the compatibility fallback for catalogs where
availability-specific translations have not yet been authored. The subtitle
label becomes a button when
`hasSubtitleSwitcher` is true, independently of the audio-language switcher,
and otherwise remains truthful informational text.

The sound-on Chrome control keeps a compact visible active state: the selected
normalized subtitle language code when available, or the localized on label
for an active track whose metadata has no resolvable display code. Off uses the
original outlined icon without a visible language label; unavailable uses the
same disabled, dimmed control. The existing modal callback, subtitle
preference, and track selection flow remain unchanged.

### Derive concise player tooltips from the accessible action label

The FGE-92 follow-up centralizes icon-button help in `ChromeButton`. Its one
required `ariaLabel` supplies both the button's accessible name and the
presentational tooltip, so the two cannot drift
(`apps/web/src/components/watch/ChromeButton.tsx:17-32`,
`apps/web/src/components/watch/ChromeButton.tsx:87-126`). The tooltip stays
hidden at rest, appears for fine-pointer hover or keyboard focus, uses a single
non-wrapping line, and shifts toward an eight-pixel viewport inset when the
tooltip fits within the available viewport width
(`apps/web/src/components/watch/ChromeButton.tsx:38-58`,
`apps/web/src/components/watch/ChromeButton.tsx:97-125`).

`HeroPlayerControls` composes localized live actions for play/pause,
mute/unmute, audio language, subtitles, and fullscreen. Subtitle text is the
explicit state projection `Subtitles: Off`, `Subtitles: On`, `Subtitles: On
(EN)`, or `Subtitles: Not available`; the visible icon and optional language
code remain a separate compact state (`apps/web/src/components/watch/HeroPlayerControls.tsx:186-203`,
`apps/web/src/components/watch/HeroPlayerControls.tsx:1297-1357`).

Measurement remains interaction-scoped. A transient `ResizeObserver` exists
only while a tooltip is open and disconnects on pointer leave, blur, or
unmount; changing a live action label also re-clamps the open tooltip
(`apps/web/src/components/watch/ChromeButton.tsx:60-85`,
`apps/web/src/components/watch/ChromeButton.tsx:97-108`). Focus within the
control bar suppresses the idle-hide timer, and leaving the bar resumes normal
auto-hide behavior (`apps/web/src/components/watch/HeroPlayerControls.tsx:314-334`,
`apps/web/src/components/watch/HeroPlayerControls.tsx:1087-1104`).

## Why This Works

React compares the server HTML with the first client render. Passing the final
localized count strings through the server-owned block makes both sides compare
the same serialized value, regardless of ICU grouping differences between the
Node and browser runtimes.

The interaction fix uses subtitle availability as its gate, so a single-audio
Video can still expose offered subtitle choices. It does not manufacture
availability: the rendered count and modal continue to derive from normalized
tracks in the Video Edition, and the existing Forge Subtitle Track delivery
path is untouched.

Using one localized action string for both semantics and presentation keeps
dynamic tooltip text synchronized without maintaining parallel props. The
visible subtitle icon and optional language/state label can remain deliberately
compact because the tooltip and accessible name carry the complete state.
Open-only measurement avoids
adding idle page-load work, while the focus guard keeps keyboard help
perceivable beyond the chrome's ordinary hide delay.

## Verification

The pending branch was checked against merge base
`1f65d0af55f2c99df40a38a44053be5cb7463495` with the same local web
configuration and Admin GraphQL endpoint.

### Automated gates

- 272 focused Vitest tests passed across `HeroPlayer`,
  `HeroPlayerControls`, `LanguagePickerModal`, and catch-all route coverage.
- A review-follow-up run passed 149 tests across `HeroPlayerControls`,
  `SeriesHero`, `SeriesPageClient`, and catch-all route coverage.
- Web TypeScript, changed-file ESLint, changed-file formatting, locale/catalog
  checks, production build, and `git diff --check` passed.
- Route and component tests cover server-produced labels for standalone,
  episode, and series-trailer compositions, including zero/missing-count
  omission.

### Browser and server-render evidence

The tested routes were:

- `/watch/jesus.html/english.html`
- `/watch/jesus.html/afrikaans.html`
- `/watch/jesus.html/xhosa.html`

For all three, server HTML and the hydrated DOM retained the same hero count
labels and the browser reported no app error or hydration signal:

- English: `2,285 audio translations`; `57 subtitles`
- Afrikaans: `2 285 tale`; `Onderskrifte: 57 tale`
- Xhosa: `2 285 iilwimi`; `IMibhalo engezantsi: 57 iilwimi`

The explicit hero button was keyboard activated and opened the existing modal.
The Xhosa modal stayed truthful: it did not invent a Xhosa subtitle and retained
the translated choices actually offered by the catalog. An offered Afrikaans
track still reached `readyState === 2` with cues through the same-origin route.

At 320 and 375 CSS-pixel portrait widths and at 740 by 320 compact landscape,
the English, Afrikaans, and Xhosa buttons stayed visible with 44-pixel height,
remained inside the viewport, and caused no horizontal overflow. The widest
measured Xhosa button was 209.5 CSS pixels.

The environment's language-less English route depends on a route-manifest
request that returned 401 locally, so browser checks used the supported explicit
`/english.html` compatibility route. This does not affect the subtitle or
hydration behavior under test.

### Production load comparison

Both branch and base production builds completed. Fetching the Xhosa route from
the two local production servers produced the following initial payloads:

| Metric                   |        Base |      Branch |    Delta |
| ------------------------ | ----------: | ----------: | -------: |
| Initial script requests  |          32 |          32 |        0 |
| Initial JavaScript, raw  | 2,541,780 B | 2,541,840 B |    +60 B |
| Initial JavaScript, gzip |   772,915 B |   772,929 B |    +14 B |
| Server HTML              |   791,522 B |   791,657 B |   +135 B |
| One local SSR response   |     1.238 s |     1.305 s | +0.067 s |

The one-response timing is diagnostic only, not an LCP comparison. It is within
the plan's 10% response-time tolerance, but no conclusion depends on that single
sample. Static composition and request evidence show no new dependency, initial
script request, browser data request, or eager media path from this change.

The in-app browser security policy blocked fresh navigation to the nonstandard
comparison ports, so production branch-versus-base LCP, CLS, and long-task
medians were not rerun. Branch dev-browser evidence reported CLS 0 and zero long
tasks, but cold compilation made its navigation timings unsuitable for a base
comparison. This limitation is recorded rather than substituting incomparable
numbers.

### Tooltip follow-up verification

Before PR #2008 merged, the full Web suite passed 2,835 tests with one existing
todo; Web typecheck, changed-file
ESLint, Prettier, production build, roadmap generation, and diff integrity also
passed. Focused coverage verifies matching tooltip/accessibility text across
all five icon buttons, the four subtitle projections, live play/mute/fullscreen
label transitions, 320-pixel clamp arithmetic, re-clamping after a label
change, and focus persistence beyond the idle timeout
(`apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx:331-413`,
`apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx:415-602`,
`apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx:1228-1280`).

A legacy demo page showed its single subtitle tooltip hidden at rest and five
controls with semantic names; it still used the obsolete middle-dot copy and
was not treated as visual proof of the production component. The actual local
Watch route returned HTTP 200 but rendered its expected experience-load
fallback because the local Admin content source was unavailable; the in-app
browser also rejected a new localhost navigation. This is recorded as a
browser-environment limitation, not as visual proof. The resulting production
verification and corrective finding are recorded below.

### Production reveal regression and corrective follow-up

Railway deployed PR #2008 as squash commit
`43813a8d4518862c2bae2294ec808de15f88a59b`. Datadog RUM and a cache-busted
production Watch session both reported that exact release. The live DOM
contained all five concise tooltip strings, including `Subtitles: On (AF)`,
with one-line and hidden-at-rest classes. However, direct production
interaction showed the button matching both `:hover` and `:focus-visible`
while the tooltip's computed `visibility` stayed `hidden` and `opacity` stayed
`0`. The CSS-only group variants were therefore present in the bundle but not
a reliable runtime reveal contract.

Corrective PR #2010 moves the open/closed projection into `ChromeButton` state
owned by the existing mouse-enter, mouse-leave, focus, and blur handlers. A
fine-pointer media query keeps compatibility mouse events from making the
tooltip sticky on touch. Leave and blur preserve the tooltip while the other
interaction path is still active. The regression test now asserts hidden at
rest, hover reveal, leave hide, focus reveal, and blur hide rather than only
checking that class tokens exist.

## Prevention

- Server-rendered localized values that participate in hydration should have a
  single formatting owner and be serialized as presentation strings when Node
  and browser ICU output can differ.
- Keep audio availability, subtitle availability, and subtitle delivery as
  separate contracts. Gate subtitle affordances on subtitle availability and
  test an actually offered track before changing its delivery path.
- For above-the-fold frontend changes, compare production initial request count
  and compressed JavaScript against the pinned merge base, then record any
  unavailable runtime metrics explicitly.
- For icon-only player controls, derive the presentational tooltip from the
  accessible action label, keep it hidden at rest, and test every dynamic state
  transition rather than asserting styling tokens alone.
- Treat tooltip geometry and chrome lifetime as interaction state: measure only
  while open, remeasure live labels, contain the box at compact widths, and
  prevent idle hiding while keyboard focus remains within the controls.

## Related Issues

- [Linear FGE-92](https://linear.app/jesus-film-project/issue/FGE-92)
- [Merged tooltip consistency PR #2008](https://github.com/JesusFilm/forge/pull/2008)
- [Production reveal corrective PR #2010](https://github.com/JesusFilm/forge/pull/2010)
- [Watch subtitle VTT delivery must remain public and same-origin](watch-subtitle-vtt-proxy-account-gate.md)
- [Watch caption defaults must be same-audio-language](watch-caption-language-availability-20260615.md)
- [Frontend change page-load performance verification](../conventions/frontend-change-page-load-performance-verification.md)
- [Watch staged client loading](../performance-issues/watch-staged-client-loading-20260611.md)
