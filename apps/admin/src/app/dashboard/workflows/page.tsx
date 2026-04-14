import { Workflow } from "lucide-react"
import { AdminStubPage } from "@/components/admin-stub-page"
import { getAdminMessages } from "@/i18n/server"

export default async function WorkflowsPage() {
  const messages = await getAdminMessages()

  return (
    <AdminStubPage
      common={messages.common}
      page={messages.pages.workflows}
      icon={Workflow}
    />
  )
}
