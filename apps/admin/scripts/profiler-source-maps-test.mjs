import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"

const require = createRequire(import.meta.url)
const ddRequire = createRequire(require.resolve("dd-trace"))
const pprofRequire = createRequire(ddRequire.resolve("@datadog/pprof"))
const { SourceMapper } = pprofRequire("./sourcemapper/sourcemapper")
const { SourceMapGenerator } = pprofRequire("source-map")
const { BasicSourceMapConsumer } = pprofRequire(
  "source-map/lib/source-map-consumer",
)
const { setLogger, NullLogger } = pprofRequire("./logger")
const directory = await mkdtemp(join(tmpdir(), "forge-profiler-source-maps-"))
const files = []
let turn = 0
let timer
function tick() {
  turn++
  timer = setImmediate(tick)
}

// Observe actual cold decoding in the pinned source-map consumer, not wall-clock
// thresholds dependent on CI speed. No decoding may remain for loaded frames.
const parses = []
const originalParse = BasicSourceMapConsumer.prototype._parseMappings
BasicSourceMapConsumer.prototype._parseMappings = function (...args) {
  parses.push(turn)
  return Reflect.apply(originalParse, this, args)
}

function basicMap(source) {
  const map = new SourceMapGenerator()
  map.addMapping({
    generated: { line: 1, column: 0 },
    original: { line: 10, column: 4 },
    source,
    name: "originalFunction",
  })
  return map.toJSON()
}

async function fixture(name, map, loaded) {
  const file = join(directory, name + ".js")
  files.push(file)
  await writeFile(
    file,
    "module.exports = 1;\n//# sourceMappingURL=" + name + ".js.map\n",
  )
  await writeFile(file + ".map", JSON.stringify(map))
  if (loaded) require(file)
  return file
}

let mapper
try {
  const basic = await fixture("loaded", basicMap("basic.ts"), true)
  const indexed = await fixture(
    "indexed",
    {
      version: 3,
      sections: [
        { offset: { line: 0, column: 0 }, map: basicMap("first.ts") },
        { offset: { line: 100, column: 0 }, map: basicMap("second.ts") },
      ],
    },
    true,
  )
  const lazy = await fixture("unloaded", basicMap("lazy.ts"), false)
  tick()
  mapper = await SourceMapper.create([directory])
  clearImmediate(timer)
  assert.equal(
    parses.length,
    3,
    "prepare loaded basic and all indexed sections",
  )
  assert.equal(new Set(parses).size, 3, "yield between each cold map decode")

  for (const [file, line, source] of [
    [basic, 1, "basic.ts"],
    [indexed, 1, "first.ts"],
    [indexed, 101, "second.ts"],
  ]) {
    assert.deepEqual(
      mapper.mappingInfo({ file, line, column: 1, name: "generated" }),
      {
        file: join(directory, source),
        line: 10,
        column: 5,
        name: "originalFunction",
      },
    )
  }
  assert.equal(
    parses.length,
    3,
    "profile lookups must not trigger cold decoding",
  )
  assert.equal(
    mapper.mappingInfo({ file: lazy, line: 1, column: 1 }).file,
    join(directory, "lazy.ts"),
  )
  assert.equal(parses.length, 4, "unexecuted modules retain lazy decoding")
  const warnings = []
  const logger = new NullLogger()
  logger.warn = (message) => warnings.push(message)
  setLogger(logger)
  const invalid = await fixture(
    "invalid",
    { ...basicMap("invalid.ts"), mappings: "!" },
    true,
  )
  await mapper.loadDirectory(directory)
  assert.equal(
    warnings.length,
    1,
    "a malformed map preparation failure is reported",
  )
  assert.throws(
    () => mapper.mappingInfo({ file: invalid, line: 1, column: 1 }),
    "malformed frame errors retain their original behavior",
  )
  console.log(
    "Loaded basic/indexed frames preserve source locations with no cold collection decoding; preparation yields and unloaded modules remain lazy.",
  )
} finally {
  clearImmediate(timer)
  BasicSourceMapConsumer.prototype._parseMappings = originalParse
  setLogger(new NullLogger())
  for (const entry of mapper?.infoMap.values() ?? [])
    entry.mapConsumer.destroy()
  for (const file of files) delete require.cache[file]
  await rm(directory, { recursive: true, force: true })
}
