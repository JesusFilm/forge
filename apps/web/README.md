# apps/web

Next.js application.

## Dev env sync

From `apps/web`, run:

```bash
pnpm fetch-secrets
```

This pulls Doppler project `forge-web`, config `dev`, into `.env`.

## Boundary

- May import from `packages/admin-graphql`.
- Must not call model providers directly.
- Must not import internals from other apps.
