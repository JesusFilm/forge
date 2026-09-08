const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const path = require("node:path")
const source = fs.readFileSync(
  path.join(__dirname, "../harness/loading-fixture.cjs"),
  "utf8",
)
const start = source.indexOf("  const svg =")
const end = source.indexOf("  await new Promise((r) => server.listen", start)
assert.ok(start > 0 && end > start)
let handler
vm.runInNewContext(source.slice(start, end), {
  URL,
  bundles: {
    "main-core": "core",
    "merged-core": "merged",
    "merged-studio": "studio",
  },
  http: {
    createServer(callback) {
      handler = callback
      return {}
    },
  },
})
function request(url) {
  const response = {
    statusCode: 200,
    body: "",
    setHeader() {},
    end(body) {
      this.body = body
    },
  }
  handler({ url }, response)
  return response
}
for (const variant of ["main-core", "merged-core", "merged-studio"]) {
  assert.equal(request(`/?variant=${variant}`).statusCode, 200)
  assert.ok(
    request(`/?variant=${variant}`).body.includes(
      `/fixture.js?variant=${variant}`,
    ),
  )
  assert.equal(request(`/fixture.js?variant=${variant}`).statusCode, 200)
}
for (const value of [
  '"><img src=x onerror=alert(1)>',
  "unknown",
  "__proto__",
]) {
  for (const route of ["/", "/fixture.js"]) {
    const result = request(`${route}?variant=${encodeURIComponent(value)}`)
    assert.equal(result.statusCode, 400)
    assert.equal(result.body, "Unknown fixture variant")
  }
}
assert.equal(request("/").statusCode, 400)
assert.equal(request("/_next/image").statusCode, 200)
console.log(
  "Actual fixture HTTP callback: allowed variants pass; reflected/prototype/unknown/missing variants denied; image route preserved.",
)
