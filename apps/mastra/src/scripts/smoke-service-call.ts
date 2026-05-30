import { callMastraSmoke } from "../client/service-client"

const result = await callMastraSmoke({
  baseUrl: process.env.MASTRA_BASE_URL,
  bearer: process.env.MASTRA_SERVICE_API_KEY,
  input: process.argv.slice(2).join(" ") || "smoke",
})

console.log(JSON.stringify(result))
process.exit(result.ok ? 0 : 1)
