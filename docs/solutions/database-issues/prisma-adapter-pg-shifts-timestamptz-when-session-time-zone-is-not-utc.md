---
title: "@prisma/adapter-pg shifts timestamptz values when the Postgres session time zone is not UTC"
date: 2026-10-07
category: database-issues
module: apps/admin database client
problem_type: database_issue
component: database
related_components:
  - development_workflow
symptoms:
  - "A local admin page showed a time 13 hours late: 'Delete it after 05:34 UTC' where 16:34 UTC was correct"
  - "Plain PrismaClient and psql read a row correctly, but the admin app read the same row 13 hours late"
  - "A Date that admin wrote was stored 13 hours early when psql read it back"
root_cause: config_error
resolution_type: environment_setup
severity: medium
framework_version: "@prisma/adapter-pg 6.19.3, PostgreSQL 17.9 (Homebrew), node 24.14.1"
retire_when: "prisma/prisma#26786 and prisma/orm#28629 fixed in a released @prisma/adapter-pg; after an upgrade, check normalize_timestamptz and formatDateTime in node_modules/@prisma/adapter-pg/dist/index.js"
tags:
  [
    prisma,
    adapter-pg,
    timestamptz,
    timezone,
    local-development,
    homebrew-postgres,
  ]
---

# @prisma/adapter-pg shifts timestamptz values when the Postgres session time zone is not UTC

## Problem

Admin reads and writes Postgres through `@prisma/adapter-pg` (`apps/admin/src/db/client.ts`). The adapter is correct only when the Postgres session time zone is UTC. Homebrew Postgres on a New Zealand Mac uses `Pacific/Auckland`, so every local `timestamptz` value that crossed the adapter was off by the UTC offset (13 hours in October).

## Symptoms

- During a local browser check of the push campaign delete (PR #2603), the refusal said "Delete it after 2026-10-08 05:34 UTC". The correct time was 2026-10-07 16:34 UTC.
- psql and a plain `PrismaClient` (no adapter) read the seeded row correctly. The admin app, through the adapter, read the same row 13 hours late.
- A probe wrote `2026-10-07T10:00:00Z` through the adapter. psql read it back as `2026-10-06T21:00:00Z`, which is 13 hours early. The adapter read it back as `10:00:00Z`, so a round trip through the adapter looked correct.
- The same happened to a `@default(now())` column written through the adapter: psql saw it 13 hours early.

## What Didn't Work

- **Suspecting the feature code.** The wrong time first looked like a bug in the delete's claim-window arithmetic. The unit and real-database tests passed, because they use a plain `PrismaClient`, which reads `timestamptz` correctly.
- **Comparing with a plain client.** A plain `PrismaClient` read the row correctly, so the data seemed right. Only a probe through the adapter itself reproduced the shift.
- **ISO strings instead of `Date` objects.** Upstream threads suggest this, but it does not help in 6.19.3. `mapArg` turns a datetime string back into a `Date` before it formats it (`node_modules/@prisma/adapter-pg/dist/index.js:371-373`).

## Solution

For a local admin server or script that uses the adapter, make the session time zone UTC. Use the libpq `options` parameter on the connection string:

```bash
DATABASE_URL="postgresql://forge@localhost:5432/<db>?options=-c%20TimeZone%3DUTC"
```

Other ways to get the same result:

- Set the database default with `ALTER DATABASE <db> SET timezone TO 'UTC'`. New sessions then start in UTC.
- Set `timezone = 'UTC'` in the Homebrew server's `postgresql.conf`.

After the change, the adapter read the seeded row as `2026-10-06T20:33:13Z`, the same instant that psql showed.

## Why This Works

The adapter assumes that the session prints and parses `timestamptz` in UTC. In 6.19.3, both directions depend on that assumption:

- **Read.** Postgres prints a `timestamptz` in the session zone, for example `2026-10-07 09:33:13+13`. `normalize_timestamptz` replaces whatever offset is there with `+00:00` (`dist/index.js:306-308`). The wall-clock time stays and the offset is lost, so the value is late by the offset.
- **Write.** `formatDateTime` sends the UTC wall-clock time with no offset, such as `2026-10-07 10:00:00` (`dist/index.js:396-400`). Postgres reads a value with no offset in the session zone, so it stores an instant that is early by the offset.

The two errors cancel out on a round trip through the adapter. So the app looks correct, but stored instants are wrong. Any other path disagrees by the offset: `now()`, database defaults, triggers, raw SQL comparisons, psql, and a plain `PrismaClient`. In a UTC session there is no offset, so both functions are correct.

## Prevention

- Use a UTC session for every database that the adapter talks to. The official Docker Postgres image defaults to UTC. A Homebrew server takes the Mac's zone. This session did not check the production database's setting.
- When a local time is off by exactly the UTC offset, check the session time zone first with `SHOW timezone` before you debug feature code.
- Test time logic through the client that production uses. The push suites use a plain `PrismaClient`, which reads correctly in any session zone, so they cannot catch this.
- To make admin safe on any server, the pool config could pin the session (`options: "-c TimeZone=UTC"` in `apps/admin/src/db/prisma-pool-config.ts`, which sets no session options today). This was not changed in this work.

## Related Issues

- Upstream reports, as of 2026-10-07: [prisma/prisma#26786](https://github.com/prisma/prisma/issues/26786) (open), [prisma/orm#28629](https://github.com/prisma/orm/issues/28629) (open), and [prisma/prisma#27590](https://github.com/prisma/prisma/issues/27590) (closed; 6.19.3 still shows the behavior above).
- `docs/solutions/database-issues/prisma-raw-serialization-retry-and-token-error-boundaries-20260916.md`: another place where PrismaPg needs connection `options`.
- `docs/solutions/developer-experience/admin-prod-video-snapshot-local-restore-20260521.md`: the local admin database setup.
- `docs/solutions/database-issues/guarded-delete-of-a-parent-with-restricted-report-rows.md`: the delete whose local check exposed the shift.
