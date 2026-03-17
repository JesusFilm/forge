# apps/mobile — Expo / React Native

## Stack

- React Native with Expo (managed workflow)
- Expo Router for navigation
- packages/graphql for all data fetching
- EAS Build + EAS Update

## Conventions

- Follow Expo Router file-based routing conventions.
- Use packages/graphql for all GraphQL operations — never define queries inline.
- EAS profiles: `development` (simulator), `preview` (TestFlight/internal), `production`.
- Use `expo-constants` for environment-specific config.

## Common Pitfalls

- EAS environment variables differ per build profile — check `eas.json`.
- OTA updates (EAS Update) only work for JS changes, not native module additions.
- Test on both iOS and Android before marking a PR as ready.
