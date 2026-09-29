import { useMemo, useSyncExternalStore } from "react"
import type {
  MessageKeys,
  NamespaceKeys,
  NestedKeyOf,
  NestedValueOf,
} from "use-intl/core"

import {
  getActiveTranslator,
  getLocaleEpoch,
  subscribeLocale,
} from "./localeStore"
import type { TranslationValues, UiTranslator } from "./translator"

/** messages/en.json is the source of truth for keys (KTD5). */
export type UiMessages = typeof import("../../messages/en.json")

export type UiNamespace = NamespaceKeys<UiMessages, NestedKeyOf<UiMessages>>

type NamespaceMessages<NS extends UiNamespace> = NestedValueOf<UiMessages, NS>

export type UiMessageKey<NS extends UiNamespace> = MessageKeys<
  NamespaceMessages<NS>,
  NestedKeyOf<NamespaceMessages<NS>>
>

export type UiT<NS extends UiNamespace> = (
  key: UiMessageKey<NS>,
  values?: TranslationValues,
) => string

function bind<NS extends UiNamespace>(
  namespace: NS,
  translator: () => UiTranslator,
): UiT<NS> {
  return (key, values) => translator().translate(`${namespace}.${key}`, values)
}

/** The store's epoch, as a React subscription (KTD2). */
export function useLocaleEpoch(): number {
  return useSyncExternalStore(subscribeLocale, getLocaleEpoch, getLocaleEpoch)
}

// UI text for React code. A catalog change re-renders the component and
// gives `t` a new identity, so an effect that lists `t` runs again.
export function useT<NS extends UiNamespace>(namespace: NS): UiT<NS> {
  // The epoch is the change signal: the memo reads the translator for it.
  const epoch = useLocaleEpoch()
  return useMemo(() => {
    const translator = getActiveTranslator()
    return bind(namespace, () => translator)
  }, [namespace, epoch])
}

// UI text for `.ts` code outside React only (KTD2). It reads the catalog in
// use at each call, so a long-lived function stays current.
export function getT<NS extends UiNamespace>(namespace: NS): UiT<NS> {
  return bind(namespace, getActiveTranslator)
}
