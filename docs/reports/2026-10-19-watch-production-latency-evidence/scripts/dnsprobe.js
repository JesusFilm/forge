const dns = require("dns")
const { performance } = require("perf_hooks")
const hosts = [
  "forgedatadog-agent.railway.internal",
  "forgeadmin.railway.internal",
  "redis-30da.railway.internal",
]
;(async () => {
  for (const h of hosts) {
    const lk = [],
      rs = []
    for (let i = 0; i < 5; i++) {
      let t = performance.now()
      await new Promise((r) => dns.lookup(h, () => r()))
      lk.push((performance.now() - t).toFixed(1))
      t = performance.now()
      await new Promise((r) => dns.resolve6(h, () => r()))
      rs.push((performance.now() - t).toFixed(1))
    }
    let t = performance.now()
    const errs = await new Promise((r) =>
      dns.resolve4(h, (e) => r(e && e.code)),
    )
    const a4 = (performance.now() - t).toFixed(1)
    console.log(
      h,
      "lookup_ms",
      lk.join(","),
      "resolve6_ms",
      rs.join(","),
      "resolve4",
      a4,
      errs,
    )
  }
})()
