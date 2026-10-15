import { useLocale, useMessages } from "next-intl"
import { useMemo } from "react"

import { createCountTranslator, type CountTranslator } from "./count-format"

/**
 * Client counterpart of {@link createCountTranslator}: translates count
 * messages from the provider's catalog with hydration-stable numbers.
 */
export function useCountTranslations(namespace: string): CountTranslator {
  const locale = useLocale()
  const messages = useMessages()
  return useMemo(
    () => createCountTranslator({ locale, messages, namespace }),
    [locale, messages, namespace],
  )
}
