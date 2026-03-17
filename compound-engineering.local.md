# Compound Engineering Local Configuration

## Stack

- Next.js 14+ (App Router, RSC, Server Actions)
- React Native / Expo (EAS builds)
- Strapi v5 CMS (GraphQL API enabled)
- gql.tada for type-safe GraphQL client (packages/graphql)
- TypeScript throughout (strict mode)
- pnpm workspaces / Turborepo monorepo
- Railway for all deployments
- Cloudflare for DNS and security (WAF, Authenticated Origin Pulls)

## Review Focus Areas

- security: high
- performance: medium
- architecture: high
- code-simplicity: medium

## Review Depth

thorough

## Review Agents

### Always Run

- security-sentinel
- architecture-strategist
- pattern-recognition-specialist
- code-simplicity-reviewer
- kieran-typescript-reviewer
- agent-native-reviewer
- learnings-researcher

### Conditional

- data-integrity-guardian: only when diff touches migrations or Strapi content types
- deployment-verification-agent: only when diff touches Dockerfiles, railway.toml, or CI config
- performance-oracle: only when diff touches GraphQL resolvers, data fetching, or API calls

### Skip

- dhh-rails-reviewer: no Rails in this repo
- kieran-rails-reviewer: no Rails in this repo
- kieran-python-reviewer: no Python in this repo
- julik-frontend-races-reviewer: no Stimulus usage

## Monorepo-Specific Review Rules

When reviewing changes, always check for cross-package impact:

### Package Dependency Map

```
apps/cms (Strapi v5)
  -> exposes GraphQL API consumed by
packages/graphql (gql.tada typed client)
  -> consumed by
apps/web (Next.js)
apps/mobile (Expo)
```

This is a linear dependency chain. Changes flow downstream:
Strapi schema -> packages/graphql codegen -> web + mobile queries.

### Cross-Package Review Checklist

- If `apps/cms/` content types change: run codegen in `packages/graphql/`, then check `apps/web/` and `apps/mobile/` for broken queries
- If `packages/graphql/` changes: check both `apps/web/` and `apps/mobile/` for type compatibility
- If `packages/graphql/` codegen config changes: verify output types still match Strapi's actual GraphQL schema
- If `apps/web/` or `apps/mobile/` add new GraphQL operations: verify the fields exist in the Strapi schema and are typed in `packages/graphql/`

## Solution Categories

When running ce:compound, use these categories for the solutions/ directory:

- graphql: gql.tada, codegen, schema introspection, typed operations, fragments
- cms: Strapi v5, content types, GraphQL plugin config, API tokens, lifecycle hooks
- mobile: React Native, Expo, EAS builds/updates, navigation, native modules
- web: Next.js, App Router, RSC, Server Actions, middleware, Tailwind
- deployment: Railway config, Cloudflare (WAF, DNS, Authenticated Origin Pulls), CI/CD, GitHub Actions
- auth: Authentication, authorization, API tokens
