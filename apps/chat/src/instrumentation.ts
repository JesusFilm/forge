/**
 * Next.js server-start hook. Runs once per server instance and — importantly —
 * NOT during `next build` (Next skips registration in
 * `phase-production-build`), which is why the Seeker egress diagnostic lives
 * here rather than in a module-load block in `config/env.ts`: `next build`
 * evaluates route modules with NODE_ENV=production and Railway exposes service
 * env at build time, so a load-time check there could fail the BUILD.
 *
 * This hook only REPORTS. Enforcement is at the proxies (`validateBaseUrl`),
 * so a missing egress pin denies exactly the calls that would carry the bearer
 * while the stub path, the page, and auth keep working. Throwing here would
 * instead reject `prepare()` for the whole server — every request, not just
 * Seeker's — and chat's railway.toml has no healthcheck to roll that back.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // Never-throw made STRUCTURAL, not incidental (mirrors apps/web's register).
  // The import alone can throw — `@/config/env` reaches `server-only`, which
  // throws on a wrong module resolution — and this hook is diagnostic-only, so
  // a failure here must cost the log line, never the server.
  try {
    const { describeSeekerEgressMisconfiguration } =
      await import("@/config/env")
    const problem = describeSeekerEgressMisconfiguration()
    if (problem === null) return

    // Plain-string `event=… reason=…` — Railway logsV2 silences JSON-stringified
    // payloads from Next runtime handlers (see root CLAUDE.md).
    console.error(
      `[seeker-egress] event=misconfigured reason=${problem} effect=seeker_sends_and_history_refuse`,
    )
  } catch {
    // Enum-only, and never the caught error — it can carry a module path or
    // env-shaped fragment (the KTD7 no-PII discipline).
    console.error("[seeker-egress] event=diagnostic_failed")
  }
}
