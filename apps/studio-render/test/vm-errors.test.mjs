import { test } from "node:test"
import assert from "node:assert/strict"
test("only typed unconfirmed failures restart; matching message text cannot reopen a quarantined worker", async () => {
  const { VmInvariantError, VmUnconfirmedError, isRetryableVmFailure } =
    await import("../src/vm/errors.mjs")
  assert.equal(
    isRetryableVmFailure(new Error("Job API request unconfirmed")),
    false,
  )
  assert.equal(
    isRetryableVmFailure(
      new VmInvariantError("Canonical terminal recording unconfirmed"),
    ),
    false,
  )
  assert.equal(isRetryableVmFailure(new VmUnconfirmedError("transport")), true)
  assert.equal(isRetryableVmFailure(new VmUnconfirmedError("recording")), true)
})
