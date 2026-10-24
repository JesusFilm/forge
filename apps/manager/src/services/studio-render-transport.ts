import { readStudioBytes, type StudioCaller } from "@forge/studio-server"
import { studioServiceRequest } from "./studio-agent/transport"
import { StudioBrokerError, type StudioBrokerClient } from "./studio-broker"

/** This caller and its assertions stay in the credential-bearing broker. Never
 * send them to the rendering service, browser, model or delegated author agent. */
export function studioRenderClient(signal?: AbortSignal) {
  const caller: StudioCaller = {
    sub: "shorts-render-worker",
    authority: "delegated",
    clientId: "shorts-render",
    scopes: ["shorts:render:execute"],
  }
  const call = async (command: string, input: unknown) => {
    const response = await studioServiceRequest(
      "admin",
      caller,
      {
        action: "render-worker",
        command,
        input,
      },
      signal,
    )
    const data = JSON.parse(await readStudioBytes(response, 2097152)) as {
      result: unknown
    }
    return data.result
  }
  const assets: StudioBrokerClient = (action, input) => {
    if (
      ![
        "asset",
        "asset-read",
        "asset-upload",
        "preview-sources",
        "source",
      ].includes(action)
    )
      throw new StudioBrokerError(
        "Render asset capability does not grant authoring authority",
      )
    return call(action, input)
  }
  return { call, assets }
}
