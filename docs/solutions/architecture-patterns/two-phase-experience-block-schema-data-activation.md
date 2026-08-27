---
title: "Two-phase activation for mixed-version Experience block rollouts"
date: "2026-08-27"
category: "architecture-patterns"
module: "Admin Experience blocks"
problem_type: "architecture_pattern"
component: "service_layer"
severity: "high"
applies_when:
  - "A new persisted Experience discriminator is unknown to the currently deployed Admin"
  - "Admin runs database migrations before new application instances replace old instances"
  - "Consumers and Admin can deploy or roll back independently"
tags:
  - "experience-editor"
  - "graphql"
  - "mixed-version"
  - "backfill"
  - "railway"
  - "rollout-safety"
---

# Two-phase activation for mixed-version Experience block rollouts

## Context

An Experience block is both an API union member and a persisted JSON
discriminator. Adding its schema and backfilling stored rows in one automatic
pre-deploy step is unsafe when old Admin instances still serve traffic: those
instances can encounter a discriminator their closed block union cannot parse.
A failed application rollout can also leave the database ahead of the restored
Admin version.

The Watch category-rail rollout solved this by separating schema expansion from
data activation. The new Admin can understand the block before any durable row
contains it. A reviewed post-deploy backfill runs only after the new Admin is
healthy and old instances have drained.

## Guidance

Use two explicit phases for a new persisted Experience discriminator:

1. **Expand the application contract.** Deploy Admin validation, Pothos types,
   generated consumer contracts, and tolerant consumers without writing the new
   discriminator during automatic migration.
2. **Activate stored data.** After the new Admin revision is healthy and old
   instances have drained, run a versioned backfill from that exact deployed
   image. Write the rows and an activation marker in one transaction.

Before activation, new Admin reads may synthesize the legacy-equivalent block
without mutating storage. The activation marker, not a row-level heuristic,
ends that compatibility behavior. After the marker exists, an absent block is
an authored decision and must remain absent.

Read the activation marker before querying rows that depend on it. Carry the
result in request context so every resolver in that request sees one rollout
state. Positive completion may be cached by the Admin process; absence must be
rechecked on a later request so a long-lived process observes activation.

Make the backfill safe under retries and overlapping operators:

- take a transaction-scoped advisory lock;
- return immediately when the versioned marker already exists;
- transform every valid target row, including active drafts whose effective
  homepage state differs from the canonical row;
- write the marker in the same transaction as the transformed rows;
- do not rerun merely to restore a block that an admin intentionally removed
  after activation.

Consumers need bounded mixed-version behavior. A Web client that names the new
GraphQL type may retry a legacy document only for the exact unknown-type
validation error. Network, authorization, timeout, resolver, and unrelated
validation errors must not enable compatibility rendering. Consumers that do
not render the new block, such as Mobile and TV in this rollout, should keep a
legacy fragment until the rollback window closes.

Rollback is data-first. Remove the new discriminator from canonical rows and
all Experience revision snapshots, verify no stored occurrence remains, remove
the activation marker, and only then restore an Admin version whose union does
not know the block.

## Why This Matters

Schema compatibility and data compatibility are separate deployment concerns.
An old consumer can often ignore a new GraphQL union member, but an old producer
may still fail when it parses a persisted discriminator it has never seen.
Separating expansion from activation preserves service availability during
either-order deploys and failed rollouts.

The marker also gives authored absence a precise meaning. Without it, read-time
synthesis cannot distinguish a pre-activation missing block from a deliberate
post-activation removal and may silently undo an admin's choice.

## When to Apply

- A closed persisted union gains a new discriminator.
- The platform runs data migrations before new application instances are fully
  serving.
- A rollout must support either producer-first or consumer-first deployment.
- Rollback may restore code that cannot parse the new stored shape.

## Examples

The Watch category-rail activation uses the versioned marker
`watch-home-category-rail-backfill-v1`. Admin resolves it once while building
the GraphQL request context, and the post-deploy SQL guards the complete
transformation with the same marker and an advisory lock. The rollout procedure
is documented in `docs/runbooks/watch-home-category-rail-rollout.md`.

## Related

- [Admin-authored, Web-owned Experience block contract](./admin-authored-web-owned-experience-block-contract-20260826.md)
  — the cross-layer contract for placing a Web-owned visual in Experience
  composition.
- [Dual-client gql.tada multi-schema codegen pattern](./dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md)
  — the generated GraphQL contract boundary used by Admin consumers.
- [YTM Prisma migration deploy safety guard](../workflow-issues/yt-video-mapper-prisma-migration-deploy-safety-guard.md)
  — adjacent guidance for SQL shapes that must be rejected before deployment.
