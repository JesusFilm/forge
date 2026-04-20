"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import type { Route } from "next"

type SearchInputProps = {
  defaultValue?: string
  searchPath?: string
  maxLength?: number
}

export function SearchInput({
  defaultValue = "",
  searchPath = "/search",
  maxLength,
}: SearchInputProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const debouncedNavigate = useCallback(
    (query: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(() => {
        if (query.trim()) {
          router.replace(
            `${searchPath}?q=${encodeURIComponent(query.trim())}` as Route,
          )
        } else {
          router.replace(searchPath as Route)
        }
      }, 300)
    },
    [router, searchPath],
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newValue = e.target.value
    setValue(newValue)
    debouncedNavigate(newValue)
  }

  return (
    <div className="relative w-full">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
        <svg
          className="h-5 w-5 text-stone-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        maxLength={maxLength}
        placeholder="Search for videos..."
        className="w-full rounded-xl bg-stone-800 py-3 pl-12 pr-4 text-stone-100 placeholder-stone-500 outline-none ring-stone-600 transition focus:ring-2"
      />
    </div>
  )
}
