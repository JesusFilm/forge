# Served recommendation snapshot format

`recommendation_request.served_item_payload` is nullable. A null value means
every `recommendation_served_item` row holds its original `presentation` and
`candidate_provenance` JSON. Version 1 stores those exact JSON objects in one
request-level payload under `items[item.id]`; child rows retain their IDs,
position, media identity, capability, signing key, timestamps, foreign keys and
other relational data. Child JSON columns contain `{}`. The request and child
rows retain their normal 29-day expiry and deletion path. Existing rows are not
rewritten.
Single-item requests stay in the legacy inline format because the parent payload
cost exceeds any savings at that size.

The database migration adds a deferred integrity check for payload version,
membership, JSON shape, child placeholders, expected count and equal expiry.
Both seeded and For You writers use `RECOMMENDATION_SERVED_ITEM_FORMAT`. Its
default is `packed`; an explicit `legacy` override stops new packed writes. The
default change is a separate PR-to-main activation step after profile-vector
sharing has been observed in production. Before deploying it, verify migration
`0117` is applied, all HTTP and worker replicas and the rollback image contain
mixed readers, and Admin request detail and shadow evaluation read both shapes.
Record the effective format on each role: an existing explicit `legacy` service
variable overrides the new default until it is removed or changed. Keep a
reader-capable rollback image; an older image can read empty child JSON and
misinterpret historical evidence after the first packed write.

Before and after activation, timestamp aggregate counts of legacy and packed
requests (including single-item requests), request/item relation and TOAST
bytes, WAL, available filesystem bytes, write/error latency, and retention
backlog. Verify a bounded new multi-item seeded and For You sample has exactly
the same issued item identities, positions, capabilities, expiry, presentation
and provenance through both Admin detail and shadow readers. Check that new
single-item requests remain inline. Keep request identities and payloads out of
the evidence report. Local storage reductions are sensitivity evidence, not a
production saving until observed with these measurements.

To stop creating packed requests, set the variable to `legacy` on both roles and
verify their effective values after the normal deployment. Existing
packed requests remain readable until normal expiry. An unsupported version or
incomplete item set is rejected at commit, rather than silently reconstructed
from mutable catalog data. Keep the payload and item rows together in the same
transaction.
