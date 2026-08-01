import type { SeekerEgressProblem } from "@/config/env"

/**
 * Next.js server-start hook. Runs once per server instance and — importantly —
 * NOT during `next build` (Next skips registration in
 * `phase-production-build`), which is why the Seeker egress check lives here
 * rather than in a module-load block in `config/env.ts`: `next build` evaluates
 * route modules with NODE_ENV=production and Railway exposes service env at
 * build time, so a load-time check there could fail the BUILD.
 *
 * Since feat-306 this hook ENFORCES the pin as a DEPLOY GATE: a genuine
 * misconfiguration throws. A throw rejects Next's `prepare()` process-wide —
 * verified under `next start`, the server still LISTENS but returns HTTP 500 on
 * every route (including `/api/health`), staying up and re-throwing the hook
 * once per request. feat-305's `healthcheckPath = "/api/health"` turns that
 * into a FAILED DEPLOY: the probe gets 500, not 2xx, so the misconfigured build
 * is never PROMOTED and the previous healthy deployment keeps serving.
 *
 * The gate covers promotion only — an already-promoted deployment restarting
 * into the same throw (after a service-variable edit, say) is not re-probed,
 * and rollback does not undo an env change. Outside a production build the hook
 * stays REPORT-ONLY: `next dev` and the test runner keep today's behavior.
 * Request-path enforcement at the proxies (`validateBaseUrl`) is untouched and
 * remains the actual security control; this is a deploy gate on top of it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // Two NARROW guards, never one blanket catch: a failure of the diagnostic
  // MACHINERY is not evidence of a misconfiguration, so it must not fail the
  // deploy. `stage=` tells an operator which half broke; enum-only, and never
  // the caught error — it can carry a module path or env-shaped fragment (KTD7).
  let config: typeof import("@/config/env")
  try {
    config = await import("@/config/env")
  } catch {
    // stage=import also means every real route is 500ing on the same module —
    // the zero-import health route can still answer 200 and promote the build.
    console.error("[seeker-egress] event=diagnostic_failed stage=import")
    return
  }

  let problem: SeekerEgressProblem | null
  try {
    problem = config.describeSeekerEgressMisconfiguration()
  } catch {
    console.error("[seeker-egress] event=diagnostic_failed stage=call")
    return
  }

  if (problem === null) return

  // Deliberately OUTSIDE both guards. A throw inside a try is caught by that
  // try's own catch; and once a REAL problem is known, a failing policy read
  // must not discard it down the fail-open path. This is the same production
  // policy the proxies enforce, not a second environment check: `allowlist_unset`
  // is already production-only, but `host_not_allowed` fires in any environment
  // (a set-but-mismatched allowlist), which must stay report-only.
  const enforcing = config.requireSeekerEgressAllowlist()

  // Plain-string `event=… reason=…` — Railway logsV2 silences JSON-stringified
  // payloads from Next runtime handlers (see root CLAUDE.md). Logged BEFORE the
  // throw: Next wraps the error, and the raw enum line is what operators grep.
  // `boot_refused_all_requests` is what this process KNOWS; whether that also
  // refuses a deploy depends on the healthcheck gating promotion.
  console.error(
    `[seeker-egress] event=misconfigured reason=${problem} effect=${
      enforcing
        ? "boot_refused_all_requests"
        : "seeker_sends_and_history_refuse"
    }`,
  )
  if (!enforcing) return

  // Names variables and the fixed reason enum only — never an env VALUE. Next
  // wraps and re-emits this once per request for the life of the process.
  throw new Error(
    `SEEKER_MASTRA_BASE_URL must use a host listed in SEEKER_MASTRA_ALLOWED_HOSTS for chat production (reason=${problem})`,
  )
}
