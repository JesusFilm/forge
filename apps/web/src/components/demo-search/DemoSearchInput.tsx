"use client"

import { useState } from "react"
import { SearchInput } from "@/components/search/SearchInput"
import { requestGenerate } from "@/lib/demo-generate-bus"

const MAX_QUERY_LENGTH = 200

type DemoSearchInputProps = {
  defaultValue?: string
}

export function DemoSearchInput({ defaultValue = "" }: DemoSearchInputProps) {
  // The underlying SearchInput keeps its own value; we mirror the length here
  // for the counter. Kept in sync via the input event bubbling up.
  const [length, setLength] = useState(defaultValue.length)

  return (
    <div>
      <div
        onInput={(event) => {
          const target = event.target as HTMLInputElement
          setLength(target.value.length)
        }}
      >
        <SearchInput
          defaultValue={defaultValue}
          searchPath="/demo-search"
          maxLength={MAX_QUERY_LENGTH}
          onSubmit={requestGenerate}
        />
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
