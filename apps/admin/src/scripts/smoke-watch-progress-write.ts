/**
 * Real-DB smoke for the watch-progress batch write.
 *
 * `upsertWatchProgress` is one raw `INSERT … unnest(…) ON CONFLICT … WHERE …
 * RETURNING`. Its unit tests mock `$queryRaw`, so they pin the clause SHAPE
 * and the bound arrays but cannot prove Postgres accepts the statement, that
 * the `::int` / `::boolean` / timestamp casts resolve, or that the staleness
 * guard actually rejects an older write. Only a live database shows that, and
 * no CI job runs one — so this is an operator smoke, run against a local DB
 * after touching the statement.
 *
 *   DATABASE_URL='postgresql://forge:forge@localhost:5433/forge_admin' \
 *   pnpm --filter @forge/admin smoke:watch-progress-write
 *
 * Writes rows under a synthetic `userId` and deletes them before exiting.
 * Refuses production-like hosts, matching `seed-web-fixtures`.
 */

import { prisma } from "@/db/client"
import {
  listWatchProgress,
  upsertWatchProgress,
} from "@/services/watch-progress.service"

const PROD_HOST_DENY_SET = new Set<string>([
  "admin.jesusfilm.org",
  "www.jesusfilm.org",
  "jesusfilm.org",
  "manager.jesusfilm.org",
  "web.jesusfilm.org",
])

function isProdDatabaseUrl(rawUrl: string): {
  isProd: boolean
  reason: string
} {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    // Fail-closed: if we can't parse the URL we can't prove it's local.
    return { isProd: true, reason: "DATABASE_URL is not a parseable URL" }
  }
  const host = parsed.hostname.toLowerCase()
  if (host.endsWith(".railway.app")) {
    return { isProd: true, reason: `host ${host} ends with .railway.app` }
  }
  if (host.endsWith(".jesusfilm.org")) {
    return { isProd: true, reason: `host ${host} ends with .jesusfilm.org` }
  }
  if (PROD_HOST_DENY_SET.has(host)) {
    return { isProd: true, reason: `host ${host} is on the prod deny set` }
  }
  return { isProd: false, reason: "" }
}

const USER = `smoke-watch-progress-${Date.now()}`
let failures = 0

function check(label: string, ok: boolean, detail?: unknown) {
  const suffix = ok ? "" : `  -> ${JSON.stringify(detail)}`
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`)
  if (!ok) failures += 1
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? ""
  const guard = isProdDatabaseUrl(databaseUrl)
  if (guard.isProd) {
    console.error(
      `refusing to run against a production database: ${guard.reason}`,
    )
    process.exit(1)
  }

  const videos = await prisma.video.findMany({
    where: { deletedAt: null },
    select: { id: true },
    take: 3,
  })
  if (videos.length < 3) {
    throw new Error(
      `need at least 3 non-deleted videos, found ${videos.length}`,
    )
  }
  const [a, b, c] = videos.map((video) => video.id)

  const first = await upsertWatchProgress({
    userId: USER,
    entries: [
      {
        videoId: a,
        languageSlug: "english",
        positionSeconds: 30,
        durationSeconds: 100,
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      {
        videoId: b,
        languageSlug: null,
        positionSeconds: 95,
        durationSeconds: 100,
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      {
        videoId: c,
        languageSlug: "spanish-castilian",
        positionSeconds: 10,
        durationSeconds: 100,
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ],
  })
  check("one statement writes the whole batch", first.length === 3, first)
  check(
    "90 percent marks completed",
    first.find((r) => r.videoId === b)?.completed === true,
  )
  check(
    "null languageSlug round-trips as null",
    first.find((r) => r.videoId === b)?.languageSlug === null,
  )
  check(
    "timestamp round-trips UTC-exact",
    first.find((r) => r.videoId === a)?.updatedAt ===
      "2026-07-02T00:00:00.000Z",
    first.find((r) => r.videoId === a)?.updatedAt,
  )

  const stale = await upsertWatchProgress({
    userId: USER,
    entries: [
      {
        videoId: a,
        positionSeconds: 5,
        durationSeconds: 100,
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
  })
  check("an older write is reported as dropped", stale.length === 0, stale)
  const afterStale = await listWatchProgress({ userId: USER })
  check(
    "an older write does not rewind the stored position",
    afterStale.find((r) => r.videoId === a)?.positionSeconds === 30,
    afterStale.find((r) => r.videoId === a),
  )

  const newer = await upsertWatchProgress({
    userId: USER,
    entries: [
      {
        videoId: a,
        languageSlug: "english",
        positionSeconds: 60,
        durationSeconds: 100,
        updatedAt: "2026-07-03T00:00:00.000Z",
      },
    ],
  })
  check(
    "a newer write is accepted",
    newer.length === 1 && newer[0]?.positionSeconds === 60,
    newer,
  )

  // `<=`, not `<`: a client retry of the same batch must not read as a drop.
  const equal = await upsertWatchProgress({
    userId: USER,
    entries: [
      {
        videoId: a,
        languageSlug: "english",
        positionSeconds: 61,
        durationSeconds: 100,
        updatedAt: "2026-07-03T00:00:00.000Z",
      },
    ],
  })
  check("an equal-timestamp rewrite is admitted", equal.length === 1, equal)

  // The case the explicit `AT TIME ZONE 'UTC'` exists for: a bare
  // `::timestamptz` shifts by the session offset here and nowhere else.
  await prisma.$executeRawUnsafe(`SET TIME ZONE 'Pacific/Auckland'`)
  const tzResult = await upsertWatchProgress({
    userId: USER,
    entries: [
      {
        videoId: c,
        positionSeconds: 40,
        durationSeconds: 100,
        updatedAt: "2026-07-04T05:06:07.000Z",
      },
    ],
  })
  check(
    "timestamp is UTC-exact under a non-UTC session timezone",
    tzResult[0]?.updatedAt === "2026-07-04T05:06:07.000Z",
    tzResult[0]?.updatedAt,
  )
  await prisma.$executeRawUnsafe(`SET TIME ZONE 'UTC'`)

  const none = await upsertWatchProgress({ userId: USER, entries: [] })
  check("an empty batch emits no statement", none.length === 0)

  await prisma.watchProgress.deleteMany({ where: { userId: USER } })
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error("smoke threw:", error)
  await prisma.watchProgress
    .deleteMany({ where: { userId: USER } })
    .catch(() => {})
  process.exit(1)
})
