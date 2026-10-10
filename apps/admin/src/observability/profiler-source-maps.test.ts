import { execFile } from "node:child_process"
import { resolve } from "node:path"
import { promisify } from "node:util"
import { expect, it } from "vitest"

it("prepares installed profiler source maps without blocking a whole collection or losing frame locations", async () => {
  const result = await promisify(execFile)(process.execPath, [
    resolve("scripts/profiler-source-maps-test.mjs"),
  ])
  expect(result.stdout).toContain("no cold collection decoding")
}, 15_000)
