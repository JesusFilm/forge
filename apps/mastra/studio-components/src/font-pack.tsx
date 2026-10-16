// One embedded font for the devotional look, registered when the item mounts
// and drawing nothing. Put the item on its own track over the whole video so
// the face is there for every text component that names the family. Studio
// components cannot load font files and stay under 32768 bytes, so faces
// travel one per pack instead of inside each text component. build.mjs fills
// the four placeholders per pack.
const FONT = "__FONT__"
const FAMILY = "__FAMILY__"
const WEIGHT = "__WEIGHT__"
const STYLE = "__STYLE__"
const RANGE = "__RANGE__"

const key = `__dbpFont_${FAMILY}_${WEIGHT}_${STYLE}_${RANGE}`
const g = globalThis as unknown as Record<string, boolean>
if (!g[key] && typeof FontFace !== "undefined" && typeof document !== "undefined") {
  g[key] = true
  const s = atob(FONT)
  const b = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i)
  const face = new FontFace(FAMILY, b, { weight: WEIGHT, style: STYLE, unicodeRange: RANGE })
  document.fonts.add(face)
  face.load().catch(() => {})
}

export default function FontPack() {
  return null
}
