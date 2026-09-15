import { describe, expect, it } from "vitest"

import * as content from "../whats-new-content"
import {
  WHATS_NEW_ASSISTANTS,
  WHATS_NEW_AUDIENCES,
  WHATS_NEW_HERO,
  WHATS_NEW_QUIZ,
} from "../whats-new-content"

/**
 * Every string reachable from the module's exports, paired with the dotted
 * path that reaches it. Walking the VALUES (not the file source) is what
 * keeps code comments out of the copy checks below — a comment may say
 * "Watch" freely, a rendered sentence may not.
 */
function copyStrings(): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = []

  const walk = (node: unknown, path: string): void => {
    if (typeof node === "string") {
      found.push({ path, text: node })
      return
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`))
      return
    }
    if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        walk(child, `${path}.${key}`)
      }
    }
  }

  for (const [name, value] of Object.entries(content)) {
    walk(value, name)
  }

  return found
}

describe("the phone's typed question", () => {
  const { phone } = WHATS_NEW_ASSISTANTS

  it("types exactly the question it then sends", () => {
    // The composer types `typedLines` and the bubble shows
    // `messages[0].text`. They are never on screen at the same moment, so
    // if they drift the phone types one question and sends a different one
    // and the page looks completely fine doing it.
    const sent = phone.messages[0]

    expect(sent.from).toBe("person")
    expect(phone.typedLines.join(" ")).toBe(sent.text)
  })

  it("keeps every typed line inside the measured character budget", () => {
    // Each line is `nowrap` so its height stays exactly one line-height,
    // which is what the typing reveal animates to. The cost is that a long
    // line is CLIPPED, not wrapped. 22 is measured, not guessed: at 28 the
    // first line ran under the send button with its tail cut off.
    for (const line of phone.typedLines) {
      expect(line.length, line).toBeLessThanOrEqual(22)
    }
  })
})

describe("whats-new copy", () => {
  it("names the product 'Jesus Film Watch', never a bare 'Watch'", () => {
    /**
     * Capitalised "Watch" that is NOT already qualified. The product got
     * renamed in one pass over the copy as it stood; new sections written on
     * another branch cannot see that rename, and a clean text merge will not
     * flag it. This guard is what makes the rename hold over time.
     *
     * Both exemptions are non-product uses of the word, verified by hand:
     */
    const exempt = new Set([
      // Imperative verb inside a quoted page title in the phone transcript
      // ("Watch LUMO Gospel films free ..."), not the product name.
      "WHATS_NEW_ASSISTANTS.phone.messages[2].citation.title",
      // A person's stated job title, printed under their own name. Changing
      // someone's title is theirs to decide, not a rename's side effect.
      "WHATS_NEW_PARTNER_LETTER.signature.role",
    ])

    const bare = copyStrings()
      .filter(({ path }) => !exempt.has(path))
      .filter(({ text }) => /(?<!Jesus Film )\bWatch\b/.test(text))
      .map(({ path, text }) => `${path}: ${text}`)

    expect(bare).toEqual([])
  })

  it("never doubles a brand name", () => {
    // The bare-'Watch' guard above is blind to the opposite failure: a
    // blanket "Watch" -> "Jesus Film Watch" rename over copy that already
    // read "Jesus Film Project Watch" produces "Jesus Film Project Jesus
    // Film Watch", which is fully qualified and so passes that check. The
    // meta description shipped exactly that.
    const doubled = copyStrings()
      .filter(({ text }) =>
        /Jesus Film (Project )?Jesus Film|Watch Watch|Jesus Film Watch Library Library/.test(
          text,
        ),
      )
      .map(({ path, text }) => `${path}: ${text}`)

    expect(doubled).toEqual([])
  })

  it("keeps the two halves of the last-updated date on the same day", () => {
    // One fact, two fields: the prose the reader sees and the ISO value the
    // rendered `<time datetime>` carries. Nothing but this test stops an
    // editor updating one and leaving the other pointing at a stale day —
    // and a machine-readable date that disagrees with the visible one is
    // worse than no attribute at all.
    const iso = WHATS_NEW_HERO.lastUpdatedIso
    expect(iso, "ISO form must be YYYY-MM-DD").toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const parsed = new Date(`${iso}T00:00:00Z`)
    const prose = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(parsed)

    expect(WHATS_NEW_HERO.lastUpdated).toBe(prose)
  })

  it("keeps the share out of the audience copy entirely", () => {
    /**
     * The share is one honest, unflattering number. The estimate stage
     * reveals it and the letter sets it as a pull-quote — twice, on
     * purpose. It used to appear a third time, interpolated into the
     * self-identification answer written for exactly the reader it
     * describes, which turned being counted into being told three times in
     * a row that you are a rounding error. That section is gone; this
     * keeps the pressure off the copy that replaced it.
     */
    for (const card of WHATS_NEW_AUDIENCES.cards) {
      expect(card.body, card.title).not.toMatch(/\d+\s*%/)
    }
  })

  it("never hard-codes the ministry share into a sentence", () => {
    // Every printed form of the share is interpolated from one constant, so
    // a corrected figure cannot leave the page stating two different numbers
    // about the same audience. A literal "2%" typed into any copy string is
    // how that guarantee gets lost — the reveal heading and the reveal's
    // note to partners both used to carry one.
    const share = WHATS_NEW_QUIZ.actualPercent
    const literal = new RegExp(`(?<!\\$\\{)\\b${share}%`)

    const offenders = copyStrings()
      .filter(({ text }) => literal.test(text))
      // The interpolated strings are indistinguishable from literals once
      // evaluated, so this can only catch a NEW literal in a string that
      // should not carry the share at all. The three that legitimately
      // print it are the quiz's own reveal and the letter's figure.
      .filter(
        ({ path }) =>
          ![
            "WHATS_NEW_QUIZ.revealHeading",
            "WHATS_NEW_QUIZ.revealPartners",
            "WHATS_NEW_PARTNER_LETTER.figure.value",
          ].includes(path),
      )
      .map(({ path, text }) => `${path}: ${text}`)

    expect(offenders).toEqual([])
  })

  it("keeps both bare-'Watch' exemptions pointing at real strings", () => {
    // Without this, a moved or renamed field turns an exemption into a
    // silent hole: the path stops matching anything and the guard above
    // still passes while the string it excused goes unchecked.
    const byPath = new Map(copyStrings().map(({ path, text }) => [path, text]))

    for (const path of [
      "WHATS_NEW_ASSISTANTS.phone.messages[2].citation.title",
      "WHATS_NEW_PARTNER_LETTER.signature.role",
    ]) {
      expect(byPath.get(path), path).toMatch(/\bWatch\b/)
    }
  })
})
