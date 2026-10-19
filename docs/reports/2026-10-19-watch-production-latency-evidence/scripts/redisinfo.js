const { createClient } = require("/app/apps/web/node_modules/redis")
;(async () => {
  const c = createClient({ url: process.env.REDIS_URL })
  c.on("error", () => {})
  await c.connect()
  const pick = (s, keys) =>
    Object.fromEntries(
      s
        .split("\r\n")
        .filter((l) => l.includes(":"))
        .map((l) => l.split(":"))
        .filter(([k]) => keys.some((x) => k.startsWith(x))),
    )
  const K = [
    "keyspace_hits",
    "keyspace_misses",
    "total_commands_processed",
    "instantaneous_ops_per_sec",
    "evicted_keys",
    "expired_keys",
    "connected_clients",
    "blocked_clients",
    "used_memory_human",
    "maxmemory_human",
    "maxmemory_policy",
    "instantaneous_input_kbps",
    "instantaneous_output_kbps",
    "total_net_output_bytes",
    "total_net_input_bytes",
    "rdb_bgsave_in_progress",
    "aof_rewrite_in_progress",
    "redis_version",
    "uptime_in_seconds",
    "db0",
  ]
  const a = pick(await c.info(), K)
  const ca = await c.info("commandstats")
  await new Promise((r) => setTimeout(r, 10000))
  const b = pick(await c.info(), K)
  const cb = await c.info("commandstats")
  const cs = (s) =>
    Object.fromEntries(
      s
        .split("\r\n")
        .filter((l) => l.startsWith("cmdstat_"))
        .map((l) => {
          const [n, v] = l.split(":")
          const o = Object.fromEntries(v.split(",").map((x) => x.split("=")))
          return [n.slice(8), o]
        }),
    )
  const A = cs(ca),
    B = cs(cb)
  const d = {}
  for (const k in B) {
    const x = +B[k].calls - +(A[k] || { calls: 0 }).calls
    if (x > 0) d[k] = { calls10s: x, usec_per_call: B[k].usec_per_call }
  }
  console.log(JSON.stringify({ a, b, cmd10s: d }))
  const sl = await c.sendCommand(["SLOWLOG", "GET", "10"])
  console.log(
    "slowlog",
    JSON.stringify(sl.map((e) => [e[1], e[2], String(e[3][0]), e[3].length])),
  )
  await c.quit()
})().catch((e) => console.log("ERR", e.message))
