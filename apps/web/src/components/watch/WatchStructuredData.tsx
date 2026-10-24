export function WatchStructuredData({
  json,
}: {
  json: string | null | undefined
}) {
  if (!json) return null

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}
