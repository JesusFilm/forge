"use client"

import {
  forwardRef,
  useLayoutEffect,
  type ChangeEventHandler,
  type ComponentProps,
  type FormEvent,
  type MouseEventHandler,
  type RefObject,
} from "react"
import { Search } from "lucide-react"
import { useTranslations } from "next-intl"

import { GLASS_OUTLINE_CLASS } from "@/lib/glass-outline"

const FIELD_BASE_CLASS = `group flex h-[52px] min-w-0 cursor-text items-center gap-3 rounded-[35px] px-6 py-3 text-left shadow-xl ${GLASS_OUTLINE_CLASS} transition-[top,opacity,background-color,color] duration-300 ease-out focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2`

const FIELD_GLASS_CLASS =
  "bg-white/10 text-white backdrop-blur-[10px] hover:bg-white hover:text-stone-950"

const FIELD_SOLID_CLASS = "bg-white text-stone-950"

export function useFloatingSearchInputAutofocus(
  open: boolean,
  inputRef: RefObject<HTMLInputElement | null>,
) {
  useLayoutEffect(() => {
    if (!open) return
    let cancelled = false
    const focusInput = () => {
      if (cancelled) return
      inputRef.current?.focus({ preventScroll: true })
    }
    focusInput()
    const frame = window.requestAnimationFrame(focusInput)
    const timer = window.setTimeout(focusInput, 100)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [inputRef, open])
}

export function FloatingSearchFieldButton({
  display,
  mobileDisplay,
  isPlaceholder,
  className,
  iconTestId = "floating-search-icon",
  ...props
}: {
  display: string
  mobileDisplay?: string
  isPlaceholder: boolean
  className?: string
  iconTestId?: string
} & ComponentProps<"button">) {
  const textClassName = `min-w-0 truncate transition-colors duration-300 group-hover:text-stone-950 ${
    isPlaceholder ? "text-white/90" : "text-white"
  }`

  return (
    <button
      type="button"
      {...props}
      className={`${FIELD_BASE_CLASS} ${FIELD_GLASS_CLASS} ${className ?? ""}`}
    >
      <Search
        aria-hidden
        data-testid={iconTestId}
        className="h-6 w-6 shrink-0 text-white/85 transition-colors duration-300 group-hover:text-stone-950"
      />
      {mobileDisplay ? (
        <>
          <span className={`${textClassName} md:hidden`}>{mobileDisplay}</span>
          <span className={`${textClassName} hidden md:inline`}>{display}</span>
        </>
      ) : (
        <span className={textClassName}>{display}</span>
      )}
    </button>
  )
}

export const FloatingSearchFieldInput = forwardRef<
  HTMLInputElement,
  {
    value: string
    onChange: ChangeEventHandler<HTMLInputElement>
    onSubmit: (query: string) => void
    onClear?: MouseEventHandler<HTMLButtonElement>
    wrapperClassName?: string
    inputClassName?: string
    iconTestId?: string
  } & Omit<
    ComponentProps<"input">,
    "className" | "enterKeyHint" | "onChange" | "onSubmit" | "type" | "value"
  >
>(function FloatingSearchFieldInput(
  {
    value,
    onChange,
    onSubmit,
    onClear,
    wrapperClassName,
    inputClassName,
    iconTestId = "floating-search-input-icon",
    ...props
  },
  ref,
) {
  const t = useTranslations("FloatingSearch")
  const hasValue = value.trim().length > 0
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!hasValue) return
    onSubmit(value)
  }

  return (
    <form
      role="search"
      aria-label={t("searchRegion")}
      onSubmit={handleSubmit}
      className={`${FIELD_BASE_CLASS} ${FIELD_SOLID_CLASS} !gap-2 !px-2 !py-1 ${wrapperClassName ?? ""}`}
    >
      <button
        type="submit"
        aria-label={t("searchRegion")}
        disabled={!hasValue}
        className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-stone-950 text-white transition-[background-color,color,transform] hover:bg-stone-700 active:scale-95 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-stone-400 focus-visible:outline-2 focus-visible:outline-stone-950/50 focus-visible:outline-offset-2"
      >
        <Search
          aria-hidden
          data-testid={iconTestId}
          className="h-5 w-5 shrink-0"
        />
      </button>
      <input
        ref={ref}
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={onChange}
        className={`min-w-0 flex-1 cursor-text appearance-none bg-transparent text-base text-stone-950 outline-none placeholder:text-stone-500 [&::-webkit-search-cancel-button]:appearance-none ${inputClassName ?? ""}`}
        {...props}
      />
      {hasValue && onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={t("clearSearch")}
          className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-950/5 hover:text-stone-950 focus-visible:outline-2 focus-visible:outline-stone-950/50 focus-visible:outline-offset-2"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <line x1={18} y1={6} x2={6} y2={18} />
            <line x1={6} y1={6} x2={18} y2={18} />
          </svg>
        </button>
      ) : null}
    </form>
  )
})
