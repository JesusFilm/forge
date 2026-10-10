---
module: Studio authoring
problem_type: workflow-issue
component: creative baseline recovery
tags: [studio, devotional, provenance, recovery, fixtures]
date: 2026-09-07
---

# Recover the creative tree before porting its patch

A handoff patch may depend on months of fork-only work while its accompanying
prose describes a different revision. In feat-452 the patch matched the actual
commit by stable patch ID, yet its stated diff statistics were stale and it
omitted a later volume-path commit. Applying it to current Forge would also
risk replacing newer Workspace lifecycle and transfer controls.

Recover full ancestry into a separate bare clone, pin the merge base and exact
handoff revisions, and preserve a verified self-contained Git bundle. Inventory
archive entries by original-byte SHA-256 and retain paid bytes outside disposable
worktrees. A music manifest is not a render manifest; indexed text is not proof
of the audio's exact speech or voice settings. Keep absent provenance unknown.

Turn saved examples into acceptance fixtures, preserving source hashes separately
from normalized JSON. Reconcile creative differences against the actual caller:
full devotionals no longer deliberately restart their backdrop at reflection,
while episodes do. The approval hash helper can pass every test while its caller
omits a spoken settle line. Test effective speech changes and inspect the calling
control flow, including explicit approval switches that skip other gates.

Historical focused tests can depend on the author's home-directory corpus.
Record the initial failures and use a small, reviewable test-only path adaptation;
do not modify production logic to make archaeology green. Record dependency
versions when borrowing an installed environment instead of reproducing the
historical lockfile. Unit tests and extracted timing arithmetic do not prove
rendered visual behavior.

See [the recovery report](../../plans/2026-09-07-feat-452-lyuba-baseline-recovery.md)
for exact identities, fixtures, commands, and remaining runtime boundaries.
