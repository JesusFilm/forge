"use client"

export function DownloadButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="watch-download-button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-stone-700 bg-stone-800 px-5 py-2.5 text-sm font-semibold text-stone-100 transition hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
    >
      <DownloadIcon />
      <span>Download</span>
    </button>
  )
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
