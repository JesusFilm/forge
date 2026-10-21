export const WATCH_MODAL_PAGE_SCROLL_VIEWPORT_CLASS =
  "fixed inset-0 z-50 flex overflow-x-hidden overflow-y-auto p-4"

export const WATCH_MODAL_PAGE_SCROLL_CONTENT_CLASS = "m-auto shrink-0"

// Footer actions can be wider than a phone dialog at 200% text. The label
// and icon may wrap onto their own lines, and a word wider than the column
// may break, so the ink stays inside the pill instead of painting past it.
export const WATCH_MODAL_ACTION_WRAP_CLASS =
  "max-w-full shrink flex-wrap gap-y-1 text-center whitespace-normal [overflow-wrap:anywhere]"

// From `sm` up the close button is fixed to the viewport corner, 1rem in from
// the edge and 3rem wide. A dialog wider than the viewport minus both gutters
// slides under it once the dialog scrolls, and the close then eats clicks meant
// for the controls beneath. `10rem` is two close gutters (2 x 4rem) plus a 1rem
// margin for a classic scrollbar. It is rem-based so large text widens it.
export const WATCH_MODAL_FILM_WIDTH_CLASS =
  "w-full max-w-[min(90vw,608px)] sm:max-w-[min(608px,calc(100vw-10rem))]"

export const WATCH_MODAL_COLLECTION_WIDTH_CLASS =
  "w-full max-w-[min(94vw,960px)] sm:max-w-[min(960px,calc(100vw-10rem))]"
