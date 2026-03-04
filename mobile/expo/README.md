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

## Environments (dev / staging / prod)

Runtime configuration is driven by `EXPO_PUBLIC_*` environment variables, which Metro inlines at build time. Copy `.env.example` to create a local env file:

```bash
cp mobile/expo/.env.example mobile/expo/.env
```

Then edit the values for your target environment:

| Environment            | `EXPO_PUBLIC_GRAPHQL_URL_IOS`           | `EXPO_PUBLIC_GRAPHQL_URL_ANDROID`       |
| ---------------------- | --------------------------------------- | --------------------------------------- |
| **dev** (local Strapi) | `http://localhost:1337/graphql`         | `http://10.0.2.2:1337/graphql`          |
| **staging**            | `https://cms-stage.example.com/graphql` | `https://cms-stage.example.com/graphql` |
| **prod**               | `https://cms.example.com/graphql`       | `https://cms.example.com/graphql`       |

You can also use named per-environment files. Expo's built-in dotenv loader picks
these up based on `NODE_ENV`:

- `.env.development` — loaded when `NODE_ENV=development` (e.g. `expo start`)
- `.env.production` — loaded when `NODE_ENV=production` (e.g. EAS production builds)

For a custom environment like staging, load the right file manually (e.g. via a
`app.config.js` that reads `dotenv` before exporting), since Expo does not
auto-load arbitrary named `.env.*` files based on custom env vars.

All `.env` files (except `.env.example`) are gitignored. Never commit real endpoint secrets or tokens.

## GraphQL and environment

- **Endpoints (platform-specific):** The app picks the GraphQL URL by platform. Set both in `.env` (or app config):
  - `EXPO_PUBLIC_GRAPHQL_URL_IOS` – used on iOS (e.g. `http://localhost:1337/graphql` for simulator).
  - `EXPO_PUBLIC_GRAPHQL_URL_ANDROID` – used on Android (e.g. `http://10.0.2.2:1337/graphql` for emulator; `10.0.2.2` is the host machine from the emulator). For Expo web, the iOS URL is used as fallback.
- **Optional auth:** If Strapi requires a token for read, set `EXPO_PUBLIC_STRAPI_TOKEN`. The client adds `Authorization: Bearer <token>` when present. **Warning:** `EXPO_PUBLIC_STRAPI_TOKEN` is embedded in the client bundle at build time. Do not use production secrets; use a read-only token with minimal scope, or avoid token auth in public builds.
- **Codegen:** Types and operations come from the shared package `@forge/graphql` (schema: `apps/cms/schema.graphql`). When the Strapi schema changes, run from the **repo root**: `pnpm run codegen`. That regenerates `packages/graphql`; do not hand-edit generated files under `packages/graphql/src/graphql-env.d.ts`.

## No shared logic with native apps

This app does not share UI or business logic with `mobile/ios` or `mobile/android`. It consumes Strapi/GraphQL only (see sub-issues #91+).
