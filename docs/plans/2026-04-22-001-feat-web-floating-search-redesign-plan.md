---
title: "feat: replace sticky header with floating searchbar + category modal (apps/web)"
type: feat
status: active
date: 2026-04-22
origin: docs/brainstorms/2026-04-20-web-floating-search-redesign-requirements.md
---

# feat: replace sticky header with floating searchbar + category modal (apps/web)

## Overview

Replace the global sticky `SiteHeader` (JFP logo + search button) in `apps/web` with a watch-modern-style floating glass searchbar and a reskinned full-screen modal that surfaces a 6-card category grid for browsing plus inline `semanticSearch` results. Modal state is coordinated via a new `FloatingSearchProvider` React Context mounted in `RootLayout`. The `/search` route is deprecated to a redirect, and the modal becomes the canonical search surface with shareable `?q=` URLs. This is a UI redesign over existing search wiring — no GraphQL, Strapi, or mobile changes.

## Problem Frame

The current `SiteHeader` (see origin: `docs/brainstorms/2026-04-20-web-floating-search-redesign-requirements.md`) is utilitarian: logo + 16px search icon in a dark sticky bar. Users without a specific query have no first-class browse affordance and the search surface is buried visually. The sibling watch-modern implementation makes search the primary action and adds a category grid as a discovery surface. Porting that design to forge's `apps/web` gives search visual weight and gives browsing a clear entry point, while reusing the already-working `semanticSearch` wiring underneath.

## Requirements Trace

All requirement IDs refer to the origin requirements doc.

- R1. `FloatingSearchBar` client component with scroll-threshold choreography, glass styling, focus-visible ring, aria behavior, no `min-width`.
- R2. Inline floating logo (not a named component) mounted alongside the bar; `hidden sm:block`; correct basePath-relative asset path.
- R3. Modal = in-place reskin of existing `SearchOverlay.tsx` preserving focus trap, stale-request guard, skeleton timing, pagination, Escape handler, body scroll lock.
- R3a–R3f. Glass input matching bar; close button; clear-input button (X) inside the input; category grid when empty; results grid when queried; empty + error states; mobile-only modal-header logo.
- R4. Inline category grid render block with responsive card padding/font sizing, `textShadow` for gradient legibility, `active:scale-95` for press feedback, and `[@media(hover:hover)]:hover:scale-105` to avoid sticky-hover on touch; click bypasses debounce and syncs URL.
- R5. Static `CATEGORIES` array with 6 entries ported verbatim from watch-modern, lifted into `apps/web/src/lib/search-categories.ts` (a pure module with zero React / Next / Apollo imports) so both the overlay and the verification script can import it cleanly.
- R6. Reuse `apps/web/src/lib/search.ts` `SEMANTIC_SEARCH` and existing Apollo client; no GraphQL changes.
- R7. Locale hardcoded `"en"`.
- R7a. Pre-ship verification script with `≥6 results` gate, revise-before-merge on fail (no runtime omission).
- R8. Remove `SiteHeader` import + `pt-16` wrapper from layout; delete `SiteHeader.tsx` and `SearchToggle.tsx`.
- R9. Mount `FloatingSearchBar` + floating logo once in `RootLayout`, inside a `<Suspense fallback={null}>` boundary that isolates the provider's `useSearchParams()` dependency.
- R9a. VideoHero clearance audit (forward-looking; current `VideoHero.tsx` anchors chrome bottom via `items-end` so no reposition needed today).
- R10. Replace `apps/web/src/app/search/page.tsx` with server-side `redirect()` forwarding `?q=`. `SearchInput`/`SearchResults` are preserved regardless because `/demo-search` currently imports them via its own `DemoSearchInput`/`DemoSearchResults` components — a follow-up PR can consolidate if justified.
- R10a. URL query sync inside shared `search(q)` callback; `router.replace` with `as Route` cast; preserves other query params via `useSearchParams()` clone; `?q=` persists past modal close.
- R10b. `FloatingSearchProvider` React Context exposes `{ open, setOpen, query, setQuery }` to bar, modal, and layout children wrapper.
- R11. Modal keeps `role="dialog" aria-modal="true"` + focus trap + Escape + body scroll lock (all preserved from existing overlay).
- R12. Floating bar keyboard-activatable via Enter/Space with `aria-label="Search videos"`.
- R13. Bar + floating logo cross-fade out with `opacity-0 pointer-events-none inert aria-hidden="true"` when modal opens.
- R14. Children wrapper in layout toggles `inert` + `aria-hidden` via provider state. React 19 ships `inert` natively — no type shim needed (verified in research).
- R15–R17. Reuse stone-900 bg + Apercu Pro font; inline gradient styles on cards; no new Tailwind plugins.

## Scope Boundaries

- No trending-search pills, no language selector, no Algolia, no InstantSearch, no cmdk, no Framer Motion.
- No `packages/graphql` or `apps/cms` changes.
- No `apps/mobile` or `apps/tv` changes.
- No new GraphQL operations; `SEMANTIC_SEARCH` stays in `apps/web/src/lib/search.ts` (pre-existing violation of `apps/web/CLAUDE.md`'s "ops come from packages/graphql" is inherited, not resolved here).
- No search analytics / tracking.
- No personalization, search history, or recent-searches UI.
- No timestamp seeking on result tap.
- `/demo-search` remains untouched. Note: `/demo-search/page.tsx` imports `DemoSearchInput`/`DemoSearchResults` (under `apps/web/src/components/demo-search/`), which in turn import the base `SearchInput`/`SearchResults`. The base components therefore still have transitive usage and must be preserved.
- The origin brainstorm stated that `SearchInput` + `SearchResults` would be deleted alongside `/search` deprecation. That instruction is **superseded by R10** in this plan — components remain due to the transitive consumer above.

### Deferred to Separate Tasks

- Migrate `SEMANTIC_SEARCH` into `packages/graphql`: follow-up PR.
- Analytics hook for category clicks + search queries: follow-up PR.
- Dark gradient scrim on routes with light hero imagery if/when any ship: follow-up.
- Component-level tests (jsdom + React Testing Library): requires expanding `apps/web/vitest.config.ts` glob + environment. Deferred; this plan tests library helpers only.

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/components/sections/DynamicBackground.tsx` — the only local example of the `createContext` + Provider + custom-hook pattern. `FloatingSearchProvider` is a new pattern with a richer value shape (`{ open, setOpen, query, setQuery, search, closeAndKeepQuery }`) — `DynamicBackground` is a reference for the structural layout only, not for the value shape.
- `apps/web/src/components/search/SearchInput.tsx` lines 31–47 — exact URL-sync pattern to port: `router.replace(\`${path}?q=${encodeURIComponent(q)}\` as Route)` with 300ms debounce. The `as Route` cast is required because `apps/web/next.config.mjs` sets `experimental.typedRoutes: true`.
- `apps/web/src/components/SearchOverlay.tsx` — the reskin target. Key pieces to preserve verbatim: `requestIdRef` stale-request guard (lines 18, 117, 137), Escape handler (49–56), body scroll lock (59–66), Tab focus trap (69–91), skeleton 500ms threshold, `loadMore()` offset pagination (163–190).
- `apps/web/src/components/SearchToggle.tsx` — current portal pattern: `createPortal(<SearchOverlay />, document.body)`. Keep this portal approach inside the new `FloatingSearchBar` to dodge `backdrop-filter` stacking-context traps.
- `apps/web/src/app/layout.tsx` — server component. The new client `FloatingSearchProvider` imports here and wraps `{children}`; this is identical to the current `SiteHeader` → `SearchToggle` server-layout/client-island pattern.
- `apps/web/src/app/search/page.tsx` — deprecation target (server component, awaits `searchParams` per Next 16).
- `apps/web/src/app/demo-search/page.tsx` — must keep working (imports `SearchInput`/`SearchResults` via `DemoSearchInput`/`DemoSearchResults`).
- `apps/web/src/components/sections/VideoHero.tsx` — `items-end` + `min-h-[500px]` bottom-anchored chrome; `controls: false` on video-js. No chrome above `top-[192px]` today.

### Institutional Learnings

- `docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md` — canonical reference for the existing overlay. Must-preserve patterns: server-only import poisoning protection (`content.ts` vs `search.ts` split), `createPortal` for overlay mount, `await searchParams` in Next 16, Tailwind v4 animations registered via `@theme --animate-*` in `globals.css` (inline `style={{ animation }}` is purged), `requestIdRef` stale guard, no duplicate `className` props, `String!` vs `I18NLocaleCode!` on `semanticSearch`.
- `docs/solutions/web/nextjs-headers-defeats-route-cache.md` — Do NOT call `headers()`/`cookies()` inside `FloatingSearchProvider` or anything mounted in `RootLayout`, or every route goes dynamic. **`useSearchParams()` has the same deopt footprint** when called from a client component at layout root: Next.js treats the nearest Suspense boundary as the prerender scope and forces all routes under the layout into dynamic rendering unless the reader is wrapped in `<Suspense>`. This plan wraps `FloatingSearchProvider` in `<Suspense fallback={null}>` inside `RootLayout` to isolate the bail-out and keep every ISR-enabled page (`/`, `/[slug]`, `/[slug]/[locale]`, `/demo-search`, `/demo-recommendations/...`) on the Full Route Cache.
- `docs/solutions/web/nextjs16-cachecomponents-isr.md` — Keep `export const revalidate = ...` behavior intact on non-search pages; the `/search` redirect is server-side and does not poison caching.
- `docs/solutions/best-practices/mobile-search-ui-patterns-20260416.md` — stale-response guard via request-ID ref is the blessed pattern; preserved from current overlay.

### External References

Skipped. Local patterns cover every decision surface (Context, URL sync, focus trap, scroll listener, redirect). Next.js 16 + React 19 are current; `redirect()` from `next/navigation` is idiomatic even though this would be the app's first usage.

## Key Technical Decisions

- **Shared state lives in a single React Context** (`FloatingSearchProvider`). The provider is mounted inside `<Suspense fallback={null}>` in `RootLayout`; this isolates `useSearchParams()`'s dynamic-rendering deopt to the provider subtree so the rest of every page can keep its existing `export const revalidate = 60` static prerender. Initial `open` is derived lazily from `useSearchParams().get('q') != null`.
- **Query ownership**: `query` lives on the provider, not in local overlay state. The reskinned `SearchOverlay` reads `query` via `useFloatingSearch()` and calls `setQuery` / `search(q)` via the same hook. Remove the existing overlay's on-close `setQuery("")` reset (lines 36–45 of current `SearchOverlay.tsx`) — the new close semantics keep `?q=` and the seeded query alive until explicit clear.
- **URL sync happens inside the shared `search(q)` callback**, not the debounced input handler. Typed, pasted, category-clicked, and URL-on-mount all flow through the same path and all update the URL. Extracted as `buildSearchUrl(pathname, existingParams, query)` in `apps/web/src/lib/search-url.ts` so it is unit-testable. The helper returns `string`; the `as Route` cast is applied at the `router.replace()` call site inside the provider's `search()` callback, mirroring `SearchInput.tsx:38-42` exactly. Note: the `as Route` cast is required for `typedRoutes: true` to compile but does **not** provide runtime validation — the same cosmetic cast as `SearchInput.tsx` uses today.
- **`?q=` persists past modal close**. Resolves the adversarial reviewer's contradiction: shareable URLs require the query to survive modal close. The user's only path to clear `?q=` is the input's clear button (R3a), which dispatches `search("")`.
- **`/search` deprecation is narrow**. Only `apps/web/src/app/search/page.tsx` is replaced with a `redirect()`; `SearchInput` and `SearchResults` stay in place because `/demo-search` transitively consumes them via `DemoSearchInput`/`DemoSearchResults`.
- **No runtime category omission**. The static `CATEGORIES` array always renders 6 cards; if pre-ship verification (`verify-categories.ts`) shows a term is weak, the term is revised in the array before merge. Eliminates the ragged-grid UX failure mode.
- **CATEGORIES lives in a pure module** (`apps/web/src/lib/search-categories.ts`) with zero React / Next / Apollo imports, so the Node-executed verification script can import it without dragging client-only modules (Apollo, `next/navigation`, env-schema validation) through the import graph.
- **React 19 native `inert`** — no type shim or polyfill. Verified `react@^19.0.0` in `apps/web/package.json`.
- **Portal retained for modal mount**. Matches current `SearchToggle.tsx` behavior; dodges `backdrop-filter` stacking-context traps per the institutional learnings doc.
- **Scroll listener is passive + rAF-coalesced**. Registered only when modal is closed. (Body scroll lock during modal means `scrollY` cannot change while open; the listener simply re-registers on close and the next genuine scroll event updates state — no explicit `scrollY` re-read needed.) Runs in parallel with `VideoHero.tsx`'s existing pause-on-scroll listener (both passive; contention deferred to profiling).
- **`pinned` boolean lives in `FloatingSearchBar` local state**, not in the provider. Keeps scroll-driven re-renders isolated to the bar; provider consumers don't re-render on every scroll event.
- **Tailwind v4 animations reuse existing `@theme` keyframes**. `--animate-overlay-fade-in`, `--animate-overlay-fade-out`, `--animate-card-enter`, `--animate-card-exit` already ship in `apps/web/src/app/globals.css`. No new inline keyframe styles (Tailwind v4 purges them).

## Open Questions

### Resolved During Planning

- **Provider architecture**: React Context in a new `'use client'` file wrapping `RootLayout`'s children. Mirrors `DynamicBackground.tsx`.
- **URL-sync library shape**: extracted helper in `apps/web/src/lib/search-url.ts`; the reskinned overlay and `FloatingSearchBar` both call it.
- **`inert` type support**: React 19 ships it natively; no shim.
- **Test surface**: library `.ts` tests for `search-url.ts` and (optionally) a shape validator for `CATEGORIES`. Component tests deferred — vitest config currently only globs `src/**/*.test.ts` and runs under `environment: "node"`.

### Deferred to Implementation

- Exact `top-[128px]`/`top-[30px]` class names may need a `clsx`-style toggle — decide when wiring the scroll listener.
- Whether to extract the category grid into its own render helper function or leave inline — cosmetic; decide once the modal file hits ~400 lines.
- Whether the `verify-categories.ts` script should run against staging or a locally-running Strapi — confirm at execution time based on which endpoint is reachable.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
 RootLayout (server)
 └── <FloatingSearchProvider>         (client; the ONLY client island at layout root)
     ├── <FloatingSearchBar />        (fixed top, glass, click → setOpen(true))
     ├── <FloatingLogoMark />         (inline Link; fixed top-left; hidden <sm)
     ├── <LayoutChildrenGate inert={open} aria-hidden={open}>
     │     {children}                 (server-rendered route content)
     │   </LayoutChildrenGate>
     └── {open && createPortal(<SearchOverlay />, document.body)}

 FloatingSearchProvider exposes:
   { open, setOpen,
     query, setQuery,
     search(q),            // shared callback: setQuery → updateUrl(q) → semanticSearch
     closeAndKeepQuery() } // closes modal; does NOT clear ?q=

 URL round-trip:
   ?q=foo on mount   → provider seeds open=true, query="foo" → overlay auto-runs search
   user types        → input.onChange → debounce(300ms) → search(q)
   category click    → search(card.searchTerm)
   search(q) →  setQuery(q)
             →  client.query({ SEMANTIC_SEARCH, vars: { query: q, locale: "en", limit: 20, offset: 0 }})
             →  router.replace(buildSearchUrl(pathname, searchParams, q) as Route)
```

## Implementation Units

- [ ] **Unit 1: `FloatingSearchProvider` context + layout wiring**

**Goal:** Stand up the shared modal-state provider and wire it into `RootLayout` so `FloatingSearchBar`, the modal, the floating logo, and the children gate all share one state.

**Requirements:** R9, R10b, R13, R14

**Dependencies:** none

**Files:**
- Create: `apps/web/src/components/FloatingSearchProvider.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Test expectation: none for this unit — the provider is mostly wiring; library-level tests for the URL helper live with `search-url.ts` in Unit 3, and the integration behavior is verified via `next build` prerender output plus manual dev-server checks.

**Approach:**
- `'use client'` file. `createContext<FloatingSearchContextValue>(null)`. Provider wraps `{children}` with a div that toggles `inert={open}` and `aria-hidden={open || undefined}` when `open` is true.
- Initial `open` state reads `useSearchParams().get('q')` — if non-empty, starts `true` and seeds `query` with the trimmed value (up to 200 chars, matching existing overlay guard).
- Expose `useFloatingSearch()` hook (structurally mirrors `useDynamicBackground()`); throws outside provider.
- Provider renders `{children}` inside the gate div, and separately renders three client islands as siblings to the gate: `<FloatingSearchBar />` (Unit 2), the inline floating logo (Unit 2 — a `Link` with fixed position, see R2), and when `open`, the portal-mounted reskinned `<SearchOverlay />` (Unit 3). DOM order: gate → bar → logo → portal-root (portal mounts `<SearchOverlay />` onto `document.body` when open).
- `RootLayout` stays a server component. Replace `<SiteHeader />` + `<div className="pt-16">{props.children}</div>` with `<Suspense fallback={null}><FloatingSearchProvider>{props.children}</FloatingSearchProvider></Suspense>`. The `<Suspense>` boundary is required so `useSearchParams()` inside the provider does not force all layout-scoped routes into dynamic rendering (see institutional learnings).

**Patterns to follow:**
- `apps/web/src/components/sections/DynamicBackground.tsx` — `createContext` + provider + custom hook template.
- `apps/web/src/components/sections/DynamicBackground.tsx` consumer in `app/[slug]/page.tsx` for hook usage.

**Test scenarios:**
- Integration (manual): `?q=forgiveness` on any route → modal auto-opens pre-populated.
- Happy path: Provider renders without crashing with no `?q=` present (open starts `false`).
- Edge case: `?q=` present but empty string → provider does not auto-open.
- Edge case: `?q=` value exceeds 200 chars → provider trims to 200 when seeding `query`.

**Verification:**
- `pnpm -F @forge/web typecheck` passes (React 19's `inert` types land cleanly).
- `pnpm -F @forge/web build` output's route table still shows `●` (ISR) on `/`, `/[slug]`, `/[slug]/[locale]`, `/demo-search`, `/demo-recommendations/*` after the change. Routes must not switch to `ƒ` (Dynamic). If any do, the `<Suspense>` wrapping is missing or misplaced.
- Visiting any route with `?q=foo` renders the modal pre-opened (pairs with Unit 3's overlay reskin).
- Content behind the modal receives `inert` + `aria-hidden` when open (inspected in DevTools).

- [ ] **Unit 2: `FloatingSearchBar` + inline floating logo + `SiteHeader` teardown**

**Goal:** Build the new floating search-entry chrome, mount it alongside the provider, and remove the dead `SiteHeader` / `SearchToggle` / `pt-16` scaffolding.

**Requirements:** R1, R2, R8, R9, R12, R13

**Dependencies:** Unit 1

**Files:**
- Create: `apps/web/src/components/FloatingSearchBar.tsx`
- Modify: `apps/web/src/app/layout.tsx` (mount bar + floating logo, remove header references)
- Modify: `apps/web/src/components/FloatingSearchProvider.tsx` (render the bar + logo as siblings to the gate)
- Delete: `apps/web/src/components/SiteHeader.tsx`
- Delete: `apps/web/src/components/SearchToggle.tsx`

**Approach:**
- `'use client'` component. Consumes `useFloatingSearch()` — calls `setOpen(true)` on any click / Enter / Space.
- Two scroll-related `useEffect`s in the bar. First: runs once on mount (no `open` dependency) to read `window.scrollY` synchronously and derive initial `pinned` — ensures the correct starting position even when the modal is pre-opened via `?q=` and the listener hasn't registered yet. Second: a passive `window.scroll` listener registered only while `open === false`, scheduling one `requestAnimationFrame` per scroll burst to update `pinned` (`scrollY > 80`). No "immediate re-read on close" — the listener re-registers on close and the next scroll event updates state naturally.
- Bar is a `<button type="button">` that opens the modal on click / Enter / Space. The button is styled to look like an input band but **is not a text field**: users can neither type into it nor paste. This is a deliberate divergence from watch-modern (which uses a real `<input>`) to avoid dual-state input coordination. The tradeoff — users who expect to start typing immediately must tap first — is accepted for implementation simplicity in v1; revisit if UX testing shows friction. Placeholder text rendered as a child `<span className="text-white/70">` reading "Search or browse topics…".
- Inline floating logo: a `Link` to `/` wrapping a `next/image` of `/images/jesusfilm-sign.svg` (remember `basePath: "/watch"` auto-prepends; do NOT include `/watch` in the src).
- Bar class outline: `fixed left-1/2 z-50 -translate-x-1/2 rounded-[35px] bg-white/10 px-6 py-3 text-left text-white/70 outline-1 outline-white/20 backdrop-blur-[10px] shadow-xl transition-[top,opacity] duration-300 ease-out w-[calc(100%-2rem)] max-w-[800px] focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2`. No `min-width`. The `transition-[top,opacity]` ensures the bar cross-fades in step with the modal's `--animate-overlay-fade-in` rather than snapping to `opacity-0` instantly.
- `top` toggles: `top-[128px]` (hero) vs `top-[30px]` (pinned) via conditional class. Only `top` and `opacity` animate — width/height/padding/font-size stay identical.
- When `open`, both bar and logo apply `opacity-0 pointer-events-none inert aria-hidden="true"`. Use React 19's native `inert`.
- Layout changes: drop `<SiteHeader />` and the `pt-16` spacer div. The `<Suspense fallback={null}><FloatingSearchProvider>...</FloatingSearchProvider></Suspense>` wrapper (Unit 1) replaces them as the direct wrapper of `{children}`.

**Patterns to follow:**
- Existing `SearchToggle.tsx` click-handler shape + portal rendering pattern.
- `SiteHeader.tsx` logo `next/image` call — just fix the src path to `/images/jesusfilm-sign.svg`.

**Test scenarios:**
- Happy path: Bar renders, clicking it opens the modal (via provider `setOpen`).
- Happy path: Pressing Enter or Space while bar is focused opens the modal.
- Edge case: Scrolling past 80px adds pinned position; scrolling back above restores hero position.
- Edge case: Opening the modal while pinned → closing → bar restores to correct pinned/hero state based on current `scrollY`.
- Integration: Viewport < 640px hides the floating logo (`hidden sm:block`) while bar remains centered.
- Integration: With `bar + logo + VideoHero` on the home route, `MuteButton` remains clickable (no z-index occlusion — bar/logo are `z-50`, VideoHero chrome is bottom-anchored so no overlap at any breakpoint today).

**Verification:**
- `SiteHeader.tsx` and `SearchToggle.tsx` no longer exist; `grep -r 'SiteHeader\|SearchToggle' apps/web/src` returns nothing.
- `pnpm -F @forge/web dev`: bar is visible on home + `[slug]` + `/demo-search`; clicking opens the modal; scrolling animates `top`.
- Lighthouse a11y pass: bar is keyboard-reachable and has a visible focus ring.
- **R9a VideoHero audit** — walk every current route (`/`, `/[slug]` for representative slugs, `/[slug]/[locale]` for representative locales, `/demo-search`, `/demo-recommendations/*`) at `sm`, `md`, `lg`, and `xl` breakpoints in dev; confirm no interactive hero chrome sits above `top-[192px]`. Also check any pending hero-variant branches the team has open (ask in `#web` channel) before merge; reposition or defer accordingly.

- [ ] **Unit 3: `SearchOverlay` reskin in place (glass + category grid + URL sync + mobile modal logo)**

**Goal:** Reskin the existing overlay to match the watch-modern design: glass input styled identically to the bar, category grid when `query` is empty, results grid when non-empty, URL query sync inside the shared `search()` callback, mobile-only header logo, and preserved focus trap / stale guard / pagination / skeleton.

**Requirements:** R3, R3a–R3f, R4, R5, R6, R7, R10a, R11, R15, R16

**Dependencies:** Unit 1 (for provider `open`/`query`/`search` API), Unit 2 (to be the opener); this unit and Unit 2 ship together in one PR.

**Files:**
- Modify: `apps/web/src/components/SearchOverlay.tsx`
- Modify: `apps/web/src/components/FloatingSearchProvider.tsx` (provider owns `query`, `setQuery`, and the shared `search(q)` callback; overlay consumes via `useFloatingSearch()`)
- Create: `apps/web/src/lib/search-url.ts`
- Create: `apps/web/src/lib/search-categories.ts`
- Test: `apps/web/src/lib/search-url.test.ts`

**Approach:**
- Keep the outer `role="dialog" aria-modal="true"` shell, the Escape effect, the body scroll-lock effect, the Tab focus-trap effect, `requestIdRef` stale-request guard, and `loadMore()` pagination — all already correct.
- **Remove** the existing overlay's on-close state reset (current `SearchOverlay.tsx:36-46` — `setQuery("")`, `setResults([])`, etc., inside the `if (open)` else branch of the first effect). The new close semantics keep `?q=` + `query` + previously fetched results alive. Escape / X-icon only toggles `open` via provider; state preservation happens naturally.
- **Query state** comes from `useFloatingSearch()`, not local state. Replace `const [query, setQuery] = useState("")` with destructured `{ query, setQuery, search, close } = useFloatingSearch()`. Input is fully controlled by provider.
- Replace the input styling to match the bar exactly: `rounded-[35px] bg-white/10 ... focus-visible:outline-2 ...`.
- **Clear-input button (X)** inside the input's trailing slot: visible only when `query.trim() !== ""`. On click → `search("")` (which the provider dispatches as `setQuery("") + router.replace(pathWithoutQ)`). `aria-label="Clear search"`. Positioned absolute right-4, vertical center; target size ≥44×44 (use `p-2 -m-2` pattern for generous hit area around the 16px icon). This is distinct from the modal close button (R3b), which closes the modal but preserves `query`/`?q=`.
- **Focus management on open**:
  - Modal opens → input receives autofocus (preserve the existing 100ms `setTimeout(() => inputRef.current?.focus(), 100)` from current overlay).
  - DOM/tab order inside the modal: input → clear-input button (when visible) → close button → category grid cards (when query empty) or result cards + Load More (when query non-empty).
  - When query goes from empty → non-empty (user typed or clicked a category), focus stays on the input; the category grid disappears and results render.
  - When query goes from non-empty → empty (user hits clear), focus stays on the input; category grid renders.
- Render a `CATEGORIES` grid (imported from `lib/search-categories.ts`, 6 entries from R5) when `query.trim()` is empty and `searched === false`. Grid: `grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4`. Each card is a `<button>` with accessible name from its text content (no explicit `aria-label` needed), inline `style={{ background: cat.gradient }}`, and class: `relative aspect-video w-full overflow-hidden rounded-lg p-3 sm:p-6 text-white transition-transform duration-200 active:scale-95 [@media(hover:hover)]:hover:scale-105 focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2`. Title is real DOM text inside the button, class `text-sm sm:text-base md:text-lg font-semibold leading-tight` with inline `style={{ textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}`. Note: the Christmas card's red-on-red gradient meets AA contrast with white text at `text-base` (16px) + shadow; verify at `text-sm` (14px) on small screens during review — if borderline, upgrade smallest-breakpoint title to `text-base`.
- On card click: `clearTimeout(timerRef.current)`, then call provider's `search(cat.searchTerm)` — bypasses the 300ms debounce per R4.
- **Mobile-only modal-header logo (R3f)**: a `Link` to `/` with a 24×18 JFP mark, rendered inside the modal top bar with `sm:hidden`. DOM position: before the input (so tab order is logo → input → clear → close → cards).
- **URL sync** is a single responsibility of the provider's `search(q)` callback. `search(q)` does: `setQuery(q)` → `router.replace(buildSearchUrl(pathname, currentParams, q) as Route)` → if `q.trim() !== ""`, fire `client.query({ SEMANTIC_SEARCH, ... })` with `requestIdRef` guard. All consumers (input onChange debounce, category click, URL-on-mount hydration) funnel through this.
- **URL-hydration loading state**: when the modal auto-opens via `?q=` on mount, the input renders pre-populated immediately but results don't appear until `semanticSearch` resolves. To avoid a jarring 0–499ms blank content area (existing overlay's skeleton has a 500ms threshold), lower the threshold to 150ms when the open is triggered by URL hydration (vs user typing). Carry a small internal flag `hydratedOpen: boolean` on the provider that seeds `showSkeleton` timing.
- `search-url.ts` exports `buildSearchUrl(pathname: string, existingParams: URLSearchParams, q: string): string` — pure function; clones `existingParams`, sets or deletes `q`, then returns `${pathname}?${params.toString()}` (or bare pathname when no params remain). The `as Route` cast lives at the `router.replace()` call site inside `FloatingSearchProvider`, not inside the helper.
- `search-categories.ts` exports a `const CATEGORIES: readonly CategoryItem[]` with the 6 entries from R5 and a `CategoryItem` type — **no React / Next / Apollo imports** so the Node verification script can import it cleanly.
- Tailwind v4: animations stay on existing `@theme` keyframes in `apps/web/src/app/globals.css` — reuse `animate-overlay-fade-in/out` and `animate-card-enter/exit` via class, NOT via inline `style={{ animation: ... }}` (per solutions doc, v4 purges inline animation styles).

**Patterns to follow:**
- `apps/web/src/components/search/SearchInput.tsx` lines 31–47 — URL-sync debounce + `as Route` cast pattern.
- Existing `SearchOverlay.tsx` `search` callback — same shape, just accept `q: string` explicitly and take state updates inside.
- `docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md` — end-to-end reference; re-read before touching this file.

**Test scenarios:**
- `search-url.test.ts`:
  - Happy path: `buildSearchUrl("/", new URLSearchParams(), "forgiveness")` → `"/?q=forgiveness"`.
  - Happy path: empty query strips `q` — `buildSearchUrl("/", new URLSearchParams("q=foo&utm=bar"), "")` → `"/?utm=bar"`.
  - Happy path: existing params are preserved — `buildSearchUrl("/jesus/en", new URLSearchParams("utm=abc"), "love")` → `"/jesus/en?utm=abc&q=love"`.
  - Edge case: query with spaces and special chars is encoded — `buildSearchUrl("/", new URLSearchParams(), "peace & love")` → `"/?q=peace+%26+love"` (or the matching URLSearchParams encoding).
  - Edge case: empty params + empty query → returns bare pathname without trailing `?`.
- Integration (manual in dev): typing "love" updates the URL to `?q=love` while preserving `utm_*`; closing the modal leaves `?q=love` intact; clicking the clear button removes `?q=`.
- Integration (manual): clicking the Christmas card → input shows "christmas", results render, URL becomes `?q=christmas`.
- Integration (manual): refreshing on `/?q=forgiveness` auto-opens the modal and runs the search.
- Edge case (manual): focus trap — tabbing at the end of the modal wraps to the first focusable element; Shift+Tab from the first wraps to the last.

**Verification:**
- `pnpm -F @forge/web test search-url` passes.
- Typing, pasting, category clicking, and URL-on-mount all result in identical URL state + search behavior.
- Clear-input button (X) appears when query non-empty, disappears when empty, and on click resets both the URL (`?q=` removed) and the view (category grid returns).
- Close button (modal X) closes the modal but leaves `?q=` and `query` intact; reopening shows the previous search pre-loaded.
- No duplicate `className` attributes on any element (per solutions doc pitfall).
- DevTools → no console errors about stale `inert` types (React 19 types are active).

- [ ] **Unit 4: `/search` route → server-side redirect**

**Goal:** Replace the `/search` page with a `redirect()` that forwards `?q=` to `/?q=…`, deprecating the legacy route without breaking shareable links.

**Requirements:** R10

**Dependencies:** Unit 3 (modal reads `?q=` on mount).

**Files:**
- Modify: `apps/web/src/app/search/page.tsx`

**Approach:**
- Delete the existing `SearchResultsLoader`, `generateMetadata`, `Suspense`, and RSC query body.
- New body: an async default export that awaits `searchParams`, extracts `q`, and calls `redirect(q ? \`/?q=\${encodeURIComponent(q)}\` : "/")` imported from `next/navigation`.
- Do NOT touch `apps/web/src/components/search/SearchInput.tsx` or `SearchResults.tsx` — both remain imports from `/demo-search`.

**Patterns to follow:**
- `redirect()` usage in Next.js App Router docs (well-known pattern, just new to this codebase).
- `await searchParams` pattern already used in the file being replaced — keep the same `Promise<{ q?: string }>` signature so typed-routes stay valid.

**Test scenarios:**
- Happy path (manual): `curl -I <local>/watch/search?q=forgiveness` → 307/308 to `/watch/?q=forgiveness`.
- Happy path (manual): `curl -I <local>/watch/search` → 307/308 to `/watch/`.
- Edge case (manual): `/search?q=` (empty q) → redirects to `/` (no `?q=`).
- Edge case (manual): `/search?q=foo%20bar` → redirects preserving URL-encoding.

**Verification:**
- `/search` no longer renders its own UI; browser lands on `/` with modal auto-opened when `?q=` is present.
- `/demo-search` page still renders its own input + results (untouched).

- [ ] **Unit 5: Pre-ship category verification script**

**Goal:** Provide a reproducible way to check that each of the 6 hardcoded category search terms returns ≥6 results at `locale: "en"` before merge, so category cards never land on a weak or empty result set.

**Requirements:** R7a

**Dependencies:** Unit 3 (imports `CATEGORIES`).

**Files:**
- Create: `apps/web/scripts/verify-categories.ts`
- Modify: `apps/web/package.json` — add `tsx` to `devDependencies` (confirmed absent as of this plan's date) and a `"verify:categories": "tsx scripts/verify-categories.ts"` entry under `scripts`.

**Approach:**
- `tsx`-executable Node script. Imports `CATEGORIES` from `apps/web/src/lib/search-categories.ts` (the pure module created in Unit 3 — has zero React/Next/Apollo imports so Node executes it without dragging in `@t3-oss/env-nextjs` schema validation or `next/navigation` hooks).
- Uses the same `SEMANTIC_SEARCH` GraphQL document and the existing Apollo `client` — imported directly from `apps/web/src/lib/search.ts`. Because this import DOES touch `@t3-oss/env-nextjs`, the script requires the env vars (`STRAPI_API_TOKEN`, `INTERNAL_GRAPHQL_URL`, `STRAPI_PREVIEW_SECRET`, `REVALIDATION_SECRET`, `NEXT_PUBLIC_GRAPHQL_URL`) to be present — document this precondition. Developers run with a staging `.env` sourced.
- For each category, executes the query and counts `results.length`. Prints a table: `searchTerm | count | pass (count ≥ 6 ? ✓ : ✗)`.
- Exits non-zero if any category fails the threshold so CI could gate on it later.
- Output is pasted into the PR description manually; no CI wiring in this unit.

**Patterns to follow:**
- No prior TS-script precedent exists under `apps/web/scripts/`. This unit establishes the pattern — use `tsx` (a small, well-maintained zero-config runner) and keep the script self-contained.

**Test scenarios:**
Test expectation: none — the script is a one-off verification runner, and its logic is trivial (fetch → count → compare). Correctness is observable by running it against staging and reading the output.

**Verification:**
- `pnpm -F @forge/web verify:categories` prints a table of 6 rows and exits 0 when all terms pass.
- The PR description contains the script's output.

## System-Wide Impact

- **Interaction graph:** `FloatingSearchProvider` becomes the single source of truth for modal open state. `FloatingSearchBar`, the reskinned `SearchOverlay`, the inline floating logo, and the children gate all consume it. `VideoHero.tsx` is unaffected (its own scroll listener runs in parallel). `/demo-search` is untouched and continues to use its own local input + results components.
- **Error propagation:** Search errors continue to surface via the overlay's existing `error` state (rate limit + service unavailable messaging preserved). URL-sync errors (`router.replace` failures) are effectively impossible with local navigation; ignore.
- **State lifecycle risks:** The scroll listener unregisters on modal open and re-registers on close. Body scroll is locked during modal so `scrollY` cannot drift, meaning no special re-read is needed — the next genuine scroll event updates state naturally. Stale-request guard via `requestIdRef` is preserved verbatim. The on-close state reset in the current overlay (clearing `query`, `results`, etc.) is explicitly removed so `?q=` and previously-fetched results survive close.
- **API surface parity:** `SEMANTIC_SEARCH` query untouched; `semanticSearch` contract unchanged. `/search` continues to be a reachable URL (redirects, not 404s), preserving external links.
- **Integration coverage:** The bar-opens-modal-with-URL-hydration flow only works end-to-end with provider, bar, and overlay all wired correctly. Verify manually in dev before merging.
- **Unchanged invariants:**
  - `/demo-search` UI and wiring: unchanged. `SearchInput`/`SearchResults` components stay exactly where they are.
  - `packages/graphql` schema + operations: no changes.
  - `apps/cms`: no changes.
  - `VideoHero.tsx` rendering: no changes (audit only — no chrome moves today).
  - Existing routes under `apps/web/src/app/[slug]/[locale]/page.tsx`, `page.tsx`, etc.: behave identically; the floating bar appears over them but does not alter their render trees.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Removing `pt-16` causes hero content to sit under the floating bar on routes without a full-bleed hero (e.g., a legacy text-heavy route) | Manual pass on every existing route before merge. If any route regresses, add a per-route spacer in that route's layout rather than reintroducing global `pt-16`. |
| Reskinning `SearchOverlay.tsx` in place accidentally drops a subtle invariant (focus trap, stale guard, skeleton timer) | Follow the canonical patterns doc (`docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md`) line by line; keep all existing `useEffect` + `useRef` blocks, change only UI-level JSX. |
| Two passive scroll listeners (bar + `VideoHero`) coexist and cause jank on long pages | Both are passive + rAF-coalesced on the bar side; `VideoHero`'s existing listener is minimal. If Lighthouse/Chrome DevTools shows jank on home, extract a shared util in a follow-up PR. |
| Tailwind v4 purges new inline animations and cross-fade breaks silently | Do not introduce inline `style={{ animation }}`. Reuse existing `@theme --animate-*` keyframes only. |
| `tsx`/`ts-node` for `verify-categories.ts` not available in `apps/web/package.json` scripts | Verify during implementation; add the dependency only if missing and the repo lacks a precedent. |
| React 19 `inert` JSX prop not yet typed in a deep dependency that shadows `@types/react@19` | `pnpm why @types/react` before starting; if anything is forcing older types, add ambient shim per the requirements doc note. |

## Documentation / Operational Notes

- Update `apps/web/CLAUDE.md` only if a new convention emerges worth locking (e.g., "global chrome lives in `FloatingSearchProvider`"). Otherwise no doc change.
- `docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md` may need a companion update once this lands (noting the new provider pattern + URL-sync helper). Capture via `/ce-compound` after implementation, not in this PR.
- No rollout plan, feature flag, or migration required — pure UI change, reversible by revert.
- Monitor the first day post-deploy for: Sentry/error-reporting spikes from the new client Context (look for "Cannot call useFloatingSearch outside of provider"); analytics dips (none expected since no tracking was attached); Lighthouse/CWV regressions on home.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-20-web-floating-search-redesign-requirements.md](../brainstorms/2026-04-20-web-floating-search-redesign-requirements.md)
- **Canonical patterns:** [docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md](../solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md)
- **URL-sync reference:** `apps/web/src/components/search/SearchInput.tsx` (lines 31–47)
- **Context prior art:** `apps/web/src/components/sections/DynamicBackground.tsx`
- **Watch-modern source** (read-only reference, not imported): `/Users/urimchae/Documents/GitHub/Cursor Local Repo/core/apps/watch/src/components/SearchComponent/`
- **Related prior brainstorm:** `docs/brainstorms/2026-04-15-search-ui-web-mobile-requirements.md`
