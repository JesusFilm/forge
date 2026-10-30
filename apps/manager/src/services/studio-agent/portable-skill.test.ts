import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test, expect } from "vitest"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import { STUDIO_MCP_TOOLS } from "./mcp-tools"

const root = resolve(import.meta.dirname, "../../../../..")
const example = (name: string) =>
  JSON.parse(
    readFileSync(
      resolve(root, `skills/shorts-creator/examples/${name}.json`),
      "utf8",
    ),
  )

test("shipped creation/capture/edit examples parse against the actual MCP registry", () => {
  for (const [name, tool] of [
    ["create", "shorts.create"],
    ["capture", "shorts.capture"],
    ["compose", "shorts.apply"],
    ["speech", "shorts.apply"],
    ["feedback", "shorts.apply"],
  ]) {
    const schema = STUDIO_MCP_TOOLS.find((entry) => entry.name === tool)!.schema
    expect(() => schema.parse(example(name))).not.toThrow()
  }
  expect(example("create").document.runtimeVersion).toBe(STUDIO_RUNTIME_VERSION)
})

test("committed skill archive is reproducible, safe and usable outside the checkout", () => {
  execFileSync(
    "python3",
    ["apps/manager/scripts/package-shorts-skill.py", "--check"],
    { cwd: root },
  )
  const directory = mkdtempSync(resolve(tmpdir(), "shorts-skill-install-"))
  try {
    execFileSync("python3", [
      "-c",
      `
import pathlib, re, sys, zipfile
archive, destination = sys.argv[1:]
with zipfile.ZipFile(archive) as source:
    source.extractall(destination)
root = pathlib.Path(destination) / "shorts-creator"
assert (root / "SKILL.md").is_file()
for path in root.rglob("*.md"):
    for target in re.findall(r"\\]\\(([^)]+)\\)", path.read_text()):
        if target.startswith("https://"):
            continue
        resolved = (path.parent / target.split("#")[0]).resolve()
        assert resolved.is_relative_to(root) and resolved.is_file(), target
`,
      resolve(root, "apps/manager/public/shorts-creator.zip"),
      directory,
    ])
    const installed = JSON.parse(
      readFileSync(
        resolve(directory, "shorts-creator/examples/create.json"),
        "utf8",
      ),
    )
    expect(() =>
      STUDIO_MCP_TOOLS.find(
        (tool) => tool.name === "shorts.create",
      )!.schema.parse(installed),
    ).not.toThrow()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
