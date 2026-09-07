# Isolated internal publication hook validation

Fixed base: `f3db6c7010824f4e3174d4b3ea3373505dd77438` (reviewed root999b81e9 equivalent).
The isolated worktree has its own frozen dependency installation and generated
Prisma client. Fresh owned loopback database
`127.0.0.1:55460/forge_studio_460_publication_base` contains reviewed migrations
only through0082. No460 schema, render jobs, catalog readiness or playback
implementation is present in this validation tree.

`initial-red.log`: two scheduled-hook cases fail against the original internal
command. `envelope-red.log`: a malformed trusted scheduled envelope incorrectly
succeeds without release/readiness before strict runtime parsing is added.

The final regression uses the real command/asset/approval services and database.
Its injected callback writes a durable transaction marker. A separate connection
receives PostgreSQL55P03 from `FOR UPDATE NOWAIT`, proving the project lock is
already held when the callback runs. Exact accepted retry after unpublish skips
both callback and verifier. Verifier rejection rolls back the marker and receipt.
Missing callback/verifier, delegated human authority, mismatched server envelope,
missing release/readiness, future and expired windows fail closed.

Fixtures deliberately use a transaction-only manifest and injected verifier.
They prove internal orchestration, not rendering, catalog visibility, provider
readiness, calendar authorization storage, or public revocation. The full460
acceptance gates remain open. No provider or infrastructure operations are used.

Final validation: internal hook/authority8 tests, complete portable contracts15,
and existing foundation command database suite12 passed. Admin and contracts
TypeScript checks passed. The existing foundation suite uses an owned database
clone named `forge_studio_454_test_460_publication_regression` on the same55460
server so its existing safety guard accepts the fixture; no guard was weakened.
Independent fixed-base Standards and Spec reviews found no blocking findings.
The Standards suggestion to reuse the portable failure union was applied.

`window-red.log` reproduces acceptance after the authorized window while either
the hook or final verifier waits. The final green cases reject both and roll
back durable consumption/verifier markers, latch and receipt. Fresh checks also
run after receipt persistence before callback return. Database commit latency
remains outside that decision; no commit-instant guarantee is claimed.
