import { VmInvariantError } from "./errors.mjs"
import { lstat, rm } from "node:fs/promises"
import { join, isAbsolute } from "node:path"
import { readCycleState } from "./cycle-state.mjs"
/** Retain immutable small retry records, remove only this cycle's large media.
 * Interrupted cleanup is safely repeated; unconfirmed work is never collected. */
export async function pruneCycleArtifacts(
  journal,
  root = "/var/lib/forge-studio/jobs",
) {
  const state = await readCycleState(journal)
  if (!state.complete || !state.retired)
    throw new VmInvariantError(
      "Confirmed retirement and receipt required for artifact cleanup",
    )
  if (!isAbsolute(root))
    throw new VmInvariantError("Absolute artifact root required")
  const id = state.assignment.binding.dispatchId.replaceAll("-", ""),
    directory = join(root, id)
  let info
  try {
    info = await lstat(directory)
  } catch (error) {
    if (error.code === "ENOENT") return
    throw error
  }
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    info.mode & 0o022
  )
    throw new VmInvariantError("Artifact ownership changed")
  for (const name of [
    "render-input",
    "verify-input",
    "output.mp4",
    "proof.json",
  ])
    await rm(join(directory, name), { recursive: true, force: true })
}
