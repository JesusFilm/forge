import { Search } from "lucide-react"
import { AdminStubPage } from "@/components/admin-stub-page"
import { getAdminMessages } from "@/i18n/server"

export default async function SearchPage() {
  const messages = await getAdminMessages()

  return (
    <AdminStubPage
      common={messages.common}
      page={messages.pages.search}
      icon={Search}
    />
  )
}
