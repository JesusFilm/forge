---
title: "Watch caption availability must be same-audio-language"
tags:
  - "watch"
  - "subtitles"
  - "accessibility"
  - "language"
---

# Watch caption availability must be same-audio-language

## Context

The Watch route
`/watch/jesus-is-brought-to-pilate.html/english.html` rendered an English audio
variant whose subtitle payload contained several languages, but no English
track. The previous overlay selection logic treated any subtitle track as an
available caption and fell back to the first/primary subtitle when the current
audio language had no match. For this route, that meant enabling subtitles
could select Arabic.

## Rule

For the Watch player overlay, a subtitle is available only when its
`language.slug` matches the current audio/page language slug. If no matching
track exists, keep subtitles off and show an explicit unavailable state in the
language modal.

Do not fall back from captions to another language's subtitle track. That may
be useful content inventory for translation workflows, but it is not an
accessibility caption for the current audio.

## Implementation Pattern

- Filter `video.subtitles` by the current audio language before resolving the
  selected overlay subtitle.
- Ignore stale subtitle preference cookies whose language slug is not in that
  filtered set.
- Pass only same-language subtitles to the language modal.
- In the modal, render the disabled/off subtitle switch plus visible
  "No subtitles" copy when the filtered set is empty.

## Verification

Use both component tests and browser proof:

- Regression test that an English audio route with only Arabic subtitle data
  passes no subtitle options to `LanguagePickerModal`.
- Modal test that other-language subtitles are not listed and the unavailable
  text is visible.
- Helium/browser smoke on the local Watch route should show `Subtitles`, `0
languages`, disabled/off switch, and `No subtitles`.
