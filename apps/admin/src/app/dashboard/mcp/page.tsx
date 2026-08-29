import type { ReactNode } from "react"

import { requireAdminSession } from "@/auth/session"
import { getAdminMcpProtectedResourceMetadata } from "@/mcp/admin-mcp-metadata"

import { CopyPrompt } from "./copy-command"
import { PlatformActionPicker } from "./platform-action"

const pluginInstall = `codex plugin marketplace add JesusFilm/forge --sparse .agents/plugins --sparse plugins/jfp-admin
codex plugin add jfp-admin@forge`

const claudePluginInstall = `/plugin marketplace add JesusFilm/forge
/plugin install jfp-admin@forge
/reload-plugins`

const starterPrompts = [
  "Use the forge-bulk-locale-factory skill to create Spanish drafts from English.",
  "Find Experiences missing Spanish locales and give me a plan.",
  "Validate the Spanish locale drafts and list anything that needs review.",
  "Check whether target-language videos exist before creating drafts.",
  "Generate a new draft Experience about hope, then translate it into French.",
  "Duplicate the Easter Experience as an unpublished draft.",
]

export default async function AdminMcpPage() {
  await requireAdminSession()
  const metadata = getAdminMcpProtectedResourceMetadata()
  const mcpCommand = `codex mcp add jfp-admin --url ${metadata.resource}`
  const claudeMcpCommand = `claude mcp add --scope user --transport http jfp-admin ${metadata.resource}`
  const genericMcpConfig = `{
  "name": "jfp-admin",
  "type": "http",
  "url": "${metadata.resource}"
}`

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="border-b border-[var(--color-hairline)] pb-6">
        <div className="label-text">Tools</div>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em]">
          Connect JFP Admin to Your AI App
        </h1>
        <p className="mt-3 max-w-2xl text-[13px] leading-6 text-[var(--color-text-muted)]">
          Give Codex, Claude, or another AI app access to Admin tools.
        </p>
      </header>

      <StepSection number="1" title="Install the plugin">
        <PlatformActionPicker
          label="Plugin install platform"
          actions={{
            codex: {
              command: pluginInstall,
              steps: [
                "Run the commands in your project.",
                "Restart Codex if it asks.",
                "Use the skill name when starting a workflow.",
              ],
            },
            claude: {
              command: claudePluginInstall,
              steps: [
                "Open Claude Code.",
                "Run the slash commands in chat.",
                "Reload plugins before using the skill.",
              ],
            },
            other: {
              note: "Most AI apps do not install Codex or Claude skills. Connect the MCP in the next step.",
              steps: [
                "Skip plugin installation.",
                "Use the MCP connection instead.",
                "Paste one of the starter prompts after connecting.",
              ],
            },
          }}
        />
      </StepSection>

      <StepSection number="2" title="Add the MCP">
        <PlatformActionPicker
          label="MCP setup platform"
          actions={{
            codex: {
              command: mcpCommand,
              steps: [
                "Run the command in your project.",
                "Sign in when Codex asks.",
                "Start a new task after the server is connected.",
              ],
            },
            claude: {
              command: claudeMcpCommand,
              steps: [
                "Run the command in your terminal.",
                "Type /mcp in Claude Code.",
                "Choose JFP Admin and sign in.",
              ],
            },
            other: {
              command: genericMcpConfig,
              steps: [
                "Open connectors or MCP settings.",
                "Add a remote HTTP MCP server.",
                "Paste this configuration and sign in.",
              ],
            },
          }}
        />
      </StepSection>

      <StepSection number="3" title="Start an Admin workflow">
        <div className="grid gap-3 md:grid-cols-2">
          {starterPrompts.map((prompt) => (
            <CopyPrompt key={prompt} value={prompt} />
          ))}
        </div>
      </StepSection>
    </div>
  )
}

function StepSection({
  children,
  number,
  title,
}: {
  children: ReactNode
  number: string
  title: string
}) {
  return (
    <section className="grid gap-4 md:grid-cols-[32px_minmax(0,1fr)]">
      <div className="pt-0.5">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-text-primary)] font-mono text-[12px] font-semibold text-[var(--color-bg)]">
          {number}
        </span>
      </div>
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        <div className="mt-5">{children}</div>
      </div>
    </section>
  )
}
