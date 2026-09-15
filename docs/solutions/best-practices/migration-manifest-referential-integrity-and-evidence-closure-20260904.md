---
title: "Migration manifests need referential integrity and evidence closure"
date: "2026-09-04"
category: "best-practices"
module: "apps/rag"
problem_type: "migration_gap"
component: "migration_workflow"
severity: "high"
root_cause: "incomplete_file_inventory"
resolution_type: "workflow_improvement"
applies_when:
  - "Migrating a service whose metadata points to durable plans, evidence, or runbooks"
  - "Replacing an implementation under new repository conventions rather than copying it one-to-one"
  - "Closing a migration ticket whose acceptance criteria include external publication or production proof"
tags:
  - "rag"
  - "migration"
  - "referential-integrity"
  - "evidence"
  - "documentation"
---

# Migration manifests need referential integrity and evidence closure

## Failure pattern

The RAG migration copied `source-status.yaml` values such as `slice_file` but
omitted the files those values identified. The implementation test asserted
that a plausible path string was present, so all tests passed while every
resume link was dangling. A related ticket closed while its publication receipt
still described the artifact as prepared but unpublished.

The failure was not in the high-level migration intent. The plan named the
missing directory and required referenced artifacts to exist. The gap appeared
when the concrete file inventory narrowed the scope and validation tested syntax
instead of the producer-consumer relationship.

## Durable rule

A migration manifest is a graph, not a bag of strings. For every migrated
reference:

1. Resolve it from the same root and with the same rules as its consumer.
2. Require the target to be tracked, inside the owning boundary, and of the
   expected type.
3. Test the complete expected inventory when omission would destroy resumable
   work.
4. Validate aggregate views against executable registries so one source cannot
   appear simultaneously completed and proposed.
5. Treat evidence status as a state machine: prepared, published, verified, and
   accepted are distinct observed states.

The discriminating test must fail if the target file is deleted. Checking only
that a field is nonempty or matches `docs/**/*.md` is self-confirming and does
not prove the contract.

## Reimplementation boundary

When the destination intentionally replaces a mechanism, retain a decision map:

- state the historical decision and rationale;
- mark the replaced mechanism as superseded;
- point to the destination's current architecture and operator command;
- preserve capabilities separately from implementation details.

This prevents two opposite errors: restoring an obsolete mechanism merely for
parity, or losing an important workflow because its old script did not fit the
new repository.

## Evidence closure

Never infer an external result from a lower-layer test or a written procedure.
If historical production evidence is missing, say so and schedule a new observed
proof in the feature that can actually perform it. A migration recovery PR may
repair code, documents, and stale claims; it cannot reconstruct a timed rollback,
an endpoint comparison, or an owner acceptance that was never recorded.
