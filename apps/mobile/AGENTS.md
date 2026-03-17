# Mobile Agent Guide

Scope: `apps/mobile`.

## Alignment

`apps/mobile/CLAUDE.md` is canonical detail for this app.

## Do

- Follow Expo managed workflow and Expo Router conventions.
- Use `packages/graphql` operations only; do not define inline queries.
- Validate behavior on iOS and Android before marking work ready.
- Respect EAS profile differences (`development`, `preview`, `production`).

## Do not

- Assume OTA updates can ship native module changes.
- Bypass `packages/graphql` with app-local GraphQL definitions.
- Introduce platform-specific divergence without clear product need.
