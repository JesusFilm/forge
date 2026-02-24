# Forge Expo (React Native)

Cross-platform watch app (iOS + Android) using React Native and Expo. Content is driven by Strapi via GraphQL (Experience/sections). Part of the Forge monorepo; see epic #89.

## Prerequisites

- Node.js (see root `package.json` / repo docs)
- pnpm (monorepo package manager)
- iOS: Xcode and simulator, or physical device with Expo Go
- Android: Android Studio and emulator, or physical device with Expo Go

## Install

From repo root:

```bash
pnpm install
```

## Run

From repo root or from this directory:

```bash
pnpm --filter @forge/expo start
# or
cd mobile/expo && pnpm start
```

Then press `i` for iOS or `a` for Android in the terminal, or scan the QR code with Expo Go.

- **iOS:** `pnpm --filter @forge/expo ios`
- **Android:** `pnpm --filter @forge/expo android`
- **Web (no simulator needed):** run `pnpm start` then press `w` in the terminal.

**Android emulator:** Expo Go must be installed on the emulator before pressing `a`. Open Play Store on the emulator, search for "Expo Go", and install. If you see `adb shell monkey ... exited with non-zero code: 251`, Expo Go is missing or not launchable on that device.

## Folder structure (by feature)

- `src/features/` – feature-specific modules (e.g. watch, experience)
- `src/screens/` – top-level screens
- `src/components/` – shared UI components
- `src/lib/` – utilities, API client, config

Root `App.tsx` and `index.ts` are the entry point. New work (GraphQL, sections, navigation) will live under `src/` as the app grows.

## TypeScript

TypeScript is configured via `tsconfig.json` (extends Expo base). No extra setup required.

## GraphQL and environment

- **Endpoint:** Set `EXPO_PUBLIC_GRAPHQL_URL` (e.g. in `.env` or app config) to your Strapi GraphQL URL per environment (dev/stage/prod). Example: `https://cms.example.com/graphql`.
- **Optional auth:** If Strapi requires a token for read, set `EXPO_PUBLIC_STRAPI_TOKEN`. The client adds `Authorization: Bearer <token>` when present.
- **Codegen:** Types and operations come from the shared package `@forge/graphql` (schema: `apps/cms/schema.graphql`). When the Strapi schema changes, run from the **repo root**: `pnpm run codegen`. That regenerates `packages/graphql`; do not hand-edit generated files under `packages/graphql/src/graphql-env.d.ts`.

## No shared logic with native apps

This app does not share UI or business logic with `mobile/ios` or `mobile/android`. It consumes Strapi/GraphQL only (see sub-issues #91+).
