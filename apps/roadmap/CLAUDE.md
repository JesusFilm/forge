# CLAUDE.md — Roadmap Viewer

## What This Is

Read-only Next.js dashboard that renders feature tickets from `docs/roadmap/` markdown files. No database — the filesystem is the data store.

## Architecture

- `lib/features.ts` — reads markdown files from `../../docs/roadmap/`, parses YAML frontmatter with `gray-matter`, computes blocked status from dependencies.
- `components/` — server components except `RoadmapTimeline.tsx` (client, for hover interactions and toggle), `CopyBrainstormButton.tsx` (client, clipboard), `Sidebar.tsx` (client, mobile toggle), `MarkdownRenderer.tsx` (client, react-markdown).
- Data flows one way: `docs/roadmap/*.md` → `lib/features.ts` → pages/components.

## Key Conventions

- **No database, no API calls**. All data from filesystem reads at request time.
- **Server Components by default**. Only use `'use client'` for interactivity (hover, click handlers, clipboard).
- **Don't import `fs` in client components**. Pass data as props from server components/layouts.
- **GitHub avatars** are mapped in `lib/features.ts` `GITHUB_PROFILES`. Add new team members there.
- **Tailwind v4** with `@tailwindcss/typography` for markdown rendering.
- Runs on port **3100**.

## Routes

- `/` — dashboard with stats + timeline grid
- `/lane/[lane]` — kanban with person swimlanes
- `/person/[person]` — kanban with lane swimlanes
- `/ticket/[...id]` — full ticket detail with rendered markdown

## Adding Features to the Roadmap

This app does NOT need changes when tickets are added to `docs/roadmap/`. It reads them dynamically. Only change this app if the viewer itself needs new functionality.

## Excluded docs-only lanes (do not register)

The `docs/roadmap/ai-chat/` and `docs/roadmap/rag/` lanes are intentionally not registered in this app. They stay absent from `LANE_DIRS` / the `Lane` union (`lib/features.ts`) and from the shared `README_LANE_ORDER` (`lib/markdown.ts`), so neither the viewer nor generated root `docs/roadmap/README.md` includes them. Do not "fix" either missing lane by registering it.

- AI Chat lane guidance: `docs/roadmap/ai-chat/README.md` and `docs/roadmap/ai-chat/CLAUDE.md`
- RAG lane guidance: `docs/roadmap/rag/README.md` and `docs/roadmap/rag/CLAUDE.md`

## Deployment

Railway via `railway.toml`. Watch patterns: `apps/roadmap/**` and `docs/roadmap/**`. Auto-redeploys when tickets are updated on main.
