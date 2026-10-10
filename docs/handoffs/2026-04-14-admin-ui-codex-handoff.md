# Codex Handoff: Forge Admin UI (Unit 12)

## Context

You're building the UI for `apps/admin/` in a pnpm + Turborepo monorepo. The backend (GraphQL API, auth, permissions, Prisma models) is fully built (Units 1-9). The UI is currently unstyled placeholders. Your job is to add the Forge Editorial design system and build the dashboard shell + core pages.

**Branch:** `feat/admin-app-phase-4`
**App root:** `apps/admin/`
**Dev server:** `pnpm --filter @forge/admin dev` (port 3003)
**Build:** `pnpm --filter @forge/admin build`

## Stitch Design Reference

The complete screen designs live in a Stitch project. Use the Stitch MCP tools to access them.

**Stitch project ID:** `792139710525865051`
**Design system:** "Forge Editorial" (asset `assets/660ef7f5da7e4f7f938539e6ac7fb198`)

### How to use

- `list_screens(projectId: "792139710525865051")` — lists all 21 screens
- `get_screen(name: "projects/792139710525865051/screens/{screenId}", projectId: "792139710525865051", screenId: "{screenId}")` — returns HTML + screenshot for a screen
- Each screen has an `htmlCode.downloadUrl` you can fetch to get the exact rendered HTML/CSS that Stitch generated. **Use this as your visual reference** — match the layout, spacing, component shapes, and data patterns you see in the HTML.
- Each screen also has a `screenshot.downloadUrl` for a visual preview.

### Screen inventory (21 screens, 17 types)

| Screen                      | Title in Stitch                  | Screen ID                          |
| --------------------------- | -------------------------------- | ---------------------------------- |
| Login                       | Login & Migration                | `0387c72374b5421588a8841a96ef4433` |
| Dashboard (use this one)    | Dashboard (Final)                | `69b54cf0ff9e4ac5be98354598b41f29` |
| Dashboard (alt)             | Dashboard Overview (Unified Nav) | `8dbda4b8ea9d49308e4e1cc1cc5ad100` |
| Experiences list (use this) | Experiences (Final)              | `94304e44d76c4a879b71924a3e017d3f` |
| Experiences list (alt)      | Experiences Index (Unified Nav)  | `a42aba38cafb45c5b2e72a8548cbf5db` |
| Experience editor           | Experience Editor                | `7829da17a78142e09a5d9b4847373900` |
| Create Experience modal     | Create Experience Modal          | `ecad0324251a4d14a563bdf5fb8101d9` |
| Videos list (use this)      | Videos (Final)                   | `04a9755e9edb448396b523f2d0f142bc` |
| Videos list (alt)           | Videos Index (Unified Nav)       | `d31296897f874d51931b681da50db6a0` |
| Video detail                | Video Detail                     | `ff42dbd0e0a24cca8a52ffa0749eb3ce` |
| Core Sync dashboard         | Core Sync Dashboard              | `db96e4d45a4846d2a6ced574a5a3411f` |
| Workflows list              | Workflows List                   | `c80ff40ff71548559b36c17133bb3652` |
| Workflow run detail         | Workflow Run Detail              | `3d97839f3f9144de87524c1958f0d9dd` |
| Embeddings overview         | Embeddings Overview              | `78f4f69c2e384cfd9d3437f01b419298` |
| Semantic search             | Semantic Search Results          | `545c596774da480b9f7153d407623680` |
| Users & Permissions         | Users & Permissions              | `63e0cd90ede34e5aafe860263827161f` |
| Users & Permissions (alt)   | Users & Permissions              | `c9e32e5535e04ffab0400b4f9d54aa57` |
| Settings & API Keys         | Settings & API Keys              | `cd672285989e465ea36c67a9e47d8bd4` |
| Command Palette             | Command Palette (⌘K)             | `d87193dce37043fc8bf123b4e50aadda` |
| Languages reference         | Languages Reference Data         | `6e5566b0143f493296801d2cc964b5f2` |
| Media Library               | Media Library                    | `37bb3e8fdf5f4a8880f000a19594929a` |

### Workflow

For each page you build:

1. Fetch the screen's HTML via `get_screen` → `htmlCode.downloadUrl`
2. Study the HTML structure, class names, layout, spacing, and data patterns
3. Recreate using Tailwind utilities matching the Forge Editorial tokens
4. Where Stitch-generated HTML has multiple iterations (e.g., "Final" vs "Unified Nav"), prefer the "Final" version

The design system markdown is also embedded in the Stitch project and can be read via `list_design_systems(projectId: "792139710525865051")` — it contains the full spec document with color tokens, typography scale, component rules, hairline discipline, and do/don't rules.
**Lint:** `pnpm --filter @forge/admin lint`
**Typecheck:** `pnpm --filter @forge/admin typecheck`

---

## Codebase State

### Already built (DO NOT MODIFY)

- `src/auth/` — Better Auth config, session resolution, permissions (10KB), Firebase bridge
- `src/graphql/` — Pothos schema, Experience/Video/Reference types, mutations, queries, plugins (armor, rate-limit, introspection)
- `src/services/` — Experience CRUD, Video reads, vector search
- `src/db/` — Prisma client singleton, pgvector helpers
- `src/config/env.ts` — Zod-validated env
- `src/domain/` — Block Zod schemas
- `prisma/schema.prisma` — Full schema (Experience, ExperienceLocale, Video, VideoLocale, VideoDub, Language, Country, Keyword, etc.)

### Key files to READ before building

- `src/auth/session.ts` — exports `requireSession(): Promise<Principal>` (redirects to /login if unauth) and `resolvePrincipalFromRequest(request): Promise<Principal | null>`
- `src/auth/principal.ts` — `type Principal = { id: string | null; role: Role }` where `Role = "ADMIN" | "EDITOR" | "VIEWER" | "PUBLIC" | "SYSTEM"`
- `src/app/login/page.tsx` — Working login page (email/password + SSO buttons). Restyle it, don't break the auth flow.
- `src/app/dashboard/page.tsx` — Placeholder, calls `requireSession()`
- `src/app/layout.tsx` — Bare root layout, needs Tailwind + fonts added

### Current pages

- `/` — Home (links to login/dashboard)
- `/login` — Working auth form (Better Auth email + SSO)
- `/dashboard` — Placeholder (auth-gated)
- `/dashboard/system-status` — Exists, leave alone
- `/api/graphql` — GraphQL endpoint
- `/api/auth/[...all]` — Better Auth routes
- `/api/health` — Health check

---

## Step 1: Install Tailwind CSS v4

The monorepo's web app uses Tailwind v4. Match it:

```bash
cd apps/admin
pnpm add tailwindcss @tailwindcss/postcss
```

Create `apps/admin/postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
}
export default config
```

Install Lucide icons:

```bash
pnpm add lucide-react
```

---

## Step 2: Design System — "Forge Editorial"

Inspired by Payload CMS. Clean hairlines, dense data, warm-stone dark mode, IBM Plex type family.

Create `apps/admin/src/app/globals.css`:

```css
@import "tailwindcss";

@theme {
  /* Surface tiers — warm stone, never pure black */
  --color-surface-inset: #08070a;
  --color-bg: #0c0a09;
  --color-surface: #1c1917;
  --color-surface-raised: #292524;
  --color-surface-overlay: #3a3633;

  /* Text — warm stone */
  --color-text-primary: #f5f5f4;
  --color-text-secondary: #d6d3d1;
  --color-text-muted: #a8a29e;
  --color-text-disabled: #57534e;

  /* Brand red — laser pointer, max ONE per viewport */
  --color-brand: #ef3340;
  --color-brand-pressed: #cb333b;
  --color-brand-soft: rgba(239, 51, 64, 0.1);

  /* Status — outlined pills only, never filled */
  --color-success: #6ee7b7;
  --color-success-border: rgba(110, 231, 183, 0.3);
  --color-warning: #fbbf24;
  --color-warning-border: rgba(251, 191, 36, 0.3);
  --color-danger: #f87171;
  --color-danger-border: rgba(248, 113, 113, 0.3);
  --color-info: #93c5fd;
  --color-info-border: rgba(147, 197, 253, 0.3);

  /* Hairlines — the primary structural device */
  --color-hairline: rgba(255, 255, 255, 0.08);
  --color-hairline-strong: rgba(255, 255, 255, 0.14);
  --color-hairline-soft: rgba(255, 255, 255, 0.04);

  /* Radii */
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-pill: 999px;

  /* Font families */
  --font-sans: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", "Geist Mono", ui-monospace, monospace;
}

html {
  background-color: var(--color-bg);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.385;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  min-height: 100vh;
}

::selection {
  background-color: var(--color-brand-soft);
  color: var(--color-text-primary);
}
```

### Design rules (MUST follow)

1. **Hairline discipline**: every structural boundary = 1px border using `border-hairline`. Cards, inputs, sidebar edge, top bar bottom, table rows — all get hairlines. Do NOT rely on tonal shifts alone.
2. **Single sans**: IBM Plex Sans for all visible text. No serifs.
3. **Aggressive mono**: IBM Plex Mono (`font-mono`) on ALL IDs, slugs, timestamps, counts, locale codes, phase names, version strings, vector dimensions, keyboard glyphs.
4. **4px radii** (`rounded-sm`): default for cards, buttons, inputs. 2px for chips. Pill only for status pills + avatars.
5. **Rule of One**: brand red #EF3340 on exactly ONE element per viewport. Usually the primary CTA button. Active nav uses a white stripe, not red.
6. **Status pills are outlined**: 1px status-color border at 30% opacity + transparent bg + status-color text. Never filled backgrounds.
7. **No shadows on cards**. Shadows only on floating overlays (modals, popovers): `shadow-[0_8px_24px_rgba(0,0,0,0.4)]` paired with hairline.
8. **Dense**: body 13px, rows 40px, top bar 48px, sidebar items 32px, buttons 32px, card padding 16px.
9. **No decorative graphics**. No watermarks, illustrations, background images. Empty canvas = negative space.
10. **Motion**: `transition-all duration-[120ms] ease-out` for hover; `duration-200 ease-in-out` for drawer/modal.

---

## Step 3: Root Layout with Fonts

Update `apps/admin/src/app/layout.tsx`:

```tsx
import type { ReactNode } from "react"
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google"
import "./globals.css"

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
})

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
})

export const metadata = {
  title: "Forge Admin",
  description: "JesusFilm Forge admin platform",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${plex.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
```

---

## Step 4: Dashboard Shell (Sidebar + Top Bar)

### File: `apps/admin/src/components/sidebar.tsx`

"use client" component. Props: `user: { id: string; role: string }`.

Uses `usePathname()` from `next/navigation` to determine active item.

Structure:

- 240px wide, `bg-surface`, right border `border-r border-hairline`, full viewport height
- Top: "JF" monogram + "Forge Admin" text, 16px padding
- Nav groups with section headers (CONTENT, REFERENCE, OPERATIONS, ADMIN) in label style (11px uppercase, letter-spacing 0.08em, text-muted)
- Nav items: `<Link>` elements, 32px tall, 12px horizontal padding, rounded-sm on hover
  - Default: text-secondary
  - Hover: bg-surface-raised, text-primary
  - Active (pathname match): bg-surface-raised + 2px white left border + text-primary
- Bottom: user row (name + role pill)

Nav structure:

```
CONTENT
  Experiences    /dashboard/experiences    FileText icon
  Videos         /dashboard/videos         Film icon
  Media          /dashboard/media          Image icon

REFERENCE
  Languages      /dashboard/languages      Globe icon
  Countries      /dashboard/countries      Map icon
  Keywords       /dashboard/keywords       Tag icon

OPERATIONS
  Core Sync      /dashboard/sync           RefreshCw icon
  Workflows      /dashboard/workflows      Zap icon
  Embeddings     /dashboard/embeddings     Sparkles icon

ADMIN
  Users          /dashboard/users          Users icon
  Settings       /dashboard/settings       Settings icon
```

### File: `apps/admin/src/components/topbar.tsx`

"use client" component. Props: none needed initially.

Structure:

- 48px tall, `bg-surface`, bottom border `border-b border-hairline-strong`
- Left: breadcrumb (derive from pathname, sans text)
- Center: command pill (surface-raised bg, 4px radius, hairline border, 320px wide, mono-xs placeholder "Search or ⌘K")
- Right: bell icon + avatar circle (20px, surface-raised bg, rounded-full)

### File: `apps/admin/src/app/dashboard/layout.tsx`

Server Component:

```tsx
import { requireSession } from "@/auth/session"
import { Sidebar } from "@/components/sidebar"
import { Topbar } from "@/components/topbar"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireSession()

  return (
    <div className="flex h-screen">
      <Sidebar user={user} />
      <div className="flex flex-1 flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
```

---

## Step 5: Dashboard Page

Update `apps/admin/src/app/dashboard/page.tsx`:

Server Component. Calls `requireSession()`. Renders:

1. Eyebrow label "OVERVIEW" in label style
2. H1 "Good morning" (display style, 24px weight 600)
3. 5 stat cards in a grid row (surface bg, 4px radius, 1px hairline, 16px padding):
   - "Experiences published" — big mono "184"
   - "Drafts in review" — "23"
   - "Videos synced" — "4,812"
   - "Last Core sync" — "2h 14m ago"
   - "Failed workflows" — "2" (this count in brand red — the one Rule-of-One element)
4. Two-column layout (60/40):
   - Left: "Activity" card with 6 placeholder rows
   - Right: "Needs attention" card with 4 rows

Use static/placeholder data for now — no GraphQL queries needed.

---

## Step 6: Restyle Login Page

Restyle `apps/admin/src/app/login/page.tsx`. Keep ALL the existing auth logic (fetch to /api/auth/sign-in/email, SSO buttons with redirect). Only change the JSX/styling.

Split-screen layout:

- Left 50%: background bg, "JF Forge Admin" top-left, centered "Tend the work." headline + sub-line, version stamp bottom-left
- Right 50%: surface bg, centered card (420px, background bg, 4px radius, 1px hairline, 32px padding) containing:
  - "SIGN IN" label + "Welcome back" headline
  - Email input + Password input (surface bg, 1px hairline border, 32px height)
  - "Remember me" checkbox + "Forgot password?" link
  - Primary red "Continue" button (the one red element)
  - "OR" divider
  - "Continue with Google" secondary button (+ other SSO providers)
  - Hairline divider
  - "LEGACY ACCOUNT" section with Firebase migration info

---

## Step 7: Experiences List Page

Create `apps/admin/src/app/dashboard/experiences/page.tsx`.

Server Component. Calls `requireSession()`. For v1, use static placeholder data (array of objects). The page should demonstrate the full table pattern:

- Page header: H1 "Experiences" + mono count "247" + primary red "+ New Experience" button
- Filter bar card: search input + filter chips (Status, Owner, Locale, Embedding) + sort
- Table with 10 rows, columns: Title, Slug (mono), Owner, Locales (chips with dots), Status (outlined pill), Embedding (dot + label), Updated (mono)
- One row hovered, one selected (brand-soft bg + 2px brand left edge)
- Pagination

Use the ministry content titles from the design: "Hope in Suffering", "Who is Jesus?", "Finding Peace After Loss", "Stories of Forgiveness", "Easter 2026 Campaign", "JESUS Film Origin Story", "Faith After Doubt", "Family Conversation Guide", "Persecuted Church Today", "Christmas Hope".

---

## Step 8: Videos List Page

Create `apps/admin/src/app/dashboard/videos/page.tsx`.

Same pattern as Experiences but for Videos. Static data. Info banner at top ("Videos are read-only. Edit masters in Core, then re-sync."). Different columns: Thumbnail placeholder, Title, Core ID (mono), Source (outlined pill), Variants (mono count), Languages (locale chips), Keywords (chips), Last synced (mono).

Use JF catalog: "JESUS (Full Film)", "Magdalena: Released from Shame", "The Story of Jesus for Children", "Rivka", "Falling Plates", etc.

---

## Step 9: Create Stub Pages

Create placeholder pages for every sidebar route so navigation works:

- `apps/admin/src/app/dashboard/media/page.tsx`
- `apps/admin/src/app/dashboard/languages/page.tsx`
- `apps/admin/src/app/dashboard/countries/page.tsx`
- `apps/admin/src/app/dashboard/keywords/page.tsx`
- `apps/admin/src/app/dashboard/sync/page.tsx`
- `apps/admin/src/app/dashboard/workflows/page.tsx`
- `apps/admin/src/app/dashboard/embeddings/page.tsx`
- `apps/admin/src/app/dashboard/users/page.tsx`
- `apps/admin/src/app/dashboard/settings/page.tsx`

Each stub: Server Component, calls `requireSession()`, renders H1 with the page name + "Coming soon" body text.

---

## Step 10: Verify

1. `pnpm --filter @forge/admin build` — must succeed
2. `pnpm --filter @forge/admin typecheck` — must pass
3. `pnpm --filter @forge/admin lint` — must pass
4. Dev server shows:
   - Login page with split-screen Forge Editorial design
   - After login, dashboard shell with sidebar + top bar
   - Sidebar navigation works (active states, all links resolve)
   - Experiences + Videos list pages render with the table pattern
   - All stub pages render

---

## Component Patterns (reusable)

### StatusPill

```tsx
// Outlined, never filled
function StatusPill({
  status,
}: {
  status: "published" | "draft" | "archived" | "failed"
}) {
  const styles = {
    published: "border-success-border text-success",
    draft: "border-warning-border text-warning",
    archived: "border-hairline text-text-muted",
    failed: "border-danger-border text-danger",
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${styles[status]}`}
    >
      {status}
    </span>
  )
}
```

### LocaleChip

```tsx
function LocaleChip({
  code,
  status,
}: {
  code: string
  status: "published" | "draft" | "empty"
}) {
  const dotColor = {
    published: "bg-success",
    draft: "bg-warning",
    empty: "bg-text-disabled",
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-[2px] border border-hairline px-1.5 py-0.5 font-mono text-[11px]">
      <span className={`h-1 w-1 rounded-full ${dotColor[status]}`} />
      {code}
    </span>
  )
}
```

### StatCard

```tsx
function StatCard({
  label,
  value,
  delta,
}: {
  label: string
  value: string
  delta?: string
}) {
  return (
    <div className="rounded-sm border border-hairline bg-surface p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
        {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-medium">{value}</div>
      {delta && (
        <div className="mt-1 font-mono text-[11px] text-text-muted">
          {delta}
        </div>
      )}
    </div>
  )
}
```

---

## Constraints Summary

- **DO NOT modify** anything in `src/auth/`, `src/graphql/`, `src/services/`, `src/db/`, `src/domain/`, `src/config/`, `prisma/`
- **DO NOT add** shadcn/ui, Radix, or any component library. Build with Tailwind utilities directly.
- **DO NOT add** any serif fonts. Single sans family (IBM Plex Sans) + mono (IBM Plex Mono).
- **DO NOT use** pure black (#000) or pure white (#fff). Always warm-stone palette.
- **DO NOT use** rounded corners larger than 4px on cards/buttons. 2px on chips. Pill only on status + avatars.
- **DO NOT use** filled status pill backgrounds. Always outlined.
- **DO NOT use** brand red on more than ONE element per viewport.
- **DO NOT use** drop shadows on cards. Only on floating overlays.
- **DO NOT break** the existing login auth flow (fetch to /api/auth/sign-in/email + SSO redirect pattern).
- **DO** use `font-mono` class on every identifier, slug, timestamp, count, locale code.
- **DO** use 1px hairline borders on every structural boundary.
- **DO** keep text at 13px base, rows at 40px, buttons at 32px.
- Commit as: `feat(admin): add Forge Editorial design system + dashboard shell + core pages`
