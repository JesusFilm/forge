# Web watch — Language switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a globe icon at the top-right of the watch-page hero that opens a searchable language-switcher overlay, persists the picked language in a cookie, and server-redirects subsequent watch pages to the saved language when a matching variant exists.

**Architecture:** Reuse the existing `LanguagePickerModal` plumbing (`modalState === "language"`, `openLanguage()` callback). Rewrite the modal's body with a new combobox-style picker + Apply/Close footer. Add a globe `<button>` inside `HeroPlayer`, wired through `WatchSectionRenderer` (the dispatcher already passes `modalCallbacks` and `onPlayerReady` — add `onLanguageClick` alongside). Persist preference via a `document.cookie` write on Apply; read it server-side in `app/[slug]/[locale]/page.tsx` and `redirect()` when the cookie language differs from the URL locale and a published HLS variant exists.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind, base-ui Dialog primitives (`@/components/ui/dialog`), Lucide icons, gql.tada types from `WatchVideoRecord.variants`, vitest + jsdom + React 19 `act()` (no RTL; tests use `createRoot()` + `document.querySelector`).

**Spec:** `docs/superpowers/specs/2026-05-12-web-watch-language-switcher-design.md`

---

## File structure

| Path                                                                   | Role                                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/language-preference-client.ts`                       | New. Cookie write helper (client). Exports `writePreferredLanguageSlug(slug)` and `LANGUAGE_PREFERENCE_COOKIE`.            |
| `apps/web/src/lib/language-preference-server.ts`                       | New. Cookie read helper (server, `next/headers`) + the pure `shouldRedirectForPreference(...)` decision function.          |
| `apps/web/src/lib/language-preference.test.ts`                         | New. Co-located vitest for both helpers + the decision function.                                                           |
| `apps/web/src/components/watch/LanguageCombobox.tsx`                   | New. Popover trigger + search input + scrollable list + keyboard nav. Pure controlled component.                           |
| `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx`    | New. Filter, keyboard, click-outside.                                                                                      |
| `apps/web/src/components/watch/LanguagePickerModal.tsx`                | Rewrite. Same prop shape; new layout, draft state, Apply/Close footer, embedded `LanguageCombobox`, cookie write on Apply. |
| `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` | Rewrite. Keep navigation assertions; add Apply/Close, draft reset, cookie-write-before-nav tests.                          |
| `apps/web/src/components/watch/HeroPlayer.tsx`                         | Modify. Accept optional `onLanguageClick`, render a globe button at top-right when `variantCount >= 2`.                    |
| `apps/web/src/components/watch/WatchSectionRenderer.tsx`               | Modify. Thread `modalCallbacks?.openLanguage` into the HeroPlayer dispatcher case.                                         |
| `apps/web/src/app/[slug]/[locale]/page.tsx`                            | Modify. Read preference cookie, compute redirect via `shouldRedirectForPreference`, call `redirect()` when applicable.     |

Two responsibilities per new lib file (client vs server) because `next/headers` can only be imported from server code. Sharing the cookie-name constant across both files is acceptable duplication — DRYing it through a third "constants" file isn't worth the indirection.

---

### Task 1: Cookie helpers

**Files:**

- Create: `apps/web/src/lib/language-preference-client.ts`
- Create: `apps/web/src/lib/language-preference-server.ts`
- Test: `apps/web/src/lib/language-preference.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/language-preference.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  LANGUAGE_PREFERENCE_COOKIE,
  writePreferredLanguageSlug,
} from "./language-preference-client"
import { shouldRedirectForPreference } from "./language-preference-server"

describe("writePreferredLanguageSlug", () => {
  beforeEach(() => {
    document.cookie
      .split(";")
      .map((c) => c.split("=")[0]?.trim())
      .filter(Boolean)
      .forEach((name) => {
        document.cookie = `${name}=; path=/watch; max-age=0`
      })
  })

  it("uses the expected cookie name", () => {
    expect(LANGUAGE_PREFERENCE_COOKIE).toBe("forge_watch_lang")
  })

  it("writes the slug with path=/watch, max-age=1y, samesite=lax", () => {
    const setSpy = vi.fn<(value: string) => void>()
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get() {
        return ""
      },
      set(value: string) {
        setSpy(value)
      },
    })

    writePreferredLanguageSlug("spanish")

    expect(setSpy).toHaveBeenCalledOnce()
    const written = setSpy.mock.calls[0]![0]
    expect(written).toContain("forge_watch_lang=spanish")
    expect(written).toContain("path=/watch")
    expect(written).toContain("max-age=31536000")
    expect(written.toLowerCase()).toContain("samesite=lax")
  })

  it("URL-encodes special characters in the slug", () => {
    const setSpy = vi.fn<(value: string) => void>()
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get() {
        return ""
      },
      set(value: string) {
        setSpy(value)
      },
    })

    writePreferredLanguageSlug("zh hant")

    expect(setSpy.mock.calls[0]![0]).toContain(
      `forge_watch_lang=${encodeURIComponent("zh hant")}`,
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})

describe("shouldRedirectForPreference", () => {
  const playable = (slug: string) => ({
    language: { slug },
    published: true,
    hls: "https://stream.mux.com/x.m3u8",
  })

  it("returns null when no preference is set", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: null,
        rawLocale: "english",
        variants: [playable("english"), playable("spanish")],
      }),
    ).toBeNull()
  })

  it("returns null when preference matches the URL locale", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: "spanish",
        rawLocale: "spanish",
        variants: [playable("spanish")],
      }),
    ).toBeNull()
  })

  it("returns null when no playable variant exists for the preference", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: "spanish",
        rawLocale: "english",
        variants: [playable("english"), playable("french")],
      }),
    ).toBeNull()
  })

  it("returns null when the matching variant is unpublished", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: "spanish",
        rawLocale: "english",
        variants: [
          playable("english"),
          { ...playable("spanish"), published: false },
        ],
      }),
    ).toBeNull()
  })

  it("returns null when the matching variant has null hls", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: "spanish",
        rawLocale: "english",
        variants: [playable("english"), { ...playable("spanish"), hls: null }],
      }),
    ).toBeNull()
  })

  it("returns the preference slug when a published HLS variant exists", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: "spanish",
        rawLocale: "english",
        variants: [playable("english"), playable("spanish")],
      }),
    ).toBe("spanish")
  })

  it("tolerates null and missing entries in the variants list", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: "spanish",
        rawLocale: "english",
        variants: [null, playable("english"), playable("spanish")],
      }),
    ).toBe("spanish")
  })
})
```

- [ ] **Step 2: Run the test, verify failure**

```bash
pnpm --filter @forge/web test src/lib/language-preference.test.ts
```

Expected: FAIL with "Cannot find module './language-preference-client'" / 'server'.

- [ ] **Step 3: Create the client helper**

Create `apps/web/src/lib/language-preference-client.ts`:

```ts
export const LANGUAGE_PREFERENCE_COOKIE = "forge_watch_lang"

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export function writePreferredLanguageSlug(slug: string): void {
  if (typeof document === "undefined") return
  const secure = process.env.NODE_ENV === "production" ? "; secure" : ""
  document.cookie = `${LANGUAGE_PREFERENCE_COOKIE}=${encodeURIComponent(slug)}; path=/watch; max-age=${ONE_YEAR_SECONDS}; samesite=lax${secure}`
}
```

- [ ] **Step 4: Create the server helper**

Create `apps/web/src/lib/language-preference-server.ts`:

```ts
import "server-only"
import { cookies } from "next/headers"

export const LANGUAGE_PREFERENCE_COOKIE = "forge_watch_lang"

export async function readPreferredLanguageSlug(): Promise<string | null> {
  const store = await cookies()
  return store.get(LANGUAGE_PREFERENCE_COOKIE)?.value ?? null
}

type ShouldRedirectInput = {
  preferredSlug: string | null
  rawLocale: string
  variants: ReadonlyArray<
    | {
        language?: { slug?: string | null } | null
        published?: boolean | null
        hls?: string | null
      }
    | null
    | undefined
  >
}

export function shouldRedirectForPreference({
  preferredSlug,
  rawLocale,
  variants,
}: ShouldRedirectInput): string | null {
  if (!preferredSlug) return null
  if (preferredSlug === rawLocale) return null
  const hasPlayable = variants.some(
    (v) =>
      v?.language?.slug === preferredSlug &&
      v?.published === true &&
      v?.hls != null,
  )
  return hasPlayable ? preferredSlug : null
}
```

Note: the `"server-only"` import causes a build error if a client component imports this file. That guards against accidental misuse.

- [ ] **Step 5: Run the test, verify pass**

```bash
pnpm --filter @forge/web test src/lib/language-preference.test.ts
```

Expected: PASS — all assertions green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/language-preference-client.ts \
        apps/web/src/lib/language-preference-server.ts \
        apps/web/src/lib/language-preference.test.ts
git commit -m "feat(web): add language-preference cookie helpers"
```

---

### Task 2: LanguageCombobox component

**Files:**

- Create: `apps/web/src/components/watch/LanguageCombobox.tsx`
- Test: `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LanguageCombobox } from "@/components/watch/LanguageCombobox"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector) as HTMLElement | null
}

function $$(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector)) as HTMLElement[]
}

const OPTIONS = [
  { slug: "english", name: "English" },
  { slug: "spanish", name: "Spanish" },
  { slug: "french", name: "French" },
  { slug: "german", name: "German" },
]

describe("LanguageCombobox", () => {
  it("renders the currently selected option label in the trigger", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="spanish"
          onChange={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="language-combobox-trigger"]')?.textContent).toMatch(
      /Spanish/,
    )
  })

  it("opens the popover on trigger click", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="spanish"
          onChange={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="language-combobox-popover"]')).toBeNull()
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    expect($('[data-testid="language-combobox-popover"]')).not.toBeNull()
  })

  it("filters the list as the user types (case-insensitive)", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="spanish"
          onChange={vi.fn()}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const input = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      input.value = "spA"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const items = $$('[data-testid="language-combobox-option"]')
    expect(items.map((el) => el.textContent)).toEqual(["Spanish"])
  })

  it("calls onChange and closes the popover when an option is clicked", () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="spanish"
          onChange={onChange}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const french = $$('[data-testid="language-combobox-option"]').find((el) =>
      el.textContent?.includes("French"),
    )!
    act(() => {
      french.click()
    })

    expect(onChange).toHaveBeenCalledWith("french")
    expect($('[data-testid="language-combobox-popover"]')).toBeNull()
  })

  it("Down arrow + Enter selects the highlighted option", () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="english"
          onChange={onChange}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const input = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      )
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )
    })

    // english is index 0; ArrowDown moves to spanish (index 1)
    expect(onChange).toHaveBeenCalledWith("spanish")
  })

  it("Escape closes the popover without calling onChange", () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="english"
          onChange={onChange}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const input = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      )
    })

    expect($('[data-testid="language-combobox-popover"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("clicking outside the popover closes it", () => {
    act(() => {
      root.render(
        <div>
          <LanguageCombobox
            options={OPTIONS}
            value="english"
            onChange={vi.fn()}
          />
          <div data-testid="outside" style={{ height: 10 }} />
        </div>,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    expect($('[data-testid="language-combobox-popover"]')).not.toBeNull()

    act(() => {
      $('[data-testid="outside"]')?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      )
    })

    expect($('[data-testid="language-combobox-popover"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test, verify failure**

```bash
pnpm --filter @forge/web test src/components/watch/__tests__/LanguageCombobox.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/watch/LanguageCombobox'".

- [ ] **Step 3: Create the component**

Create `apps/web/src/components/watch/LanguageCombobox.tsx`:

```tsx
"use client"

import { ChevronsUpDown, Languages } from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"

export type LanguageComboboxOption = {
  slug: string
  name: string
}

export type LanguageComboboxProps = {
  options: LanguageComboboxOption[]
  value: string
  onChange: (slug: string) => void
  placeholder?: string
}

export function LanguageCombobox({
  options,
  value,
  onChange,
  placeholder = "Select language",
}: LanguageComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const selected = options.find((o) => o.slug === value) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.name.toLowerCase().includes(q))
  }, [options, query])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    setActiveIndex(0)
    setQuery("")
  }, [open])

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0)
  }, [filtered.length, activeIndex])

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(event: MouseEvent) {
      const target = event.target as Node
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [open])

  const handleSelect = useCallback(
    (slug: string) => {
      onChange(slug)
      setOpen(false)
    },
    [onChange],
  )

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (event.key === "Enter") {
        event.preventDefault()
        const option = filtered[activeIndex]
        if (option) handleSelect(option.slug)
      } else if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
      }
    },
    [activeIndex, filtered, handleSelect],
  )

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="language-combobox-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center justify-between gap-3 rounded-full border border-stone-700 bg-stone-800/60 px-4 py-3 text-left text-base font-medium text-stone-100 transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
      >
        <span className="flex items-center gap-3">
          <Languages aria-hidden className="h-5 w-5 text-stone-400" />
          <span>{selected?.name ?? placeholder}</span>
        </span>
        <ChevronsUpDown aria-hidden className="h-4 w-4 text-stone-400" />
      </button>

      {open ? (
        <div
          ref={popoverRef}
          data-testid="language-combobox-popover"
          role="dialog"
          className="absolute left-0 right-0 z-20 mt-2 rounded-2xl border border-stone-700 bg-stone-900 shadow-xl"
        >
          <div className="border-b border-stone-700 px-3 py-2">
            <input
              ref={searchRef}
              data-testid="language-combobox-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search languages…"
              className="w-full bg-transparent text-sm text-stone-100 placeholder:text-stone-500 focus:outline-none"
            />
          </div>
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li
                data-testid="language-combobox-empty"
                className="px-4 py-3 text-sm text-stone-500"
              >
                No matches
              </li>
            ) : (
              filtered.map((option, index) => {
                const active = index === activeIndex
                return (
                  <li key={option.slug}>
                    <button
                      type="button"
                      data-testid="language-combobox-option"
                      data-language-slug={option.slug}
                      data-active={active ? "true" : "false"}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => handleSelect(option.slug)}
                      className={`w-full px-4 py-2 text-left text-sm transition ${
                        active
                          ? "bg-stone-700 text-stone-50"
                          : "text-stone-200 hover:bg-stone-800"
                      }`}
                    >
                      {option.name}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Run the test, verify pass**

```bash
pnpm --filter @forge/web test src/components/watch/__tests__/LanguageCombobox.test.tsx
```

Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/watch/LanguageCombobox.tsx \
        apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx
git commit -m "feat(web): add LanguageCombobox (popover + search + keyboard nav)"
```

---

### Task 3: LanguagePickerModal rewrite

**Files:**

- Modify: `apps/web/src/components/watch/LanguagePickerModal.tsx` (entire body — keep prop shape)
- Modify: `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` (replace test bodies — keep file path & describe naming)

- [ ] **Step 1: Read the existing test file**

```bash
sed -n '1,80p' apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx
```

Note the `vi.hoisted` `routerPushMock` pattern and the `makeVariant` factory at the top. Keep both.

- [ ] **Step 2: Replace the test file with the new behavior set**

Overwrite `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 *
 * LanguagePickerModal tests — globe-driven overlay rewrite.
 *
 * Covers:
 *  - Apply disabled until selection differs from current
 *  - Apply navigates with `/{videoSlug}/{newSlug}?t={currentTime}` (no /watch/)
 *  - Apply writes the language-preference cookie BEFORE router.push
 *  - Close does nothing besides onClose
 *  - Draft resets when the modal reopens
 *  - Selecting the current language and clicking Apply is a no-op nav
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MuxPlayerRef } from "@forge/video-player"

const { routerPushMock, writePreferredLanguageSlugMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  writePreferredLanguageSlugMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}))

vi.mock("@/lib/language-preference-client", () => ({
  LANGUAGE_PREFERENCE_COOKIE: "forge_watch_lang",
  writePreferredLanguageSlug: writePreferredLanguageSlugMock,
}))

import {
  LanguagePickerModal,
  type LanguagePickerVariant,
} from "@/components/watch/LanguagePickerModal"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  routerPushMock.mockReset()
  writePreferredLanguageSlugMock.mockReset()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ""
})

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector) as HTMLElement | null
}

function $$(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector)) as HTMLElement[]
}

function makeVariant(
  overrides: Partial<LanguagePickerVariant> & {
    documentId: string
    languageSlug: string
  },
): LanguagePickerVariant {
  const { languageSlug, documentId, ...rest } = overrides
  const base: LanguagePickerVariant = {
    documentId,
    hls: "https://stream.mux.com/x.m3u8",
    published: true,
    language: {
      coreId: languageSlug,
      slug: languageSlug,
      name: languageSlug,
    },
  }
  return { ...base, ...rest }
}

function makePlayerRef(currentTime: number) {
  const player = { currentTime } as unknown as MuxPlayerRef
  return { current: player }
}

function renderModal({
  open,
  currentLanguageSlug = "english",
  variants,
  videoSlug = "the-call",
  playerRef = makePlayerRef(42),
  onClose = vi.fn(),
}: {
  open: boolean
  currentLanguageSlug?: string
  variants: LanguagePickerVariant[]
  videoSlug?: string
  playerRef?: ReturnType<typeof makePlayerRef>
  onClose?: () => void
}) {
  act(() => {
    root.render(
      <LanguagePickerModal
        open={open}
        variants={variants}
        currentLanguageSlug={currentLanguageSlug}
        videoSlug={videoSlug}
        playerRef={playerRef}
        onClose={onClose}
      />,
    )
  })
  return { onClose }
}

const baseVariants = [
  makeVariant({ documentId: "v1", languageSlug: "english" }),
  makeVariant({ documentId: "v2", languageSlug: "spanish" }),
  makeVariant({ documentId: "v3", languageSlug: "french" }),
]

describe("LanguagePickerModal — globe overlay", () => {
  it("Apply is disabled when the modal first opens", () => {
    renderModal({ open: true, variants: baseVariants })
    const apply = $(
      '[data-testid="watch-language-picker-apply"]',
    ) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
  })

  it("Apply enables once the user picks a different language", () => {
    renderModal({ open: true, variants: baseVariants })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find((el) =>
      el.textContent?.includes("spanish"),
    )!
    act(() => {
      spanish.click()
    })
    const apply = $(
      '[data-testid="watch-language-picker-apply"]',
    ) as HTMLButtonElement
    expect(apply.disabled).toBe(false)
  })

  it("Apply writes the cookie BEFORE calling router.push, then closes", () => {
    const onClose = vi.fn()
    renderModal({ open: true, variants: baseVariants, onClose })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find((el) =>
      el.textContent?.includes("spanish"),
    )!
    act(() => {
      spanish.click()
    })
    act(() => {
      $('[data-testid="watch-language-picker-apply"]')?.click()
    })

    expect(writePreferredLanguageSlugMock).toHaveBeenCalledWith("spanish")
    expect(routerPushMock).toHaveBeenCalledWith("/the-call/spanish?t=42")
    const writeOrder =
      writePreferredLanguageSlugMock.mock.invocationCallOrder[0]!
    const pushOrder = routerPushMock.mock.invocationCallOrder[0]!
    expect(writeOrder).toBeLessThan(pushOrder)
    expect(onClose).toHaveBeenCalled()
  })

  it("Close does not write the cookie and does not navigate", () => {
    const onClose = vi.fn()
    renderModal({ open: true, variants: baseVariants, onClose })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find((el) =>
      el.textContent?.includes("spanish"),
    )!
    act(() => {
      spanish.click()
    })
    act(() => {
      $('[data-testid="watch-language-picker-close"]')?.click()
    })

    expect(writePreferredLanguageSlugMock).not.toHaveBeenCalled()
    expect(routerPushMock).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("re-opening after a cancelled change resets the draft to the current language", () => {
    renderModal({ open: true, variants: baseVariants })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find((el) =>
      el.textContent?.includes("spanish"),
    )!
    act(() => {
      spanish.click()
    })
    // Close without applying
    act(() => {
      $('[data-testid="watch-language-picker-close"]')?.click()
    })

    // Re-render with open=false then open=true
    renderModal({ open: false, variants: baseVariants })
    renderModal({ open: true, variants: baseVariants })

    const apply = $(
      '[data-testid="watch-language-picker-apply"]',
    ) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    expect($('[data-testid="language-combobox-trigger"]')?.textContent).toMatch(
      /english/i,
    )
  })

  it("selecting the current language and clicking Apply does not navigate", () => {
    renderModal({ open: true, variants: baseVariants })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const english = $$('[data-testid="language-combobox-option"]').find((el) =>
      el.textContent?.includes("english"),
    )!
    act(() => {
      english.click()
    })
    const apply = $(
      '[data-testid="watch-language-picker-apply"]',
    ) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
  })

  it("renders the count of playable variants in the header", () => {
    renderModal({
      open: true,
      variants: [
        ...baseVariants,
        makeVariant({
          documentId: "v4",
          languageSlug: "german",
          published: false,
        }),
        makeVariant({ documentId: "v5", languageSlug: "italian", hls: null }),
      ],
    })
    const count = $('[data-testid="watch-language-picker-count"]')
    expect(count?.textContent).toBe("3 languages")
  })

  it("does not render when open is false", () => {
    renderModal({ open: false, variants: baseVariants })
    expect($('[data-testid="watch-language-picker-apply"]')).toBeNull()
  })
})
```

- [ ] **Step 3: Run the new test file, verify the existing component fails it**

```bash
pnpm --filter @forge/web test src/components/watch/__tests__/LanguagePickerModal.test.tsx
```

Expected: FAIL — the current modal has no `watch-language-picker-apply` / `watch-language-picker-close` / `watch-language-picker-count` testids.

- [ ] **Step 4: Rewrite LanguagePickerModal**

Overwrite `apps/web/src/components/watch/LanguagePickerModal.tsx`:

```tsx
"use client"

import type { Route } from "next"
import { useRouter } from "next/navigation"
import type { RefObject } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"

import type { MuxPlayerRef } from "@forge/video-player"

import { LanguageCombobox } from "@/components/watch/LanguageCombobox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { writePreferredLanguageSlug } from "@/lib/language-preference-client"

export type LanguagePickerVariant = {
  documentId: string
  hls: string | null
  published: boolean | null
  language: {
    coreId?: string | null
    slug: string | null
    name: string | null
  } | null
}

export type LanguagePickerModalProps = {
  open: boolean
  variants: LanguagePickerVariant[]
  currentLanguageSlug: string
  videoSlug: string
  playerRef: RefObject<MuxPlayerRef | null>
  onClose: () => void
}

export function LanguagePickerModal({
  open,
  variants,
  currentLanguageSlug,
  videoSlug,
  playerRef,
  onClose,
}: LanguagePickerModalProps) {
  const router = useRouter()

  const options = useMemo(
    () =>
      variants
        .filter(
          (v) =>
            v.published === true && v.hls != null && v.language?.slug != null,
        )
        .map((v) => ({
          slug: v.language!.slug!,
          name: v.language!.name ?? v.language!.slug!,
        })),
    [variants],
  )

  const [draftSlug, setDraftSlug] = useState(currentLanguageSlug)

  // Reset the draft each time the modal opens.
  useEffect(() => {
    if (open) setDraftSlug(currentLanguageSlug)
  }, [open, currentLanguageSlug])

  const isDirty = draftSlug !== currentLanguageSlug

  const handleApply = useCallback(() => {
    if (!isDirty) return
    writePreferredLanguageSlug(draftSlug)
    const t = playerRef.current?.currentTime ?? 0
    // basePath '/watch' auto-prepended at runtime — do NOT include here.
    const href = `/${videoSlug}/${draftSlug}?t=${t}` as Route
    router.push(href)
    onClose()
  }, [draftSlug, isDirty, onClose, playerRef, router, videoSlug])

  function handleOpenChange(next: boolean) {
    if (!next) onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="watch-language-picker-modal"
        className="sm:max-w-lg"
      >
        <DialogHeader className="flex flex-row items-baseline justify-between gap-3">
          <DialogTitle className="text-2xl font-bold">Language</DialogTitle>
          <span
            data-testid="watch-language-picker-count"
            className="text-sm text-stone-400"
          >
            {options.length} languages
          </span>
        </DialogHeader>

        <div className="mt-4">
          <LanguageCombobox
            options={options}
            value={draftSlug}
            onChange={setDraftSlug}
          />
        </div>

        <div className="mt-8 flex items-center justify-end gap-3">
          <button
            type="button"
            data-testid="watch-language-picker-close"
            onClick={onClose}
            className="px-6 py-2 text-sm font-semibold text-stone-300 transition hover:text-stone-100"
          >
            CLOSE
          </button>
          <button
            type="button"
            data-testid="watch-language-picker-apply"
            disabled={!isDirty}
            onClick={handleApply}
            className="rounded-full bg-stone-100 px-6 py-2 text-sm font-semibold text-stone-900 transition disabled:cursor-not-allowed disabled:bg-stone-500 disabled:text-stone-800"
          >
            APPLY
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5: Run the test, verify pass**

```bash
pnpm --filter @forge/web test src/components/watch/__tests__/LanguagePickerModal.test.tsx
```

Expected: PASS — all 8 tests green.

- [ ] **Step 6: Run typecheck**

```bash
pnpm --filter @forge/web typecheck
```

Expected: no new errors. (If `Route` from `next` complains about a non-static href, that is the existing pattern — keep the `as Route` cast.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/watch/LanguagePickerModal.tsx \
        apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx
git commit -m "feat(web): rewrite LanguagePickerModal with combobox + Apply/Close + cookie"
```

---

### Task 4: Globe button inside HeroPlayer

**Files:**

- Modify: `apps/web/src/components/watch/HeroPlayer.tsx`

This task has no new test file — the button is presentational and the modal-opening behavior is covered by Task 5's wiring + manual verification.

- [ ] **Step 1: Read the current HeroPlayer top-level structure**

```bash
sed -n '1,60p' apps/web/src/components/watch/HeroPlayer.tsx
```

Identify where the hero's outer container is and where the existing overlay layer for the unmute pill is mounted.

- [ ] **Step 2: Find the right insertion point**

```bash
grep -n "absolute\|z-10\|z-20\|right-\|aria-label" apps/web/src/components/watch/HeroPlayer.tsx | head -20
```

The unmute pill is at `bottom-0 right-6 left-10` with `z-10`. Add the globe button in the same overlay layer but at `top-4 right-4` so it floats top-right per the mockup.

- [ ] **Step 3: Add the `onLanguageClick` prop and globe button**

Edit `apps/web/src/components/watch/HeroPlayer.tsx`. At the top of the file, add the lucide import alongside any existing imports:

```tsx
import { Globe } from "lucide-react"
```

Extend the component's props type to include:

```tsx
onLanguageClick?: () => void
playableLanguageCount?: number
```

Inside the component, destructure `onLanguageClick` and `playableLanguageCount` from props. Compute:

```tsx
const showLanguageSwitch =
  typeof onLanguageClick === "function" && (playableLanguageCount ?? 0) >= 2
```

In the overlay layer (the same absolutely-positioned wrapper that holds the unmute pill), add — guarded by `showLanguageSwitch`:

```tsx
{
  showLanguageSwitch ? (
    <button
      type="button"
      data-testid="hero-player-language-button"
      onClick={onLanguageClick}
      aria-label="Switch language"
      className="absolute top-4 right-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-stone-900/60 text-stone-100 backdrop-blur-sm transition hover:bg-stone-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
    >
      <Globe aria-hidden className="h-5 w-5" />
    </button>
  ) : null
}
```

If the overlay wrapper does not currently span the full hero (it may be anchored to the bottom for the unmute pill), wrap the globe button in its own absolutely-positioned `<div className="pointer-events-none absolute inset-0"><div className="pointer-events-auto">…</div></div>` block at the top-level of the hero JSX so it floats independently.

- [ ] **Step 4: Run the existing HeroPlayer tests to verify no regression**

```bash
pnpm --filter @forge/web test src/components/watch/__tests__/HeroPlayer
```

Expected: PASS — existing assertions unchanged. (If the file has no tests, the command exits with "no tests found" which is OK for this task.)

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter @forge/web typecheck
```

Expected: clean — the new props are optional so existing callers still type-check.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/watch/HeroPlayer.tsx
git commit -m "feat(web): add globe language-switch button to hero overlay"
```

---

### Task 5: Wire HeroPlayer through WatchSectionRenderer

**Files:**

- Modify: `apps/web/src/components/watch/WatchSectionRenderer.tsx`

- [ ] **Step 1: Read the HeroPlayer dispatch case**

```bash
grep -n "HeroPlayer" apps/web/src/components/watch/WatchSectionRenderer.tsx
```

The dispatcher currently passes `block` and `onPlayerReady`. We add two more props.

- [ ] **Step 2: Update the dispatcher**

Change the `case "HeroPlayer":` branch to pass `onLanguageClick` and `playableLanguageCount`. The block carries `video` which has `variants` — compute the count inline.

```tsx
case "HeroPlayer": {
  const playableLanguageCount = (block.video.variants ?? []).filter(
    (v) =>
      v != null &&
      v.published === true &&
      v.hls != null &&
      v.language?.slug != null,
  ).length
  return (
    <HeroPlayer
      block={block}
      onPlayerReady={onPlayerReady}
      onLanguageClick={modalCallbacks?.openLanguage}
      playableLanguageCount={playableLanguageCount}
    />
  )
}
```

If `block.video.variants` typing requires a null-narrow, mirror the same `(v): v is NonNullable<typeof v> => v != null` pattern used elsewhere in the file.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @forge/web typecheck
```

Expected: clean.

- [ ] **Step 4: Run the affected test files**

```bash
pnpm --filter @forge/web test src/components/watch
```

Expected: PASS — no regression in any watch test.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/watch/WatchSectionRenderer.tsx
git commit -m "feat(web): thread openLanguage + variant count into HeroPlayer"
```

---

### Task 6: Server-side redirect in page.tsx

**Files:**

- Modify: `apps/web/src/app/[slug]/[locale]/page.tsx`

- [ ] **Step 1: Add the imports**

At the top of `apps/web/src/app/[slug]/[locale]/page.tsx`, add:

```ts
import { redirect } from "next/navigation"
import {
  readPreferredLanguageSlug,
  shouldRedirectForPreference,
} from "@/lib/language-preference-server"
```

- [ ] **Step 2: Insert the redirect check after `resolveWatchVideoBySlug`**

After the existing `const watchVideo = await resolveWatchVideoBySlug(slug, locale)` line, and **before** the `if (watchVideo) { ... }` branch, insert:

```ts
const preferredSlug = await readPreferredLanguageSlug()
const redirectSlug = shouldRedirectForPreference({
  preferredSlug,
  rawLocale,
  variants: watchVideo?.video.variants ?? [],
})
if (redirectSlug) {
  // basePath '/watch' is auto-prepended at runtime; do NOT include here.
  redirect(`/${slug}/${redirectSlug}`)
}
```

The variants list comes from the just-resolved video. `shouldRedirectForPreference` short-circuits to `null` when no preference is set, when the preference already matches the URL, or when no playable variant exists — making this a near-zero-cost addition for users without the cookie.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @forge/web typecheck
```

Expected: clean. The `shouldRedirectForPreference` signature in Task 1 accepts a permissive variants shape that matches `watchVideo.video.variants`.

- [ ] **Step 4: Run the full web test suite**

```bash
pnpm --filter @forge/web test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/[slug]/[locale]/page.tsx
git commit -m "feat(web): redirect watch page to saved language preference"
```

---

### Task 7: Manual verification

**Files:** none (manual browser testing)

- [ ] **Step 1: Start the dev server in the worktree**

```bash
cd /Users/urimchae/Documents/GitHub/forge/.worktrees/feat/web-video-language-switcher/apps/web
pnpm dev
```

Wait for `Ready in ...` in the terminal output.

- [ ] **Step 2: Verify the globe button**

Open `http://localhost:3000/watch/jesus/english`. Confirm the globe icon is visible at the top-right of the hero area.

- [ ] **Step 3: Verify the modal opens and search works**

Click the globe. Confirm the overlay opens with title "Language", a count like "200+ languages", a pill-shaped trigger labelled "English", and Close/Apply buttons. Click the trigger; confirm a popover with a search input appears. Type "Span"; confirm the list narrows to "Spanish".

- [ ] **Step 4: Verify Apply navigates and persists**

Pick "Spanish"; confirm Apply switches from disabled (grey) to enabled (white). Click Apply. Confirm:

1. The URL becomes `/watch/jesus/spanish?t=<N>` and the player resumes near the same point.
2. DevTools → Application → Cookies → `localhost` → `forge_watch_lang = spanish`, Path `/watch`, Max-Age ~ 1 year, SameSite `Lax`.

- [ ] **Step 5: Verify persistence on another video**

Navigate to any other video known to have a Spanish variant (e.g. open the home page and click any sibling). Confirm the URL is rewritten to `/watch/<slug>/spanish` (server redirect) on load, not the English link you clicked.

- [ ] **Step 6: Verify fallback when no Spanish variant exists**

Navigate to a video that lacks Spanish. Confirm the page renders in the URL locale (no redirect, no error).

- [ ] **Step 7: Verify Close cancels**

Open the modal, change selection, click Close. Confirm the URL is unchanged and no cookie write has occurred (re-open the modal — the trigger label is still the original language).

- [ ] **Step 8: Final typecheck + test sweep**

```bash
pnpm --filter @forge/web typecheck && pnpm --filter @forge/web test
```

Expected: clean + all green.

- [ ] **Step 9: Push the branch**

```bash
git push -u origin feat/web-video-language-switcher
```

---

## Self-review

**Spec coverage:**

- Globe trigger at top-right of hero → Task 4
- Replace LanguagePickerModal internals → Task 3
- Searchable language dropdown → Task 2
- Apply disabled until change → Task 3 (test in Step 2, behaviour in Step 4)
- Close cancels with no nav → Task 3
- Existing nav behaviour (`/<slug>/<draftSlug>?t=<n>`) preserved → Task 3 (handleApply)
- Cookie write on Apply → Task 3 (handleApply calls `writePreferredLanguageSlug` before `router.push`)
- Server redirect to canonical URL → Task 6
- Tests for modal, combobox, helpers → Tasks 1, 2, 3
- Out-of-scope items (subtitles, scroll-pinned globe, clear-preference UI, schema changes) → not in any task ✓

**Placeholder scan:** no TBD/TODO; every code step contains the actual code. The HeroPlayer overlay-wrapper note in Task 4 Step 3 is hedged ("if the overlay wrapper does not currently span the full hero") because the file's structure has multiple acceptable insertion points — the engineer reads ~15 lines and picks. Acceptable.

**Type consistency:**

- `LANGUAGE_PREFERENCE_COOKIE` exported from both `language-preference-client.ts` (Task 1 Step 3) and `language-preference-server.ts` (Task 1 Step 4); both equal `"forge_watch_lang"`. ✓
- `shouldRedirectForPreference` input shape (Task 1 Step 4) accepts `language?: { slug?: string | null } | null` — compatible with `WatchVideoRecord.variants` element shape (gql.tada). ✓
- `LanguageComboboxOption = { slug: string; name: string }` (Task 2) matches the `options` array shape constructed in `LanguagePickerModal` (Task 3 Step 4). ✓
- `LanguagePickerVariant` (Task 3) unchanged from current export — re-exported by the rewritten file. ✓
- `writePreferredLanguageSlug(slug: string): void` declared in Task 1, mocked + asserted in Task 3 test, called in Task 3 component. ✓

No fixes needed.
