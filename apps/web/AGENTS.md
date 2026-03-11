# Web Agent Guide

Scope: `apps/web`.

## Do

- Read content via generated client packages.
- Keep preview/revalidate endpoints token-gated.
- Treat web as consumer of published content.

## Do not

- Call model providers directly.
- Import internals from `apps/cms` or `apps/ai-orchestrator`.
- Handwrite API client logic duplicated from generated clients.

## Component patterns

### base-ui Button (`@base-ui/react/button`)

- The `render` prop fully replaces the rendered element. When passing `render={<a ... />}`, base-ui renders only the `<a>` — no duplicate `<button>` is emitted.
- There is no `nativeButton` prop in our version. If a bot reviewer suggests adding it, verify against `node_modules/@base-ui/react` before applying.

### shadcn/ui generated components

- shadcn-generated code may have subtle bugs. After adding a component via `npx shadcn@latest add`, review the generated code for missing event listener cleanups, incomplete keyboard handling, or other issues.
- Known issue: the generated `carousel.tsx` subscribes to Embla's `reInit` event but doesn't unsubscribe in the cleanup function.

### String fallbacks

- When a value is normalized via `String(x ?? "")`, the result is `""` (empty string), not `null`. Use `||` (not `??`) when you need a truthy fallback for potentially-empty strings (e.g. `ctaLabel || "Default label"`).
