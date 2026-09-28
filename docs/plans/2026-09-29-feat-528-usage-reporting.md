# Feat-528 implementation scope

Implement programme plan C and applicable E through three confirmed seams:
real HTTP search/report responses, the public accounting/report store API, and
isolated database-role permissions. Review baseline: `2787f5300`.

Use separate raw-SQL metadata tables and aggregate-only reader views, a pure
usage port, PostgreSQL adapter and transport-aware serving collector. Atomic
admission/completion provides exact normal-operation counts; telemetry failures
remain visible through durable gaps and conservative pending-state coverage.
UTC windows are minute-aligned and bounded to 31 days. Report capabilities are
independent of consumer credentials and ownership, initially only Jaco/RAGBot.
RAGBot registration through the portal remains an activation prerequisite.

Verification: vertical red/green tests at the confirmed seams, regular typechecks,
RAG lint/import-law checks, disposable PostgreSQL accounting and privilege tests,
then full RAG suite and separate standards/spec reviews. No frontend runtime
change, production operation, shared-token cutoff or cross-app contract change.

Capacity and fleet inventory follow-up is feat-563. Provisioning and recovery
instructions live in `apps/rag/docs/ops/consumer-usage.md`. Durable learning:
transport completion must be observed below the Fetch response abstraction;
a heartbeat proves only the instance emitting it, not deployment inventory.

Review correction: require independent deployment inventory (deployment ID,
interval and expected replicas) held behind a separate operator capability.
Reports compare every boundary with that inventory and fail closed on missing or
undeclared collectors. Serving cannot rewrite expectations. Closed flushed
windows retain historical coverage after a later outage. Failure acceptance
forces real admission, completion, checkpoint and gap writes to fail/recover.
