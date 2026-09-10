import { execFileSync } from "node:child_process"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, expect, it } from "vitest"

const script = resolve("scripts/package-standalone-public.mjs")
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "manager-public-"))
  roots.push(root)
  mkdirSync(join(root, ".next/standalone/apps/manager"), { recursive: true })
  writeFileSync(join(root, ".next/standalone/apps/manager/server.js"), "server")
  mkdirSync(join(root, "public/shorts-preview"), { recursive: true })
  return root
}

it("includes generated preview and other public assets in the standalone server", () => {
  const root = fixture()
  writeFileSync(
    join(root, "public/shorts-preview/runtime.js"),
    "preview runtime",
  )
  writeFileSync(join(root, "public/logo.svg"), "logo")
  execFileSync(process.execPath, [script], { cwd: root })
  const target = join(root, ".next/standalone/apps/manager/public")
  expect(readFileSync(join(target, "shorts-preview/runtime.js"), "utf8")).toBe(
    "preview runtime",
  )
  expect(readFileSync(join(target, "logo.svg"), "utf8")).toBe("logo")
})

it("fails the build when the generated preview is missing", () => {
  const root = fixture()
  expect(() =>
    execFileSync(process.execPath, [script], { cwd: root, stdio: "pipe" }),
  ).toThrow()
})
