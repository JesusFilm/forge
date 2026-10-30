/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, beforeAll, describe, expect, it, require */
// R8, AE11: the runner names every uncommitted change in the build inputs
// before it builds, and ignores changes outside them.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { run } = require("../lib/proc")
const { dirtyBuildInputs } = require("../lib/testBuild/worktree")

const COMMITTED_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "apps/mobile/package.json",
  "apps/mobile/src/env.ts",
  "apps/web/package.json",
  "apps/web/src/page.tsx",
  "packages/admin-graphql/src/index.ts",
  "packages/watch-url-policy/src/index.ts",
  "patches/expo.patch",
]

let repo
let gitEnv

async function git(...args) {
  const result = await run(
    "git",
    [
      "-c",
      "user.name=Release Check",
      "-c",
      "user.email=release-check@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd: repo, env: gitEnv, timeoutMs: 20_000 },
  )
  if (result.code !== 0) throw new Error(result.stderr)
}

function write(file, text) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), text)
}

beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-dirty-"))
  // An empty HOME keeps the developer's global git config out of the fixture.
  gitEnv = { PATH: process.env.PATH, HOME: repo, GIT_CONFIG_NOSYSTEM: "1" }
  await git("init", "--quiet")
  for (const file of COMMITTED_FILES) write(file, "committed\n")
  await git("add", "--all")
  await git("commit", "--quiet", "-m", "fixture")
})

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

describe("the dirty build input check", () => {
  it("finds nothing in a clean checkout", async () => {
    expect(await dirtyBuildInputs({ repoRoot: repo, env: gitEnv })).toEqual([])
  })

  it("lists a changed file under apps/mobile and not one under apps/web", async () => {
    write("apps/mobile/src/env.ts", "changed\n")
    write("apps/web/src/page.tsx", "changed\n")
    write("apps/web/package.json", "changed\n")

    expect(await dirtyBuildInputs({ repoRoot: repo, env: gitEnv })).toEqual([
      "apps/mobile/src/env.ts",
    ])
  })

  it("lists new, staged, and deleted files in every build input", async () => {
    write("apps/mobile/app/new-screen.tsx", "new\n")
    write("patches/new.patch", "new\n")
    write("package.json", "changed\n")
    write("packages/watch-url-policy/src/index.ts", "changed\n")
    await git("add", "packages/watch-url-policy/src/index.ts")
    fs.rmSync(path.join(repo, "packages/admin-graphql/src/index.ts"))
    write("pnpm-lock.yaml", "changed\n")

    expect(await dirtyBuildInputs({ repoRoot: repo, env: gitEnv })).toEqual([
      "apps/mobile/app/new-screen.tsx",
      "apps/mobile/src/env.ts",
      "package.json",
      "packages/admin-graphql/src/index.ts",
      "packages/watch-url-policy/src/index.ts",
      "patches/new.patch",
      "pnpm-lock.yaml",
    ])
  })
})
