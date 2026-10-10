/**
 * normalize unit tests — locks the #74 wiring: `documents.language` is decided
 * per document from the CLEANED content (never `entry.languages[0]`), with the
 * decision's two floors kept distinct: `crawl.minContentLength` (250 here —
 * "worth storing?") still rejects a document outright, while the 500-char
 * detection floor and the 0.75 confidence gate only blank the language column
 * (`null` = "not confidently detected", the doc is still stored). A confident
 * detection outside the declared set is stored AND surfaced as a warning on the
 * outcome (content wins, ADR-0006). Pure; no I/O.
 */
import { describe, expect, it } from "vitest"
import type { SourceDefinition } from "../contracts/index.js"
import { normalizeDocument, type RawInput } from "./normalize.js"

const ES_PROSE =
  "La gracia de Dios es un regalo que nunca podríamos ganar por nuestra cuenta. El " +
  "evangelio invita a cada persona a confiar en Jesús, a apartarse del pecado y a " +
  "caminar en la libertad que solo el perdón puede traer a un corazón cansado y roto. " +
  "Cuando leemos las Escrituras descubrimos que el amor del Padre no depende de " +
  "nuestras obras ni de nuestros méritos, sino de su fidelidad eterna. Por eso la fe " +
  "cristiana no es una lista de reglas, sino una relación viva con el Dios que nos " +
  "creó, nos busca y nos llama por nombre cada día de nuestra vida."
const EN_PROSE =
  "God's grace is a gift we could never earn on our own. The gospel invites every " +
  "person to trust Jesus, to turn from sin, and to walk in the freedom that only " +
  "forgiveness can bring to a weary and broken heart. When we read the Scriptures " +
  "we discover that the Father's love does not depend on our works or our merits, " +
  "but on his everlasting faithfulness. That is why the Christian faith is not a " +
  "list of rules but a living relationship with the God who made us, who seeks us " +
  "out, and who calls each of us by name every single day of our lives."
const FR_PROSE =
  "La grâce de Dieu est un don que nous ne pourrions jamais mériter par nous-mêmes. " +
  "L'évangile invite chaque personne à faire confiance à Jésus, à se détourner du " +
  "péché et à marcher dans la liberté que seul le pardon peut apporter au cœur " +
  "fatigué et brisé. Lorsque nous lisons les Écritures, nous découvrons que l'amour " +
  "du Père ne dépend pas de nos œuvres ni de nos mérites, mais de sa fidélité " +
  "éternelle. C'est pourquoi la foi chrétienne n'est pas une liste de règles, mais " +
  "une relation vivante avec le Dieu qui nous a créés et nous appelle par notre nom."
const NOISY_LONG =
  'See https://ex.com/a?utm=1 John 3:16 `const x = f(y)` @handle {"k":"v","n":42} #tag ROI KPI EOF 200 OK GET /v1 <div/> '.repeat(
    5,
  )

/** Synthetic multilingual source: declared set + the 250-char ingest floor. */
function entry(over: Partial<SourceDefinition> = {}): SourceDefinition {
  return {
    key: "test-source",
    name: "Test Source",
    domain: "example.org",
    trust: "owned",
    ingestionMode: "html-scrape",
    languages: ["en", "es"],
    defaultTags: [],
    defaultCategory: "article",
    rights: null,
    crawl: {
      baseUrl: "https://example.org",
      contentSelectors: ["main"],
      stripSelectors: [],
      requestDelayMs: 0,
      maxPages: 10,
      minContentLength: 250,
    },
    ...over,
  }
}

function raw(rawContent: string): RawInput {
  return {
    url: "https://example.org/page",
    canonicalUrl: "https://example.org/page",
    title: "A Page",
    rawContent,
  }
}

describe("normalizeDocument language decision (#74)", () => {
  it("labels a confident Spanish document es (not languages[0])", () => {
    const out = normalizeDocument(entry(), raw(ES_PROSE))
    if (!out.ok) throw new Error("expected ok")
    expect(out.doc.language).toBe("es")
    expect(out.warning).toBeUndefined()
  })

  it("labels a confident English document en", () => {
    const out = normalizeDocument(entry(), raw(EN_PROSE))
    if (!out.ok) throw new Error("expected ok")
    expect(out.doc.language).toBe("en")
  })

  it("stores a confident out-of-declared-set detection and surfaces a warning", () => {
    const out = normalizeDocument(entry(), raw(FR_PROSE))
    if (!out.ok) throw new Error("expected ok")
    expect(out.doc.language).toBe("fr")
    expect(out.warning).toContain("'fr'")
  })

  it("stores language null between the ingest floor (250) and the detection floor (500)", () => {
    const between = ES_PROSE.slice(0, 300)
    const out = normalizeDocument(entry(), raw(between))
    if (!out.ok)
      throw new Error("expected ok — 300 chars clears minContentLength")
    expect(out.doc.language).toBeNull()
    expect(out.warning).toBeUndefined()
  })

  it("stores language null on low-confidence content (never defaults to the declared language)", () => {
    const out = normalizeDocument(entry(), raw(NOISY_LONG))
    if (!out.ok) throw new Error("expected ok")
    expect(out.doc.language).toBeNull()
  })

  it("still rejects a document below minContentLength (the OTHER floor)", () => {
    const out = normalizeDocument(entry(), raw("too short to store"))
    expect(out).toEqual({ ok: false, reason: "too-thin" })
  })

  it("detects on the CLEANED content (whitespace noise does not blank the label)", () => {
    // Same Spanish prose but drowned in raw whitespace: cleanText collapses it,
    // so detection must still see article-length prose and label es.
    const messy = ES_PROSE.split(" ").join("   \t") + "\n\n\n\n"
    const out = normalizeDocument(entry(), raw(messy))
    if (!out.ok) throw new Error("expected ok")
    expect(out.doc.language).toBe("es")
  })
})
