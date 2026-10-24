---
title: "Repair PR 752 subtitle artifact review integrity"
type: fix
status: in-progress
date: 2026-10-24
---

Bounded local repair of feat-081 against pinned main ac7b6483488db3d84745ea7775fe0fda05ae51d0. Original head 3fb2aa62c01b8892847e0328b88e6b6bb30d21ec remains an ancestor through normal merge. Four findings and validation contract live in the 752-subtitle-editor-security-review-r1 evidence packet.

Admin owns cross-process conditional artifact transitions. Review create, consume and save compare the complete observed manifest and asset identity; stale comparisons retry with fresh state. Ordinary job updates preserve review-owned records under the same database row lock. Demo state mirrors conditional behavior but remains single-process only. No topology assumption replaces Admin atomicity.

Reviewed object identities bind job, source, request and bytes. Conditional publication and digest verification protect acknowledged revisions and ambiguous persistence retries. Generated and historical names remain readable. Save IDs replay only equal requests. Client request ownership survives viewport changes and StrictMode; dirty drafts clear only for an acknowledged submitted snapshot. Bound the existing API and VTT resource surfaces.

Validation: exact four regression cases; independent-process conditional transitions and artifact interleavings; immutable writes and persistence failure recovery; role/origin/config/token matrix; targeted Manager/editor/Admin and artifact/Mux tests, typecheck, lint, format, SDL/client drift and pin checks; real browser edit/save/reload/conflict/draft preservation with matched load/resource evidence. No paid provider, live database, publication, activation, push or deploy. Candidate requires a fresh parent-assigned independent review.

## Independent review corrections (implementation r2)

Repair only 752-IR1-F1/P2 and 752-IR1-F2/P2 from the exact-tree independent
review of 80e24c0076dedfee9eab5bec70eae38863956026. A different launch must
invalidate active capability/base/save intent; retain old dirty text separately
for explicit disposition. Save and reload responses belong to their successful
initialization owner. Same/equivalent props, StrictMode, viewport changes and
same-owner error recovery retain their existing behavior.

Unverified job/code inputs must not reserve verified-job limiter capacity.
Use separate bounded rejected-request accounting, preserving verified per-job
attempt limits, pruning and capacity. Test 1024 invalid IDs followed by a valid
new launch, invalid known jobs, repeated failures, verified saturation and expiry.
The limiter is process-local cache admission, not a deployed DoS guarantee.

Add colocated component/service regressions and rerun the actual service and
native-browser fixtures with pre-navigation egress containment and native crypto.
Record exact before/after commands, load/resource comparison and limitations in
`752-launch-ownership-limiter-implementation-r2`. Parent assigns a new independent
review before publication. Overall feat-794 remains in progress, draft/config-off.
