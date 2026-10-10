# Fix Watch Contextual Video Canonical Routing

## Summary

Recreate the production `www.jesusfilm.org` URL model in Forge without changing
the current contextual route shape. A video has one canonical standalone URL:
`/{video}.html/{language}.html`. Collection-context viewing uses:
`/{collection}.html/{video}/{language}.html`, preserves carousel state, and
declares the standalone video URL as canonical for SEO/social metadata.

## Key Changes

- Keep `watchEpisodePath` emitting `/{collection}.html/{video}/{language}.html`
  and use it for collection/chapter navigation.
- Treat three-segment routes as contextual viewing routes only; pass the
  requested collection parent to watch-page rendering.
- Update metadata for contextual routes so canonical, Open Graph URL,
  structured-data URL, and hreflang alternates use standalone video URLs.
- Thread optional collection context through watch-page client interactions
  that need to preserve navigation state, while keeping share/copy canonical.

## Tests

- Route helper/parser tests keep the bare middle segment contextual shape.
- Metadata tests assert contextual routes point canonical SEO URLs to the
  standalone video page.
- Carousel tests assert every chapter href in a collection keeps the parent
  slug and active clip indexing.
- Language picker tests assert contextual pages preserve collection context
  when switching languages.
- Share modal tests assert copied/share URLs remain standalone canonical URLs.

## Assumptions

- The first contextual segment is the collection/journey slug.
- The second contextual segment is the playable video slug.
- Invalid contextual parent/video combinations should 404 instead of falling
  back to an unrelated parent.
