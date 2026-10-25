---
module: Studio rendering
problem_type: security_issue
tags: [studio, delegated, rendering, scopes, retention]
date: 2026-09-23
---

# Delegated draft renders retain separate admission and worker authority

`shorts:render` admits private draft rendering; `shorts:read` reads exact attempts
and refreshes short-lived output access. Do not route render admission through the
older generic `shorts:chat` request: that request accepts only `GENERATION`.
The persisted actor stays delegated, including the OAuth client identity. No
interactive reviewer is synthesized, and no render tool approves or publishes.

The admission receipt is durable before source preparation or execution. The
existing worker scan recovers the crash window before enqueueing. A narrow
server-only admission option permits canonical source descriptors; workers invoke
`prepareStudioRenderSources` and then `prepareStudioRenderInput`. Materialization
adds trusted retained byte identities without editing the admitted human revision.
Source eligibility and broker codec proofs are rechecked during preparation.

Migration 0101 retains the materialized document and original input hash against
its exact issued lease. The trusted worker records this before returning prepared
bytes and reuses the pinned document after response loss. Validation permits only
video preview/export handle changes, compares the original and prepared catalog
and download identities, and checks current source eligibility plus fresh lease
expiry after catalog-lock waits. The database makes this evidence immutable and
retains its asset references. Catalog staging and publication resolve sources only
from the admitted successful execution's preparation. Losing leases never supply
publication source authority. Historic renders without preparation still pass the
original strict retained-source check; descriptor-backed renders cannot use that
fallback. Human approval continues to hash the original revision and exact output.

Read results identify the admitted revision, attempt and input hash. A later human
edit marks old output stale while leaving it readable. Byte access is issued from
the exact immutable manifest and never stored in project history. Refresh requires
fresh delegated authentication and current operator membership; an already-issued
bearer capability has its existing five-minute lifetime.

Migration 0099 fixes an exact-profile comparison in `short_attach_render_asset`:
0094 compared `shorts-render-1/...` while the versioned runtime profile is
`studio-render-1/...`. This mismatch skipped both retention and producer/lease
validation. Never rewrite the applied migration or rename the runtime profile to
fit it. The real database regression registers output as a worker, proves its
retention edge, and rejects forged human provenance. Historical audit/repair is a
separate operator-authorized operation (feat-549), not a side effect of the fix.

New Auth scope deployment also requires the normal first-party scope seeding and
fresh user consent. Existing grants do not silently acquire rendering permission.
