/**
 * Shared disposable-database guard for the ai-chat lane's opt-in REAL-POSTGRES
 * smokes (`ai-chat-erasure.smoke.test.ts`, feat-337;
 * `ai-chat-history-write-route.smoke.test.ts`, feat-450). Those suites SEED,
 * WRITE, AND DELETE rows, and the operator shell most likely to run them is the
 * same one that holds production credentials — the erasure runbook's own
 * sourcing idiom exports a whole env group. A prose "use a throwaway database"
 * warning is not a control; this is. ONE copy, imported by both suites, so the
 * rule cannot drift between them (review finding, 2026-09-02).
 *
 * Accepted: a loopback host is treated as disposable on its own, and any host
 * is accepted when the database NAME says throwaway. A production database
 * called `..._test` would slip through, which is why this is a guard against
 * the realistic accident (a stale `DATABASE_URL` still exported from an
 * earlier task), not a claim of proof.
 *
 * Test-support only: no production module imports this.
 */
export function assertThrowawayDatabaseTarget(
  databaseUrl: string,
  suiteLabel: string,
): void {
  // Independent second axis beside the URL shape below: the Railway console
  // sets NODE_ENV=production and vitest never overrides a pre-set value, so
  // this refuses a production RUNTIME even if its database were named to
  // slip the pattern. It cannot catch a laptop pointed at production — the
  // URL check owns that side.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `refusing to run the ${suiteLabel} smoke in a production runtime (NODE_ENV=production)`,
    )
  }
  const url = new URL(databaseUrl)
  // Deny BEFORE the allowlist: Railway hostnames (railway.internal,
  // railway.app, and the proxy domain rlwy.net) mark a real deployed
  // database, and Railway's default database NAME is literally "railway" —
  // a Railway DB named like a test database must still refuse.
  if (/railway|rlwy/i.test(url.hostname)) {
    throw new Error(
      `refusing to run the ${suiteLabel} smoke against a Railway-hosted database (hostname matches railway/rlwy)`,
    )
  }
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    url.hostname,
  )
  const database = url.pathname.replace(/^\/+/, "")
  if (loopback || /(test|smoke|throwaway|scratch)/i.test(database)) return
  throw new Error(
    `refusing to run the ${suiteLabel} smoke against a target that does not look disposable: ` +
      "point DATABASE_URL at a loopback host, or name the database with test/smoke/throwaway/scratch",
  )
}
