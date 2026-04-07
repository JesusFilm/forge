# apps/mobile-v2 — Expo Watch App (v2)

## Stack

- React Native with Expo (SDK 54, managed workflow)
- Expo Router for file-based navigation
- @forge/graphql with gql.tada for typed GraphQL operations
- Apollo Client with cache persistence (apollo3-cache-persist)
- expo-video for HLS playback
- expo-image for optimized image loading
- @shopify/flash-list for virtualized section feed

## Architecture

This is a Server-Driven UI (SDUI) app. The CMS (Strapi v5) controls the content
blocks and their order via the Experience content type. The app renders them.

### SDUI Pipeline

```
Strapi GraphQL → gql.tada typed query → thin normalizer (adds `kind`) → dispatcher → renderers
```

- **Query**: Defined in `src/lib/queries.ts` using `graphql()` from `@forge/graphql`
- **Normalizer**: `src/lib/normalizer.ts` — maps `__typename` → `kind`, ~100 LOC
- **Dispatcher**: `src/components/sections/SectionDispatcher.tsx` — switch on `kind`
- **Renderers**: `src/components/sections/*Renderer.tsx` — one per block type

### Key Patterns

- **No parallel type hierarchy**: Renderers receive gql.tada `ResultOf` types with `kind` added. No `sectionModels.ts`.
- **ExperienceProvider at root layout**: Wraps the root Stack so both tabs and video detail route have access.
- **Three-layer hero**: VideoHero (zIndex 0) is absolutely-positioned behind FlashList. An interactive overlay (zIndex 2, `pointerEvents="box-none"`) sits above for touch targets (e.g., mute button) that must be tappable above the scroll view. Visual elements render in the hero layer; invisible Pressable hit targets render in the overlay, positioned via `measureLayout`.
- **VideoDecoderBudget**: Global context limiting concurrent video decoder slots on Android.
- **expo-image everywhere**: Never use RN `<Image>`. Always `expo-image` with `recyclingKey`.

## Conventions

- Follow Expo Router file-based routing conventions.
- Use `@forge/graphql` for all GraphQL operations — never define queries in `@forge/graphql` package itself.
- System font (`fontFamily: 'System'`) for platform-native typography (SF Pro iOS, Roboto Android).
- `hexToRgba(color, 0)` for gradient stops — never `"transparent"`.
- Validate all CMS-sourced URLs via `validateUrl.ts` before use.
- Composite React keys: `key={\`${item.kind}-${item.id}-${index}\`}`.

## Common Pitfalls

- Android VideoView z-order: renders on top of all RN Views. Place video BEHIND scroll content.
- ScrollView gesture preemption: interactive hero elements need `pointerEvents="box-none"` pass-through.
- Lazy Apollo Client init: never module-scope. Use `getApolloClient()` getter.
- `contentParagraphs` is `string[]` (Strapi JSON field) — validate with `Array.isArray()`.
- `Math.round()` all scaled font sizes on Android (sub-pixel = blurry).
