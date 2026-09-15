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
  mkdirSync(join(root, "public/icons"), { recursive: true })
  return root
}

it("includes public assets in the standalone server", () => {
  const root = fixture()
  writeFileSync(join(root, "public/icons/check.svg"), "check icon")
  writeFileSync(join(root, "public/logo.svg"), "logo")
  execFileSync(process.execPath, [script], { cwd: root })
  const target = join(root, ".next/standalone/apps/manager/public")
  expect(readFileSync(join(target, "icons/check.svg"), "utf8")).toBe(
    "check icon",
  )
  expect(readFileSync(join(target, "logo.svg"), "utf8")).toBe("logo")
})

it("fails the build when public assets are missing", () => {
  const root = fixture()
  rmSync(join(root, "public"), { recursive: true })
  expect(() =>
    execFileSync(process.execPath, [script], { cwd: root, stdio: "pipe" }),
  ).toThrow()
})
