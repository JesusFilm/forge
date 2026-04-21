export default function DashboardLoading() {
  return (
    <div
      className="flex min-h-[50vh] items-center justify-center px-6 py-16"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-[32rem] rounded-[2rem] border border-border bg-card px-8 py-10 text-center shadow-[0_24px_56px_rgba(8,8,8,0.08)]">
        <span className="block text-[15px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Studio UI
        </span>
        <strong className="mt-4 block text-[28px] font-semibold tracking-[-0.03em] text-foreground">
          Loading workspace
        </strong>
        <p className="mt-3 text-[18px] leading-7 tracking-[-0.02em] text-muted-foreground">
          Pulling the latest dashboard state.
        </p>
      </div>
    </div>
  )
}
