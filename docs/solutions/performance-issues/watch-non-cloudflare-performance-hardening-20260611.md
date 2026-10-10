# Watch Non-Cloudflare Performance Hardening

## Summary

This slice removes the remaining app-side Watch cold-path issues that should
not wait for Cloudflare HTML caching:

- `HeroPlayer` now always uses the optimized `MuxVideo` backend after
  poster-first activation.
- Watch video resolution is split into cached slug shell, localized copy, and
  selected Dub detail paths.
- Selected transcript cues can be parsed on the server and hydrated into the
  transcript component.
- The watch language modal loads slim language rows on open instead of
  serializing the full language-picker data into initial page props.

Canonical, Open Graph, Twitter, and public watch URLs stay on
`https://www.jesusfilm.org/watch/...`.

## Implementation Notes

- The old `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` and
  `FORGE_WATCH_HERO_MUX_VIDEO_DEFAULT` rollout path was removed from
  `apps/web`. `@forge/video-player` still exports `MuxPlayer` for package
  compatibility, but the watch hero imports the `mux-video` subpath only.
- `apps/web/src/lib/fragments/watch-video.ts` now exposes:
  - `getWatchVideoShellBySlugOperation`
  - `getWatchVideoLocalizedCopyBySlugOperation`
  - `getWatchVideoDubDetailOperation`
- Non-English fallback now retries only localized copy fields. Heavy selected
  Dub details are fetched once by `videoDub(id)` after the playable variant is
  selected.
- `apps/web/src/lib/subtitle-transcript.ts` holds the pure VTT parser shared
  by server and client. `apps/web/src/lib/watch-transcript.ts` is server-only
  and returns initial cues for the selected audio subtitle.
- `apps/web/src/lib/watch-language-actions.ts` loads slim language picker rows
  on demand. `WatchPageClient` prunes client-bound video props to the selected
  variant, while `WatchHeroPlayerBlock.playableLanguageCount` preserves the
  hero globe count.

## Verification

- `pnpm --filter @forge/web test -- src/lib/content.test.ts src/lib/fragments/__tests__/watch-video.test.ts`
- `pnpm --filter @forge/web test -- src/components/watch/__tests__/SubtitleTranscript.test.tsx src/components/watch/__tests__/SubtitleTranscript.render.test.tsx`
- `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguagePickerModal.test.tsx src/components/watch/__tests__/WatchPageClient.download.test.tsx`
- `pnpm --filter @forge/web test -- 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx'`
- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx src/lib/feature-flags.test.ts`
- `pnpm --filter @forge/feature-flags test`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `git diff --check`

Local browser proof used `agent-browser` against a Next dev server with
`ADMIN_GRAPHQL_URL=https://admin.jesusfilm.org/api/graphql` and existing local
`.env` secrets:

- `/watch/jesus.html/english.html` rendered the hero, a single H1, chapters,
  study questions, Bible quotes, and the language control.
- Opening the language modal fired
  `loadWatchLanguageOptions({"videoSlug":"jesus"})` and the combobox showed
  lazy-loaded options.
- `/watch/life-of-jesus-gospel-of-john.html/english.html` rendered with the
  readable title and expected body sections.
- A no-JS HTML capture for the Life page showed `html lang="en"`, readable
  `<title>`, canonical on `www.jesusfilm.org`, hreflang alternates,
  VideoObject JSON-LD, and 1200x630 social image metadata in server HTML.

## Remaining Cold-Path Work

This PR does not eliminate all cold TTFB by itself. Local first render of very
large records still depends on admin data coldness:

- `JESUS` first local render logged `GET /jesus.html/english.html 200 in 36.4s`.
- `Life of Jesus` first local render logged `GET /life-of-jesus-gospel-of-john.html/english.html 200 in 13.4s`, then a warm repeat logged `200 in 143ms`.

That points to the next biggest win: document caching at the edge for
`/watch/*` HTML requests, plus production verification of admin cache warmth.
Cloudflare should be added after this app slice is deployed and route health is
confirmed.
