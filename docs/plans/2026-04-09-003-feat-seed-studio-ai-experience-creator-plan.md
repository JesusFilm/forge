---
title: "feat: Seed Studio — AI-Powered Experience Creator"
type: feat
status: completed
date: 2026-04-09
origin: docs/brainstorms/2026-04-09-seed-studio-requirements.md
---

# feat: Seed Studio — AI-Powered Experience Creator

## Overview

Build `apps/seed-studio`, a standalone Next.js app with a chat-first UI where the content team describes a theme and AI generates a complete Experience document — selecting videos, writing bible quotes, composing discussion questions, and arranging sections — then publishes directly to Strapi. This eliminates the developer bottleneck of manually coding seed files like `seed-easter.ts` and `seed-christmas.ts`.

## Problem Statement

Creating themed experiences (Easter, Christmas) currently requires a developer to write 500+ lines of TypeScript seed code, manually selecting Mux streaming URLs, crafting bible quotes, and hardcoding section ordering. The content team cannot create or iterate on experiences without developer involvement. Each new experience takes days of developer time. (see origin: `docs/brainstorms/2026-04-09-seed-studio-requirements.md`)

## Proposed Solution

A chat-first web tool inspired by Lovable.com where:

1. User types a theme (e.g., "Create a Thanksgiving experience about gratitude")
2. AI generates all sections — video selections from Strapi catalog, text blocks, bible quotes, Q&A, quizzes
3. Live preview shows the experience in real-time alongside the chat
4. User iterates via chat ("swap the first video", "add a quiz after section 3")
5. User publishes directly to Strapi when satisfied

**Key architectural decisions (see origin):**

- **Standalone app** (`apps/seed-studio`): Separate from `apps/web` — different auth, deployment, UX needs
- **Chat-first, not form-first**: Lower learning curve, AI does heavy lifting
- **Direct Strapi publish**: No developer bottleneck, no seed file generation
- **Per-platform ordering**: Platform tags on section blocks for web vs mobile arrangement

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────┐
│ apps/seed-studio (Next.js 16 + React 19)            │
│                                                     │
│  ┌──────────────┐     ┌──────────────────────────┐  │
│  │ Chat Panel   │     │ Preview Panel            │  │
│  │ (Client)     │     │ (Client)                 │  │
│  │              │     │                          │  │
│  │ Messages     │     │ Web / Mobile toggle      │  │
│  │ Suggestions  │     │ Section cards            │  │
│  │ Input        │     │ Drag-to-reorder          │  │
│  └──────┬───────┘     └──────────┬───────────────┘  │
│         │                        │                  │
│  ┌──────▼────────────────────────▼───────────────┐  │
│  │ Server Actions                                │  │
│  │ ├─ generateExperience(theme)                  │  │
│  │ ├─ refineExperience(conversationId, message)  │  │
│  │ ├─ searchVideos(query)                        │  │
│  │ └─ publishExperience(experience)              │  │
│  └──────┬────────────────────────┬───────────────┘  │
│         │                        │                  │
└─────────┼────────────────────────┼──────────────────┘
          │                        │
    ┌─────▼─────┐          ┌───────▼──────┐
    │ Claude AI │          │ Strapi CMS   │
    │ (Anthropic│          │ REST API     │
    │  SDK)     │          │ + custom     │
    │           │          │   endpoints  │
    └───────────┘          └──────────────┘
```

**Communication pattern**: Next.js Server Actions call Claude API (for AI generation) and Strapi REST API (for video search and experience publishing). The `patchNestedVideoRelations` workaround requires a custom Strapi endpoint since Seed Studio cannot access Strapi's internal Knex instance.

### Implementation Phases

#### Phase 1: Foundation — App Scaffold + Strapi Endpoints (2-3 days)

**Goal**: Standalone Next.js app running in monorepo + Strapi API endpoints for video search and experience publishing.

**Tasks:**

1. **Scaffold `apps/seed-studio`**
   - Follow `apps/web` patterns: `@forge/seed-studio`, Next.js 16, React 19, Tailwind v4
   - `package.json` with `@forge/graphql: workspace:*`, `@anthropic-ai/sdk`
   - `tsconfig.json` extending root, paths `@/* -> ./src/*`
   - `next.config.mjs` with Strapi URL env vars
   - `turbo.json` entry for seed-studio tasks
   - Reference: `apps/web/package.json`, `apps/web/tsconfig.json` for conventions

2. **Create Strapi custom endpoints** in `apps/cms/`
   - `src/api/seed-studio/routes/seed-studio.ts` — routes
   - `src/api/seed-studio/controllers/seed-studio.ts` — controller
   - `src/api/seed-studio/services/seed-studio.ts` — service
   - **Endpoints:**
     - `POST /api/seed-studio/search-videos` — search videos by query, tags, locale. Returns `{ id, documentId, title, slug, description, streamingUrl, thumbnailUrl }`
     - `POST /api/seed-studio/publish-experience` — create Experience document with all blocks + run `patchNestedVideoRelations` internally
     - `GET /api/seed-studio/video-catalog-stats` — return available tags, locales, video count for AI context
   - Auth: API token header (`X-Seed-Studio-Token`) validated against env var
   - Reference: `apps/cms/src/bootstrap/seed-utils.ts` for `findOrCreatePublishedVideo()` and `patchNestedVideoRelations()` patterns
   - Reference: `docs/solutions/runtime-errors/cms-easter-seed-not-called-2026-03-30.md` for endpoint pattern

3. **Environment setup**
   - `.env.local`: `STRAPI_URL`, `STRAPI_SEED_STUDIO_TOKEN`, `ANTHROPIC_API_KEY`
   - Railway service config (deferred to Phase 4)

**Gotchas:**

- Use numeric entity IDs for all video relations inside dynamic zone components (see `docs/solutions/integration-issues/strapi-v5-nested-component-relation-ids-2026-03-31.md`)
- Strapi v5 GraphQL truncates nested relations to 10 items — use REST API for publish, not GraphQL mutation (see `docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md`)

**Acceptance criteria:**

- [ ] `pnpm --filter @forge/seed-studio dev` starts the app on localhost
- [ ] `POST /api/seed-studio/search-videos` returns video results from Strapi DB
- [ ] `POST /api/seed-studio/publish-experience` creates an Experience with video relations intact

---

#### Phase 2: AI Chat Engine (2-3 days)

**Goal**: Working chat interface that generates experiences via Claude API.

**Tasks:**

1. **AI prompt system** — `src/lib/ai/`
   - `system-prompt.ts` — System prompt defining AI's role as an experience creator. Includes:
     - Available section types and their schemas
     - Video catalog summary (from `/video-catalog-stats`)
     - Output format: JSON structure matching Experience blocks schema
     - Per-platform ordering guidelines (mobile: video-first, web: context-first)
   - `tools.ts` — Claude tool definitions:
     - `search_videos(query, tags?, locale?)` — searches Strapi video catalog
     - `generate_section(type, content)` — creates a typed section block
     - `reorder_sections(platform, newOrder)` — adjusts ordering for a platform
   - `experience-schema.ts` — TypeScript types for the Experience JSON structure matching Strapi's dynamic zone format

2. **Server Actions** — `src/app/actions/`
   - `chat.ts` — `generateExperience(theme: string)` and `refineExperience(messages: Message[], userMessage: string)`
   - Uses Anthropic SDK with streaming (`stream: true`) for real-time preview updates
   - Tool use loop: AI calls `search_videos` → Server Action fetches from Strapi → returns results to AI → AI incorporates into experience
   - Returns structured experience JSON + chat message

3. **Chat state management** — `src/lib/chat/`
   - `use-chat.ts` — Custom hook managing conversation history + current experience state
   - Messages: `{ role, content, experienceSnapshot? }` — each AI message optionally carries the experience state at that point
   - Ephemeral sessions (no persistence in v1)

**Key design decisions:**

- **Streaming**: AI streams its reasoning/explanation text. The experience JSON is extracted from the final tool call result, not from streamed text. This avoids partial JSON parsing issues.
- **Tool use pattern**: AI uses `search_videos` tool to query Strapi, receives results, then uses `generate_section` tools to build each section. This keeps the AI grounded in real catalog data.
- **Per-platform ordering**: AI generates a single set of sections, then assigns `platforms: [{ platform: "web", order: N }, { platform: "mobile", order: N }]` to each block based on content-type heuristics (video-heavy → earlier on mobile, text-heavy → earlier on web).

**Acceptance criteria:**

- [ ] User types a theme → AI streams a response + generates Experience JSON
- [ ] AI searches video catalog via tool calls and selects relevant videos
- [ ] User sends follow-up message → AI modifies the experience
- [ ] Experience JSON matches Strapi's `ExperienceBlocksDynamicZone` format

---

#### Phase 3: UI — Chat + Preview Split Screen (2-3 days)

**Goal**: Polished split-screen UI with chat and live preview.

**Reference designs**: Stitch MCP project `3497475446795838271` — 4 screen variations generated. Screen 1 (sidebar + chat + preview) and Screen 4 (header with Publish button) are the primary references.

**Tasks:**

1. **Layout** — `src/app/page.tsx` (Server Component) + `src/app/studio.tsx` (Client Component)
   - Split-screen: Chat panel (40% width) | Preview panel (60% width)
   - Responsive: On mobile, tabs to switch between chat and preview
   - Header bar: "Seed Studio" branding + "Publish to Strapi" button + "Save Draft" (disabled v1)

2. **Chat panel** — `src/components/chat/`
   - `ChatPanel.tsx` — Container with message list + input
   - `ChatMessage.tsx` — User messages (indigo bg, right-aligned) and AI messages (gray bg, left-aligned)
   - `ChatInput.tsx` — Large text input with send button, placeholder "Describe your experience theme..."
   - `SuggestionChips.tsx` — Soft-rounded pills below last AI message. Hybrid: fixed chips ("Add more videos", "Include a quiz", "Preview on mobile") + AI-generated contextual suggestions
   - Streaming indicator: Animated dots while AI is generating

3. **Preview panel** — `src/components/preview/`
   - `PreviewPanel.tsx` — Container with platform toggle + section list
   - `PlatformToggle.tsx` — "Web" | "Mobile" tab toggle that re-sorts sections by platform ordering
   - `SectionCard.tsx` — Generic card wrapper with section type icon + drag handle + edit icon on hover
   - Section type renderers (simplified card previews, not full web components):
     - `VideoSectionPreview.tsx` — Video thumbnail + title + subtitle
     - `VideoHeroPreview.tsx` — Large hero image/thumbnail + heading + CTA
     - `VideoCarouselPreview.tsx` — Horizontal scroll of video thumbnail cards
     - `TextSectionPreview.tsx` — Heading + paragraph text
     - `BibleQuotesPreview.tsx` — Quote card with reference + background
     - `RelatedQuestionsPreview.tsx` — Expandable Q&A items
     - `QuizButtonPreview.tsx` — CTA button preview
     - `ContainerPreview.tsx` — Grid layout with nested content
   - Drag-to-reorder: Users can drag sections to manually override AI ordering (updates platform-specific order)

4. **Publish flow** — `src/components/publish/`
   - `PublishButton.tsx` — "Publish to Strapi" button with loading state
   - `PublishDialog.tsx` — Confirmation dialog showing: experience title, slug (editable), locale, section count
   - Slug auto-generated from theme, user can edit. If collision detected, append `-2`, `-3`, etc.
   - Success state: "Published! View in Strapi" link
   - Error state: Clear message + "Retry" button. If relation patch fails, show warning "Published with incomplete video links — Retry linking"

**Styling:**

- Tailwind v4 with Geist font (from Stitch design system: indigo `#6366f1` primary, neutral `#1e1e2e`)
- Clean, minimal, generous whitespace
- Subtle borders and shadows, no heavy visual noise

**Acceptance criteria:**

- [ ] Split-screen layout renders correctly on desktop
- [ ] Chat messages stream in real-time
- [ ] Suggestion chips are clickable and inject into chat
- [ ] Preview updates as AI generates sections
- [ ] Platform toggle re-sorts sections by web/mobile ordering
- [ ] Publish flow creates Experience in Strapi with success/error feedback

---

#### Phase 4: Polish + Deployment (1-2 days)

**Goal**: Production-ready deployment on Railway.

**Tasks:**

1. **Error handling**
   - Strapi unreachable: "Cannot connect to CMS. Please try again later."
   - AI timeout: "AI took too long. Try a simpler theme or retry."
   - Video search returns 0 results: AI responds in chat suggesting broader theme or manual video selection
   - Publish validation: Check all required fields before calling Strapi
   - Partial publish failure (relation patch fails): Show warning + retry button

2. **Auth (simple v1)**
   - Basic auth middleware (`src/middleware.ts`) with shared password from env var `SEED_STUDIO_PASSWORD`
   - Simple login page with password input
   - Session cookie (httpOnly, secure) lasting 24 hours

3. **Railway deployment**
   - `railway.toml` in `apps/seed-studio/`
   - Do NOT use `output: "standalone"` (see `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`)
   - Set `HOSTNAME=0.0.0.0` via Railway CLI, not toml
   - Pin pnpm version in build command
   - Env vars: `STRAPI_URL`, `STRAPI_SEED_STUDIO_TOKEN`, `ANTHROPIC_API_KEY`, `SEED_STUDIO_PASSWORD`

4. **Smoke tests**
   - Manual test: create an experience via chat → verify in Strapi admin → verify renders in `apps/web`
   - Verify video relations are populated on all video section types

**Acceptance criteria:**

- [ ] App deploys to Railway and is accessible behind Cloudflare
- [ ] Basic auth prevents unauthorized access
- [ ] Full end-to-end flow: chat → generate → preview → publish → visible in Strapi

## Scope Decisions for v1

These decisions narrow the v1 scope based on SpecFlow analysis findings (see origin):

| Decision                  | v1 Scope                                         | Future                            |
| ------------------------- | ------------------------------------------------ | --------------------------------- |
| Edit existing experiences | Create-only. "Edit in Strapi" link after publish | v2: load + edit                   |
| Locale                    | English (`en`) only                              | v2: locale selector               |
| Section types             | 8 types from R8                                  | Add more as content team requests |
| Conversation persistence  | Ephemeral sessions                               | v2: save/resume conversations     |
| Undo/redo                 | No undo. User can re-describe in chat            | v2: version history               |
| Preview fidelity          | Simplified card-based previews                   | v2: import web components         |
| Draft workflow            | No drafts. Publish or abandon                    | v2: save as Strapi draft          |
| Video stream validation   | Check `published_at IS NOT NULL` only            | v2: validate Mux playback         |

## Per-Platform Ordering — Schema Approach

**Decision**: Store ordering as a JSON field on the Experience itself, NOT as component-level attributes.

```typescript
// New field on Experience content type:
// platformOrdering: JSON
// Value:
{
  "web": [0, 2, 1, 3, 4, 5],    // indices into blocks array
  "mobile": [1, 0, 3, 2, 5, 4]  // indices into blocks array
}
```

**Rationale**:

- No schema change to existing section components (avoids breaking GraphQL contract)
- No changes needed in `apps/web` or `apps/mobile-v2` consumers until they opt-in to reading this field
- Backward compatible: existing experiences have `null` → consumers use default blocks array order
- Single field addition to Experience content type via Strapi admin
- Consumer apps read `platformOrdering.web` or `platformOrdering.mobile` and sort `blocks` accordingly

**Note**: This differs from the brainstorm decision of "platform tag on each section block" — the JSON field approach was chosen to avoid breaking the existing GraphQL schema contract. The end result is equivalent: each platform has its own section ordering.

## System-Wide Impact

### Interaction Graph

- Seed Studio → Strapi REST API (create Experience, search videos)
- Seed Studio → Claude API (generate content)
- New Strapi endpoints → Document Service → PostgreSQL (create Experience + blocks)
- New Strapi endpoints → Knex (patchNestedVideoRelations for link table rows)
- `apps/web` reads Experience via GraphQL (unchanged, optionally reads `platformOrdering`)
- `apps/mobile-v2` reads Experience via GraphQL (unchanged, optionally reads `platformOrdering`)

### Error Propagation

- AI API failure → Server Action catches → returns error message to chat UI
- Strapi API failure → Server Action catches → shows user-friendly error in publish dialog
- Relation patch failure → Strapi endpoint catches → returns partial success status → UI shows warning + retry
- Video search failure → AI receives empty results → AI asks user to try different keywords

### State Lifecycle Risks

- **Partial publish**: `create()` succeeds but `patchNestedVideoRelations()` fails → Experience exists with broken video links. Mitigation: the custom endpoint wraps both in a try/catch and returns `{ created: true, relationsPatched: false }`. UI shows retry button.
- **Orphaned experiences**: User publishes, then wants to redo. No auto-cleanup. Mitigation: v1 shows "Edit in Strapi" link; v2 adds update/delete.

### API Surface Parity

- New Strapi endpoints: `POST /api/seed-studio/search-videos`, `POST /api/seed-studio/publish-experience`, `GET /api/seed-studio/video-catalog-stats`
- No changes to existing GraphQL schema (Experience type gains one optional JSON field)
- `apps/web` and `apps/mobile-v2` are NOT modified in this feature

## Acceptance Criteria

### Functional Requirements

- [ ] Content team member can type a theme and receive a full AI-generated experience
- [ ] AI selects videos from Strapi catalog that match the theme
- [ ] Live preview shows all generated sections with correct section type rendering
- [ ] Web/Mobile toggle shows different section orderings
- [ ] User can iteratively refine via chat ("swap video", "add quiz", "reorder")
- [ ] Suggestion chips provide context-aware quick actions
- [ ] Publish creates a valid Experience in Strapi with all video relations populated
- [ ] Published experience renders correctly in `apps/web`

### Non-Functional Requirements

- [ ] AI generation completes within 30 seconds for a typical 8-section experience
- [ ] Simple password auth prevents unauthorized access
- [ ] App deploys to Railway as a separate service

### Quality Gates

- [ ] TypeScript strict mode, no `any`
- [ ] All Strapi API calls have error handling with user-friendly messages
- [ ] Publish flow validates Experience structure before calling Strapi

## Dependencies & Prerequisites

1. **Strapi running locally** with video data imported (`pnpm data-import`)
2. **Anthropic API key** for Claude access
3. **`platformOrdering` JSON field** added to Experience content type in Strapi admin
4. **New Strapi endpoints** (Phase 1) must be built before the AI engine (Phase 2)

## Risk Analysis & Mitigation

| Risk                                         | Likelihood | Impact | Mitigation                                                        |
| -------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------- |
| Video catalog metadata too sparse for AI     | Medium     | High   | Start with tag-based search; add pgvector embeddings if needed    |
| Strapi nested relation bug affects publish   | High       | High   | Custom endpoint runs `patchNestedVideoRelations` server-side      |
| AI generates poor content for niche themes   | Medium     | Medium | Iterative refinement via chat; user always reviews before publish |
| Per-platform ordering adds schema complexity | Low        | Medium | JSON field on Experience avoids component-level changes           |

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-04-09-seed-studio-requirements.md](docs/brainstorms/2026-04-09-seed-studio-requirements.md) — Key decisions: chat-first UX, AI generates everything, direct Strapi publish, standalone app, per-platform ordering via platform tags

### Internal References

- Seed script patterns: `apps/cms/src/bootstrap/seed-easter.ts`, `seed-christmas.ts`, `seed-utils.ts`
- Experience schema: `apps/cms/schema.graphql:1584`
- Next.js app conventions: `apps/web/package.json`, `apps/web/tsconfig.json`
- Video relation workaround: `docs/solutions/integration-issues/strapi-v5-nested-component-relation-ids-2026-03-31.md`
- Endpoint pattern: `docs/solutions/runtime-errors/cms-easter-seed-not-called-2026-03-30.md`
- Railway deployment: `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`
- pgvector search: `docs/solutions/best-practices/pgvector-recommendation-query-locale-graphql-strapi-v5.md`
- GraphQL relation truncation: `docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md`

### Design References

- Stitch MCP project: `3497475446795838271` — 4 desktop screen variations
- Design system: Geist font, indigo `#6366f1` primary, `ROUND_TWELVE` corners, light mode

### Stitch Screen Designs

| Screen                | Title              | Description                                                                 |
| --------------------- | ------------------ | --------------------------------------------------------------------------- |
| Screen 1 (`4fa4ce71`) | Seed Studio Editor | Sidebar + chat + preview with Easter content. Best for navigation structure |
| Screen 2 (`9cbc8b8d`) | Seed Studio Editor | Chat above + article-style preview below                                    |
| Screen 3 (`3070eafc`) | AI Studio Chat     | Clean split-screen with suggestion chips                                    |
| Screen 4 (`b5e200b2`) | AI Studio Chat     | Split-screen with "Publish to Strapi" header button. Best for publish flow  |
