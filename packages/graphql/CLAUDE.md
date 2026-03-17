# packages/graphql — Typed GraphQL Client

## Purpose

This package provides gql.tada typed GraphQL operations generated from the Strapi v5 GraphQL schema. It is the single source of truth for all GraphQL interactions consumed by apps/web and apps/mobile.

## Stack

- gql.tada for type-safe GraphQL operations
- TypeScript strict mode
- Codegen from Strapi's GraphQL introspection endpoint

## Conventions

- All queries, mutations, and fragments live in this package — not in the consuming apps.
- Organize by domain: `operations/videos.ts`, `operations/users.ts`, `fragments/media.ts`.
- Export typed operations and their result types for consumers.
- Run codegen after every Strapi content type change.
- Commit generated type files — they are part of the contract.

## Common Pitfalls

- Forgetting to run codegen after Strapi changes breaks types silently (builds pass, runtime fails).
- Strapi's GraphQL plugin has its own filtering/sorting syntax — don't assume Relay-style pagination.
- Fragment colocation: keep fragments close to the queries that use them, not in a separate folder.
