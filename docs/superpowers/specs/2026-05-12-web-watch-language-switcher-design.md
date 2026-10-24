# Web watch — Language switcher (v1)

**Branch:** `feat/web-video-language-switcher`
**Surface:** `apps/web` — `/watch/[slug]/[locale]`
**Date:** 2026-05-12
**Owner:** Urim

## Goal

Let viewers switch a video's audio language from the watch page via a globe icon at the top-right of the hero, opening a centered overlay with a searchable language dropdown and Apply/Close actions. The chosen language is remembered so the next video the viewer opens defaults to that language when a variant exists. v1 ships audio-language switching only; subtitles are out of scope.

## Background

- `LanguagePickerModal` already exists at `apps/web/src/components/watch/LanguagePickerModal.tsx`. It is wired through `WatchPageClient` (`modalState === "language"`, `openLanguage()` callback) but **no UI currently triggers it** — there is no globe button anywhere on the page.
- The existing modal is a simple flat button list. The new design is a searchable combobox-style overlay because some videos (e.g., `jesus`) have hundreds of variants — a flat list is unusable at that scale.
- Variants live on `WatchVideoRecord.variants` (Strapi → gql.tada). Each variant has `language { coreId, slug, name }`, `hls`, `published`, `documentId`. The "playable" filter is `published === true && hls != null && language.slug != null` (matches the existing modal's filter).
- Subtitles have no field on the Strapi variant. `VideoSubtitle` exists in the admin GraphQL schema but the watch page does not consume admin GraphQL yet. v1 skips subtitles entirely.

## Scope

### In

- Globe icon trigger at top-right of the hero player area
- Replace `LanguagePickerModal`'s internal UI with the new overlay design
- Searchable language dropdown (popover + search input + scrollable list)
- Apply button (disabled until the selection differs from current)
- Close button (cancels with no navigation)
- Preserve existing navigation behaviour: `router.push('/<videoSlug>/<draftSlug>?t=<currentTime>')` on Apply
- **Persist the chosen language as a cookie** so every subsequent watch-page load opens in that language when a variant exists
- **Server-side redirect** that canonicalises the URL to the saved-preference language whenever the URL locale disagrees and a matching variant exists for the requested video
- Tests for the modal's draft/dirty/apply/close logic, the combobox's search/keyboard behaviour, and the cookie read/write helpers

### Out

- Subtitles row (toggle + dropdown). Deferred until the admin GraphQL migration exposes `VideoSubtitle` to the watch page.
- Globe icon staying visible after the hero scrolls off-screen
- A UI to clear the saved language preference (the user changes it by picking a different language; clearing the cookie manually is out of scope)
- Any backend / Strapi / gql.tada schema changes

## File changes

| Path                                                                                                             | Change                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/watch/LanguagePickerModal.tsx`                                                          | Rewrite. Same props; new internal layout, draft state, Apply/Close footer, embedded `LanguageCombobox`.   |
| `apps/web/src/components/watch/LanguageCombobox.tsx`                                                             | New. Trigger field + popover + search input + scrollable list.                                            |
| `apps/web/src/components/watch/HeroPlayer.tsx`                                                                   | Add a globe `<button>` overlay at top-right, wired to a new `onLanguageClick?: () => void` prop.          |
| `apps/web/src/components/watch/WatchSectionRenderer.tsx` (or whichever file builds `WatchHeroPlayerBlock` props) | Thread `modalCallbacks.openLanguage` through to `HeroPlayer.onLanguageClick`.                             |
| `apps/web/src/components/watch/LanguagePickerModal.test.tsx`                                                     | New tests for draft/dirty/apply/close + cookie write on Apply.                                            |
| `apps/web/src/components/watch/LanguageCombobox.test.tsx`                                                        | New tests for search filter and keyboard interaction.                                                     |
| `apps/web/src/lib/language-preference-client.ts`                                                                 | New. `writePreferredLanguageSlug(slug)` — sets the cookie via `document.cookie`. Exports cookie name.     |
| `apps/web/src/lib/language-preference-server.ts`                                                                 | New. `readPreferredLanguageSlug()` — reads the cookie via `next/headers`. Exports cookie name.            |
| `apps/web/src/lib/language-preference.test.ts`                                                                   | New. Tests cookie read/write helpers (mock `document.cookie` for write; mock `next/headers` for read).    |
| `apps/web/src/app/[slug]/[locale]/page.tsx`                                                                      | Modify. Read preference cookie before rendering. If a matching variant exists, redirect to canonical URL. |

No changes to: `WatchPageClient.tsx` (`openLanguage` already exists in `modalCallbacks`), `apps/web/src/lib/content.ts` (no new data), `packages/graphql` (no schema work), Strapi.

## Component shapes

### `LanguagePickerModal` (rewritten)

```tsx
type Props = {
  open: boolean
  variants: LanguagePickerVariant[] // unchanged
  currentLanguageSlug: string // unchanged
  videoSlug: string // unchanged
  playerRef: RefObject<MuxPlayerRef | null> // unchanged (drives ?t=)
  onClose: () => void // unchanged
}
```

Internal state:

- `draftSlug: string`, initialised to `currentLanguageSlug`
- `isDirty = draftSlug !== currentLanguageSlug` — drives Apply enabled/disabled
- On `open` transitioning false → true, reset `draftSlug` to `currentLanguageSlug` (use a `useEffect` keyed on `open`)
- Apply handler: identical navigation to the current `handleSelect` — `router.push('/<videoSlug>/<draftSlug>?t=<currentTime>')` then `onClose()`
- Close handler: `onClose()` only

Markup outline:

```
<Dialog open onOpenChange>
  <DialogContent class="sm:max-w-lg">
    <header>
      <DialogTitle>Language</DialogTitle>
      <span data-testid="...-count">{count} languages</span>
    </header>
    <LanguageCombobox options={options} value={draftSlug} onChange={setDraftSlug} />
    <footer>
      <button data-testid="...-close" onClick={onClose}>CLOSE</button>
      <button data-testid="...-apply" disabled={!isDirty} onClick={handleApply}>APPLY</button>
    </footer>
  </DialogContent>
</Dialog>
```

### `LanguageCombobox` (new)

```tsx
type Option = { slug: string; name: string }

type Props = {
  options: Option[]
  value: string // current draftSlug
  onChange: (slug: string) => void
  placeholder?: string // e.g. "Select language"
}
```

Internal state:

- `popoverOpen: boolean`
- `query: string`
- Filtered list = `options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()))`
- Active index (for keyboard nav)

Trigger renders as a pill-shaped button matching the mockup: translate glyph (left), selected name (centre-left), chevrons (right). Popover anchored beneath the trigger, height capped at `max-h-80 overflow-y-auto`. Search input is autofocused on open.

Keyboard:

- `Down` / `Up` move the active index
- `Enter` calls `onChange(activeOption.slug)` and closes the popover
- `Escape` closes the popover without changing value
- Click outside closes the popover

No external dependency — implemented with `useState` + `useRef` + a click-outside hook. (If the repo already has a popover primitive in `@/components/ui`, reuse it.)

## Hero trigger

In `HeroPlayer.tsx`, add an absolutely-positioned globe button:

- Position: top-right of the hero area, with the same spacing convention used by the existing mute button (look at the mute button's positioning and mirror it)
- Lucide icon: `<Globe />`
- `aria-label="Switch language"`
- Click handler: new prop `onLanguageClick?: () => void` (undefined-safe — renders nothing if not provided)
- Renders only when `variants` count ≥ 2 (single-language videos don't need a switcher)

The block-renderer plumbing passes `modalCallbacks.openLanguage` into the hero block. Inspect `WatchSectionRenderer` to see how `onPlayerReady` is threaded — follow the same pattern for `onLanguageClick`.

## Language preference persistence

The viewer's last-picked language is stored in a cookie and used to canonicalise every subsequent watch-page URL.

### Cookie

- **Name**: `forge_watch_lang`
- **Value**: the language slug (e.g. `spanish`, not the bcp47 code)
- **Path**: `/watch` (matches the app `basePath`; isolates the cookie to watch pages)
- **Max-Age**: 1 year (`60 * 60 * 24 * 365`)
- **SameSite**: `Lax`
- **HttpOnly**: false (client needs to write it via `document.cookie`)
- **Secure**: set in production builds; omitted in dev so localhost works

### Client write

`apps/web/src/lib/language-preference-client.ts`:

```ts
export const LANGUAGE_PREFERENCE_COOKIE = "forge_watch_lang"

export function writePreferredLanguageSlug(slug: string): void {
  if (typeof document === "undefined") return
  const secure = process.env.NODE_ENV === "production" ? "; secure" : ""
  document.cookie = `${LANGUAGE_PREFERENCE_COOKIE}=${encodeURIComponent(slug)}; path=/watch; max-age=${60 * 60 * 24 * 365}; samesite=lax${secure}`
}
```

Called from the Apply handler in `LanguagePickerModal` **before** `router.push`. (Order matters: the cookie must be set before the next page render starts so the server-side read on the new URL sees it.)

### Server read

`apps/web/src/lib/language-preference-server.ts`:

```ts
import { cookies } from "next/headers"

export const LANGUAGE_PREFERENCE_COOKIE = "forge_watch_lang"

export async function readPreferredLanguageSlug(): Promise<string | null> {
  const store = await cookies()
  return store.get(LANGUAGE_PREFERENCE_COOKIE)?.value ?? null
}
```

Note: `cookies()` is async in Next 15+ (the repo runs Next 16). The page is already an async server component.

### Server redirect (in `app/[slug]/[locale]/page.tsx`)

```ts
const preferredSlug = await readPreferredLanguageSlug()
const watchVideo = await resolveWatchVideoBySlug(slug, rawLocale)

if (watchVideo && preferredSlug && preferredSlug !== rawLocale) {
  const hasPreferredVariant = (watchVideo.video.variants ?? []).some(
    (v) =>
      v?.language?.slug === preferredSlug &&
      v?.published === true &&
      v?.hls != null,
  )
  if (hasPreferredVariant) {
    redirect(`/${slug}/${preferredSlug}`)
  }
}
```

Inserted **after** the existing `resolveWatchVideoBySlug` call and **before** the existing `if (watchVideo)` branch that constructs blocks. The existing resolver call stays — it lets us check variants for this video without an extra fetch. The redirect target uses the language `slug` (not bcp47), so the next request will satisfy `preferredSlug === rawLocale` and not loop.

The redirect happens **only when**:

1. A preference cookie is set
2. The cookie value differs from the URL locale segment (string comparison — does not normalise bcp47 ↔ slug)
3. A `published && hls` variant exists for the cookie language on this video

If the cookie language has no variant for this video (e.g., niche language with limited coverage), the page renders with the URL locale untouched — the preference falls back silently rather than redirecting to a 404-like state.

### bcp47 ↔ slug edge case

URLs may use either form (`/jesus/en` or `/jesus/english`). The cookie stores the slug. The simple `preferredSlug !== rawLocale` comparison will mis-trigger a redirect from `/jesus/en` → `/jesus/english` when both refer to the same variant. This is acceptable (and arguably desirable: the slug form is more readable). The planner may instead compare against `watchVideo.selectedVariant.language?.bcp47` as well to suppress the redirect when the URL already matches the variant by either form — pick one approach and document it.

## Tests

`LanguagePickerModal.test.tsx`:

- Apply is disabled when modal first opens
- Apply enables once user picks a different language
- Clicking Apply calls `writePreferredLanguageSlug(newSlug)` **before** `router.push`
- Clicking Apply calls `router.push` with `/<videoSlug>/<newSlug>?t=<currentTime>` and calls `onClose`
- Clicking Close calls `onClose` and does NOT call `router.push` or write the cookie
- Reopening the modal after a cancelled change resets the draft to `currentLanguageSlug`
- Selecting the current language and clicking Apply is a no-op navigation (matches existing `handleSelect` short-circuit)

`LanguageCombobox.test.tsx`:

- Typing in the search input filters the visible list (case-insensitive)
- Arrow keys move the highlight; Enter selects
- Escape closes the popover without changing `value`
- Clicking outside the popover closes it

`language-preference.test.ts`:

- `writePreferredLanguageSlug("spanish")` sets `document.cookie` with the expected name, path, max-age, and samesite attributes
- `writePreferredLanguageSlug` URL-encodes values containing special characters
- `readPreferredLanguageSlug()` returns the cookie value when present
- `readPreferredLanguageSlug()` returns `null` when the cookie is absent

Page-level redirect (test inside the page's own test file if one exists, or add a focused integration test):

- When the cookie is set and a matching variant exists, the page redirects to `/<slug>/<cookieSlug>`
- When the cookie is set but no matching variant exists for this video, the page renders normally (no redirect)
- When the cookie is unset, behaviour is unchanged from today

Use the project's existing testing patterns (vitest, RTL — check sibling test files for setup).

## Behaviour edge cases

- **Zero playable variants**: globe button does not render (single-language videos)
- **One playable variant**: globe button does not render (no switch needed)
- **`currentLanguageSlug` not in variants**: should not happen, but if it does, Apply remains enabled the moment user picks any option — no special handling needed
- **Player not ready (`playerRef.current == null`)**: fall back to `t=0`, same as existing modal
- **Locale URL was bcp47 (`en`) not slug (`english`)**: existing routing already normalises this. Apply navigates with `draftSlug` (always the language slug), not the URL locale segment. No change.
- **Cookie language has no variant for current video**: page renders with the URL locale; no redirect. The preference falls back silently.
- **Cookie language matches URL locale**: no redirect.
- **Cookie has stale slug (language removed from the catalog)**: variant lookup fails, no redirect; the cookie is overwritten next time the user picks a language.
- **Deep link with explicit locale + saved preference disagree**: saved preference wins (server redirects). Accepted trade-off — see the design discussion in this spec.

## Verification

- `pnpm --filter @forge/web test` passes the new test files
- `pnpm --filter @forge/web typecheck` clean
- Manual: load `http://localhost:3000/watch/jesus/english`, click globe, search "Span", pick "Spanish", click Apply → URL becomes `/watch/jesus/spanish?t=<n>` and the player resumes
- Manual: open modal, change selection, click Close → URL unchanged
- Manual: open modal, click Apply without changing → button is disabled (cannot click)
- Manual persistence: after applying Spanish on `/watch/jesus/*`, navigate to a different video known to have a Spanish variant (e.g. `/watch/bp-plot-episode-5/english`) → page redirects to the Spanish variant
- Manual fallback: after applying Spanish, navigate to a video that lacks a Spanish variant → page loads in the URL locale (no redirect)
- Manual cookie inspection: DevTools → Application → Cookies → `forge_watch_lang=spanish` with `Path=/watch`, `Max-Age` ~ 1y, `SameSite=Lax`
