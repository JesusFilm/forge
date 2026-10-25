/**
 * Real-DB smoke for the watch-progress erasure route's contract.
 *
 * Two callers share `DELETE /api/internal/watch-progress`: apps/auth erases
 * everything for an account deletion, apps/web erases only resume positions
 * when a user clears their own history. The route's unit tests mock both
 * delete services, so they pin the branch but cannot prove the rows actually
 * behave that way — or that the two deletes really commit together. This
 * drives the real services against Postgres.
 *
 *   DATABASE_URL='postgresql://forge:forge@localhost:5433/forge_admin' \
 *   pnpm --filter @forge/admin smoke:watch-progress-erasure
 *
 * Writes rows under a synthetic userId and removes them before exiting.
 * Refuses production-like hosts, matching the sibling write smoke.
 */

import { prisma } from "@/db/client"
import { deleteWatchEventsForUser } from "@/services/watch-events.service"
import {
  deleteWatchProgressForUser,
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

const USER = `smoke-erasure-${Date.now()}`
let failures = 0

function check(label: string, ok: boolean, detail?: unknown) {
  const suffix = ok ? "" : `  -> ${JSON.stringify(detail)}`
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`)
  if (!ok) failures += 1
}

async function seed(videoId: string) {
  await upsertWatchProgress({
    userId: USER,
    entries: [
      {
        videoId,
        languageSlug: "english",
        positionSeconds: 42,
        durationSeconds: 100,
        updatedAt: new Date().toISOString(),
      },
    ],
  })
  await prisma.watchEvent.create({
    data: {
      authSubject: USER,
      videoId,
      eventType: "play",
      occurredAt: new Date(),
    },
  })
}

async function counts() {
  const [progress, events] = await Promise.all([
    prisma.watchProgress.count({ where: { userId: USER } }),
    prisma.watchEvent.count({ where: { authSubject: USER } }),
  ])
  return { progress, events }
}

async function main() {
  const guard = isProdDatabaseUrl(process.env.DATABASE_URL ?? "")
  if (guard.isProd) {
    console.error(
      `refusing to run against a production database: ${guard.reason}`,
    )
    process.exit(1)
  }

  const video = await prisma.video.findFirst({
    where: { deletedAt: null },
    select: { id: true },
  })
  if (!video) throw new Error("need at least one non-deleted video")

  // --- apps/web's clear-history: positions go, analytics stay -------------
  await seed(video.id)
  const before = await counts()
  check(
    "seeded one progress row and one watch event",
    before.progress === 1 && before.events === 1,
    before,
  )

  await prisma.$transaction(async (tx) => [
    await deleteWatchProgressForUser(USER, tx),
    { deletedCount: 0 },
  ])
  const afterClear = await counts()
  check(
    "clear-history removes the resume position",
    afterClear.progress === 0,
    afterClear,
  )
  check(
    "clear-history LEAVES the watch-event log intact",
    afterClear.events === 1,
    afterClear,
  )

  // --- apps/auth's account deletion: both stores go ----------------------
  await seed(video.id)
  await prisma.$transaction(async (tx) => [
    await deleteWatchProgressForUser(USER, tx),
    await deleteWatchEventsForUser(tx, USER),
  ])
  const afterDelete = await counts()
  check(
    "account deletion removes progress AND watch events",
    afterDelete.progress === 0 && afterDelete.events === 0,
    afterDelete,
  )

  // --- atomicity: a failure after the first delete must roll it back -----
  await seed(video.id)
  const seeded = await counts()
  check("re-seeded for the rollback case", seeded.progress === 1, seeded)

  let threw = false
  try {
    await prisma.$transaction(async (tx) => {
      await deleteWatchProgressForUser(USER, tx)
      // Stand in for the second erasure failing mid-transaction.
      throw new Error("second erasure failed")
    })
  } catch {
    threw = true
  }
  const afterRollback = await counts()
  check("the failing transaction surfaced its error", threw)
  check(
    "a failed erasure rolls the first delete BACK (nothing half-erased)",
    afterRollback.progress === 1 && afterRollback.events === 1,
    afterRollback,
  )

  await prisma.watchProgress.deleteMany({ where: { userId: USER } })
  await prisma.watchEvent.deleteMany({ where: { authSubject: USER } })
  const cleaned = await counts()
  check("cleaned up", cleaned.progress === 0 && cleaned.events === 0, cleaned)

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error("smoke threw:", error)
  await prisma.watchProgress
    .deleteMany({ where: { userId: USER } })
    .catch(() => {})
  await prisma.watchEvent
    .deleteMany({ where: { authSubject: USER } })
    .catch(() => {})
  process.exit(1)
})
