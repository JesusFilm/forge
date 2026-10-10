---
title: "Watch Home Collection CTA Destination - Plan"
type: "feat"
date: "2026-07-15"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Goal Capsule

Make each Watch home media collection CTA default to the localized listing page
for the collection represented by its rendered videos, while preserving Admin
overrides and safe fallback behavior.

# Product Contract

- **R1:** A non-empty Admin `mediaCtaLink` remains authoritative.
- **R2:** A route-video-children section defaults to its route video's collection
  page.
- **R3:** A manual section defaults to the first parent slug shared by every
  rendered item.
- **R4:** Collection links use the active public language slug and the canonical
  two-segment Watch route shape.
- **R5:** Empty, mixed-parent, or unresolved sections retain the current videos
  inventory fallback.

# Planning Contract

## Key Technical Decisions

1. Add `defaultCollectionSlug` to `MediaCollectionBlock`; videos can belong to
   multiple collections, so Admin computes the intersection for the whole block
   and returns only the first deterministic match.
2. Resolve visible parents through the existing Admin relation and video
   DataLoaders so all items and sibling blocks batch their reads.
3. Infer a destination only from the intersection of all linked manual items'
   ordered parent slugs. The first item's order provides deterministic choice.
4. Thread the active Watch language slug from the route into the experience
   section renderer instead of reusing an internal locale or hardcoded English.

## Implementation Units

### U1 - Admin collection-parent contract

- Add the block-level field and resolver in `apps/admin/src/graphql/types/blocks.ts`.
- Extend resolver/schema tests in `apps/admin/src/graphql/types/blocks.test.ts`.
- Select the field in the shared media collection fragment.
- Regenerate `apps/admin/schema.graphql` and the shared gql.tada environment.

### U2 - Watch CTA inference

- Read the block-level inferred collection slug from the shared fragment.
- Pass the active language slug through Watch home experience rendering.
- Apply precedence: explicit Admin link, route collection, shared parent,
  existing fallback.
- Cover localized, overridden, route-child, and mixed-parent behavior.

# Verification Contract

- Focused Admin block GraphQL tests pass.
- Schema print and shared GraphQL generation produce committed artifacts.
- Focused Web media collection tests pass.
- Typecheck and lint the touched packages where feasible.
- Review the resolver path for DataLoader batching and verify no new client-side
  hydration or initialization path was introduced.

# Definition of Done

- A Lumo-only media section without an Admin CTA links to the localized Lumo
  listing page.
- Explicit Admin CTAs and labels are unchanged.
- Mixed collections do not receive a misleading inferred destination.
- Generated GraphQL artifacts match the Pothos schema.
- Roadmap ticket `feat-262` is marked complete with verification notes.
