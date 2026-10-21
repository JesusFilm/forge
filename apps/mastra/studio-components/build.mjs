/**
 * Build the devotional look's Shorts Studio components: embed each subset
 * font (and the brand lockup) where the source has a placeholder, write the
 * upload-ready files to dist/, and check every build against the version
 * already uploaded to Studio.
 *
 *   node apps/mastra/studio-components/build.mjs
 *
 * Studio components cannot load files, so fonts travel inside the code as
 * base64 and are registered with FontFace at module load. Upload limit:
 * 32768 bytes per component.
 */
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const font = (f) => readFileSync(path.join(here, "fonts", f)).toString("base64")

// The lockup lives in the long-form composition; read it from there so the
// two never drift apart.
function lockup() {
  const src = readFileSync(
    path.join(
      here,
      "../../../packages/shorts-compositions/src/devotional/DevotionalVideo.tsx",
    ),
    "utf8",
  )
  const m = /const BRAND_LOCKUP_SVG = `([^`]+)`/.exec(src)
  if (!m) throw new Error("BRAND_LOCKUP_SVG not found in DevotionalVideo.tsx")
  return m[1]
}

const PLACEHOLDERS = {
  __LIT400__: () => font("literata-400.woff2"),
  __INTER600CAPS__: () => font("inter-600-caps.woff2"),
  __PTSERIFI__: () => font("pt-serif-italic.woff2"),
  __HERO__: () => font("literata-500-caps.woff2"),
  __ACCENT__: () => font("literata-400-italic.woff2"),
  __PLAIN__: () => font("inter-600-caps-plain.woff2"),
  __INTER600CAPSCYR__: () => font("inter600caps-cyrillic.woff2"),
  __RYLE__: () => readFileSync(path.join(here, "images", "ryle-160.jpg")).toString("base64"),
  __LOCKUP__: lockup,
}

/** Component → the code digest of the version uploaded to Studio (null when
 *  the uploaded digest is not on record here). */
const COMPONENTS = {
  "film-look": "7e945146e329dae08872656357933eb44a40dbd76eb1e6fe149dfe08bbf64f70",
  "kinetic-question":
    "df1db97cb78be400caa98853d674ff717de8d2f635d17ede989ede8a533b6375",
  "history-credit":
    "e66c407c2ed1353d6647891c992ab1988869cb35998be7324c4e30f1069e7527",
  "serif-line": "0ecb8c1a5f85d48c21c7e1c5c115ba2891bce13a28d3eb93cfa974e172901a44",
  "close-question":
    "80fc723a7c4256006c9c901e29eb9744eeaef3a3c2031b6e699bb568b3c2b747",
  "brand-mark": null,
  "step-line": null,
  "backdrop-blur": null, // uploaded as backdrop-blur-v2 (v1 had an SVG grain filter that failed in Studio)
  "closing-verse": null,
  "takeaway": null,
  "pray-block": null,
  "source-mark": null,
}

mkdirSync(path.join(here, "dist"), { recursive: true })
let failed = false
for (const [name, uploaded] of Object.entries(COMPONENTS)) {
  let code = readFileSync(path.join(here, "src", `${name}.tsx`), "utf8")
  for (const [key, value] of Object.entries(PLACEHOLDERS))
    if (code.includes(key)) code = code.split(key).join(value())
  const bytes = Buffer.byteLength(code)
  const digest = createHash("sha256").update(code).digest("hex")
  writeFileSync(path.join(here, "dist", `${name}.tsx`), code)
  const status =
    uploaded == null
      ? "built (no uploaded digest on record)"
      : digest === uploaded
        ? "matches the uploaded version"
        : "DIFFERS from the uploaded version"
  if (bytes > 32768) failed = true
  console.log(
    `${name}: ${bytes} bytes${bytes > 32768 ? " (OVER the 32768 limit)" : ""}, ${status}`,
  )
}
/** One source, one build per script: Latin and Cyrillic subsets do not fit
 *  in one component under the size limit. `__FONT__` is the subset. */
const VARIANTS = {
  "reveal-serif-en": {
    src: "reveal-serif",
    font: "literata400-latin.woff2",
    uploaded: "8d1e837444e6bc3c2158bc984a6a8e73c3b43fe2b58c5416f02eabaf280c5de2",
  },
  "reveal-serif-ru": {
    src: "reveal-serif",
    font: "literata400-cyrillic.woff2",
    uploaded: "83db64eda0373e0fbf92e84006743bbfb928fe5cf2ab64b8593f8c9e696dd249",
  },
  "reveal-sans-en": {
    src: "reveal-sans",
    font: "inter400-latin.woff2",
    uploaded: null,
  },
  "verse-callout-en": {
    src: "verse-callout",
    font: "literata400i-latin.woff2",
    uploaded: null,
  },
  "verse-callout-ru": {
    src: "verse-callout",
    font: "literata400i-cyrillic.woff2",
    uploaded: null,
  },
  "scripture-scroll-en": {
    src: "scripture-scroll",
    font: "literata400-latin.woff2",
    uploaded: null,
  },
  "scripture-scroll-ru": {
    src: "scripture-scroll",
    font: "literata400-cyrillic.woff2",
    uploaded: null,
  },
}
for (const [name, v] of Object.entries(VARIANTS)) {
  const code = readFileSync(path.join(here, "src", `${v.src}.tsx`), "utf8")
    .split(`"__FONT__"`)
    .join(JSON.stringify(font(v.font)))
  const bytes = Buffer.byteLength(code)
  const digest = createHash("sha256").update(code).digest("hex")
  writeFileSync(path.join(here, "dist", `${name}.tsx`), code)
  if (bytes > 32768) failed = true
  console.log(
    `${name}: ${bytes} bytes${bytes > 32768 ? " (OVER the 32768 limit)" : ""}, ${v.uploaded == null ? "built (no uploaded digest on record)" : digest === v.uploaded ? "matches the uploaded version" : "DIFFERS from the uploaded version"}`,
  )
}
/** Font packs: one embedded face per component (src/font-pack.tsx). Latin
 *  packs cover Latin and punctuation; Cyrillic packs only Cyrillic, so a
 *  Russian video loads both and each glyph comes from one file. */
const LATIN = "U+0000-00FF,U+2000-206F"
const CYRILLIC = "U+0400-04FF"
const PACKS = {
  "font-sourceserif300i-latin": ["sourceserif300i-latin.woff2", "DBP Source Serif", "300", "italic", LATIN],
  "font-literata400-latin": ["literata400-latin.woff2", "DBP Literata", "400", "normal", LATIN],
  "font-literata400-cyrillic": ["literata400-cyrillic.woff2", "DBP Literata", "400", "normal", CYRILLIC],
  "font-literata400i-latin": ["literata400i-latin.woff2", "DBP Literata", "400", "italic", LATIN],
  "font-literata400i-cyrillic": ["literata400i-cyrillic.woff2", "DBP Literata", "400", "italic", CYRILLIC],
  "font-literata500-latin": ["literata500-latin.woff2", "DBP Literata", "500", "normal", LATIN],
  "font-literata500-cyrillic": ["literata500-cyrillic.woff2", "DBP Literata", "500", "normal", CYRILLIC],
  "font-literata500i-latin": ["literata500i-latin.woff2", "DBP Literata", "500", "italic", LATIN],
  "font-literata500i-cyrillic": ["literata500i-cyrillic.woff2", "DBP Literata", "500", "italic", CYRILLIC],
  "font-inter600caps-latin": ["inter-600-caps.woff2", "DBP Inter Caps", "600", "normal", LATIN],
  "font-inter600caps-cyrillic": ["inter600caps-cyrillic.woff2", "DBP Inter Caps", "600", "normal", CYRILLIC],
}
const packSrc = readFileSync(path.join(here, "src", "font-pack.tsx"), "utf8")
for (const [name, [file, family, weight, style, range]] of Object.entries(PACKS)) {
  const code = packSrc
    .replace(`"__FONT__"`, JSON.stringify(font(file)))
    .replace(`"__FAMILY__"`, JSON.stringify(family))
    .replace(`"__WEIGHT__"`, JSON.stringify(weight))
    .replace(`"__STYLE__"`, JSON.stringify(style))
    .replace(`"__RANGE__"`, JSON.stringify(range))
  const bytes = Buffer.byteLength(code)
  writeFileSync(path.join(here, "dist", `${name}.tsx`), code)
  if (bytes > 32768) failed = true
  console.log(`${name}: ${bytes} bytes${bytes > 32768 ? " (OVER the 32768 limit)" : ""}`)
}
if (failed) process.exit(1)
