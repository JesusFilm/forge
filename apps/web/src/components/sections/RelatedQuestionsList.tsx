"use client"

import { useState } from "react"
import {
  WatchFaqList,
  type WatchFaqItem,
} from "@/components/watch/WatchFaqList"

/**
 * The client half of `RelatedQuestions`: only the single-open accordion
 * state. Answers arrive already rendered, so no Markdown parser ships here.
 */
export function RelatedQuestionsList({
  items,
}: {
  items: readonly WatchFaqItem[]
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  // One row at a time. `<details>` reports React's own writes back through
  // `onToggle`, so closing a row must match on identity — otherwise the echo
  // from the row React just closed would clear the row the user opened.
  const handleToggle = (toggledId: string, isOpen: boolean) => {
    setOpenId((current) => {
      if (isOpen) return toggledId
      return current === toggledId ? null : current
    })
  }

  return (
    <WatchFaqList
      items={items}
      openIds={openId == null ? [] : [openId]}
      onToggle={handleToggle}
      itemTestId="RelatedQuestionsItem"
    />
  )
}
