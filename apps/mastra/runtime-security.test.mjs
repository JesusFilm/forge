import assert from "node:assert/strict"
import { test } from "vitest"
import {
  deploymentIdentity,
  verifyRuntime,
  verifyTrustResult,
} from "./runtime-security.mjs"

test("requires the patched Node release and backported decoder marker", () => {
  for (const version of ["v24.22.1", "v24.22.2", "v24.23.0"])
    verifyRuntime(version, -17)
  for (const version of [
    "v24.22.0",
    "v24.21.0",
    "v24.9.9",
    "v24.22.1-rc.1",
    "v26.0.0",
    "invalid",
  ]) {
    assert.throws(() => verifyRuntime(version, -17), {
      code: "node_security_release_required",
    })
  }
  assert.throws(() => verifyRuntime("v24.22.1", 0), {
    code: "brotli_fix_marker_missing",
  })
})
test("timeouts, DNS errors and accepted bad chains cannot masquerade as rejection", () => {
  for (const result of [
    { accepted: false, certificateRejected: false },
    { accepted: true, certificateRejected: false },
  ]) {
    assert.throws(() => verifyTrustResult("node", "bad-control", false, result))
  }
  assert.equal(
    verifyTrustResult("node", "bad-control", false, {
      accepted: false,
      certificateRejected: true,
    }).passed,
    true,
  )
  assert.throws(() =>
    verifyTrustResult("bundle", "good-control", true, {
      accepted: false,
      certificateRejected: true,
    }),
  )
  assert.equal(
    verifyTrustResult("bundle", "good-control", true, { accepted: true })
      .passed,
    true,
  )
})
test("identity is an explicit whitelist and does not include secrets", () => {
  assert.deepEqual(
    deploymentIdentity({
      RAILWAY_DEPLOYMENT_ID: "deployment",
      DATABASE_URL: "secret",
      PROVIDER_TOKEN: "secret",
    }),
    {
      RAILWAY_DEPLOYMENT_ID: "deployment",
      RAILWAY_REPLICA_ID: null,
      RAILWAY_GIT_COMMIT_SHA: null,
    },
  )
})
