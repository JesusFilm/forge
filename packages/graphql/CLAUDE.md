# packages/graphql — Typed GraphQL Client

## Purpose

This package provides gql.tada typed GraphQL operations generated from the Strapi v5 GraphQL schema. It is the single source of truth for all GraphQL interactions consumed by apps/web and apps/mobile.

## Stack

- gql.tada for type-safe GraphQL operations
- TypeScript strict mode
- Codegen from Strapi's GraphQL introspection endpoint

## Conventions

- This package exports the typed `graphql()` function and introspection types — consuming apps define their own operations inline.
- Operations are defined in apps (e.g., `apps/web/src/lib/content.ts`, `apps/manager/src/app/dashboard/`) using `graphql()` from this package.
- Run codegen after every Strapi content type change.
- Commit generated type files — they are part of the contract.

## Common Pitfalls

- Forgetting to run codegen after Strapi changes breaks types silently (builds pass, runtime fails).
- Strapi's GraphQL plugin has its own filtering/sorting syntax — don't assume Relay-style pagination.
- Fragment colocation: keep fragments close to the queries that use them, not in a separate folder.
