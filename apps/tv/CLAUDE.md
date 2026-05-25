# apps/tv — Expo TV App (Apple TV + Android TV)

## Stack

- React Native with Expo (SDK 54, managed workflow)
- react-native-tvos (aliased as react-native) for TV platform support
- @react-native-tvos/config-tv Expo plugin with EXPO_TV=1
- Expo Router for file-based navigation (stack only, no tabs)
- @forge/admin-graphql with gql.tada for typed GraphQL operations
- Apollo Client for GraphQL data fetching
- expo-video for HLS playback
- expo-image for optimized image loading

## Architecture

This is a TV adaptation of the Server-Driven UI (SDUI) app. Same pipeline
as mobile, different renderers optimized for 10-foot UI and D-pad navigation.

### SDUI Pipeline

```
Admin GraphQL → gql.tada typed query → normalizer (adds `kind`) → dispatcher → TV renderers
```

- **Queries**: Imported from mobile or copied with sync comment
- **Normalizer**: Copied from mobile (identical logic)
- **Dispatcher**: TV version with subset of block kinds
- **Renderers**: All new, designed for 10-foot UI with D-pad focus

## Design System: The Crimson Gallery

All UI follows the Crimson Gallery design system from the Stitch mockups:

- Background: `#161311` (warm stone, never pure black)
- Surface container: `#221F1D`
- Surface container high: `#2D2927`
- Primary accent: `#CB333B` (Crimson Red — sparingly, for CTAs and focus rings)
- Text: `#F5F5F4`
- Muted: `#A8A29E`
- Font: System (SF Pro on tvOS, Roboto on Android TV)
- No 1px borders — use background color shifts
- 16px border radius on cards
- Focus state: 1.05x scale + crimson glow

## Conventions

- Build with `EXPO_TV=1 npx expo prebuild --clean` before running.
- Dev-client builds only (no Expo Go on TV).
- System font (`fontFamily: 'System'`) for platform-native typography.
- `hexToRgba(color, 0)` for gradient stops — never `"transparent"`.
- Validate all CMS-sourced URLs via `validateUrl.ts` before use.
- Composite React keys: `key={\`${item.kind}-${item.id}-${index}\`}`.
- Hardcoded English locale: `{ locale: "en" }` for all GraphQL queries.

## TV-Specific Patterns

- Every interactive element must be focusable via D-pad.
- Visible focus ring (crimson glow) on focused elements.
- `TVFocusGuideView` to constrain focus within horizontal rails.
- `hasTVPreferredFocus` for initial focus control and back-navigation focus restore.
- Stack navigation only: Home → Experience Detail → Video Playback.
- Menu/Back button pops navigation stack.

## Common Pitfalls

- Android TV VideoView z-order: renders on top of all RN Views.
- Focus lost on back-navigation (react-native-tvos #852): workaround with `hasTVPreferredFocus` in `useEffect`.
- Lazy Apollo Client init: never module-scope. Use `getApolloClient()` getter.
- `Math.round()` all scaled font sizes on Android (sub-pixel = blurry).
- Must run `EXPO_TV=1 npx expo prebuild --clean` when switching between TV and phone targets.
