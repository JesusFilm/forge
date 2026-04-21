"use client"

import { useState } from "react"
import { SearchInput } from "@/components/search/SearchInput"
import { setGeneratePending, setSearchPending } from "@/lib/demo-generate-bus"
import { GenerateShortcutButton } from "./GenerateShortcutButton"

// URL flag appended on Enter submit. AiExperienceGeneratorDemo reads it on
// mount and auto-runs (then strips it), so Enter always regenerates even
// after the navigation re-keys the component.
const AUTOGEN_QUERY_PARAM = "ag"

// DOM id on the hero bar container — scroll target for the "Try another
// prompt!" button after a successful generation.
export const DEMO_SEARCH_INPUT_ID = "demo-search-input"

const MAX_QUERY_LENGTH = 200

type DemoSearchInputProps = {
  defaultValue?: string
}

export function DemoSearchInput({ defaultValue = "" }: DemoSearchInputProps) {
  // The underlying SearchInput keeps its own value; we mirror the length here
  // for the counter. Kept in sync via the input event bubbling up.
  const [length, setLength] = useState(defaultValue.length)

  return (
    <div id={DEMO_SEARCH_INPUT_ID} className="scroll-mt-24">
      <div
        className="flex flex-col gap-3 rounded-3xl border border-stone-800 bg-stone-900/50 p-3 shadow-2xl shadow-black/40 md:flex-row md:items-center"
        onInput={(event) => {
          const target = event.target as HTMLInputElement
          setLength(target.value.length)
        }}
      >
        <div className="flex-1">
          <SearchInput
            defaultValue={defaultValue}
            searchPath="/demo-search"
            maxLength={MAX_QUERY_LENGTH}
            // Flip both spinners on the instant Enter is pressed. The
            // search spinner is cleared once the new
            // AiExperienceGeneratorDemo mounts (Suspense resolved); the
            // generate spinner is cleared when its autogen run finishes.
            onSubmit={() => {
              setSearchPending(true)
              setGeneratePending(true)
            }}
            extraQueryOnSubmit={`${AUTOGEN_QUERY_PARAM}=1`}
            size="lg"
          />
        </div>
        <GenerateShortcutButton />
      </div>
      <div className="mt-2 flex justify-end">
        <span
          className={
            length >= MAX_QUERY_LENGTH
              ? "text-xs font-medium text-amber-400"
              : "text-xs text-stone-500"
          }
        >
          {length} / {MAX_QUERY_LENGTH}
        </span>
      </div>
    </div>
  )
}
