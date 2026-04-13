# apps/subtitle-editor — Subtitle Review Editor

## What this app does

Hosts the Forge subtitle review editor. It exchanges a short-lived launch code for an in-memory edit token, loads subtitle VTT from Manager, lets an operator edit the text in a textarea, and saves reviewed subtitles back to Manager.

## Stack

- Next.js 16 App Router
- React 19
- `@t3-oss/env-nextjs` for runtime env validation
- Vitest for helper tests

## Conventions

- Keep all runtime config in `src/config/env.ts`.
- Use `src/lib/manager-client.ts` for Manager calls. Keep fetch details centralized.
- Keep launch tokens in memory only.
- Preserve draft text through recoverable bootstrap/save errors.
- Keep `Return to Manager` always available once a launch has been resolved.
- Block editing below the documented minimum viewport with a clear fallback.

## Environment variables

| Variable                       | Description                              |
| ------------------------------ | ---------------------------------------- |
| `NEXT_PUBLIC_MANAGER_BASE_URL` | Public base URL of the Forge Manager app |
