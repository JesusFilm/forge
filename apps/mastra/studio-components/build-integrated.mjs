/**
 * Build the devotional components for the integrated Shorts runtime, where a
 * component may be any size (Tatai, 2026-10-17). Unlike build.mjs (the
 * 32768-byte Studio builds), every component here is self-contained:
 *
 * - it embeds every face it uses, Latin and Cyrillic together, so no
 *   font-pack items are needed on a fonts track;
 * - one build per element: no -en / -ru pairs;
 * - the Ryle portrait is the full 344 px engraving.
 *
 *   node apps/mastra/studio-components/build-integrated.mjs
 *
 * Writes dist-integrated/<name>.tsx. Components whose source is not kept here
 * (uploaded/) are copied as they are.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, "dist-integrated")
mkdirSync(out, { recursive: true })
const font = (f) => readFileSync(path.join(here, "fonts", f)).toString("base64")

function ryleFull() {
  const src = readFileSync(
    path.join(here, "../../../packages/shorts-compositions/src/devotional/source-portraits.ts"),
    "utf8",
  )
  const m = /RYLE_JPEG_BASE64\s*=\s*\n?\s*"([A-Za-z0-9+/=]+)"/.exec(src)
  if (!m) throw new Error("RYLE_JPEG_BASE64 not found in source-portraits.ts")
  return m[1]
}
function lockup() {
  const src = readFileSync(
    path.join(here, "../../../packages/shorts-compositions/src/devotional/DevotionalVideo.tsx"),
    "utf8",
  )
  const m = /const BRAND_LOCKUP_SVG = `([^`]+)`/.exec(src)
  if (!m) throw new Error("BRAND_LOCKUP_SVG not found in DevotionalVideo.tsx")
  return m[1]
}

// The Cyrillic subsets also carry ASCII and the typographic marks, so one
// file per face covers English and Russian. Inter caps is split by range.
const LATIN = "U+0000-00FF,U+2000-206F"
const CYRILLIC = "U+0400-04FF"
const FACE = {
  lit400: ["DBP Literata", "400", "normal", null, "literata400-cyrillic.woff2"],
  lit400i: ["DBP Literata", "400", "italic", null, "literata400i-cyrillic.woff2"],
  lit500: ["DBP Literata", "500", "normal", null, "literata500-cyrillic.woff2"],
  lit500i: ["DBP Literata", "500", "italic", null, "literata500i-cyrillic.woff2"],
  ss300i: ["DBP Source Serif", "300", "italic", null, "sourceserif300i-latin.woff2"],
  interLat: ["DBP Inter Caps", "600", "normal", LATIN, "inter-600-caps.woff2"],
  interCyr: ["DBP Inter Caps", "600", "normal", CYRILLIC, "inter600caps-cyrillic.woff2"],
  // The reflection line's body face (reveal-sans), Latin from __FONT__ and
  // Cyrillic from this range (2026-10-21).
  inter400Cyr: ["DBP Inter", "400", "normal", CYRILLIC, "inter400-cyrillic.woff2"],
}

/** Registers the faces a component names, once per page, before it renders. */
function prelude(keys) {
  const faces = keys.map((k) => {
    const [family, weight, style, range, file] = FACE[k]
    return [family, weight, style, range, font(file)]
  })
  return `
// Embedded faces (build-integrated.mjs): registered once per page.
const __DBP_FACES: [string, string, string, string | null, string][] = ${JSON.stringify(faces)}
if (typeof FontFace !== "undefined" && typeof document !== "undefined") {
  const __g = globalThis as unknown as Record<string, boolean>
  for (const [family, weight, style, range, b64] of __DBP_FACES) {
    const key = \`__dbpFace_\${family}_\${weight}_\${style}_\${range}\`
    if (__g[key]) continue
    __g[key] = true
    const s = atob(b64)
    const b = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i)
    const face = new FontFace(family, b, range ? { weight, style, unicodeRange: range } : { weight, style })
    document.fonts.add(face)
    face.load().catch(() => {})
  }
}
`
}

const PLACEHOLDERS = {
  __LIT400__: () => font("literata-400.woff2"),
  __INTER600CAPS__: () => font("inter-600-caps.woff2"),
  __INTER600CAPSCYR__: () => font("inter600caps-cyrillic.woff2"),
  __PTSERIFI__: () => font("pt-serif-italic.woff2"),
  __HERO__: () => font("literata-500-caps.woff2"),
  __ACCENT__: () => font("literata-400-italic.woff2"),
  __PLAIN__: () => font("inter-600-caps-plain.woff2"),
  __LOCKUP__: lockup,
  __RYLE__: ryleFull,
}

/** name -> [source, the single-font placeholder's file or null, prelude faces] */
const BUILDS = {
  "film-look": ["film-look", null, []],
  "kinetic-question": ["kinetic-question", null, []],
  "history-credit": ["history-credit", null, []],
  "serif-line": ["serif-line", null, []],
  "close-question": ["close-question", null, []],
  "brand-mark": ["brand-mark", null, []],
  "step-line": ["step-line", null, []],
  "backdrop-blur": ["backdrop-blur", null, []],
  "reveal-serif": ["reveal-serif", "literata400-cyrillic.woff2", []],
  "verse-callout": ["verse-callout", "literata400i-cyrillic.woff2", []],
  "scripture-scroll": ["scripture-scroll", "literata400-cyrillic.woff2", []],
  "closing-verse": ["closing-verse", null, ["ss300i", "lit400i", "lit500", "interLat", "interCyr"]],
  takeaway: ["takeaway", null, ["lit500", "lit500i"]],
  "pray-block": ["pray-block", null, ["lit400", "lit400i", "interLat", "interCyr"]],
  "source-mark": ["source-mark", null, ["lit400", "interLat", "interCyr"]],
  // Layout B and the Inter reflection line (owner, 2026-10-21).
  "reveal-sans": ["reveal-sans", "inter400-latin.woff2", ["inter400Cyr"]],
  "verse-callout-ref": ["verse-callout-ref", "literata300i-cyrillic.woff2", ["interLat", "interCyr"]],
  "source-mark-compact": ["source-mark-compact", null, ["lit400", "interLat", "interCyr"]],
}

for (const [name, [src, single, faces]] of Object.entries(BUILDS)) {
  let code = readFileSync(path.join(here, "src", `${src}.tsx`), "utf8")
  if (single) code = code.split(`"__FONT__"`).join(JSON.stringify(font(single)))
  for (const [key, value] of Object.entries(PLACEHOLDERS))
    if (code.includes(key)) code = code.split(key).join(value())
  if (faces.length) {
    // After the last import line.
    const lines = code.split("\n")
    let at = 0
    lines.forEach((l, i) => {
      if (l.startsWith("import ")) at = i + 1
    })
    lines.splice(at, 0, prelude(faces))
    code = lines.join("\n")
  }
  writeFileSync(path.join(out, `${name}.tsx`), code)
  console.log(`${name}: ${Buffer.byteLength(code)} bytes`)
}

// Kept as uploaded (their sources are not in this folder).
for (const [file, name] of [
  ["caption-orange.tsx", "caption-orange"],
  ["kinetic-ru-v1.tsx", "kinetic-ru"],
  ["cta-calm-ru-v1.tsx", "cta-calm-ru"],
  ["paper-strips-v1.tsx", "paper-strips"],
  ["dbp-mark-v1.tsx", "dbp-mark"],
]) {
  copyFileSync(path.join(here, "uploaded", file), path.join(out, `${name}.tsx`))
  console.log(`${name}: copied from uploaded/${file}`)
}
