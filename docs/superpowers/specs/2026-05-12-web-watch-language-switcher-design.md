# Web watch — Language switcher (v1)

**Branch:** `feat/web-video-language-switcher`
**Surface:** `apps/web` — `/watch/[slug]/[locale]`
**Date:** 2026-05-12
**Owner:** Urim

## Goal

Let viewers switch a video's audio language from the watch page via a globe icon at the top-right of the hero, opening a centered overlay with a searchable language dropdown and Apply/Close actions. v1 ships audio-language switching only; subtitles are out of scope.

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
- Tests for the modal's draft/dirty/apply/close logic and the combobox's search/keyboard behaviour

### Out

- Subtitles row (toggle + dropdown). Deferred until the admin GraphQL migration exposes `VideoSubtitle` to the watch page.
- Persisting last-picked language across videos
- Globe icon staying visible after the hero scrolls off-screen
- Any backend / Strapi / gql.tada schema changes

## File changes

| Path                                                                                                             | Change                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/watch/LanguagePickerModal.tsx`                                                          | Rewrite. Same props; new internal layout, draft state, Apply/Close footer, embedded `LanguageCombobox`. |
| `apps/web/src/components/watch/LanguageCombobox.tsx`                                                             | New. Trigger field + popover + search input + scrollable list.                                          |
| `apps/web/src/components/watch/HeroPlayer.tsx`                                                                   | Add a globe `<button>` overlay at top-right, wired to a new `onLanguageClick?: () => void` prop.        |
| `apps/web/src/components/watch/WatchSectionRenderer.tsx` (or whichever file builds `WatchHeroPlayerBlock` props) | Thread `modalCallbacks.openLanguage` through to `HeroPlayer.onLanguageClick`.                           |
| `apps/web/src/components/watch/LanguagePickerModal.test.tsx`                                                     | New tests for draft/dirty/apply/close.                                                                  |
| `apps/web/src/components/watch/LanguageCombobox.test.tsx`                                                        | New tests for search filter and keyboard interaction.                                                   |

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

## Tests

`LanguagePickerModal.test.tsx`:

- Apply is disabled when modal first opens
- Apply enables once user picks a different language
- Clicking Apply calls `router.push` with `/<videoSlug>/<newSlug>?t=<currentTime>` and calls `onClose`
- Clicking Close calls `onClose` and does NOT call `router.push`
- Reopening the modal after a cancelled change resets the draft to `currentLanguageSlug`
- Selecting the current language and clicking Apply is a no-op navigation (matches existing `handleSelect` short-circuit)

`LanguageCombobox.test.tsx`:

- Typing in the search input filters the visible list (case-insensitive)
- Arrow keys move the highlight; Enter selects
- Escape closes the popover without changing `value`
- Clicking outside the popover closes it

Use the project's existing testing patterns (vitest, RTL — check sibling test files for setup).

## Behaviour edge cases

- **Zero playable variants**: globe button does not render (single-language videos)
- **One playable variant**: globe button does not render (no switch needed)
- **`currentLanguageSlug` not in variants**: should not happen, but if it does, Apply remains enabled the moment user picks any option — no special handling needed
- **Player not ready (`playerRef.current == null`)**: fall back to `t=0`, same as existing modal
- **Locale URL was bcp47 (`en`) not slug (`english`)**: existing routing already normalises this. Apply navigates with `draftSlug` (always the language slug), not the URL locale segment. No change.

## Verification

- `pnpm --filter @forge/web test` passes the new test files
- `pnpm --filter @forge/web typecheck` clean
- Manual: load `http://localhost:3000/watch/jesus/english`, click globe, search "Span", pick "Spanish", click Apply → URL becomes `/watch/jesus/spanish?t=<n>` and the player resumes
- Manual: open modal, change selection, click Close → URL unchanged
- Manual: open modal, click Apply without changing → button is disabled (cannot click)
