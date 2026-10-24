---
date: 2026-04-20
topic: web-floating-search-redesign
---

# Web — Floating Searchbar + Category Modal Redesign

> Superseded on 2026-06-24 for Watch search URL state: the modal remains canonical, but search no longer reads from or writes to `?q=`. Use `docs/brainstorms/2026-06-24-watch-search-local-state-requirements.md` for the current Watch search query-state contract.

## Problem Frame

The web app's sticky `SiteHeader` (JFP logo + search button, `bg-stone-900/80` backdrop) is utilitarian and buries search as a small icon in the top-right. Users without a specific query have no way to browse — they must either know what to type or leave the header to scroll curated experiences.

The watch app in the sibling `core` monorepo (`apps/watch`) ships a floating centered searchbar that doubles as a browse surface: clicking it cross-fades into a modal with a hardcoded category grid. Search becomes the primary action, and discovery gets a first-class entry point. The design is Tailwind-only, uses Radix Dialog, and is visually richer than the current forge header.

Port that design to `apps/web` as a drop-in replacement for `SiteHeader`. Reuse the existing `semanticSearch` GraphQL wiring — this is a UI redesign, not new search functionality.

## Decisions

- **Header removed globally**: `SiteHeader.tsx` is deleted from `apps/web/src/app/layout.tsx`. The `pt-16` spacer wrapper is removed. Content scrolls under the floating elements.
- **Floating searchbar, global**: A new `FloatingSearchBar` client component is mounted once in `RootLayout`. Fixed positioning, centered horizontally, `z-50`. Visible on every route.
- **Floating logo, top-left**: A small JFP logo mark is rendered as a separate fixed element in the top-left (same z-layer as the searchbar). Links to `/`.
- **Scroll choreography**: The floating searchbar animates its vertical position based on a `scrollY` threshold. When `scrollY <= 80`, the bar sits at `top-[128px]` (hero state). When `scrollY > 80`, it animates to `top-[30px]` (pinned state). Uses `transition-[top] duration-300 ease-out`. A passive `window` scroll listener is registered only while the modal is closed (paused on open, re-synced on close). Mirrors watch-modern's threshold behavior.
- **Modal on click**: Clicking the searchbar opens a full-screen modal via an **in-place reskin** of the existing `apps/web/src/components/SearchOverlay.tsx` — no new modal file, no deletion of the existing one. The reskin preserves the component's working focus trap, Escape handler, body scroll lock, skeleton timing, stale-request guard, and pagination. Visually it matches watch-modern: rounded glass search input at top, category grid below when no query is typed, results grid when a query is typed. When the modal opens, the floating searchbar and floating logo cross-fade out (`opacity-0 pointer-events-none aria-hidden="true" inert`) — no shared-element morph, no double search input, no competing tab stops.
- **Category grid**: 6 hardcoded cards, each with `{ title, searchTerm, gradient }`. Inline `linear-gradient` styles, `aspect-video rounded-lg`, hover scale, grid `grid-cols-2 md:grid-cols-3 xl:grid-cols-4`. The 6 entries are ported verbatim from watch-modern's `CategoryGrid.tsx` (see R5 for the concrete list); revising the list is explicitly follow-up work.
- **Category click → inline search**: Clicking a card populates the modal's search input with the card's `searchTerm`, triggers `semanticSearch`, and swaps the category grid out for the results grid. No navigation, no route change.
- **Modal out-of-scope (deferred)**: Trending-search pills and the Algolia language selector from watch-modern are NOT ported. `locale: "en"` stays hardcoded per the 2026-04-15 search brainstorm.
- **`/search` route deprecated**: The existing `/search` page is replaced with a server-side redirect to `/` that forwards `?q=`. The modal becomes the canonical search surface, and `SearchInput` + `SearchResults` components are deleted.
- **URL query sync**: The modal reads `?q=` on mount to pre-populate its input and auto-open. While typing, the URL is updated via `router.replace` (no history entry per keystroke). Modal close clears `?q=`. Gives every search query a shareable/bookmarkable URL and replaces the functionality the old `/search` page provided.
- **VideoHero clearance**: On routes rendering `VideoHero` (home, `[slug]`), hero interactive chrome (mute, subtitles, play/pause) must sit below `top-[192px]` at every breakpoint so the floating bar never obscures it.
- **Animation library**: Tailwind + existing CSS keyframes only. No Framer Motion. Reuse the existing `--animate-overlay-fade-in/out` and `--animate-card-enter/exit` in `apps/web/src/app/globals.css`.

## Requirements

### Components

- **R1. `FloatingSearchBar`** (new, client): Fixed-position centered searchbar. Registers a passive `window` scroll listener (only while the modal is closed) with a single `requestAnimationFrame`-coalesced update per frame to avoid render thrash on fast scrolls; applies `top-[128px]` when `scrollY <= 80` (hero state) and `top-[30px]` when `scrollY > 80` (pinned state), with `transition-[top] duration-300 ease-out`. **Only `top` animates** — width, height, padding, and font-size stay identical across both states. Placeholder copy: `Search or browse topics…`. Styled: `rounded-[35px] bg-white/10 outline-1 outline-white/20 backdrop-blur-[10px] shadow-xl text-white placeholder:text-white/70 focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2`. Clicking anywhere on the bar opens the modal. While the modal is open, the bar sets `opacity-0 pointer-events-none inert aria-hidden="true"` and the scroll listener is paused (on modal close, the handler reads `scrollY` immediately and re-applies the correct `top` before next scroll event). Width: `w-[calc(100%-2rem)] max-w-[800px]` — no `min-width`; bar shrinks to fit narrow viewports rather than overflowing.
- **R2. Inline floating logo** (not a named component): Rendered directly inside `RootLayout` alongside the floating searchbar — a `Link` to `/` wrapping `/images/jesusfilm-sign.svg` (the file lives at `apps/web/public/images/jesusfilm-sign.svg`; do not prefix `/watch` — `next.config.mjs` applies `basePath: "/watch"` automatically), at ~32×24, positioned `fixed top-4 left-4 z-50 hidden sm:block` (hidden below the 640px breakpoint where the bar's left edge would otherwise collide with the logo). Receives the same `opacity-0 pointer-events-none inert aria-hidden="true"` treatment as the floating searchbar while the modal is open.
- **R3. Modal** (in-place reskin of `apps/web/src/components/SearchOverlay.tsx` — no new file): Full-screen overlay with cross-fade in/out (reuse existing `animate-overlay-fade-in/out`). Preserves the component's existing `requestIdRef` staleness guard, 500ms skeleton threshold, focus trap, Escape handler, body scroll lock, and offset-based pagination. Contains:
  - R3a. Glass search input using the same Tailwind classes as the floating bar (`rounded-[35px] bg-white/10 outline-1 outline-white/20 backdrop-blur-[10px] shadow-xl text-white placeholder:text-white/70`), autofocused on open.
  - R3b. Close button (existing X-icon pattern).
  - R3c. Category grid — visible when `query` is empty.
  - R3d. Results grid — visible when `query` is non-empty. Reuses existing `VideoCard` + skeleton + "Load more" logic from current `SearchOverlay.tsx`.
  - R3e. Empty state (no results for current query) and error state preserved from current `SearchOverlay`.
  - R3f. Mobile home link: on viewports below `sm` only, render a small JFP logo mark (same SVG as R2, ~24×18) inside the modal's top bar as a `Link` to `/`. Hidden at `sm` and above where the floating logo (R2) covers branding. Ensures mobile users always have a persistent path home whenever the modal is open.
- **R4. Inline category grid** (render block inside the reskinned `SearchOverlay`, not a separately exported component): `grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4`. Each card: `relative aspect-video w-full overflow-hidden rounded-lg p-3 sm:p-6 text-white transition-transform duration-200 hover:scale-105 focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2`; title uses `text-sm sm:text-base md:text-lg font-semibold leading-tight` with `textShadow: 0 1px 2px rgba(0,0,0,0.3)` to stay legible on gradient backgrounds (especially the red-on-red Christmas card). 6 hardcoded categories (see R5). Clicking a card (a) clears any pending `timerRef` debounce timeout, (b) calls `setQuery(card.searchTerm)`, (c) invokes the existing `search(card.searchTerm)` callback directly — bypassing the 300ms input-debounce path so the click feels immediate and avoids a double-fire, and (d) updates the URL via `router.replace` (same as any other search path — see R10a). The static array always renders all 6 cards; if pre-ship verification (R7a) shows a term returns < 6 results, the term is revised in the array before merge rather than omitted at runtime (no ragged grid states).

### Data

- **R5.** Categories are a static `const` array declared inside the reskinned `SearchOverlay.tsx` — not extracted to a sibling module, no Strapi content type. Shape: `{ title: string; searchTerm: string; gradient: string }`. Ported verbatim from watch-modern's `CategoryGrid.tsx`:
  - `{ title: "Bible Stories", searchTerm: "bible stories", gradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" }`
  - `{ title: "Parables", searchTerm: "parables", gradient: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)" }`
  - `{ title: "Animated", searchTerm: "animated", gradient: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)" }`
  - `{ title: "Study", searchTerm: "study", gradient: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)" }`
  - `{ title: "Family", searchTerm: "family", gradient: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)" }`
  - `{ title: "Christmas", searchTerm: "christmas", gradient: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)" }`
- **R6.** Search continues to use `apps/web/src/lib/search.ts`'s `SEMANTIC_SEARCH` query via the existing Apollo `client`. No GraphQL changes, no `packages/graphql` changes.
- **R7.** `locale` stays hardcoded to `"en"`.
- **R7a. Pre-ship category verification** (QA gate, not a code change): Before merge, a small script at `apps/web/scripts/verify-categories.ts` imports the same `CATEGORIES` const from the reskinned `SearchOverlay` and runs `SEMANTIC_SEARCH` for each term at `locale: "en"` against the staging GraphQL endpoint, printing a `searchTerm → result count` table. The script runs manually before merge; its output is pasted into the PR description. If any term returns fewer than 6 results, the term is revised (or the category swapped) in the static array before merge — no runtime omission logic, no conditional rendering, the grid always ships with exactly 6 cards.

### Layout + routing

- **R8.** `SiteHeader` import and usage removed from `apps/web/src/app/layout.tsx`. `<div className="pt-16">` wrapper also removed — floating elements overlay content. Once unreferenced, delete `apps/web/src/components/SiteHeader.tsx` and `apps/web/src/components/SearchToggle.tsx` in the same PR to avoid orphaned dead code.
- **R9.** `FloatingSearchBar` and the inline floating logo mount once in `RootLayout` so they render on every route.
- **R9a. VideoHero clearance audit.** The current `apps/web/src/components/sections/VideoHero.tsx` anchors its only interactive chrome (`MuteButton`) to the bottom of the hero via `items-end` and initializes video-js with `controls: false` — so the floating bar at `top-[128px]` does not occlude it. No repositioning is required for the existing component. This requirement exists as a forward-looking audit: before merging, verify that no in-flight hero variant places interactive chrome above `top-[192px]`; if one does, reposition it. Hero heading/subheading text that visually sits in the upper portion of the hero is accepted as acceptable overlap (the bar's glass backdrop allows heading text to remain readable); if a future route proves otherwise, add a dark gradient scrim at the hero top as a follow-up.
- **R10. `/search` deprecation (narrow scope).** Replace `apps/web/src/app/search/page.tsx` with a server-side redirect: on load it reads `searchParams.q` and calls `redirect(q ? \`/?q=\${encodeURIComponent(q)}\` : "/")`. **Do NOT delete** `apps/web/src/components/search/SearchInput.tsx`or`SearchResults.tsx`— both are still imported by`apps/web/src/components/demo-search/DemoSearchInput.tsx`and`DemoSearchResults.tsx`, which power the live `/demo-search`route. The components stay in place; only the`/search` route itself is deprecated.
- **R10a. URL query sync.** URL updates happen inside the shared `search(q)` callback (not just the debounced input handler) so every search path — typed, pasted, category-clicked, URL-on-mount — updates the URL consistently. Implementation: read current `searchParams` via `useSearchParams()`, clone them, set `q`, serialize, and call `router.replace(\`${pathname}?${params.toString()}\` as Route)`. This preserves any existing query params (e.g., `utm\_\*`) instead of wiping them. The `as Route`cast is required because`apps/web/next.config.mjs`sets`experimental.typedRoutes: true`. On modal open with `?q=`in`searchParams`, the modal auto-opens and pre-populates; on modal close, `?q=`**is preserved in the URL** so the page stays shareable (the old`/search` page behaved the same way — the modal inherits this contract rather than stripping the param). Users clear the query via the input's clear button, not by closing the modal.
- **R10b. Modal open-state ownership.** Introduce `apps/web/src/components/FloatingSearchProvider.tsx` (client component) that exposes a React Context with `{ open, setOpen }`. `FloatingSearchBar`, the floating logo (R2), the `RootLayout` children wrapper (R14), and the reskinned `SearchOverlay` all consume this context. The provider derives `open` initial state from `useSearchParams().get('q')` so `?q=foo` on mount auto-opens the modal. `RootLayout` remains a server component; the provider is mounted as a client island wrapping `children`.

### Accessibility + interaction

- **R11.** Modal remains a `role="dialog" aria-modal="true"` with focus trap, Escape-to-close, and body scroll lock (existing `SearchOverlay` already implements these — preserve them).
- **R12.** Floating searchbar must be keyboard-activatable (Enter/Space opens modal); `aria-label="Search videos"`.
- **R13.** When the modal opens, the floating searchbar and floating logo cross-fade out via `opacity-0 pointer-events-none inert aria-hidden="true"` (not a shared-element morph — two separate inputs). On modal close the bar cross-fades back in and the scroll listener re-syncs. Ensures no double search input and no competing tab stops.
- **R14.** Content behind the modal is `aria-hidden="true"` and `inert` while open. The `FloatingSearchProvider` (R10b) wraps `RootLayout`'s `children` and reads `open` from context to toggle both attributes on its wrapping div. The floating bar and floating logo are covered by R13 independently. Note: `inert` as a JSX attribute requires either React 19+ (which ships the type) or a short ambient declaration at `apps/web/src/types/react-inert.d.ts` (`declare module "react" { interface HTMLAttributes<T> { inert?: "" } }`). Verify the React major version in `apps/web/package.json` during planning; add the shim only if pre-19.

### Styling

- **R15.** Reuse stone-900 background and Apercu Pro font from existing layout. No new font loads.
- **R16.** Category gradients use inline `style={{ background: card.gradient }}`; no new CSS classes or design tokens required.
- **R17.** All new Tailwind classes consistent with existing web app conventions — no new utility plugins.

## Scope Boundaries

- No trending-search pills (would need a data source).
- No language selector (locale is hardcoded).
- No new GraphQL queries or Strapi content types.
- No changes to `packages/graphql` or `apps/cms`.
- No Algolia, no InstantSearch, no cmdk, no Framer Motion.
- No mobile app changes (`apps/mobile` and `apps/tv` untouched).
- `/search` route is replaced with a redirect to `/?q=...` (R10). `SearchInput` / `SearchResults` components are NOT deleted — they remain in `apps/web/src/components/search/` because `/demo-search` still imports them. Only the `/search` page file itself is touched.
- No search analytics/tracking in this PR.
- No personalization, search history, or recent-searches UI.
- Timestamp seeking on result tap remains out of scope (same as 2026-04-15 brainstorm).

## Success Criteria

- The sticky `SiteHeader` no longer renders on any web route.
- A floating glass searchbar is visible and centered on every route.
- Scrolling changes the searchbar's vertical position smoothly (compact when scrolled down, hero when scrolled to top).
- A small JFP logo is fixed in the top-left on every route and links to `/`.
- Clicking the floating searchbar opens a full-screen cross-fade modal with autofocused input.
- The modal shows a 6-card category grid when no query is entered.
- Typing a query swaps the category grid for `semanticSearch` results; the existing skeleton, "Load more", empty, and error states all still work.
- Clicking a category card fills the input with the card's `searchTerm`, runs the search, and displays results in the modal.
- Pressing Escape or clicking the close icon cross-fades the modal out.
- Typing a query updates the URL to `?q=<value>`; refreshing re-runs the search and shows the same results.
- Visiting `/search?q=forgiveness` redirects to `/?q=forgiveness`, auto-opens the modal, and runs the search.
- No VideoHero interactive chrome (mute/subtitles/play/pause) is occluded by the floating searchbar at any breakpoint on home or `[slug]` routes.
- Every rendered category card, on click, returns a non-empty results set (verified pre-ship at `locale: "en"` per R7a).
- No regressions to existing experience pages, video routes, or deep-links.

## Open Questions for Planning

All requirements-level product decisions are locked above. Remaining items are implementation-detail for planning:

- **Scroll listener coordination with `VideoHero`.** Both the floating bar and `VideoHero` subscribe to `window.scroll` independently (both passive). If profiling shows contention, planning should decide whether to extract a shared store/util or leave them decoupled. Not a requirements gap.
- **Bar legibility on light-colored hero imagery.** All current forge routes render against `stone-900`, so the `bg-white/10` glass bar reads fine. If a future route introduces a pastel/white hero at the top, revisit with either a dark gradient scrim at the top of the route or a `prefers-light`-style variant on the bar.
- **Analytics hook for category clicks + search queries.** Out of scope for this PR. Planning should earmark where a hook would attach for a follow-up analytics pass.
