---
title: Bound shared Redis cache cleanup
type: fix
status: completed
date: 2026-09-16
roadmap: feat-496
---

# Bound shared Redis cache cleanup

Production Redis SLOWLOG confirms that the Web cache handler sends HDEL commands
with 430,486–542,713 fields. Individual commands took 210–368 ms, exceeding the
250 ms recommendation admission command budget on the same Redis server.
The maintained cache handler scans in pages but accumulates all expired or
matching entries before sending unbounded UNLINK and HDEL commands.

This is a confirmed contention hazard. Its recorded timestamps do not coincide
with the latest 02:55/05:51 admission failures, so fixing it must not be described
as resolving every remaining timeout. Selection's separate 700 ms Web-to-Admin
timeouts also remain outside this patch.

## Scope and approach

- Reproduce realistic metadata cleanup on isolated local Redis while a separate
  Node worker samples TIME latency. Production cache data remains unchanged by
  diagnostic probes; any temporary latency-monitor setting must be restored.
- Patch the pinned cache-handler dependency's Redis string handler to delete
  bounded batches, awaiting each batch before submitting the next. Preserve
  both metadata hashes, cache invalidation semantics and existing timeout
  limits. Cover ESM and CommonJS exports.
- Use smaller scan pages only if measurement identifies scan contention; do not
  conflate scan and delete changes in the initial experiment.
- Retain the existing Redis instance, recommendation admission limits, TTLs,
  cache keys and serializers. No schema, mobile/TV, authored homepage or flag
  changes. No new public diagnostics endpoint.

## Validation and release

- Tests cover all matching/expired entries including a final partial batch,
  unrelated live entries, and stopping further commands after timeout/failure.
- Compare worker-observed Redis latency before/after realistic cleanup, and
  verify preserved cache reads, writes and invalidation on real Redis.
- Run Web tests, types, lint, build, format and PR checks; review correctness,
  maintainability, data mutation safety, performance and dependency patch use.
- Merge through the normal PR/main deployment flow; verify the exact deployed
  revision, normal production playback and admission outcomes.
- Compound the confirmed mechanism and record remaining unconfirmed causes in
  the recovery report; keep feat-496 in progress until those are resolved.

## Release result

PR #2311 merged the patch; PR #2312 repaired the unrelated Expo CI failure that
blocked Web's automatic deployment. Web revision
`0a1c585998a6dbb4bf1399fe4c5eed25310a5512` reached SUCCESS at 23:43:15 UTC on
September 15. Both installed exports and the production playback smoke passed.
See `docs/operations/watch-runtime-followup-2026-09-16.md` for release evidence
and remaining investigation limits. feat-496 remains in progress.
