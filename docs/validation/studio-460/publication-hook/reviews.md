# Fixed-base independent reviews

Base: `f3db6c7010824f4e3174d4b3ea3373505dd77438`.
Reviewed staged internal slice in its isolated worktree; no implementation
commits existed at review time. Command: `git diff --cached <base>`.
Two independent read-only reviewers received the agreed dependency-slice scope,
repo guides, roadmap/plan context, and durable seam contract.

## Standards

No documented-standard violations. Admin owns authorization and persistence;
portable contracts stay runtime-neutral; consumption, verification, latch and
receipt share a transaction; no public publication surface was added.

One nonblocking maintainability suggestion: publication error literals duplicated
the portable failure union. Applied by importing `StudioPublicationFailure` into
the `StudioCommandError` code union, preserving the accepted error set.

## Spec

No actionable findings. Confirmed trusted service/callback authority, full
scheduled envelope validation, mandatory verifier, receipt-first semantics,
server-time window, project-before-hook locking, rollback and unpublish retry.
Calendar authorization storage and full460 catalog/readiness/render/Watch gates
remain explicit obligations rather than claimed completed behavior.

Neither reviewer ran external operations or substituted review for functional
acceptance. These reviews cover the internal dependency slice only.

## Window-wait correction review

After the initial reviews, root identified expiration during callback waits.
Both independent reviewers rechecked the bounded correction. Standards found no
issues: one shared assertion, typed rollback, and clear timestamp semantics.
Spec confirmed fresh checks after hook, verifier and receipt writes, rollback,
receipt-first retry, and the documented limit before actual commit. Neither axis
reported a remaining finding.
