import { readFile } from "node:fs/promises"
import path from "node:path"

import type {
  DevotionalAuthoredDataReader,
  DevotionalAuthoredPath,
  DevotionalAuthoredDocument,
} from "../services/devotional/authored-data"

export function requiredArg(name: string): string {
  const prefix = `--${name}=`
  const value = process.argv.find((argument) => argument.startsWith(prefix))
  if (!value) throw new Error(`required argument missing: ${prefix}<path>`)
  return path.resolve(value.slice(prefix.length))
}

export async function readWorkspaceText(
  inputsRoot: string,
  workspacePath: string,
): Promise<string> {
  if (!workspacePath.startsWith("/inputs/")) {
    throw new Error(`expected canonical Workspace input path: ${workspacePath}`)
  }
  return readFile(
    path.join(inputsRoot, workspacePath.slice("/inputs/".length)),
    "utf8",
  )
}

export function createExplicitInputsReader(
  inputsRoot: string,
): DevotionalAuthoredDataReader {
  return {
    async readRequired(
      workspacePath: DevotionalAuthoredPath,
    ): Promise<DevotionalAuthoredDocument> {
      try {
        return {
          path: workspacePath,
          text: await readWorkspaceText(inputsRoot, workspacePath),
          digest: "explicit-script-input",
        }
      } catch (error) {
        throw new Error(
          `${workspacePath}: unavailable below explicit --workspace-inputs=${inputsRoot}`,
          { cause: error },
        )
      }
    },
  }
}
