# Strict stored-expiry manual retention

The two operator entry paths currently invoke the ordinary scheduled purge. That
also performs age/status-based maintenance without a persisted expiry, contrary
to the owner's limit for manual cleanup.

Keep the ordinary scheduler unchanged. Route the Admin button workflow and the
deployed `--expired-only` command through an internal strict mode that skips
age/status-only precomputed generation and object-store cleanup, orphan-vector
sweeping, old refresh metadata and retired-profile deletion. Continue bounded
deletion of rows with elapsed stored expiry and dependent children required to
remove those roots atomically. Keep the existing guarded page for expired
precomputed retention proofs; preserve proofs held by capture artifacts or
bound imports. Finalize an otherwise unreported baseline run in manual mode
only when the run or one of its visits has reached stored expiry. Do not let a
previously persisted manual workflow
input default back into ordinary mode after deployment.

Pin the behavior with focused manual/scheduler routing tests and a regression
test proving strict mode leaves age-only work while an expired root is still
processed. Run Admin format, typecheck, lint and focused tests; then publish a
scoped PR for independent review. Resume no production cleanup from this plan.
