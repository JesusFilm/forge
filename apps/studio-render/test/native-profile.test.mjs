import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readlinkSync } from "node:fs"
import {
  validateNativeProbe,
  checkNativeTestPrerequisites,
} from "../scripts/check-native-test-prerequisites.mjs"

test("CI refuses a payload outside the enforced child profile or retaining setup capabilities", () => {
  const sample = {
    pid: 1,
    net: "net:[2]",
    interfaces: ["lo"],
    label: "forge_studio_ci_bwrap (enforce)",
    effective: "0000000000000000",
    permitted: "0000000000000000",
    ambient: "0000000000000000",
    escape: 1,
    alternates: [],
  }
  assert.throws(
    () => validateNativeProbe(sample, "net:[1]", true),
    /child profile/,
  )
})

test("actual payload and alternate execs retain zero capabilities/private network and refuse forged qualification", () => {
  let report
  checkNativeTestPrerequisites((command, args, options) => {
    const result = spawnSync(command, args, options)
    if (args.at(-1) === "normal" && result.status === 0)
      report = JSON.parse(result.stdout)
    return result
  })
  assert.ok(report)
  const parentNet = readlinkSync("/proc/self/ns/net")
  validateNativeProbe(report, parentNet, process.env.GITHUB_ACTIONS === "true")
  assert.throws(
    () => validateNativeProbe({ ...report, net: parentNet }, parentNet, false),
    /private PID1/,
  )
  assert.throws(
    () =>
      validateNativeProbe(
        { ...report, effective: "0000000000200000" },
        parentNet,
        false,
      ),
    /zero payload capabilities/,
  )
  assert.throws(
    () => validateNativeProbe({ ...report, escape: 0 }, parentNet, false),
    /denied namespace escape/,
  )
  assert.throws(
    () =>
      validateNativeProbe(
        {
          ...report,
          alternates: [
            report.alternates[0],
            { ...report.alternates[1], permitted: "1" },
          ],
        },
        parentNet,
        false,
      ),
    /zero payload capabilities/,
  )
  assert.throws(
    () =>
      validateNativeProbe(
        {
          ...report,
          label: "forge_studio_ci_bwrap//&forge_studio_ci_child (complain)",
        },
        parentNet,
        true,
      ),
    /child profile/,
  )
})

test("the fixed capability qualification rejects a successful private mount and a missing requested capability", () => {
  const report = {
    pid: 1,
    net: "net:[2]",
    interfaces: ["lo"],
    label: "forge_studio_ci_bwrap//&forge_studio_ci_child (enforce)",
    effective: "0000000000200000",
    mountErrno: 1,
  }
  validateNativeProbe(report, "net:[1]", true, true)
  for (const changed of [
    { ...report, mountErrno: 0 },
    { ...report, effective: "0" },
  ])
    assert.throws(
      () => validateNativeProbe(changed, "net:[1]", true, true),
      /deny a private mount/,
    )
})
