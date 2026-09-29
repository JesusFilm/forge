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
Both seeded and For You writers use `RECOMMENDATION_SERVED_ITEM_FORMAT`, whose
default is `legacy`. All deployed readers must understand both representations
before changing it to `packed`. In particular, Admin request detail and shadow
evaluation must be deployed and verified first. After the first packed write,
the rollback floor is the first image containing those mixed readers; an older
image will read empty child JSON and can misinterpret historical evidence.

To stop creating packed requests, set the variable back to `legacy`. Existing
packed requests remain readable until normal expiry. An unsupported version or
incomplete item set is rejected at commit, rather than silently reconstructed
from mutable catalog data. Keep the payload and item rows together in the same
transaction.
