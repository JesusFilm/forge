const fs = require("node:fs")
const path = require("node:path")
const { createRequire } = require("node:module")
const http = require("node:http")
const zlib = require("node:zlib")
const crypto = require("node:crypto")
const repo = process.cwd(),
  base = path.resolve("..")
const esbuild = createRequire(
  fs.realpathSync("apps/admin/node_modules/tsx/package.json"),
)("esbuild")
const { chromium } = createRequire(path.join(repo, "apps/web/package.json"))(
  "@playwright/test",
)
;(async () => {
  const bundles = {},
    evidence = {
      qualification:
        "Isolated browser image-loading boundary fixture, not a full Watch page, provider or historical benchmark. Same production React/Next Image with controlled local image bytes.",
      bundles: {},
      samples: [],
    }
  for (const variant of ["main-core", "merged-core", "merged-studio"]) {
    const source =
      variant === "main-core"
        ? "next/image"
        : path.join(repo, "apps/web/src/components/ui/MediaImage.tsx")
    const src =
      variant === "merged-studio"
        ? "/api/studio/playback/release/poster.webp"
        : "/core-frame.png"
    const result = await esbuild.build({
      stdin: {
        contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Image from ${JSON.stringify(source)}; performance.mark('fixture-init'); createRoot(document.getElementById('root')).render(<Image src=${JSON.stringify(src)} alt="fixture" width={320} height={180} loading="eager" onLoad={()=>performance.mark('fixture-image-loaded')} />);`,
        loader: "tsx",
        resolveDir: path.join(repo, "apps/web"),
      },
      tsconfig: path.join(repo, "apps/web/tsconfig.json"),
      bundle: true,
      write: false,
      minify: true,
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
      metafile: true,
    })
    const bytes = result.outputFiles[0].contents
    bundles[variant] = bytes
    evidence.bundles[variant] = {
      bytes: bytes.length,
      gzip: zlib.gzipSync(bytes).length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      inputs: Object.keys(result.metafile.inputs),
    }
  }
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="navy"/></svg>'
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://local")
    if (u.pathname === "/fixture.js") {
      res.setHeader("Content-Type", "application/javascript")
      res.end(bundles[u.searchParams.get("variant")])
      return
    }
    if (
      u.pathname === "/core-frame.png" ||
      u.pathname === "/_next/image" ||
      u.pathname.startsWith("/api/studio/")
    ) {
      res.setHeader("Content-Type", "image/svg+xml")
      res.setHeader("Cache-Control", "no-store")
      res.end(svg)
      return
    }
    res.setHeader("Content-Type", "text/html")
    res.end(
      `<html><body><div id="root"></div><script src="/fixture.js?variant=${u.searchParams.get("variant")}"></script></body></html>`,
    )
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({
    executablePath:
      "/home/tataihono/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
    headless: true,
    env: { ...process.env, TMPDIR: "/home/tataihono/.cache/s462m" },
    args: [
      "--no-sandbox",
      "--disable-background-networking",
      "--disable-component-update",
    ],
  })
  try {
    for (let round = 0; round < 4; round++)
      for (const variant of ["main-core", "merged-core", "merged-studio"]) {
        const page = await browser.newPage(),
          errors = []
        page.on("pageerror", (e) => errors.push(String(e)))
        await page.goto(`${origin}/?variant=${variant}`)
        await page.waitForFunction(
          () => performance.getEntriesByName("fixture-image-loaded").length > 0,
          { timeout: 10000 },
        )
        const metrics = await page.evaluate(() => ({
          init: performance.getEntriesByName("fixture-init")[0].startTime,
          loaded: performance.getEntriesByName("fixture-image-loaded")[0]
            .startTime,
          resources: performance.getEntriesByType("resource").map((r) => ({
            path: new URL(r.name).pathname,
            transferSize: r.transferSize,
            duration: r.duration,
          })),
          image: document.querySelector("img").getAttribute("src"),
        }))
        if (errors.length) throw new Error(errors.join("\n"))
        const imageResources = metrics.resources.filter(
          (r) => r.path === "/_next/image" || r.path.startsWith("/api/studio/"),
        )
        if (
          imageResources.length !== 1 ||
          (variant === "merged-studio"
            ? imageResources[0].path !==
              "/api/studio/playback/release/poster.webp"
            : imageResources[0].path !== "/_next/image")
        )
          throw new Error("Unexpected image request plan")
        evidence.samples.push({ round, variant, ...metrics })
        await page.close()
      }
  } finally {
    await browser.close()
    await new Promise((r) => server.close(r))
  }
  fs.writeFileSync(
    path.join(base, "evidence/loading-fixture.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  )
  console.log(
    "12 controlled browser loads: one expected image request each; Core optimization preserved, Studio direct gateway retained.",
  )
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
