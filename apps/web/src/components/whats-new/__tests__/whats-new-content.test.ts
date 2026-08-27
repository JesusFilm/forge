import { describe, expect, it } from "vitest"

import * as content from "../whats-new-content"

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
