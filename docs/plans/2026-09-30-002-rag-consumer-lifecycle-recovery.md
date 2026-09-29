---
title: "RAG consumer recovery and deletion"
type: feat
status: complete
date: 2026-09-30
---

# Scope

Replace the portal's Revoke action with Delete. Show All, Active, and Suspended
filters. Allow an owner to recover a previously revoked consumer using a newly
issued key. Deletion removes a consumer from the directory and frees its name,
while retaining its stable ID, audit trail, and usage history.

# Lifecycle

| Current             | Action                 | Result        | Credential                              |
| ------------------- | ---------------------- | ------------- | --------------------------------------- |
| Active              | Suspend                | Suspended     | Retained; rejected until resume         |
| Suspended           | Resume                 | Active        | Same key works again                    |
| Active or suspended | Delete                 | Deleted       | Permanently invalid                     |
| Revoked (legacy)    | Recover                | Active        | New one-time key; old key stays invalid |
| Revoked (legacy)    | Delete                 | Deleted       | Permanently invalid                     |
| Deleted             | Create with prior name | New active ID | New key; old history stays with old ID  |

Only owners can mutate. Delete requires the name to be typed in the confirmation.
Recovery displays the replacement key once and never retries issuance automatically.
Concurrent owner actions use a lifecycle version to reject stale state changes.
The API stops offering new revocation, while legacy revoked records remain visible
in All and a Revoked filter when present, with Recover and Delete actions.
The Usage page lists deleted UUIDs separately from the management directory so
past reports remain available after name reuse.

# Storage and consistency

Add `deleted_at` and `lifecycle_version` to `consumer_private.consumers`. Replace
the global name uniqueness constraint with a unique index limited to nondeleted
rows. Preserve historical names and UUIDs; reports distinguish reused names by
UUID. A deleted row is excluded from the directory and all owner mutations.
Credential rejection uses both the consumer state and `revoked_at`. Delete and
recover update state, credential and audit atomically under the consumer row lock.
Usage and audit references remain intact, including pending requests whose auth
completed before deletion. A request authenticated before the commit may finish;
the next auth check rejects the old key.

# Verification

Exercise owner authorization, typed confirmation, list filters, active/suspended
delete, revoked recovery, name reuse, old-key denial, audit and usage preservation,
stale versions and concurrent owners. Run RAG HTTP and PostgreSQL integration
checks, typecheck, lint, depcruise, format, and portal load measurement.

## Local result

The migration applied on fresh local RAG and portal databases. Focused
PostgreSQL/HTTP tests passed (16 tests), as did the restricted consumer-role
verifier, schema checks, RAG typecheck/lint/dependency rules, the package unit
suite (907 passed), and the portal and Usage browser suites (two tests each).
The browser checks used synthetic identities and local PostgreSQL. They confirm
typed deletion, old-key denial, revoked recovery's one-time display, retained
historical reports, and the lazy Usage module. No production consumer was
created by this verification.

The authenticated local portal navigation decoded 134,572 bytes across eight
same-origin resources, with a 42 ms load event in one run. The changed startup
HTML and JavaScript total 2,052 bytes more than the branch base; `usage.js`
remains absent from initial navigation and loads once on entering Usage. This is
local load evidence, not a production latency comparison.
