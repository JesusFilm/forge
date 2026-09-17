import { useRef, useState } from "react"

export type StableActionKey = ReturnType<typeof createStableActionKey>

export function createStableActionKey(
  generate: () => string = () => globalThis.crypto.randomUUID(),
) {
  let key: string | null = null

  return {
    current() {
      key ??= generate()
      return key
    },
    peek() {
      return key
    },
    complete() {
      key = null
    },
  }
}

export function useStableActionKey() {
  const key = useRef<StableActionKey | null>(null)
  const [, render] = useState(0)
  key.current ??= createStableActionKey()

  return {
    current() {
      const value = key.current!.current()
      render((version) => version + 1)
      return value
    },
    peek() {
      return key.current!.peek()
    },
    complete() {
      key.current!.complete()
      render((version) => version + 1)
    },
  }
}
