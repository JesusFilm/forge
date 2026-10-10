/**
 * GET /api/search/health — synthetic probe for embedding-provider
 * reachability.
 *
 * Always returns HTTP 200. Body's `status` field is the machine-readable
 * signal (`ok` or `degraded`) — matches cms parity so external monitors
 * (Railway healthcheck, uptime tools, curl checks) swap URLs without
 * changing their success rule.
 *
 * Runs a real `embedQuery("health probe")` call with a short timeout so a
 * stalled provider fails fast. Counters are shared with the search
 * orchestrator via hybrid-search-health.ts — operators see a single
 * unified view of embedding-call activity on the process.
 */

import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { prisma } from "@/db/client"
import { generateCurrentContentQueryEmbedding } from "@/services/embeddings.service"
import {
  getStats,
  recordAttempt,
  recordFailure,
  withTimeout,
} from "@/services/hybrid-search-health"
import { getSearchTraceCaptureStats } from "@/services/search-trace.service"
import { readSearchTraceRetentionHealth } from "@/services/search-trace-retention.service"

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60_000

/** Probe ceiling. Shorter than the embedding provider's own timeout so a
 *  stalled request fails fast and external monitors can page quickly. */
const HEALTH_PROBE_TIMEOUT_MS = 5_000

/** Fixed input — keeps cost and log output predictable. */
const HEALTH_PROBE_INPUT = "health probe"

function tooManyRequests(): Response {
  return Response.json({ error: "Too many requests" }, { status: 429 })
}

async function loadRetentionHealth() {
  try {
    return await readSearchTraceRetentionHealth(prisma)
  } catch (error) {
    const errorClass =
      error instanceof Error ? error.constructor.name : "UnknownError"
    console.error(
      `[search] event=trace_retention_health_failed error_class=${errorClass}`,
    )
    return {
      healthy: false,
      reason: "missing" as const,
      latestPurgeAt: null,
      activeSchedulerRunId: null,
    }
  }
}

export async function GET(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "search-health",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) return tooManyRequests()

  recordAttempt()
  try {
    await withTimeout(
      generateCurrentContentQueryEmbedding(prisma, HEALTH_PROBE_INPUT),
      HEALTH_PROBE_TIMEOUT_MS,
    )
    const retention = await loadRetentionHealth()
    return Response.json(
      {
        status: retention.healthy ? "ok" : "degraded",
        error: retention.healthy ? null : "search trace retention unhealthy",
        ...getStats(),
        traceCapture: getSearchTraceCaptureStats(),
        retention,
      },
      { status: 200 },
    )
  } catch (error) {
    recordFailure(error)
    const retention = await loadRetentionHealth()
    const errorClass =
      error instanceof Error ? error.constructor.name : "UnknownError"
    const message = error instanceof Error ? error.message : String(error)

    console.error(
      `[search] event=health_probe_failed error_class=${errorClass} message=${message}`,
    )
    return Response.json(
      {
        status: "degraded",
        error: message,
        ...getStats(),
        traceCapture: getSearchTraceCaptureStats(),
        retention,
      },
      { status: 200 },
    )
  }
}
