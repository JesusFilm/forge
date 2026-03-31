---
date: 2026-03-31
topic: mobile-doppler-env-setup
---

# Mobile App Doppler Environment Setup

## Problem Frame

The mobile Expo app's environment variable setup is incomplete compared to the web app. While `fetch-secrets` already pulls from Doppler for local dev, the app lacks env validation, EAS Build profiles aren't wired for staging/production secrets, the Doppler project likely only has a `dev` config, and `.env.example` is stale. This means production EAS builds silently fail or use wrong values, and developers get no feedback when required vars are missing.

## Requirements

- R1. **Env validation with @t3-oss/env-core + Zod** — Replace raw `process.env` access in `apps/mobile/src/lib/config.ts` with a structured `createEnv()` call using `@t3-oss/env-core`, mirroring the web app's pattern in `apps/web/src/env.ts`. Validate all `EXPO_PUBLIC_*` vars as client vars. Include `skipValidation` for CI builds.
- R2. **EAS Secrets for build-time env vars** — Use the EAS Secrets dashboard (via `eas secret:create` or Expo dashboard) to store secrets for preview and production build profiles. Document which secrets must be set in EAS for each profile.
- R3. ~~**Doppler configs for staging and production**~~ — **Removed.** Following the web app's pattern, Doppler is dev-only. Staging/production secrets are managed via EAS Environments (the mobile equivalent of Railway dashboard for web).
- R4. **Update .env.example** — Refresh to document all required and optional vars, which come from Doppler, and which are set in EAS Secrets for builds. Include comments explaining platform-specific vars (Android vs iOS URLs).
- R5. **eas.json env block for non-secret vars** — Define non-secret, profile-specific env vars (like `EXPO_PUBLIC_GRAPHQL_URL_*`) directly in `eas.json` per build profile. Secrets remain in EAS Secrets dashboard only.

## Success Criteria

- Running `pnpm fetch-secrets` in `apps/mobile/` populates `.env` from Doppler with all required vars
- Importing the env module fails fast with a clear error if a required var is missing (except in CI)
- EAS preview builds use staging config values; EAS production builds use production values
- No private keys or secrets appear in `eas.json` or committed files

## Scope Boundaries

- **Not changing Doppler CLI setup** — The CLI is already installed in the devcontainer and `fetch-secrets` script exists
- **Not automating Doppler-to-EAS sync** — Manual sync via EAS Secrets dashboard is sufficient
- **Not adding server-side vars** — Expo apps only have client-bundled vars (`EXPO_PUBLIC_*`); no server/client split needed
- **Not changing the web app** — Web app is the model, not a target for changes

## Key Decisions

- **@t3-oss/env-core over env-nextjs**: Framework-agnostic version for React Native/Expo compatibility, same DX as web
- **EAS Environments for staging/production secrets**: Mirrors how web app uses Railway dashboard — Doppler is dev-only, deployment platform handles the rest
- **Non-secret env vars in eas.json**: Public URLs per profile live in version control; secrets stay out

## Dependencies / Assumptions

- The `forge-mobile` Doppler project exists and is accessible to the team
- Team members have EAS CLI access to create secrets
- Zod v4 is already in the monorepo (used by web app)

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Needs research] Does `@t3-oss/env-core` work seamlessly with Expo's bundler (Metro), or are there known compatibility issues?
- ~~[Affects R3][User decision] What are the actual staging and production GraphQL URLs and Strapi token values to populate in Doppler configs?~~ — **Removed.** Doppler is dev-only; staging/production values go in EAS Environments.
- [Affects R5][Technical] Should `eas.json` use the `env` block per profile or the newer EAS environment feature for non-secret vars?

## Next Steps

-> `/ce:plan` for structured implementation planning
