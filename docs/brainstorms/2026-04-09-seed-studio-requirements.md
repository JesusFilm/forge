---
date: 2026-04-09
topic: seed-studio
---

# Seed Studio — AI-Powered Experience Creator

## Problem Frame

Creating new themed experiences (like Easter and Christmas) currently requires a developer to write hundreds of lines of TypeScript seed code, manually selecting videos, crafting bible quotes, and hardcoding section ordering. This makes it impossible for the content team to create or iterate on experiences without developer involvement. The content team needs a self-service tool to create rich, multi-section experiences using JesusFilm's existing video catalog.

## Requirements

- R1. **Chat-first creation flow**: Users describe a theme or idea in a chat interface (e.g., "Create a Thanksgiving experience about gratitude") and AI generates a complete experience with all sections.
- R2. **AI generates full experience**: Given a theme, AI selects videos from the Strapi video catalog, writes bible quotes, generates discussion questions, composes descriptive text, and arranges sections — all matching the theme.
- R3. **Live preview panel**: A split-screen layout shows the generated experience preview alongside the chat, updating in real-time as AI generates or user edits content.
- R4. **Per-platform section ordering**: AI produces separate section orderings for web and mobile. Web may lead with text/context, mobile may lead with video. Both orderings are stored in the Experience document.
- R5. **Iterative refinement via chat**: Users can request changes through chat (e.g., "swap the first video for something shorter", "add a quiz after the third section", "reorder bible quotes") and AI applies the edits.
- R6. **Direct Strapi publish**: Completed experiences are published as `api::experience.experience` documents in Strapi via the Document Service API, with all video relations, dynamic zone blocks, and media properly linked.
- R7. **Video catalog search**: AI searches the Strapi video catalog by theme, tags, and content to find relevant videos. Uses existing video data (titles, descriptions, tags) for matching.
- R8. **Section type support**: Supports all existing dynamic zone block types: `sections.video`, `sections.video-hero`, `sections.video-carousel`, `sections.text`, `sections.container`, `sections.related-questions`, `sections.bible-quotes-carousel`, `sections.quiz-button`.
- R9. **Clean, modern UI**: Minimal, polished interface with clear visual hierarchy. Chat on the left, preview on the right. Designed using Stitch MCP for consistent, production-quality design.
- R10. **Suggestion chips**: AI provides quick-action suggestions (e.g., "Add more videos", "Include a quiz", "Try a different theme") as clickable chips below the chat.

## Success Criteria

- Content team member can create a complete themed experience in under 10 minutes without writing code.
- Generated experience renders correctly in both the web app and mobile app.
- Per-platform ordering produces meaningfully different section arrangements for web vs mobile.
- All video relations in the generated experience are valid and playable.

## Scope Boundaries

- **Not building a general CMS editor** — this is specifically for creating themed experiences.
- **Not replacing Strapi admin** — users still use Strapi for editing individual content types.
- **Not adding new content types** — uses existing Experience schema and section components.
- **Not building user auth in v1** — relies on internal network access or simple shared secret. Auth can come later.
- **Not handling video uploads** — only selects from existing video catalog in Strapi.
- **Per-platform ordering is about section arrangement only** — not about showing/hiding sections per platform.

## Key Decisions

- **Standalone app (`apps/seed-studio`)**: Separate from `apps/web` because it's an internal tool with different auth, deployment, and UX needs. Avoids bloating the public-facing app.
- **Chat-first, not form-first**: Matches the Lovable.com mental model. Lower learning curve for content team. AI does the heavy lifting.
- **AI generates everything, user reviews**: Rather than user assembling pieces, AI creates a complete draft and user iterates. Faster for the content team.
- **Direct Strapi publish (not seed files)**: Eliminates the developer bottleneck entirely. Content goes live without a code review cycle.
- **Stitch MCP for UI design**: Ensures clean, consistent design system from the start.

## Dependencies / Assumptions

- Strapi video catalog has enough tagged/searchable videos to make AI selection useful.
- Strapi GraphQL API or Document Service API is accessible from the seed-studio app.
- AI model (Claude) has access to the video catalog data for making content decisions.
- Experience schema supports storing per-platform ordering (may need a new field or convention).

## Outstanding Questions

### Resolve Before Planning

(All resolved)

### Resolved

- [R4] Per-platform ordering: Platform tag on each section block. Each section gets a `platforms` array with `{ platform: "web" | "mobile", order: number }` entries. Apps query sections and sort by their platform's order value.

### Deferred to Planning

- [Affects R2][Needs research] Which AI model/API to use for content generation and how to structure the prompts for theme-to-experience generation.
- [Affects R7][Needs research] Whether existing video metadata (tags, descriptions) is rich enough for AI to make good selections, or if we need to add embeddings/semantic search.
- [Affects R6][Technical] How to handle the Strapi v5 nested component relation bug (currently patched by `patchNestedVideoRelations`) when publishing from seed-studio.
- [Affects R9][Design] Detailed UI component design — to be explored with Stitch MCP during planning.

## Next Steps

→ `/ce:plan` for structured implementation planning
