import Link from "next/link"

export default function HomePage() {
  return (
    <main>
      <h1>Forge Admin</h1>
      <p>
        Scaffolding in place. See{" "}
        <code>
          docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md
        </code>
        .
      </p>
      <ul>
        <li>
          <Link href="/login">/login</Link>
        </li>
        <li>
          <Link href="/dashboard">/dashboard</Link>
        </li>
        <li>
          <Link href="/dashboard/system-status">/dashboard/system-status</Link>
        </li>
        <li>
          <a href="/api/health">/api/health</a>
        </li>
      </ul>
    </main>
  )
}
