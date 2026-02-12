# apps/web

Next.js application.

## Boundary

- May import from `packages/contracts`, `packages/clients`, `packages/content-models`.
- Must not call model providers directly.
- Must not import from `apps/cms` or `apps/ai-orchestrator`.
