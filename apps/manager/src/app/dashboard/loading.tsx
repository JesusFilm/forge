export default function DashboardLoading() {
  return (
    <div className="studio-shell-state" role="status" aria-live="polite">
      <div className="studio-shell-state-card studio-shell-state-card--loading">
        <span className="studio-shell-state-eyebrow">Studio UI</span>
        <strong>Loading workspace</strong>
        <p>Pulling the latest dashboard state.</p>
      </div>
    </div>
  )
}
