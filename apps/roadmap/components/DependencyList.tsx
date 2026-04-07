import Link from "next/link"

type Props = {
  label: string
  ids: string[]
}

export default function DependencyList({ label, ids }: Props) {
  if (ids.length === 0) return null

  return (
    <div>
      <h4 className="mb-1 text-sm font-medium text-stone-400">{label}</h4>
      <ul className="space-y-1">
        {ids.map((id) => (
          <li key={id}>
            <Link
              href={`/ticket/${id}`}
              className="text-sm text-blue-400 hover:text-blue-300 hover:underline"
            >
              {id}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
