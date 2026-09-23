# Feat-464 acceptance evidence — September 23, 2026

The [acceptance record](../../operations/recommendation-evidence-acceptance-2026-09-23.md)
interprets these sanitized observations and preserves unpassed gates.

## Local proof

- `browser-stack.json`: eight joined Chrome/Web/Admin/PostgreSQL controls,
  recorded before component unmount. `requests` are proxy-observed server
  attempts; `browser.observations` are JavaScript-visible responses. The browser
  can transparently retry a dropped socket, so the two lists need not match.
- `local-durable.json`: later direct SQL snapshot after unmount. It includes
  departure events; do not force equality with the earlier browser snapshot.
- `local-validation.json`: real Redis/PostgreSQL/Yoga test observations and
  negative-control result. Source hashes identify the one-off scratch harness;
  it is not a new supported test framework or a reproducible source bundle.
- `audit-initial.json`: complete canonical read-only production pointer audit
  before the fixed acceptance interval, not its final audit.

The reusable regression is
`apps/admin/src/graphql/plugins/rate-limit-recovery.db.test.ts`. Run it from the
repository root with Docker available:

```sh
RECOMMENDATION_DB_TEST=1 RECOMMENDATION_REDIS_TEST=1 pnpm --filter @forge/admin exec vitest run src/graphql/plugins/rate-limit-recovery.db.test.ts
```

The joined fixture used production Next builds, full migrations, separate owned
Web/Admin Redis, loopback ports and synthetic local consumer credentials. Exact
payload controls used binary fractions to avoid conflating transport replay with
the separately documented numeric JSON round-trip diagnostic. All local services
were removed after capture. No production fault or database mutation was used.

## Production collection

The fixed interval is September 23, 04:30 inclusive–06:30 exclusive UTC. Final
collection is pending; no partial interval is represented as two hours.

Primary HTTP collection pins the Railway deployment, explicitly enumerates exact
recommendation paths, recursively splits capped anchor slices, clips the interval,
checks duplicate request IDs and exports only counts plus an ID-set digest.
Railway outcome logs are collected in bounded non-overlapping slices. A complete
collection means the source did not hit a result cap; it does not establish that
every response has a corresponding structured log.

Durable reads use repeatable-read, read-only snapshots, five-second statement and
500 ms lock limits, a finite overall deadline, and explicit rollback. Fact receipt
time, replay observation time, episode creation time, HTTP request counts and
structured batch counts describe different populations.

Only aggregate outcomes, public deployment identifiers and local synthetic
scenario labels are published. Credentials, cookies, capabilities, event/episode/
profile/session identifiers, viewer histories, IP addresses and raw logs are
excluded.
