#!/usr/bin/env node
/**
 * Regenerates every app-icon asset from one vector source.
 *
 * Run:  node scripts/generate-app-icon.mjs
 *
 * Design is "Kin": the JFP symbol on a near-black graded field.
 *
 * Two rules worth knowing before editing:
 *   1. The symbol is centred on its CENTROID, not its bounding box. The sliced
 *      bottom-left corner removes weight, so a box-centred symbol visibly sags.
 *   2. Layers written into AppIcon.icon stay FLAT. iOS 26 adds the specular
 *      highlight and the drop shadow itself; baking them in double-applies them.
 *      Only the standalone rasters carry any baked shading.
 *
 * Fallback: if a future Xcode ever rejects the .icon bundle, swap app.json's
 * `ios.icon` for the `{ light, dark, tinted }` PNG form. Emit the dark plate with
 * `compositeSvg(SIZE, WIDTH_IOS, { from: "#1B1613", to: "#070606" })`. That path
 * keeps the glass container but loses per-layer parallax.
 */

import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { Buffer } from "node:buffer"
import path from "node:path"
import fs from "node:fs/promises"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOBILE = path.resolve(HERE, "..")
const REPO = path.resolve(MOBILE, "../..")
const ASSETS = path.join(MOBILE, "assets")
const ICON_BUNDLE = path.join(ASSETS, "AppIcon.icon")

// sharp is a dependency of apps/admin only — deliberately not added to this app,
// where it would ship a native binary into every EAS build for a script that
// runs by hand a couple of times a year.
let sharp
const sharpHost = path.join(REPO, "apps/admin/package.json")
try {
  sharp = createRequire(sharpHost)("sharp")
} catch (err) {
  // Report the real cause. A missing install and an ABI/platform mismatch look
  // identical otherwise, and only one of them is fixed by installing.
  console.error(
    `Could not resolve sharp via ${sharpHost}\n` +
      `  ${err.code ? `[${err.code}] ` : ""}${err.message}\n\n` +
      "This script borrows apps/admin's sharp rather than declaring its own, to\n" +
      "keep a native binary out of every EAS build. If apps/admin is installed and\n" +
      "this still fails, the copy is present but unloadable (platform/ABI), not missing.",
  )
  process.exit(1)
}

/* ---------------------------------------------------------------- geometry */

// Jesus Film Project symbol, verbatim from apps/chat/public/brand/jfp-sign.svg
const MARK =
  "M45.854 -0.000301361H2.34C1.048 -0.000301361 0 1.0467 0 2.3397V20.2427C0 21.2917 " +
  "0.699 22.2137 1.709 22.4957L47.072 35.2077C47.636 35.3657 48.194 34.9417 48.194 " +
  "34.3567V2.3397C48.194 1.0467 47.147 -0.000301361 45.854 -0.000301361Z"
const MW = 48.194
const MH = 35.2077

// Alpha centroid of the path, as a fraction of its bounding box. Measured, not
// guessed — `node scripts/generate-app-icon.mjs --verify-centroid` re-derives it
// from the rasterised path and fails if these drift.
const CX = 0.5388
const CY = 0.4158

const SIZE = 1024

// Two stops only. Icon Composer rejects anything else ("Linear gradients require
// exactly 2 colors"), and the rasters match it stop-for-stop so the App Store
// icon and the on-device icon cannot drift apart.
const FIELD = { from: "#2A231F", to: "#100D0C" }
const MARK_TOP = "#F65360"
const MARK_BOTTOM = "#DE202D"

// Fraction of the tile width the symbol occupies.
const WIDTH_IOS = 0.6
// Android's 108dp canvas only shows its middle 72dp, so the same apparent size
// needs a smaller number here. 0.6 * 72/108 = 0.4, well inside the 66/108 safe zone.
const WIDTH_ANDROID = 0.6 * (72 / 108)
const WIDTH_SPLASH = 0.55

/** Transform placing the symbol's centroid at the centre of a `size` box. */
function markTransform(size, widthFraction) {
  const s = (size * widthFraction) / MW
  const tx = size / 2 - CX * MW * s
  const ty = size / 2 - CY * MH * s
  return `translate(${tx.toFixed(3)},${ty.toFixed(3)}) scale(${s.toFixed(6)})`
}

/**
 * The symbol's own gradient, in objectBoundingBox units.
 *
 * It must NOT be userSpaceOnUse: those coordinates resolve in the element's own
 * space after its transform, so canvas-space numbers land outside the symbol's
 * 48x35 local box and the whole shape flattens to the first stop.
 */
const MARK_GRADIENT = `<linearGradient id="mark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${MARK_TOP}"/>
      <stop offset="1" stop-color="${MARK_BOTTOM}"/>
    </linearGradient>`

/**
 * CSS `linear-gradient(Adeg, …)` expressed as SVG userSpaceOnUse endpoints.
 * CSS measures clockwise from "to top"; SVG wants two points.
 */
function gradientEndpoints(size, cssAngleDeg) {
  const rad = (cssAngleDeg * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  const len = Math.abs(size * dx) + Math.abs(size * dy)
  const c = size / 2
  return {
    x1: c - (dx * len) / 2,
    y1: c - (dy * len) / 2,
    x2: c + (dx * len) / 2,
    y2: c + (dy * len) / 2,
  }
}

/* ------------------------------------------------------------------- pieces */

function fieldSvg(size, field = FIELD) {
  const g = gradientEndpoints(size, 176)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="field" gradientUnits="userSpaceOnUse"
      x1="${g.x1.toFixed(2)}" y1="${g.y1.toFixed(2)}" x2="${g.x2.toFixed(2)}" y2="${g.y2.toFixed(2)}">
      <stop offset="0" stop-color="${field.from}"/>
      <stop offset="1" stop-color="${field.to}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#field)"/>
</svg>`
}

/** The symbol alone on transparency. Pass `fill` for a solid colour (themed icon). */
function markSvg(size, widthFraction, fill) {
  const defs = fill == null ? `<defs>${MARK_GRADIENT}</defs>` : ""
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${defs}
  <path d="${MARK}" transform="${markTransform(size, widthFraction)}" fill="${fill ?? "url(#mark)"}"/>
</svg>`
}

/** Field + symbol composited, for the rasters no OS will enhance. */
function compositeSvg(size, widthFraction, field = FIELD) {
  const g = gradientEndpoints(size, 176)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="field" gradientUnits="userSpaceOnUse"
      x1="${g.x1.toFixed(2)}" y1="${g.y1.toFixed(2)}" x2="${g.x2.toFixed(2)}" y2="${g.y2.toFixed(2)}">
      <stop offset="0" stop-color="${field.from}"/>
      <stop offset="1" stop-color="${field.to}"/>
    </linearGradient>
    ${MARK_GRADIENT}
  </defs>
  <rect width="${size}" height="${size}" fill="url(#field)"/>
  <path d="${MARK}" transform="${markTransform(size, widthFraction)}" fill="url(#mark)"/>
</svg>`
}

/* -------------------------------------------------------------- .icon bundle */

/**
 * Icon Composer encodes a colour as "<color-space>:r,g,b,a".
 * All four components are required — a three-component string is rejected.
 */
function iconColor(hex) {
  const n = parseInt(hex.slice(1), 16)
  const c = (shift) => (((n >> shift) & 255) / 255).toFixed(5)
  return `srgb:${c(16)},${c(8)},${c(0)},1`
}

const ICON_JSON = {
  // `linear-gradient` takes a bare array of colours and runs top-to-bottom.
  // There is no angle parameter, which is fine here: the field is 176deg,
  // i.e. vertical to within four degrees.
  fill: {
    "linear-gradient": [iconColor(FIELD.from), iconColor(FIELD.to)],
  },
  groups: [
    {
      layers: [
        {
          "image-name": "Mark.svg",
          name: "Mark",
          hidden: false,
        },
      ],
      shadow: { kind: "neutral", opacity: 0.5 },
      specular: true,
      translucency: { enabled: false, value: 0.5 },
      "blur-material": 0,
    },
  ],
  "supported-platforms": {
    circles: ["watchOS"],
    squares: ["macOS"],
  },
}

/* --------------------------------------------------------------------- main */

async function png(svg, out, { alpha = true, size = SIZE } = {}) {
  let img = sharp(Buffer.from(svg)).resize(size, size)
  if (!alpha) img = img.flatten({ background: "#100D0C" }).removeAlpha()
  await img.png({ compressionLevel: 9 }).toFile(out)
  const m = await sharp(out).metadata()
  console.log(
    `  ${path.relative(MOBILE, out).padEnd(44)} ${m.width}x${m.height}  ` +
      `${m.hasAlpha ? "RGBA" : "RGB "}  ${(await fs.stat(out)).size.toLocaleString()} B`,
  )
}

/**
 * Re-derives CX/CY from the path so the constants above can't silently rot.
 * Runs on every generation; `quiet` suppresses the pass output so only drift speaks.
 */
async function verifyCentroid({ quiet = false } = {}) {
  const w = 964
  const h = Math.round(w / (MW / MH))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${MW} ${MH}"><path d="${MARK}" fill="#000"/></svg>`
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let sx = 0,
    sy = 0,
    sa = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const a = data[(y * info.width + x) * info.channels + 3] / 255
      if (a > 0) {
        sx += x * a
        sy += y * a
        sa += a
      }
    }
  }
  const cx = sx / sa / info.width
  const cy = sy / sa / info.height
  const drift = Math.max(Math.abs(cx - CX), Math.abs(cy - CY))
  if (!quiet) {
    console.log(
      `measured centroid  ${cx.toFixed(4)}, ${cy.toFixed(4)}\n` +
        `declared           ${CX.toFixed(4)}, ${CY.toFixed(4)}\n` +
        `drift              ${drift.toFixed(5)}`,
    )
  }
  if (drift > 0.001) {
    console.error(
      `\nCentroid constants are stale — measured ${cx.toFixed(4)}, ${cy.toFixed(4)} ` +
        `against declared ${CX.toFixed(4)}, ${CY.toFixed(4)}.\n` +
        "Update CX/CY; every output places the symbol from them.",
    )
    process.exit(1)
  }
  if (!quiet) console.log("\nCentroid constants are current.")
}

async function main() {
  // Re-derive the centroid on EVERY run, not just behind the flag. These two
  // constants place the symbol in every output, so a guard that only fires when
  // someone remembers to ask for it is not guarding anything.
  const explicit = process.argv.includes("--verify-centroid")
  await verifyCentroid({ quiet: !explicit })
  if (explicit) return

  await fs.mkdir(path.join(ICON_BUNDLE, "Assets"), { recursive: true })

  console.log(
    "\niOS — Icon Composer bundle (layers stay flat; the system adds glass)",
  )
  await fs.writeFile(
    path.join(ICON_BUNDLE, "icon.json"),
    JSON.stringify(ICON_JSON, null, 2) + "\n",
  )
  await fs.writeFile(
    path.join(ICON_BUNDLE, "Assets", "Mark.svg"),
    markSvg(SIZE, WIDTH_IOS),
  )
  console.log(`  ${path.relative(MOBILE, ICON_BUNDLE)}/icon.json`)
  console.log(`  ${path.relative(MOBILE, ICON_BUNDLE)}/Assets/Mark.svg`)

  console.log("\nRasters")
  // Feeds the Android legacy launcher, Expo Go, and web — NOT iOS. With
  // ios.icon set to the .icon bundle, prebuild never emits an AppIcon.appiconset
  // and Xcode compiles the iOS and App Store icon from the bundle instead.
  // Must have no alpha channel regardless.
  await png(compositeSvg(SIZE, WIDTH_IOS), path.join(ASSETS, "icon.png"), {
    alpha: false,
  })

  // Android adaptive: foreground and background are separate layers so the
  // launcher can parallax them, and so the field keeps its gradient.
  await png(
    markSvg(SIZE, WIDTH_ANDROID),
    path.join(ASSETS, "adaptive-icon.png"),
  )
  await png(fieldSvg(SIZE), path.join(ASSETS, "adaptive-icon-background.png"))
  // Themed icons: the launcher tints this, so it must be a plain white silhouette.
  await png(
    markSvg(SIZE, WIDTH_ANDROID, "#FFFFFF"),
    path.join(ASSETS, "adaptive-icon-monochrome.png"),
  )

  // Splash sits on splash.backgroundColor, so the symbol ships on transparency.
  await png(markSvg(SIZE, WIDTH_SPLASH), path.join(ASSETS, "splash-icon.png"))

  await png(compositeSvg(196, WIDTH_IOS), path.join(ASSETS, "favicon.png"), {
    alpha: false,
    size: 196,
  })

  console.log(
    "\nDone. `npx expo prebuild --clean` to push these into ios/ and android/.\n",
  )
}

await main()
