import type { PrismaClient } from "@prisma/client"
import { WatchRouteManifestService } from "../watch-route-manifest.service"
import { WatchRouteManifestStore } from "../watch-route-manifest-store"
import { emitRevalidateWebhook } from "../revalidate-webhook"

type Event = { releaseId: string; phase: "published" | "revoked" }
/** The committed publication latch is the durable work record. A missing
 * phase acknowledgement is retried; revocation supersedes undelivered publish.
 * Generation/store serialize across processes. Network delivery is outside the
 * transaction and can only invalidate caches, never restore earlier content. */
export async function reconcileStudioWatch(
  db: PrismaClient,
  emit: typeof emitRevalidateWebhook = emitRevalidateWebhook,
) {
  const events = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '15000ms'`
      await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
      const [lock] = await tx.$queryRaw<
        { acquired: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(460,85) AS acquired`
      if (!lock?.acquired) return []
      const pending = await tx.$queryRaw<Event[]>`
   SELECT p.release_id AS "releaseId", CASE WHEN p.revoked_at IS NULL THEN 'published' ELSE 'revoked' END AS phase
   FROM studio_publication p
   WHERE NOT EXISTS(SELECT 1 FROM studio_watch_delivery d WHERE d.release_id=p.release_id AND d.phase=CASE WHEN p.revoked_at IS NULL THEN 'published' ELSE 'revoked' END)
   ORDER BY p.published_at,p.release_id LIMIT 100`
      if (!pending.length) return []
      // Full canonical rebuild also bootstraps a fresh global snapshot. It retains
      // Core routes and reads current publication predicates, never an event payload.
      const manifest = await new WatchRouteManifestService(tx).generate()
      await new WatchRouteManifestStore(tx).upsertLatest(manifest)
      return pending
    },
    { maxWait: 1000, timeout: 20000 },
  )
  if (!events.length) return { status: "idle" as const }
  const route = await emit({
    model: "watch-route-manifest",
    slug: null,
    locale: null,
    requireComplete: true,
  })
  const render = await emit({
    model: "video",
    slug: null,
    locale: null,
    requireComplete: true,
  })
  if (route.status !== "sent" || render.status !== "sent")
    return { status: "pending" as const }
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '1000ms'`
      await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
      for (const event of events) {
        // A publish response arriving after unpublish cannot consume revoked work.
        await tx.$executeRaw`INSERT INTO studio_watch_delivery(release_id,phase)
    SELECT p.release_id,${event.phase} FROM studio_publication p WHERE p.release_id=${event.releaseId}
    AND CASE WHEN p.revoked_at IS NULL THEN 'published' ELSE 'revoked' END=${event.phase}
    ON CONFLICT DO NOTHING`
      }
    },
    { maxWait: 1000, timeout: 5000 },
  )
  return { status: "delivered" as const, count: events.length }
}
