---
title: "Collection Download Quality Listbox - Plan"
type: fix
date: 2026-08-29
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Collection Download Quality Listbox - Plan

## Goal Capsule

- **Objective:** A viewer opening the Watch "Download collection" modal can read and pick a video quality from a dropdown that matches the dark modal — no white native popup with near-invisible option text — with pointer or keyboard.
- **Means:** Replace the native `<select>` in `apps/web/src/components/watch/CollectionDownloadModal.tsx` with a themed, portaled listbox lifted from the single-video `DownloadModal` tier picker, plus keyboard operability the lifted mechanics lack (KTD1, KTD2).
- **Authority hierarchy:** Product Contract R-IDs win on behavior; KTDs win on mechanism; units carry only local deltas.
- **Execution profile:** Lightweight, single PR, `apps/web` only.
- **Stop conditions:** Stop if the listbox cannot be opened inside the base-ui `Dialog` without the dialog dismissing (see R4 and Assumptions) and no in-repo pattern resolves it; report rather than shipping a partially working picker.
- **Tail ownership:** The calling pipeline owns review, browser verification, and shipping.

## Product Contract

### Summary

Swap the collection download modal's "Video quality" native `<select>` for the app's dark, portaled tier listbox so the open option list is themed and readable, and give that listbox the arrow-key operability the native control had. The Language field already uses `LanguageCombobox` and needs no code change; it is verified for visual parity only. The single-video `DownloadModal` keeps its inline listbox; migrating it onto the shared component is deferred.

### Problem Frame

The screenshot from a Linux Chrome session shows the quality `<select>` trigger styled dark, but its open option list rendered by the browser as a white popup with a light-blue highlight and near-white option text ("High", "Low" barely legible). The element already carries Tailwind's `scheme-dark` (`color-scheme: dark`), which the existing test `uses a dark native menu for video quality options` pins — so the native-styling approach has been tried and does not hold across platforms. Native `<option>` styling is platform-dependent (ignored on macOS, partial on Linux/Windows), which makes any further native tweak unverifiable from one machine. The repo already solves the same problem for the same three tiers in `DownloadModal.tsx` with a custom `role="listbox"` popup portaled to `document.body`.

### Requirements

**Rendering**

- R1. The "Video quality" options in the collection download modal render inside a dark, app-styled listbox drawn in the page DOM — never the browser's native `<select>` popup — with light readable text and a visible selected state, so theming no longer depends on platform popup rendering.
- R2. The quality trigger visually matches the adjacent Language combobox trigger: `h-14`, `rounded-xl`, `border-white/15`, `bg-stone-900/70`, amber focus ring, chevron affordance; it shows the current tier label (`Highest` / `High` / `Low` from the `CollectionDownloadModal` message namespace) and, when no tier is selectable, the placeholder text passed by the caller.

**Behavior**

- R3. Choosing an option sets the selected tier, closes the listbox, and the next "Download all" builds its queue for that tier; the effective-tier fallback (`commonTiers[0]` when the pick is not available) is unchanged.
- R4. Opening the listbox, hovering, or clicking an option never dismisses the surrounding dialog; the popup tracks the trigger's position when either of the modal's scroll surfaces (the dialog viewport or the inner column) scrolls, or the window resizes.
- R5. The trigger is disabled while a download is running or when no common tier exists (same conditions as today's `disabled={busy || !effectiveTier}`).

**Accessibility**

- R6. The trigger exposes `aria-haspopup="listbox"`, `aria-expanded`, and `aria-controls`; options are `role="option"` with `aria-selected`; the trigger's accessible name is the visible "Video quality" text via `aria-labelledby`, and the listbox is labelled by the same element.
- R7. Closing the listbox by any path — choosing an option, Escape, or click/tap outside the trigger and popup — returns focus to the trigger; Escape closes only the listbox, and the dialog's own Escape handling is unaffected when the listbox is closed.
- R9. With the trigger focused, ArrowDown/ArrowUp open the list and move the highlighted option, Home/End jump to the first/last option, Enter/Space select the highlighted option; the highlighted option is exposed through `aria-activedescendant` on the trigger while DOM focus stays on the trigger.

**Test surface**

- R8. `data-testid="watch-collection-download-quality"` stays on the trigger element; options carry `data-testid="watch-collection-download-quality-option"` and `data-tier`.

### Scope Boundaries

- The Language field (`LanguageCombobox`) is unchanged; it is only screenshot-verified alongside the new trigger for parity.
- No i18n key changes; the three tier labels and the `qualityLabel` placeholder already exist in `apps/web/messages/*.json` under `CollectionDownloadModal`.

#### Deferred to Follow-Up Work

- Migrate `DownloadModal.tsx`'s inline tier listbox onto the shared component from U1. It carries its own safeguard regression suite (`docs/solutions/ui-bugs/watch-download-modal-safeguards-can-regress-independently.md`) and per-option `data-size-bytes` attributes, so it is a separate, test-heavy refactor. Create a `todos/` entry for it in this PR so the second copy has an owner.
- Give the tier listbox an above/below placement flip like `LanguageCombobox` when there is no room below the trigger; today `DownloadModal` also always drops below, so this is a pre-existing gap, not a regression.
- Replace the two other native `<select>` elements on Watch (`SubtitleTranscript.tsx`, `SiblingCarousel.tsx`) if the same popup-theme defect is reported there.

## Planning Contract

### Key Technical Decisions

- KTD1. **Custom portaled listbox, not native `<select>` styling.** `scheme-dark` is already applied and the popup still renders light on Linux Chrome; `<option>` colors are ignored on macOS. The repo's proven answer for these exact tiers is `DownloadModal.tsx`'s `role="listbox"` popup portaled to `document.body` with fixed positioning. Governs R1, R2, R4.
- KTD2. **Extract into a shared `TierListbox` component instead of inlining a second copy.** The popup mechanics (portal, trigger rect, click-outside + Escape-first capture listeners, resize/scroll repositioning, mount/unmount animation) are ~120 lines. The new component is modelled on `DownloadModal.tsx`, adds the keyboard model R9 requires (which `DownloadModal` lacks — mirror `LanguageCombobox`'s `activeIndex` handling), and is adopted by `CollectionDownloadModal` only in this PR; two copies coexist until the deferred `DownloadModal` migration lands on it. Governs R3–R7, R9.
- KTD3. **Hand-rolled listbox, not `@base-ui/react` Select.** `apps/web` uses base-ui only for Dialog/Accordion/Switch/Button; every existing dropdown (`LanguageCombobox`, `DownloadModal`) is a hand-rolled portal. Introducing base-ui Select adds a new primitive with unproven jsdom and nested-Dialog behavior for a one-field fix; the cost accepted is implementing R9's keyboard model by hand. Governs R1, R9.
- KTD4. **Label association via `aria-labelledby` to a visible `<span id>`, not `<label htmlFor>`.** A `<label>` pointing at a `<button>` forwards its activation click to the button (both wrapping and `htmlFor` shapes), which would open the list on label clicks and, with the list open, close-then-reopen it through the outside-`pointerdown` handler. The adjacent Language field already labels its trigger with a plain `<span>`, so this keeps the two fields consistent. Governs R6.

### Assumptions

- The user wants the fix to cover the quality dropdown; the "(and Language)" mention is satisfied by verifying the existing `LanguageCombobox` renders themed alongside it, since it already is a custom dark popup in the screenshot.
- Portaling the listbox to `document.body` does not trigger base-ui Dialog outside-press dismissal. Verified against the installed `@base-ui/react` source: the modal Dialog's outside press closes only when the event target is its own backdrop, and its Escape handler is a bubble-phase `keydown` on `document`, so a capture-phase `stopPropagation` shields it. `DownloadModal.tsx` and `LanguageCombobox` (inside this very modal) already portal to body in production.
- Because no Admin GraphQL endpoint is reachable from a worktree, real-browser proof uses a throwaway, uncommitted harness route that renders the new component inside the app's `Dialog` with fixture tiers; jsdom tests prove the modal wiring.
- Cross-browser consistency follows from rendering the popup in the DOM (R1): a DOM listbox does not vary per platform the way native `<select>` popups do. The browser gate exercises Chrome only, which is the browser the defect was reported in and the one the DevTools MCP drives.
- Page-load performance is not affected: `CollectionDownloadModal` is loaded via `dynamic(..., { ssr: false })` only when `modalState === "download"` in `SeriesPageClient.tsx`; the change is confined to that lazily loaded chunk. The Verification Contract records the chunk's before/after size by the method the repo convention prescribes.

### Sources

- `apps/web/src/components/watch/CollectionDownloadModal.tsx` — the `<select>` block (`data-testid="watch-collection-download-quality"`), `effectiveTier`, `tierMessageKey`.
- `apps/web/src/components/watch/DownloadModal.tsx` — inline tier listbox: `dropdownOpen` / `dropdownMounted` / `dropdownRect` state, `updateDropdownRect`, `closeDropdown`, the capture-phase `pointerdown` / `keydown` document listeners, `SIZE_DROPDOWN_ANIMATION_MS`, the `createPortal(<ul role="listbox">…)` block, and the `fileSizeLabel` placeholder fallback on the trigger.
- `apps/web/src/components/watch/LanguageCombobox.tsx` — `activeIndex` / `activeIndexRef` keyboard model and `useId`-derived listbox ids.
- `apps/web/src/components/watch/__tests__/DownloadModal.test.tsx` — how the listbox is driven in jsdom (`watch-download-modal-size-option`, `data-tier`, the `$$` document-level query helper needed for portaled content).
- `apps/web/src/components/watch/__tests__/CollectionDownloadModal.test.tsx` — the `scheme-dark` and `border-white/15` / `bg-stone-900/70` className pins on the quality element; the single-download `dubs` fixture.
- `apps/web/src/components/watch/download-options.ts` — `DownloadTier` union and `bucketDownloads` (one download → `highest` only; two → `highest`+`low`; three or more → all three).
- `apps/web/src/components/watch/download-link.ts` — proxy URL carries `downloadId`; the filename's rendition segment encodes height, not tier, when height is present.
- `apps/web/src/app/(preview)/preview/experience/[token]/page.tsx` — the `loadClientMessages` + `NextIntlClientProvider` wiring a harness route under `/preview` must copy; `apps/web/src/proxy.ts` bypasses the watch rewrite for `RESERVED_PREFIXES` (which include `preview`).
- `docs/solutions/best-practices/base-ui-dialog-state-attribute-detection-20260520.md` — inspect `data-open` / `data-closed`, not element presence, in browser probes.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` — the page-load evidence convention, including the static-chunk-graph method for `next/dynamic` surfaces.

## Implementation Units

### U1. Shared `TierListbox` component

- **Goal:** A reusable dark, portaled, keyboard-operable listbox for `DownloadTier` values with the popup mechanics from `DownloadModal.tsx`.
- **Requirements:** R1, R2, R3, R4, R5, R6, R7, R8, R9 (via KTD1–KTD4).
- **Dependencies:** none.
- **Files:**
  - create `apps/web/src/components/watch/TierListbox.tsx`
  - create `apps/web/src/components/watch/__tests__/TierListbox.test.tsx`
- **Approach:**
  1. Props: `tiers: DownloadTier[]`, `value: DownloadTier | null`, `onChange(tier)`, `getLabel(tier): string` (non-nullable; called only when `value` is non-null), `placeholder: string` (rendered on the trigger when `value` is null, mirroring `DownloadModal`'s `fileSizeLabel` fallback), `disabled?`, `labelledBy` (id of the caller's visible label element, applied as `aria-labelledby` on both trigger and listbox), `testIdPrefix` (yields `${prefix}` on the trigger, `${prefix}-list`, `${prefix}-option`), `triggerClassName?`.
  2. Lift the open/mounted/rect state, `updateDropdownRect`, `closeDropdown`, the mount-timeout effect, and the capture-phase `pointerdown` / `keydown` / `resize` / `scroll` listeners from `DownloadModal.tsx`; keep `event.stopPropagation()` on Escape so base-ui's Dialog does not also close (R7).
  3. Add the keyboard model R9 requires, following `LanguageCombobox`'s `activeIndex` + ref pattern: ArrowDown/ArrowUp on the closed trigger open the list with the current value highlighted; while open they move the highlight, Home/End jump, Enter/Space call `onChange` with the highlighted tier and close; the trigger carries `aria-activedescendant` pointing at the highlighted option's id; DOM focus never leaves the trigger.
  4. Every close path — option click, Enter/Space, Escape, outside pointerdown — calls `triggerRef.current?.focus()` so removing the focused option row never drops focus to `<body>` (R7).
  5. Render the trigger as a `<button type="button">` with `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls`, `data-open`, the current label or placeholder, and a rotating `ChevronDown`; compose its className as `cn(BASE_TRIGGER_CLASSES, triggerClassName)` using `cn` from `@/lib/utils` so caller overrides deterministically replace conflicting base utilities (do not string-concatenate as `LanguageCombobox` does). Render the popup through `createPortal(..., document.body)` as `<ul role="listbox">` with `<li><button role="option" aria-selected data-tier id>` rows, reusing the `DownloadModal` popup classes (`bg-stone-950/95`, `border-white/10`, `rounded-2xl`, `bg-brand-red` selected row, `Check` icon) plus a distinct highlighted-row style for keyboard navigation.
  6. Do not render the trigger's file-size copy or `data-size-bytes`; those stay `DownloadModal`-specific.
- **Patterns to follow:** `DownloadModal.tsx` listbox block; `LanguageCombobox.tsx` for the keyboard `activeIndex` model and `useId`-derived ids only.
- **Test scenarios:**
  - Renders the trigger with the label for `value` and `aria-expanded="false"`; the list is not in the document.
  - `value: null` renders the `placeholder` text on the trigger, does not call `getLabel`, and marks no option selected when opened.
  - Clicking the trigger renders one `role="option"` per tier in the given order with matching `data-tier`, marks the `value` option `aria-selected="true"`, and sets `aria-expanded="true"`.
  - Clicking an option calls `onChange` with that tier once, closes the list (`data-open="false"` on the list, then unmounted after the animation timeout), and leaves `document.activeElement` on the trigger.
  - With the trigger focused and the list closed, ArrowDown opens the list with the current value highlighted; ArrowDown twice then Enter calls `onChange` with the tier two below the current value and closes the list; `aria-activedescendant` on the trigger names the highlighted option's id while open; Home/End move the highlight to the first/last option; Space selects like Enter.
  - Pressing Escape while open closes the list, does not propagate to a `keydown` listener registered on `document` in the bubble phase (stand-in for the Dialog), and focuses the trigger.
  - `pointerdown` outside the trigger and list closes the list and focuses the trigger; `pointerdown` inside the list does not close it.
  - `disabled` renders a disabled trigger; clicking it or pressing ArrowDown does not open the list.
  - `value` not in `tiers` renders the trigger without crashing and marks no option selected.
  - The trigger and the list both carry `aria-labelledby` equal to the `labelledBy` prop.
  - Passing `triggerClassName="px-4"` yields a trigger className containing `px-4` and not the base `px-5` (twMerge override, not concatenation).
- **Verification:** The new suite passes under `pnpm --filter @forge/web test -- TierListbox`; the component compiles with no `any`.

### U2. Wire the listbox into `CollectionDownloadModal`

- **Goal:** The collection download modal uses `TierListbox` for "Video quality" and its tests pin the new contract.
- **Requirements:** R1–R9.
- **Dependencies:** U1.
- **Files:**
  - modify `apps/web/src/components/watch/CollectionDownloadModal.tsx`
  - modify `apps/web/src/components/watch/__tests__/CollectionDownloadModal.test.tsx`
- **Approach:**
  1. Replace the `<label><span/><select/></label>` block with a `<div>` holding `<span id={qualityLabelId}>{t("qualityLabel")}</span>` and `<TierListbox labelledBy={qualityLabelId} tiers={options?.commonTiers ?? []} value={effectiveTier} onChange={setSelectedTier} getLabel={(tier) => t(tierMessageKey(tier))} placeholder={t("qualityLabel")} disabled={busy || !effectiveTier} testIdPrefix="watch-collection-download-quality" triggerClassName=… />` (KTD4); mint `qualityLabelId` with `useId`.
  2. Pass the same trigger classes the Language combobox uses in this modal (`border-white/15 bg-stone-900/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-white/25 hover:bg-white/10 focus-visible:ring-amber-400`) plus `h-14 rounded-xl px-4 text-stone-100` so the existing className pins keep passing (R2).
  3. Remove the `scheme-dark` class and its test; nothing else in the modal changes.
  4. New list/option assertions must query `document` (not the render `container`) because the list is portaled to `document.body`; mirror `DownloadModal.test.tsx`'s `$$` helper. Assert `data-open="false"` before asserting on unmount, since the list stays mounted for the animation window.
- **Patterns to follow:** The `LanguageCombobox` usage a few lines above for the `compact` / `triggerClassName` shape and its `<span>` label.
- **Test scenarios:**
  - Replace `uses a dark native menu for video quality options` with: the quality trigger is a `button` with `aria-haspopup="listbox"`, and no `select` element exists in the modal.
  - Add a `threeTierDubs` fixture in which each dub carries three downloads with distinct `documentId`s and heights (e.g. 2160/1080/480) so `bucketDownloads` yields `highest`/`high`/`low`; the existing single-download `dubs` fixture yields only `highest` and cannot drive tier selection.
  - With `threeTierDubs` loaded, clicking the trigger lists `Highest`, `High`, `Low` in that order with `aria-selected` on `highest`.
  - With `threeTierDubs`, choosing `High` then clicking "Download all" calls `runCollectionDownloadQueue` with every item's `url` carrying `downloadId=<that dub's 1080 download documentId>` (the filename encodes height, not tier, when height is present, so the query param is the discriminating assertion).
  - While a download is running (`runCollectionDownloadQueueMock` pending), the quality trigger is `disabled`.
  - When the loaded dubs share no common tier, the trigger is `disabled`, shows the "Video quality" placeholder, and "Download all" stays disabled.
  - The existing `border-white/15` / `bg-stone-900/70` className assertions on `watch-collection-download-quality` still pass.
  - The trigger's `aria-labelledby` resolves to the element whose text is "Video quality".
- **Verification:** `pnpm --filter @forge/web test -- CollectionDownloadModal` passes; `pnpm --filter @forge/web typecheck` and `pnpm --filter @forge/web lint` are clean.

## Verification Contract

| Gate              | Command / method                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Applies to                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Unit              | `pnpm --filter @forge/web test -- TierListbox CollectionDownloadModal DownloadModal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | U1, U2 (`DownloadModal` suite confirms the unchanged single-video modal still passes) |
| Types             | `pnpm --filter @forge/web typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | U1, U2                                                                                |
| Lint              | `pnpm --filter @forge/web lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | U1, U2                                                                                |
| Real browser      | With `.env.ci` sourced, add an uncommitted harness at `apps/web/src/app/(preview)/preview/tier-listbox-harness/page.tsx` (`preview` is in `RESERVED_PREFIXES`, so `proxy.ts` leaves it alone) that wraps a client component in `NextIntlClientProvider` with `loadClientMessages(...)` exactly as `(preview)/preview/experience/[token]/page.tsx` does (`DialogContent` reads the `WatchModal` namespace). The client component renders `Dialog`/`DialogContent` with the modal's exact props (`viewportClassName="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"`, `showCloseButton={false}`, `className` with `bg-transparent p-0`), the same inner `<div className="flex max-h-[86vh] flex-col gap-8 overflow-y-auto p-6 sm:p-9">` wrapper holding the two-column field row — a fixture-backed `LanguageCombobox` beside the labelled `TierListbox` (three tiers, collection trigger classes) — followed by enough filler blocks to overflow at a 900px-tall viewport. Run `next dev` on a free port and drive it with the Chrome DevTools MCP: screenshot both closed triggers for parity (R2) and the open quality popup (dark, readable labels, red selected row) (R1); click an option and confirm the dialog popup still has `data-open` and focus is on the trigger (R4, R7); press Escape while open and confirm the list closes and the dialog stays open (R7); Tab to the trigger and operate it with keys only — ArrowDown, ArrowDown, Enter — confirming the selection changed and `aria-activedescendant` tracked the highlight (R9); with the list open, scroll the inner column, then the dialog viewport, then resize the window, asserting each time that the list's `top` equals the trigger's bottom edge plus the gap (R4). Delete the harness before commit. | R1, R2, R4, R7, R9                                                                    |
| Page-load posture | After `next build` before and after the change, `grep -l watch-collection-download-quality .next/static/chunks/*.js` to locate the lazy chunk, record its byte size both times, and confirm that chunk is absent from `.next/build-manifest.json` `rootMainFiles` (per the static-chunk-graph method in `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Assumptions (page-load)                                                               |

Toolchain note: fresh worktrees need the mise PATH export and `pnpm install --frozen-lockfile --prefer-offline --config.ignore-scripts=true` before any of the above.

## Definition of Done

- All Verification Contract gates green; the `scheme-dark` test is replaced, not deleted without a successor.
- Browser screenshot evidence of the open listbox inside a dialog, beside the Language trigger, attached to the PR.
- `DownloadModal.tsx` is not modified in this PR; its migration onto `TierListbox` stays deferred and has a `todos/` entry.
- No harness route, debug logging, or abandoned-attempt code left in the diff.
