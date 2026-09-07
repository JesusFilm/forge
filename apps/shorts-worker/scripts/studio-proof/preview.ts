/// <reference lib="dom" />
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium } from "playwright"
import {
  subtitlesAt,
  type StudioManifest,
} from "@forge/shorts-compositions/studio-proof/manifest"

export async function previewProof({
  out,
  browserPath,
  manifest,
}: {
  out: string
  browserPath: string
  manifest: StudioManifest
}) {
  let bytesServed = 0
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://local").pathname
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Origin-Agent-Cluster", "?1")
    if (pathname === "/") {
      res.setHeader("Content-Type", "text/html")
      res.end(`<html><body><h1>Isolated preview proof</h1><label>Title <input id="title"></label><label>Color <input id="color" type="color"></label><button id="save">Save properties</button><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" src="http://127.0.0.1:${(server.address() as { port: number }).port}/index.html?preview" width="640" height="420"></iframe><script>
document.querySelector('#save').onclick=()=>{const m=JSON.parse(localStorage.getItem('manifest'));m.props.title=document.querySelector('#title').value;m.props.color=document.querySelector('#color').value;localStorage.setItem('manifest',JSON.stringify(m));document.querySelector('iframe').contentWindow.postMessage({type:'load',manifest:m},'*')};
window.ready=false;window.addEventListener('message',e=>{if(e.source===document.querySelector('iframe').contentWindow&&e.data.type==='ready')window.ready=true});
</script></body></html>`)
      return
    }
    if (!/^\/(?:[a-zA-Z0-9_.-]+|media\/[a-zA-Z0-9_.-]+)$/.test(pathname)) {
      res.writeHead(404).end()
      return
    }
    const isMedia = pathname.startsWith("/media/")
    const file = join(out, isMedia ? "" : "bundle", pathname)
    try {
      const body = await readFile(file)
      bytesServed += body.length
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src ${origin} 'unsafe-eval' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src ${origin}/media/ blob:; connect-src ${origin}/media/; worker-src blob:; base-uri 'none'; form-action 'none'; frame-src 'none'`,
      )
      res.setHeader(
        "Content-Type",
        pathname.endsWith(".js")
          ? "text/javascript"
          : pathname.endsWith(".html")
            ? "text/html"
            : pathname.endsWith(".m3u8")
              ? "application/vnd.apple.mpegurl"
              : "video/mp2t",
      )
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
  })
  try {
    const page = await browser.newPage()
    const started = performance.now()
    await page.goto(
      `http://localhost:${(server.address() as { port: number }).port}`,
    )
    await page.waitForFunction(
      () => (window as unknown as { ready: boolean }).ready,
    )
    const readyMs = performance.now() - started
    await page.evaluate(
      (manifest) =>
        document
          .querySelector("iframe")!
          .contentWindow!.postMessage({ type: "load", manifest }, "*"),
      manifest,
    )
    const frame = page.frames()[1]!
    await frame.waitForSelector("video")
    await frame.waitForFunction((start) => {
      const v = document.querySelector("video")
      return (
        v &&
        !v.seeking &&
        v.readyState >= 2 &&
        Math.abs(v.currentTime - start) < 0.1
      )
    }, manifest.asset.trimStartMs / 1000)
    assert.equal(
      await frame.locator('[data-testid="subtitle"]').textContent(),
      subtitlesAt(manifest, 0).join("\n"),
    )
    await frame
      .locator('[data-testid="canvas"]')
      .screenshot({ path: join(out, "preview-frame-0.png") })
    const previewMs = performance.now() - started
    const presentedFrame = frame.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("No decoded frame after seek")),
            5000,
          )
          document
            .querySelector("video")!
            .requestVideoFrameCallback((_now, metadata) => {
              clearTimeout(timer)
              resolve(metadata.mediaTime)
            })
        }),
    )
    const seekStart = performance.now()
    await page.evaluate(() =>
      document
        .querySelector("iframe")!
        .contentWindow!.postMessage({ type: "seek", frame: 45 }, "*"),
    )
    await frame.waitForFunction(
      (target) => {
        const video = document.querySelector("video")!
        return (
          !video.seeking &&
          video.readyState >= 2 &&
          Math.abs(video.currentTime - target) < 0.1
        )
      },
      manifest.asset.trimStartMs / 1000 + 1.5,
    )
    const presentedMediaTime = await presentedFrame
    assert(
      Math.abs(presentedMediaTime - (manifest.asset.trimStartMs / 1000 + 1.5)) <
        0.1,
    )
    const seekMs = performance.now() - seekStart
    await frame
      .locator('[data-testid="canvas"]')
      .screenshot({ path: join(out, "preview-frame-45.png") })
    assert.equal(
      await frame.locator('[data-testid="subtitle"]').textContent(),
      subtitlesAt(manifest, 45).join("\n"),
    )
    const denied = await frame.evaluate(async () => {
      let parentDenied = false,
        storageDenied = false,
        networkDenied = false
      try {
        void window.parent.document.body
      } catch {
        parentDenied = true
      }
      try {
        localStorage.setItem("probe", "value")
      } catch {
        storageDenied = true
      }
      try {
        await fetch("https://example.com")
      } catch {
        networkDenied = true
      }
      return { parentDenied, storageDenied, networkDenied }
    })
    assert.deepEqual(denied, {
      parentDenied: true,
      storageDenied: true,
      networkDenied: true,
    })
    // Persist in the trusted host, then recreate the iframe and apply the edit.
    const edited = {
      ...manifest,
      props: { ...manifest.props, title: "Reloaded edit", color: "#ff0000" },
    }
    await page.evaluate(
      (m) => localStorage.setItem("manifest", JSON.stringify(m)),
      manifest,
    )
    await page.locator("#title").fill(edited.props.title)
    await page.locator("#color").fill(edited.props.color)
    await page.locator("#save").click()
    const reloadedEdit = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("manifest")!),
    )
    assert.deepEqual(reloadedEdit, edited)
    const warmStarted = performance.now()
    await page.reload()
    await page.waitForFunction(
      () => (window as unknown as { ready: boolean }).ready,
    )
    await page.evaluate(() =>
      document.querySelector("iframe")!.contentWindow!.postMessage(
        {
          type: "load",
          manifest: JSON.parse(localStorage.getItem("manifest")!),
        },
        "*",
      ),
    )
    await page.frames()[1]!.getByText("Reloaded edit").waitFor()
    assert.equal(
      await page
        .frames()[1]!
        .getByText("Reloaded edit")
        .evaluate((e) => getComputedStyle(e).color),
      "rgb(255, 0, 0)",
    )
    const warmEditReadyMs = performance.now() - warmStarted
    await page.screenshot({ path: join(out, "preview.png") })
    // Cross-site opaque iframe + parent-owned deadline. This is an observed
    // browser behavior, not an aggregate desktop-browser memory guarantee.
    await page.evaluate((manifest) => {
      const iframe = document.querySelector("iframe")!
      setTimeout(() => iframe.remove(), 1500)
      iframe.contentWindow!.postMessage(
        {
          type: "load",
          manifest: {
            ...manifest,
            source: "export default () => { while(true) {} }",
          },
        },
        "*",
      )
    }, manifest)
    const infiniteStart = performance.now()
    await page.waitForFunction(
      () => !document.querySelector("iframe"),
      undefined,
      { timeout: 5000 },
    )
    const previewInfiniteRemovedMs = performance.now() - infiniteStart
    return {
      browserVersion: browser.version(),
      specialSiteIsolationFlags: false,
      editedManifest: reloadedEdit,
      warmEditReadyMs,
      previewInfiniteRemovedMs,
      readyMs,
      previewMs,
      seekMs,
      presentedMediaTime,
      bytesServed,
      denied,
      savedEditReloaded: true,
      sourceAtFrame45Ms: manifest.asset.trimStartMs + 1500,
    }
  } finally {
    await browser.close()
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
  }
}
