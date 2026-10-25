/**
 * Split a reflection into short, card-sized chunks (~1–2 sentences each) so each
 * gets its own card + narration and the on-screen text advances WITH the voice.
 * Standalone (no imports) so both the audio and manifest sides can use it
 * without a circular dependency.
 */
export function splitReflection(text: string, maxWords = 32): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
  const chunks: string[] = []
  let cur: string[] = []
  let words = 0
  for (const s of sentences) {
    const w = s.split(/\s+/).length
    if (words + w > maxWords && cur.length) {
      chunks.push(cur.join(" "))
      cur = []
      words = 0
    }
    cur.push(s)
    words += w
  }
  if (cur.length) chunks.push(cur.join(" "))
  return chunks
}
