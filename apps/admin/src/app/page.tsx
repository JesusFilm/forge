import Link from "next/link"
import { getAdminMessages } from "@/i18n/server"

export default async function HomePage() {
  const messages = await getAdminMessages()

  return (
    <main>
      <h1>{messages.home.title}</h1>
      <p>{messages.home.description}</p>
      <ul>
        <li>
          <Link href={messages.home.links.login}>
            {messages.home.links.login}
          </Link>
        </li>
        <li>
          <Link href={messages.home.links.dashboard}>
            {messages.home.links.dashboard}
          </Link>
        </li>
        <li>
          <Link href={messages.home.links.systemStatus}>
            {messages.home.links.systemStatus}
          </Link>
        </li>
        <li>
          <a href={messages.home.links.health}>{messages.home.links.health}</a>
        </li>
      </ul>
    </main>
  )
}
