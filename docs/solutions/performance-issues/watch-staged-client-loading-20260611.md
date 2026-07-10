# Watch Staged Client Loading

## Summary

This slice moves Watch interaction code behind a staged client loader without
moving SEO or page content out of the server HTML.

- Language, search, share, and download now load on user intent or after
  `window.load` plus idle time.
- Idle warming follows the product priority order: language, search, share,
  download.
- Search is split into a light floating-header shell and a lazy controller.
  The shell remains visible on first render; the full search state machine,
  search actions, language filters, and overlay portal load on search intent
  or post-load warmup.
- Watch language options are cached per `videoSlug` in the browser session, so
  idle warmup and click-open paths share the same promise/result.
- Download auth/session checks still run only when the user clicks Download.

SEO-bearing metadata, H1, localized copy, chapter/body content, study
questions, Bible quotes, transcript hydration, canonical URLs, and social URLs
remain server-owned.

## Implementation Notes

- `apps/web/src/lib/watch-interaction-loader.ts` owns module-level preload
  promises, priority warmup, and per-video language-option caching.
- `apps/web/src/components/watch/WatchPageClient.tsx` now renders modal
  components only after the matching interaction is enabled. Once enabled, the
  component can stay mounted for close animations and state preservation.
- `apps/web/src/components/FloatingSearchProvider.tsx` is now the light shell:
  header chrome, pinned state, visible search affordance, logo, language globe,
  and direct `?q=` search intent bootstrap.
- `apps/web/src/components/FloatingSearchController.tsx` owns the existing
  heavy search behavior and provides the context consumed by
  `SearchOverlay`.

## Verification

- `pnpm --filter @forge/web test -- watch-interaction-loader.test.ts WatchPageClient.download.test.tsx FloatingSearchProvider.test.tsx LanguagePickerModal.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `ADMIN_GRAPHQL_URL=https://admin.jesusfilm.org/api/graphql pnpm --filter @forge/web build`
- `git diff --check`

Local browser proof used `agent-browser` against:

```bash
ADMIN_GRAPHQL_URL=https://admin.jesusfilm.org/api/graphql pnpm --dir apps/web dev -p 4910
```

Routes checked:

- `/watch/jesus.html/english.html` rendered locally with title `Who is Jesus?`
  and the light floating search shell.
- `/watch/life-of-jesus-gospel-of-john.html/english.html` rendered locally
  with title `Life of Jesus (Gospel of John) | Jesus Film Project`,
  `html lang="en"`, one H1, chapters, related questions, Bible quotes,
  download/share controls, floating search, and the floating language control.

Resource timing on the Life of Jesus local dev route showed staged chunks
starting after the page `load` event and in priority order:

| Chunk                      | Start relative to load |
| -------------------------- | ---------------------: |
| `LanguagePickerModal`      |                +508 ms |
| `FloatingSearchController` |                +531 ms |
| `ShareModal`               |                +549 ms |
| `DownloadModal`            |                +564 ms |

The byte sizes from local Turbopack dev chunks are not production-size
evidence; use deployed resource timing for final encoded-byte comparisons.
This local pass proves the ordering and post-load staging behavior.

The production build completed successfully after sandbox escalation for
Turbopack's internal process/port binding. Built static/server artifacts include
separate dynamic chunks for `FloatingSearchController`, `LanguagePickerModal`,
`ShareModal`, and `DownloadModal`.

Interaction smoke:

- Language globe opened the Language modal with language rows, subtitle state,
  Close, and disabled Apply.
- Search opened the lazy search overlay with the keyword input and category
  buttons.
- Share opened the Share video modal with link/embed tabs and copy controls.
- Download opened the Download video modal after the session gate, with file
  size selector, Terms of Use checkbox, and disabled Download action.

## Remaining Work

Production deployment should be checked with real encoded transfer sizes and a
cold mobile run. Cloudflare HTML caching and cold TTFB remain separate follow-up
work after app-owned route health is confirmed.
