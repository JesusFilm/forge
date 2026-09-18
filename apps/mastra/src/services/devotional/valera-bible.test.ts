import { describe, expect, it } from "vitest"

import { normalizeEsCaption } from "./devotional-locale"
import {
  esSpokenReference,
  fetchValeraPassage,
  modernizeValeraOrthography,
} from "./valera-bible"

describe("modernizeValeraOrthography", () => {
  it("drops the 1909 accents on one-letter conjunctions only", () => {
    expect(
      modernizeValeraOrthography(
        "la cubre con vasija, ó la pone debajo de la cama; á los que entran",
      ),
    ).toBe("la cubre con vasija, o la pone debajo de la cama; a los que entran")
    // Real accents inside words stay.
    expect(modernizeValeraOrthography("está aquí, él ó ella")).toBe(
      "está aquí, él o ella",
    )
  })
})

describe("fetchValeraPassage", () => {
  it("joins the requested verses under a Spanish citation", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          book_name: "Lucas",
          verses: [
            { verse: 16, text: "Ninguno que enciende la antorcha ó la cubre." },
            { verse: 17, text: "Porque nada hay oculto." },
            { verse: 18, text: "Mirad pues." },
          ],
        }),
      )) as unknown as typeof fetch
    const p = await fetchValeraPassage("Luke 8:16-17", { fetchFn })
    expect(p.reference).toBe("Lucas 8:16-17")
    expect(p.text).toBe(
      "Ninguno que enciende la antorcha o la cubre. Porque nada hay oculto.",
    )
  })
})

describe("esSpokenReference", () => {
  it("reads chapter and verse with a pause, ranges with 'al'", () => {
    expect(esSpokenReference("Lucas 8:16")).toBe("Lucas 8, 16")
    expect(esSpokenReference("Lucas 8:16-18")).toBe("Lucas 8, 16 al 18")
  })
})

describe("normalizeEsCaption", () => {
  it("tidies the dub track's typing debris without rewording", () => {
    expect(
      normalizeEsCaption("Así pues oigan bien. al que tiene se le dará más."),
    ).toBe("Así pues oigan bien. Al que tiene se le dará más.")
    expect(normalizeEsCaption("para que alumbre  a los que entran.")).toBe(
      "para que alumbre a los que entran.",
    )
    expect(normalizeEsCaption("cubrirla ó ponerla debajo")).toBe(
      "cubrirla o ponerla debajo",
    )
  })
})
