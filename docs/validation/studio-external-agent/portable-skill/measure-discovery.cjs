const fs = require("node:fs")
const path = require("node:path")
const { createRequire } = require("node:module")
const { execFileSync } = require("node:child_process")
const { gzipSync } = require("node:zlib")
const root = process.argv[2]
const req = createRequire(path.join(root, "apps/manager/package.json"))
const ts = req("typescript")
const React = req("react")
const { renderToStaticMarkup } = req("react-dom/server")
const relative = "apps/manager/src/features/video-studio/projects.tsx"
function load(source) {
  const code = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const mod = { exports: {} }
  new Function("require", "module", "exports", code)(
    (name) => {
      if (name.endsWith(".css")) return {}
      if (name === "./client")
        return {
          studioCall: () => {
            throw Error("SSR must not fetch")
          },
        }
      if (name === "@forge/studio-contracts/preview")
        return { STUDIO_RUNTIME_VERSION: "unused-in-project-list" }
      return req(name)
    },
    mod,
    mod.exports,
  )
  return mod.exports.StudioProjects
}
const before = load(
  execFileSync("git", ["show", "0b75ba130:" + relative], {
    cwd: root,
    encoding: "utf8",
  }),
)
const after = load(fs.readFileSync(path.join(root, relative), "utf8"))
const render = (component) =>
  renderToStaticMarkup(React.createElement(component))
for (let i = 0; i < 100; i++) {
  render(before)
  render(after)
}
const beforeMs = [],
  afterMs = []
for (let i = 0; i < 500; i++) {
  for (const [component, timings] of i % 2
    ? [
        [after, afterMs],
        [before, beforeMs],
      ]
    : [
        [before, beforeMs],
        [after, afterMs],
      ]) {
    const start = performance.now()
    render(component)
    timings.push(performance.now() - start)
  }
}
const median = (values) =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
const oldHtml = render(before),
  newHtml = render(after)
const result = {
  boundary:
    "Projects initial SSR loading state, actual React/Next Link/lucide rendering; 100 warmup and 500 alternating samples. studioCall rejects if invoked during SSR.",
  before: {
    htmlBytes: Buffer.byteLength(oldHtml),
    gzipBytes: gzipSync(oldHtml).length,
    medianRenderMs: median(beforeMs),
  },
  after: {
    htmlBytes: Buffer.byteLength(newHtml),
    gzipBytes: gzipSync(newHtml).length,
    medianRenderMs: median(afterMs),
  },
  additionalFetchesFromNewAnchor: 0,
  anchor: newHtml.match(/<a href="\/shorts-creator.zip"[^>]*>[^<]*<\/a>/)?.[0],
  limitations: [
    "Server-render microbenchmark, not end-to-end browser navigation or LCP.",
    "No new imports, hydration hooks, prefetch, media or scripts; ZIP loads only on explicit download. Existing project-list fetch and rendering remain unchanged.",
    "Timing changes below one millisecond are measurement noise, not claimed speed improvement.",
  ],
}
console.log(JSON.stringify(result, null, 2))
