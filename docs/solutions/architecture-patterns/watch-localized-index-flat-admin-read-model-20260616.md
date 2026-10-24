# Watch Localized Index + Flat Admin Read Model

## Context

Watch index-style pages can be language-specific without becoming video routes.
For the language inventory page, the public shape is
`/watch/{language}.html/videos`: the first segment is the public Watch language
slug, and the final `videos` segment remains an app index segment without
`.html`.

## Pattern

- Add canonicalizer exceptions for app index child segments before generic
  two-segment `.html` appending treats them as video/audio pairs.
- Rewrite localized index URLs to internal routes that carry the original
  public language slug, for example
  `/watch/spanish-latin-american.html/videos` ->
  `/watch/es/es-419/videos/spanish-latin-american`.
- Keep Admin responsible for language coverage joins. Return card-ready rows
  and counts instead of letting Watch fetch nested video, dub, subtitle, and
  relation graphs.
- For subtitle-only rows, return a playable fallback `watchLanguageSlug` so
  Watch links open a valid audio route while the card still labels the requested
  language as subtitles-only.

## Why

This preserves existing Watch video URL contracts, keeps route links public-slug
safe, and avoids the child x dub payload trap that can exceed Next cache limits.
