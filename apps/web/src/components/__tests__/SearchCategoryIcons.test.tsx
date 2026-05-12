/**
 * @vitest-environment node
 *
 * Exhaustiveness + shape checks for the search-overlay category icons.
 *
 * The icon map is keyed by `searchTerm` from CATEGORIES (search-categories.ts)
 * and constrained to the literal union — TypeScript already enforces both
 * directions of completeness at compile time. These runtime tests pin the
 * contract so a refactor that loosens the Record type (back to
 * Record<string, …>) gets caught here.
 */
import { describe, expect, it } from "vitest"

import {
  BibleIcon,
  BulbIcon,
  CATEGORY_ICON_BY_SEARCH_TERM,
  MediaStrip1Icon,
  MessageText1Icon,
  Star2Icon,
  UsersProfiles2Icon,
} from "@/components/SearchCategoryIcons"
import { CATEGORIES } from "@/lib/search-categories"

describe("SearchCategoryIcons — coverage of CATEGORIES", () => {
  it("every CATEGORIES entry has a matching icon component", () => {
    for (const cat of CATEGORIES) {
      const Icon = CATEGORY_ICON_BY_SEARCH_TERM[cat.searchTerm]
      expect(Icon, `missing icon for ${cat.searchTerm}`).toBeDefined()
      expect(typeof Icon).toBe("function")
    }
  })

  it("the map has no extra keys beyond CATEGORIES", () => {
    // If a category is removed from CATEGORIES, its icon entry should
    // be removed too — otherwise the map carries dead weight.
    const allowed: Set<string> = new Set(CATEGORIES.map((c) => c.searchTerm))
    for (const key of Object.keys(CATEGORY_ICON_BY_SEARCH_TERM)) {
      expect(allowed.has(key), `unexpected key in icon map: ${key}`).toBe(true)
    }
  })

  it("the title→icon mapping mirrors core/apps/watch's CategoryGrid", () => {
    // Pin the upstream-parity mapping so a refactor that changes which
    // icon a category gets surfaces here, not in a visual QA pass.
    expect(CATEGORY_ICON_BY_SEARCH_TERM["bible stories"]).toBe(BibleIcon)
    expect(CATEGORY_ICON_BY_SEARCH_TERM["parables"]).toBe(MessageText1Icon)
    expect(CATEGORY_ICON_BY_SEARCH_TERM["animated"]).toBe(MediaStrip1Icon)
    expect(CATEGORY_ICON_BY_SEARCH_TERM["study"]).toBe(BulbIcon)
    expect(CATEGORY_ICON_BY_SEARCH_TERM["family"]).toBe(UsersProfiles2Icon)
    expect(CATEGORY_ICON_BY_SEARCH_TERM["christmas"]).toBe(Star2Icon)
  })
})

describe("SearchCategoryIcons — component shape", () => {
  // Each icon is `function Icon(props) { return <svg>...</svg> }`. The
  // factory sets displayName for React DevTools; pin it so a refactor
  // that drops the assignment doesn't silently lose the label.
  it("each icon component has a displayName matching its export", () => {
    expect(BibleIcon.displayName).toBe("BibleIcon")
    expect(MessageText1Icon.displayName).toBe("MessageText1Icon")
    expect(MediaStrip1Icon.displayName).toBe("MediaStrip1Icon")
    expect(BulbIcon.displayName).toBe("BulbIcon")
    expect(UsersProfiles2Icon.displayName).toBe("UsersProfiles2Icon")
    expect(Star2Icon.displayName).toBe("Star2Icon")
  })
})
