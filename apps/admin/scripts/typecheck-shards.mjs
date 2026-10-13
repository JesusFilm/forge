import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const adminRoot = fileURLToPath(new URL("../", import.meta.url))
const tsconfigPath = join(adminRoot, "tsconfig.json")
const cacheDir = join(adminRoot, ".next/cache/typecheck")
const maxTestsPerShard = 200

function readConfig(path, baseDir) {
  const config = ts.readConfigFile(path, ts.sys.readFile)
  const errors = config.error ? [config.error] : []
  const parsed = config.error
    ? null
    : ts.parseJsonConfigFileContent(
        config.config,
        ts.sys,
        baseDir,
        undefined,
        path,
      )
  errors.push(...(parsed?.errors ?? []))
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(ts.flattenDiagnosticMessageText(error.messageText, "\n"))
    }
    process.exit(1)
  }
  return parsed
}

const roots = readConfig(tsconfigPath, adminRoot).fileNames.sort()
if (roots.length === 0) throw new Error("Admin tsconfig has no source files")

const tests = roots.filter((path) => /\.test\.tsx?$/.test(path))
const shared = roots.filter((path) => !/\.test\.tsx?$/.test(path))
for (const path of tests) {
  const source = ts.sys.readFile(path)
  if (source === undefined) throw new Error(`Cannot read ${path}`)
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  let augmentsGlobals = false
  function visit(node) {
    if (
      ts.isModuleDeclaration(node) &&
      ((node.flags & ts.NodeFlags.GlobalAugmentation) !== 0 ||
        ts.isStringLiteral(node.name))
    ) {
      augmentsGlobals = true
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (
    !ts.isExternalModule(file) ||
    augmentsGlobals ||
    file.referencedFiles.length > 0 ||
    file.typeReferenceDirectives.length > 0 ||
    file.libReferenceDirectives.length > 0
  ) {
    throw new Error(
      `Cannot split global test declarations in ${relative(adminRoot, path)}`,
    )
  }
}
const shardCount = Math.max(1, Math.ceil(tests.length / maxTestsPerShard))
const shards = Array.from({ length: shardCount }, () => [])
for (const [index, path] of tests.entries()) {
  shards[index % shardCount].push(path)
}

mkdirSync(cacheDir, { recursive: true })
const configs = shards.map((testFiles, index) => {
  const path = join(cacheDir, `tsconfig-${index}.json`)
  writeFileSync(
    path,
    JSON.stringify({
      extends: tsconfigPath,
      compilerOptions: {
        tsBuildInfoFile: join(cacheDir, `tsconfig-${index}.tsbuildinfo`),
      },
      files: [...shared, ...testFiles],
      include: [],
    }),
  )
  return { path, testCount: testFiles.length }
})

const covered = new Set(
  configs.flatMap(({ path }) => readConfig(path, cacheDir).fileNames),
)
if (covered.size !== roots.length || roots.some((path) => !covered.has(path))) {
  throw new Error("Admin typecheck shards do not cover every tsconfig root")
}

console.log(
  `Admin typecheck covers ${roots.length} roots (${tests.length} tests) in ${shardCount} serial shards`,
)
if (!process.argv.includes("--plan")) {
  const compilerPath = createRequire(import.meta.url).resolve(
    "typescript/bin/tsc",
  )
  for (const [index, { path, testCount }] of configs.entries()) {
    console.log(
      `Admin typecheck shard ${index + 1}/${shardCount}: ${testCount} tests`,
    )
    const result = spawnSync(
      process.execPath,
      [compilerPath, "--project", path, "--noEmit"],
      { cwd: adminRoot, stdio: "inherit" },
    )
    if (result.error) throw result.error
    if (result.signal) {
      console.error(
        `Admin typecheck shard ${index + 1} received ${result.signal}`,
      )
      process.exit(1)
    }
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}
