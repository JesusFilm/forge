# Web Agent Guide

Scope: `apps/web`.

## Do

- Read content via generated client packages.
- Keep preview/revalidate endpoints token-gated.
- Treat web as consumer of published content.

## Do not

- Call model providers directly.
- Import internals from `apps/cms`.
- Handwrite API client logic duplicated from generated clients.
