---
title: "Watch caption defaults must be same-audio-language"
tags:
  - "watch"
  - "subtitles"
  - "accessibility"
  - "language"
---

# Watch caption defaults must be same-audio-language

## Context

The Watch route
`/watch/jesus-is-brought-to-pilate.html/english.html` rendered an English audio
variant whose subtitle payload contained several languages, but no English
track. The previous overlay selection logic treated any subtitle track as an
available caption and fell back to the first/primary subtitle when the current
audio language had no match. For this route, that meant enabling subtitles
could select Arabic.

## Rule

For the Watch player overlay, an automatic/default caption is available only
when its `language.slug` matches the current audio/page language slug. If no
matching track exists, keep subtitles off by default and show an explicit
unavailable state in the language modal.

Do not fall back from captions to another language's subtitle track. Translated
subtitle tracks may still be useful to users, but they must be selected
intentionally and should not masquerade as the accessibility caption for the
current audio.

## Implementation Pattern

- Filter `video.subtitles` by the current audio language before resolving the
  default overlay subtitle.
- Ignore legacy stale subtitle preference cookies whose language slug is not in
  that filtered set.
- Store newly selected translated subtitles with an explicit v2 preference so
  they can restore as intentional choices.
- Pass all subtitles to the language modal so translated subtitles remain
  selectable.
- In the modal, render the visible "No subtitles" copy for the current audio
  language when the same-language set is empty, but keep translated subtitle
  options selectable when they exist.

## Verification

Use both component tests and browser proof:

- Regression test that an English audio route with only legacy Arabic subtitle
  preference data stays disabled by default.
- Regression test that an explicit v2 translated subtitle preference restores.
- Modal test that translated subtitles can be selected only after the user turns
  subtitles on and picks a subtitle language.
- Helium/browser smoke on the local Watch route should show `Subtitles`, `0
languages`, disabled/off switch, and `No subtitles` when no subtitle tracks
  exist; when translated tracks exist, it should show the same-language
  unavailable state while preserving translated subtitle choices.
