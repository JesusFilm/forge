process.env.TZ = "UTC"
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const { Client } = require("/tmp/forge-profile-audit-tools/node_modules/pg")
const cli =
  "/home/nisal/.cache/pnpm/dlx/fn4qp76b3sbipnjiogg4ezmrim/1a0eeba5094-254fda/node_modules/.bin/railway"
function vars(service) {
  return JSON.parse(
    execFileSync(
      cli,
      [
        "variable",
        "list",
        "--project",
        "98952497-a4d9-4714-8fe8-0cdbff3147c9",
        "--environment",
        "production",
        "--service",
        service,
        "--json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 45000 },
    ),
  )
}
;(async () => {
  const admin = vars("@forge/admin"),
    db = vars("@forge/admin/pg")
  const a = new URL(admin.DATABASE_URL),
    b = new URL(db.DATABASE_URL),
    u = new URL(db.DATABASE_PUBLIC_URL)
  if (
    ["hostname", "pathname", "username", "password"].some((k) => a[k] !== b[k])
  )
    throw new Error("Admin database identity mismatch")
  if (["pathname", "username", "password"].some((k) => b[k] !== u[k]))
    throw new Error("Public database identity mismatch")
  u.search = ""
  const c = new Client({
    connectionString: u.toString(),
    connectionTimeoutMillis: 15000,
    application_name: "codex-cowatch-restoration-readonly",
    options:
      "-c default_transaction_read_only=on -c statement_timeout=25000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=30000 -c timezone=UTC",
  })
  try {
    await c.connect()
    for (const f of process.argv.slice(2)) {
      await c.query("BEGIN READ ONLY")
      try {
        const sql = fs.readFileSync(f, "utf8")
        const r = await c.query(sql)
        const rows = (Array.isArray(r) ? r : [r]).map((x) => x.rows)
        await c.query("ROLLBACK")
        fs.writeFileSync(
          f.replace(/\.sql$/, ".json"),
          JSON.stringify(rows, null, 2) + "\n",
        )
        console.log(
          JSON.stringify({
            file: f,
            resultSets: rows.length,
            rows: rows.map((x) => x.length),
          }),
        )
      } catch (e) {
        await c.query("ROLLBACK")
        console.error(
          JSON.stringify({
            file: f,
            error: e.code || e.name,
            message: e.message.replace(
              /postgres(?:ql)?:\/\/\S+/g,
              "[redacted]",
            ),
          }),
        )
        process.exitCode = 1
        break
      }
    }
  } finally {
    await c.end()
  }
})().catch((e) => {
  console.error(e.code || e.name, "Bootstrap failed; details withheld")
  process.exitCode = 1
})
