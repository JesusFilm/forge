export const dynamic = "force-dynamic"

export default async function AgenticStudioPage() {
  return (
    <div className="studio-page studio-page--agentic-studio">
      <iframe
        className="agentic-studio-frame"
        src="/api/agentic-studio"
        title="Agentic Studio"
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups"
        referrerPolicy="same-origin"
      />
    </div>
  )
}
