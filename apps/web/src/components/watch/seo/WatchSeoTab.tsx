"use client"

/**
 * Import this file directly so the tab does not eagerly load the workspace.
 * Place inside the parent's tablist after Admin capability is confirmed.
 * The parent owns selection, roving tabIndex and arrow-key navigation.
 */
export function WatchSeoTab({
  id,
  panelId,
  selected,
  onSelect,
  tabIndex = 0,
}: {
  id: string
  panelId: string
  selected: boolean
  onSelect: () => void
  tabIndex?: 0 | -1
}) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-controls={panelId}
      aria-selected={selected}
      tabIndex={tabIndex}
      onClick={onSelect}
      className={`min-h-11 cursor-pointer rounded-sm border-b-2 px-1 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white ${selected ? "border-brand-red text-stone-100" : "border-transparent text-stone-300 hover:text-stone-100"}`}
    >
      SEO &amp; Marketing
    </button>
  )
}
