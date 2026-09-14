import { test } from "node:test"
import assert from "node:assert/strict"
import {
  checkNativeTestPrerequisites,
  NativeTestPrerequisiteError,
} from "../scripts/check-native-test-prerequisites.mjs"

test("missing Bubblewrap fails before running security fixtures with an actionable diagnostic", () => {
  assert.throws(
    () =>
      checkNativeTestPrerequisites(() => ({
        error: Object.assign(new Error("missing"), { code: "ENOENT" }),
      })),
    {
      constructor: NativeTestPrerequisiteError,
      message: /\/usr\/bin\/bwrap.*ENOENT.*install-native-test-prerequisites/s,
    },
  )
})

test("unsupported version and denied namespaces refuse rather than skipping security tests", () => {
  assert.throws(
    () =>
      checkNativeTestPrerequisites(() => ({
        status: 0,
        stdout: "bubblewrap 0.9.0",
        stderr: "",
      })),
    /0.11.1 required/,
  )
  let calls = 0
  assert.throws(
    () =>
      checkNativeTestPrerequisites(() =>
        ++calls === 1
          ? { status: 0, stdout: "bubblewrap 0.11.1", stderr: "" }
          : {
              status: 1,
              stdout: "",
              stderr: "Creating new namespace failed: Operation not permitted",
            },
      ),
    /namespace.*Operation not permitted/s,
  )
  assert.equal(calls, 2)
})
