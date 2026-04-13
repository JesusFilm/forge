export type SubtitleReviewPopup = {
  opener: unknown
  location: {
    href: string
  }
  close: () => void
}

export type SubtitleReviewOpenWindow = (
  url: string,
  target: string,
) => SubtitleReviewPopup | null

export type SubtitleReviewCurrentTab = {
  assign: (url: string) => void
}

export function openSubtitleReviewPopup(
  openWindow: SubtitleReviewOpenWindow,
): SubtitleReviewPopup | null {
  const popup = openWindow("about:blank", "_blank")
  if (popup) {
    popup.opener = null
  }

  return popup
}

export function completeSubtitleReviewLaunch(
  popup: SubtitleReviewPopup | null,
  editorUrl: string,
  currentTab: SubtitleReviewCurrentTab,
): void {
  if (popup) {
    popup.location.href = editorUrl
    return
  }

  currentTab.assign(editorUrl)
}

export function closeSubtitleReviewPopup(
  popup: SubtitleReviewPopup | null,
): void {
  popup?.close()
}
