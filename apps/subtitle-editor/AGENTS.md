# Apps Subtitle Editor Agent Guide

Scope: `apps/subtitle-editor/**` only.

## Role

This app is the internal Forge subtitle review editor. Keep it small, local to this app, and adapter-first. Do not reach into Manager code or repo-root files.

## Rules

- Read runtime config from `src/config/env.ts`; do not read `process.env` directly in app code.
- Keep launch tokens out of local storage and out of editable URLs after exchange.
- Treat Manager as the source of truth for auth, session exchange, bootstrap, and save.
- Keep the editor responsive only down to the documented minimum viewport; below that, show a return-only fallback.
- Use simple, tested helpers for launch parsing, viewport gating, and Manager API calls.

## Local files

- `src/config/env.ts` - validated public env
- `src/lib/manager-client.ts` - Manager API adapter
- `src/lib/launch-envelope.ts` - launch parsing helpers
- `src/components/subtitle-editor-app.tsx` - client editor shell
