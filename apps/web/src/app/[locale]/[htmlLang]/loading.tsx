export default function Loading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading watch home"
      className="min-h-screen bg-black text-white"
    >
      <div className="relative min-h-[82svh] animate-pulse bg-stone-900 pt-32">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#111827,#4c1d1d_52%,#064e3b)] opacity-70" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-8">
          <div className="max-w-3xl space-y-5">
            <div className="h-3 w-32 rounded bg-white/20" />
            <div className="h-14 w-5/6 rounded bg-white/15 sm:h-20" />
            <div className="h-5 w-2/3 rounded bg-white/15" />
            <div className="flex gap-3">
              <div className="h-12 w-32 rounded-lg bg-white/20" />
              <div className="h-12 w-36 rounded-lg bg-white/10" />
            </div>
          </div>
          <div className="hidden gap-3 lg:grid">
            <div className="h-28 rounded-lg bg-white/10" />
            <div className="h-28 rounded-lg bg-white/10" />
            <div className="h-28 rounded-lg bg-white/10" />
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-7xl space-y-10 px-4 py-12 sm:px-6 lg:px-8">
        {[0, 1].map((section) => (
          <div key={section} className="space-y-5">
            <div className="h-3 w-36 rounded bg-white/15" />
            <div className="h-8 w-80 max-w-full rounded bg-white/15" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((card) => (
                <div
                  key={card}
                  className="aspect-[16/10] rounded-lg bg-white/10"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
