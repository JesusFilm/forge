import { VmInvariantError } from "./errors.mjs"
import { createHash } from "node:crypto"
import { mkdir, writeFile, chown, chmod } from "node:fs/promises"
import { jobIdentity } from "./profile.mjs"
const maxBytes = 134217728
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
function bounded(files) {
  if (
    [...files.values()].reduce((sum, value) => sum + value.length, 0) > maxBytes
  )
    throw new VmInvariantError("Staging byte limit")
  return files
}
export function renderFiles(prepared) {
  if (
    !prepared ||
    !prepared.input ||
    !Array.isArray(prepared.files) ||
    prepared.files.length > 256
  )
    throw new VmInvariantError("Invalid prepared input")
  const files = new Map([
    ["input.json", Buffer.from(JSON.stringify(prepared.input))],
  ])
  for (const file of prepared.files) {
    if (
      !file ||
      typeof file.name !== "string" ||
      !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,159}$/.test(file.name) ||
      files.has(file.name) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size > maxBytes ||
      typeof file.base64 !== "string" ||
      file.base64.length > Math.ceil(maxBytes / 3) * 4 ||
      typeof file.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.digest)
    )
      throw new VmInvariantError("Invalid staged file")
    const bytes = Buffer.from(file.base64, "base64")
    if (
      bytes.length !== file.size ||
      bytes.toString("base64") !== file.base64 ||
      hash(bytes) !== file.digest
    )
      throw new VmInvariantError("Staged file hash mismatch")
    files.set(file.name, bytes)
    bounded(files)
  }
  return bounded(files)
}
export function verificationFiles(output, document) {
  if (!Buffer.isBuffer(output) || !output.length || output.length > maxBytes)
    throw new VmInvariantError("Invalid admitted output")
  for (const key of ["width", "height", "fps", "durationInFrames"])
    if (!Number.isSafeInteger(document?.[key]) || document[key] < 1)
      throw new VmInvariantError("Invalid verification dimensions")
  const { width, height, fps, durationInFrames } = document
  return bounded(
    new Map([
      ["output.mp4", output],
      [
        "input.json",
        Buffer.from(
          JSON.stringify({
            digest: hash(output),
            width,
            height,
            fps,
            durationInFrames,
          }),
        ),
      ],
    ]),
  )
}
/** Fresh fixed job directory only. Partial staging is preserved on failure;
 * reconciliation cannot silently rewrite an already-issued execution input. */
export async function stageFiles(id, phase, files) {
  if (process.getuid() !== 0 || !["render", "verify"].includes(phase))
    throw new VmInvariantError("Trusted host staging required")
  bounded(files)
  const directory = `${jobIdentity(id).directory}/${phase}-input`
  await mkdir(directory, { mode: 0o700 })
  for (const [name, bytes] of files) {
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,159}$/.test(name))
      throw new VmInvariantError("Invalid staged path")
    const path = `${directory}/${name}`
    await writeFile(path, bytes, { flag: "wx", mode: 0o400 })
    await chown(path, 1000, 1000)
  }
  await chown(directory, 1000, 1000)
  await chmod(directory, 0o500)
}
