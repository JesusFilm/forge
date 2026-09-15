---
title: "Mastra chat deletion must cover background writers"
date: "2026-09-11"
category: "architecture-patterns"
module: "apps/mastra"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
applies_when:
  - "Deleting persisted chat while native SDK title or message work can still finish"
  - "Evaluating whether an SDK delete can replace the conversation lifecycle transaction"
  - "Upgrading the SDK or changing the storage paths used by background writers"
tags:
  - "mastra"
  - "chat-deletion"
  - "postgresql"
  - "concurrency"
  - "background-writers"
  - "native-sdk"
  - "deletion-record"
---

# Mastra chat deletion must cover background writers

## Context

Removing existing content and preventing its later recreation are different
requirements. Feature 247 requires deletion to proceed despite unfinished model
or background work, with bounded database waits. A successful SDK thread delete
alone cannot establish the second guarantee: a delayed native title save can
upsert the same thread after it has disappeared.

This learning captures the reasoning behind the **pending PR1 implementation**,
locally verified on 2026-09-10 with PostgreSQL 18.6 and the installed
`@mastra/core` 1.64.0, `@mastra/memory` 1.28.2 and `@mastra/pg` 1.22.3.
It does not claim production activation or completion of feature 247.

## Guidance

Treat the writer boundary as part of deletion. Enumerate native SDK persistence,
including automatic titles and message upserts, before choosing the enforcement
point. Protecting only the application handler leaves those internal writes
outside the guarantee.

This guarantee requires installed guards that pass readiness checks and the
supported PostgreSQL thread/message storage configuration. Vector storage,
semantic recall, working memory and observational memory are not covered;
the lifecycle operation refuses unsupported configurations. Extend deletion
coverage before enabling any of those stores.

The pending implementation combines three controls:

1. A globally keyed lifecycle record retains the conversation ID, exact owner
   resource ID and coordination state after content disappears. A deleted record
   contains no title, messages or deletion timestamp. Reserving an absent ID also
   covers deletion that wins before the first native save.
2. One transaction checks ownership, locks lifecycle and content, marks deletion,
   and removes messages/thread together. Success is returned only after observed
   commit. Direct SQL gives this operation control over its own record and native
   rows in the same transaction; merely wrapping an SDK call with a flag does not.
3. PostgreSQL INSERT triggers, including the INSERT arm of an upsert, check the
   lifecycle record under a shared row lock. Deletion takes an exclusive row lock
   on that record. The check and write therefore cannot straddle a committed
   deletion. UPDATE guards separately forbid changing thread/message identity;
   a cascading foreign key enforces message-parent integrity.

Conceptual ordering, not a standalone migration recipe:

```text
Writer first:  hold shared lifecycle lock -> write -> commit
Deletion:      wait for writer -> lock -> mark deleted + remove content -> commit

Deletion first: lock -> mark deleted + remove content -> commit
Late INSERT:   inspect deleted record under lock -> refuse
```

A lock timeout is a failed attempt, not successful deletion. No transaction is
held across model generation. The transaction's connection "lease" is simply a
borrowed pool connection with a deadline; it is separate from PostgreSQL row
locking. Cancellation of model work is not the correctness mechanism.

## Why This Matters

The tempting simplification is to replace this with an SDK delete because both
leave an empty thread list in a sequential test. That test misses the outstanding
writer. A check-before-save in application code also leaves a gap between its
check and persistence, even before considering SDK paths that bypass it.

The deletion record must outlive ordinary retention. Subject Erasure deliberately
removes exact-owner records even when no thread remains; that accepted exception
removes recreation protection and allows a later same-owner save. It never permits
reassigning another owner's existing identity. These are different cleanup
contracts, so replacing all three with one generic delete would lose semantics.

## When to Apply

Use this reasoning when deletion must remain effective while independent writers
can finish. An SDK delete can be sufficient when the required outcome is only to
remove currently stored content and all relevant future writes are prevented by
some other proven mechanism. Database triggers are the selected enforcement point
for this SDK integration, not a universal requirement for every delete operation.

The plan's [alternatives discussion](../../plans/2026-09-09-0438-feat-chat-conversation-delete-plan.md#alternatives-and-future-evolution)
also retained option C as viable: server-issued conversation IDs, with
continuations forbidden from automatically recreating missing conversations.
That requires a broader creation API/protocol change, client ID handling,
issuance retries and rollout for old clients. Option B remains the approved
design; moving to C is not approved, and any future transition must retain B's
records until all remaining recreation paths are closed.

## Examples

The durable regression is an actual SDK persistence sequence, not mocked SQL:

- Start native automatic title generation with a controllable model fixture.
- Wait until the reply is persisted and title generation is pending.
- Commit deletion, then release the title result.
- Assert that the thread and messages remain absent and the deleted record remains.

A separate race leaves an **orphan message**, rather than recreating the thread:
a native message save can pass its parent/thread existence check, pause while
deletion commits, then insert a message whose parent is gone without database
protection. The real SDK/PostgreSQL regression named "refuses saveMessages paused
after its real existence read, without an orphan" holds the result of the actual
parent read, commits deletion, then resumes the save. With protection installed,
the save rejects, both content tables remain empty for that conversation, and
the deleted record remains.

The PostgreSQL suite also exercises both first-creation orderings. For the
creation-first case, its test-only AFTER INSERT barrier holds the native writer;
`pg_blocking_pids` proves the exact waiting deletion before the test releases it.
A sleep cannot prove that ordering. Native message-ID collision tests assert an
identity error and unchanged original ownership, because the SDK upsert rewrites
identity fields on conflict.

On SDK upgrades, retain these tests and inspect the real writer paths. Passing
mocked storage tests or testing only raw UPDATE statements does not demonstrate
that the native upsert/background paths remain covered.

## Related

- [Lifecycle transaction](../../../apps/mastra/src/mastra/ai-chat-conversation-lifecycle.ts): `deleteAiChatConversation` and `runAiChatLifecycleTransaction`.
- [PostgreSQL guards](../../../apps/mastra/chat-migrations/001-conversation-deletion.sql): INSERT guards, immutable identities and parent constraint.
- [Real SDK/PostgreSQL tests](../../../apps/mastra/src/mastra/ai-chat-conversation-lifecycle.smoke.test.ts): automatic title, orphan-message race, both creation orderings, rollback and owner collisions.
- [Operational runbook](../../runbooks/ai-chat-conversation-lifecycle.md): deployment-before-migration, readiness, pause/drain and exact-current restore.
- [Approved feature 247 plan](../../plans/2026-09-09-0438-feat-chat-conversation-delete-plan.md): U1/U2 and storage-cleanup U5; later API and UI work remains separate.
