export const WATCH_MODAL_PAGE_SCROLL_VIEWPORT_CLASS =
  "fixed inset-0 z-50 flex overflow-x-hidden overflow-y-auto p-4"

export const WATCH_MODAL_PAGE_SCROLL_CONTENT_CLASS = "m-auto shrink-0"

// Footer actions can be wider than a phone dialog at 200% text. The label
// and icon may wrap onto their own lines, and a word wider than the column
// may break, so the ink stays inside the pill instead of painting past it.
export const WATCH_MODAL_ACTION_WRAP_CLASS =
  "max-w-full shrink flex-wrap gap-y-1 text-center whitespace-normal [overflow-wrap:anywhere]"
