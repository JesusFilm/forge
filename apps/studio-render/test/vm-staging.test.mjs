import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { renderFiles, verificationFiles } from "../src/vm/staging.mjs"
const hash = (value) => createHash("sha256").update(value).digest("hex")
function fixture() {
  const bytes = Buffer.from("retained media")
  return {
    input: {
      document: { width: 320, height: 180, fps: 30, durationInFrames: 30 },
    },
    files: [
      {
        name: "source.mp4",
        size: bytes.length,
        digest: hash(bytes),
        base64: bytes.toString("base64"),
      },
    ],
  }
}
test("stages only exact hashed bounded flat inputs, never paths or substituted bytes", () => {
  const input = fixture()
  const files = renderFiles(input)
  assert.equal(files.get("source.mp4").toString(), "retained media")
  for (const name of ["../escape", "input.json", "/etc/passwd"]) {
    const changed = fixture()
    changed.files[0].name = name
    assert.throws(() => renderFiles(changed))
  }
  const changed = fixture()
  changed.files[0].digest = "a".repeat(64)
  assert.throws(() => renderFiles(changed), /hash/)
})
test("the verifier sees only admitted output and expected dimensions, never render sources or filesystem", () => {
  const output = Buffer.from("output"),
    input = fixture()
  const files = verificationFiles(output, input.input.document)
  assert.deepEqual([...files.keys()].sort(), ["input.json", "output.mp4"])
  assert.deepEqual(JSON.parse(files.get("input.json")), {
    digest: hash(output),
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 30,
  })
  assert.throws(
    () => verificationFiles(Buffer.alloc(0), input.input.document),
    /output/,
  )
})
