import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const rows = readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .filter((line) => line.startsWith("{"))
  .map((line) => JSON.parse(line))
const proof = rows.find((row) => row.event === "mastra_runtime_security")
const application = rows.find((row) => row.event === "startup_app_control")
assert.equal(proof?.status, "pass")
assert.equal(proof.RAILWAY_DEPLOYMENT_ID, "isolated-image-ci")
assert.equal(proof.pid, application?.pid)
assert.equal(proof.controls.length, 12)
assert.ok(proof.controls.every((control) => control.passed))
assert.match(proof.executableSha256, /^[0-9a-f]{64}$/)
assert.ok(rows.indexOf(proof) < rows.indexOf(application))
console.log(
  "PASS: real image entrypoint attests the same serving Node PID before application code",
)
