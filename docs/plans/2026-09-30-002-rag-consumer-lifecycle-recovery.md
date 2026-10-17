---
title: "RAG consumer revocation and restoration"
type: feat
status: complete
date: 2026-09-30
---

# Scope

The consumer directory has Active, Suspended, and Revoked states. Owners can
revoke an active or suspended consumer after confirmation. Revocation immediately
invalidates the current key, keeps the consumer visible, and keeps its name
globally reserved. Owners can restore a revoked consumer with a newly issued
one-time key. There is no consumer deletion action or name reuse.

# Lifecycle

| Current             | Action               | Result    | Credential                              |
| ------------------- | -------------------- | --------- | --------------------------------------- |
| Active              | Suspend              | Suspended | Retained; rejected until resume         |
| Suspended           | Resume               | Active    | Same key works again                    |
| Active or suspended | Revoke               | Revoked   | Permanently invalid                     |
| Revoked             | Restore with new key | Active    | New one-time key; old key stays invalid |

Only owners can mutate. Revocation requires confirmation and explains that
the name stays reserved. Restoration displays the replacement key once; the
consumer appears in Active after the key dialog closes. Issuance never retries
automatically. Concurrent owner actions use a lifecycle version to reject
stale state changes. All three state filters remain visible, including when a
filter has no results.

# Storage and consistency

Add `lifecycle_version` to `consumer_private.consumers`. Keep the global unique
name constraint and stable UUID. Revocation and restoration update consumer
state, credential, and audit atomically under the consumer row lock. Credential
rejection uses both state and `revoked_at`; restoration replaces the verifier
and clears `revoked_at` only for the new key. Usage and audit history remain
attached to the same UUID. A request authenticated before a revoke commit may
finish; the next auth check rejects the old key.

# Verification

Exercise owner authorization, state filters, active and suspended revocation,
restoration, name reservation, old-key denial, usage/audit retention, stale
versions, and concurrent owners. Run RAG HTTP and PostgreSQL integration checks,
typecheck, lint, depcruise, format, and portal load measurement.

## Local result

The revised migration applied to a fresh local PostgreSQL database. Focused
PostgreSQL and HTTP tests passed, including suspended revocation, restoration,
old-key denial, name reservation, and audit/usage retention. The restricted
consumer roles passed verification. The portal and Usage browser suites passed
with synthetic identities and local PostgreSQL. The RAG package passed typecheck,
lint, dependency rules, schema checks, and its 907-test unit suite.

The browser captured confirmation, revoked-row action, and restored-active
screenshots without an API key. Authenticated cold navigation decoded 134,142
bytes across eight same-origin resources and reached the load event in 43 ms in
one local run; the Usage module remained lazy loaded. This is local load evidence,
not a production latency comparison.
