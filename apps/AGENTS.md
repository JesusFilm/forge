# Apps Agent Guide

Scope: `apps/*` only.

## Rules

- No cross-imports between app contexts.
- Integrations use contracts/generated clients only.
- Do not embed env-specific branching in app logic.
- Keep CMS publish controls human-only.

## App ownership

- `apps/web`: web rendering and cache invalidation hooks.
- `apps/cms`: schema/workflow and editorial lifecycle.
- `apps/mobile`: mobile app rendering and device-specific UX.
