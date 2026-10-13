import type { ServerRuntime } from "next"
import { NextResponse } from "next/server"

import { buildAccountSessionBody } from "@/lib/account-session-response"
import { verifyAuthSession, type AuthSessionResult } from "@/lib/auth-session"
import {
  isWatchDownloadAccountGateEnabled,
  isWatchGlobalBetaTesterCtaEnabled,
  watchDownloadAccountGateFlagContext,
} from "@/lib/feature-flags"
import {
  WATCH_BOOTSTRAP_CONTRACT,
  type WatchBootstrapProgress,
  type WatchBootstrapResponse,
} from "@/lib/watch-bootstrap-contract"
import { fetchWatchProgressForUser } from "@/lib/watch-progress-server"

export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"

// Per-visitor identity, flag, and progress data: never shared or stored.
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
} as const
const BOOTSTRAP_PROGRESS_TIMEOUT_MS = 1_500

type Settled<T> = { ok: true; value: T } | { ok: false }

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true, value }),
    () => ({ ok: false }),
  )
}

/**
 * `GET /watch/api/bootstrap?callbackURL=<current watch path>` — the single
 * post-hydration "who is this visitor" read (`watch-bootstrap-v1`).
 *
 * The session is verified once and gates the progress read exactly as
 * `GET /watch/api/watch-progress` did. Every section fails independently to
 * `null` so one slow or broken dependency keeps its old failure behavior
 * without taking the others down.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const [session, accountGateEnabled, betaTesterCtaEnabled] = await Promise.all(
    [
      settle(verifyAuthSession(request.headers)),
      settle(
        isWatchDownloadAccountGateEnabled(watchDownloadAccountGateFlagContext),
      ),
      settle(isWatchGlobalBetaTesterCtaEnabled()),
    ],
  )

  const body: WatchBootstrapResponse = {
    contractVersion: WATCH_BOOTSTRAP_CONTRACT,
    account:
      session.ok && accountGateEnabled.ok
        ? buildAccountSessionBody({
            request,
            session: session.value,
            accountGateEnabled: accountGateEnabled.value,
          })
        : null,
    betaTesterCta: betaTesterCtaEnabled.ok
      ? { enabled: betaTesterCtaEnabled.value }
      : null,
    watchProgress: session.ok ? await readWatchProgress(session.value) : null,
  }

  return NextResponse.json(body, { headers: NO_STORE_HEADERS })
}

async function readWatchProgress(
  session: AuthSessionResult,
): Promise<WatchBootstrapProgress | null> {
  if (!session.authenticated) {
    return { authenticated: false, userId: null, entries: [] }
  }

  try {
    return {
      authenticated: true,
      userId: session.userId,
      // Account and CTA state must not wait on the lower-priority progress
      // snapshot. Aborting the upstream read also keeps a timed-out request
      // from continuing to consume Admin capacity after this response.
      entries: await fetchWatchProgressForUser(
        session.userId,
        AbortSignal.timeout(BOOTSTRAP_PROGRESS_TIMEOUT_MS),
      ),
    }
  } catch {
    return null
  }
}
