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
if (failed) process.exit(1)
