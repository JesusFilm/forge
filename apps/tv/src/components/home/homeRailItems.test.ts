import { buildRailItems } from "./homeRailItems"
import type { WatchHomeCard } from "../../lib/watchHome/model"

const card = (id: string) => ({ id }) as unknown as WatchHomeCard

describe("buildRailItems", () => {
  it("pads a short rail up to visibleColumns", () => {
    const items = buildRailItems([card("a"), card("b"), card("c")], 5)
    expect(items).toHaveLength(5)
    expect(items.slice(0, 3).map((i) => i.kind)).toEqual([
      "card",
      "card",
      "card",
    ])
    expect(items.slice(3).map((i) => i.kind)).toEqual(["pad", "pad"])
  })

  it("adds no pads when the rail exactly fills the columns", () => {
    const items = buildRailItems([card("a"), card("b")], 2)
    expect(items.map((i) => i.kind)).toEqual(["card", "card"])
  })

  it("adds no pads when the rail exceeds the columns (clamp at 0)", () => {
    const items = buildRailItems([card("a"), card("b"), card("c")], 2)
    expect(items.map((i) => i.kind)).toEqual(["card", "card", "card"])
  })

  it("returns nothing for an empty rail", () => {
    expect(buildRailItems([], 5)).toEqual([])
  })

  it("preserves card order and identity", () => {
    const cards = [card("a"), card("b")]
    const items = buildRailItems(cards, 4)
    expect(items[0]).toEqual({ kind: "card", card: cards[0] })
    expect(items[1]).toEqual({ kind: "card", card: cards[1] })
  })
})
